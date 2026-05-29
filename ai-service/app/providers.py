from __future__ import annotations

import asyncio
import json
import os
import re
from typing import AsyncGenerator

import httpx

from app.models import AIRewriteResponse, RewriteRequest
from app.rewrite_engine import build_diffs, evaluate_texts, rewrite_locally

# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------

_RETRYABLE_STATUS_CODES = {429, 502, 503}


async def _call_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    max_retries: int = 3,
    base_delay: float = 0.5,
    **kwargs,
) -> httpx.Response:
    """Send an HTTP request with exponential backoff on transient errors."""
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            response = await client.request(method, url, **kwargs)
            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                await asyncio.sleep(delay)
                continue
            response.raise_for_status()
            return response
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in _RETRYABLE_STATUS_CODES and attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                await asyncio.sleep(delay)
                last_exc = exc
                continue
            raise
        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                await asyncio.sleep(delay)
                last_exc = exc
                continue
            raise
    # Should not reach here, but satisfy type checker
    assert last_exc is not None
    raise last_exc


# ---------------------------------------------------------------------------
# Prompt helpers (static system content first for prompt caching)
# ---------------------------------------------------------------------------

def provider_system_prompt() -> str:
    """Return the static system prompt.

    Kept entirely static so that providers supporting prompt caching
    (e.g. Anthropic, OpenAI) can cache this block across requests.
    """
    return (
        "You rewrite text ethically. Preserve meaning, facts, numbers, citations, quotes, and named entities. "
        "For humanize mode, make the writing sound natural, specific, and human-edited without changing the idea. "
        "Prefer concrete verbs, varied sentence rhythm, contractions where appropriate, and plain human phrasing. "
        "Avoid stock AI phrases, generic filler, exaggerated claims, over-polished corporate language, and detector-bypass claims. "
        "Return only valid compact JSON with key rewrittenText."
    )


def provider_user_prompt(request: RewriteRequest) -> str:
    """Return the dynamic user prompt containing mode/tone/strength and the text to rewrite."""
    return json.dumps(
        {
            "mode": request.mode,
            "tone": request.tone,
            "strength": request.strength,
            "meaningLock": request.meaning_lock,
            "text": request.text,
        }
    )


# ---------------------------------------------------------------------------
# Token counting helpers
# ---------------------------------------------------------------------------

def _estimate_tokens(text: str) -> int:
    """Rough token estimate when the provider does not return usage data."""
    return max(1, len(text) // 4)


def _extract_token_counts(
    usage: dict | None,
    input_text: str,
    output_text: str,
) -> tuple[int, int]:
    """Return (input_tokens, output_tokens) from a usage dict, with fallback."""
    if usage:
        input_tokens = (
            usage.get("prompt_tokens")
            or usage.get("input_tokens")
            or _estimate_tokens(input_text)
        )
        output_tokens = (
            usage.get("completion_tokens")
            or usage.get("output_tokens")
            or _estimate_tokens(output_text)
        )
        return int(input_tokens), int(output_tokens)
    return _estimate_tokens(input_text), _estimate_tokens(output_text)


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------

def extract_json_object(content: str) -> str:
    """Extract the first complete JSON object from a string."""
    stripped = content.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        return stripped

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise json.JSONDecodeError("No JSON object found in provider response", stripped, 0)
    return stripped[start : end + 1]


# ---------------------------------------------------------------------------
# Response builder
# ---------------------------------------------------------------------------

def parse_provider_text(
    content: str,
    request: RewriteRequest,
    provider: str,
    *,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> AIRewriteResponse:
    """Parse a provider JSON response and build an AIRewriteResponse."""
    parsed = json.loads(extract_json_object(content))
    rewritten_text = str(parsed.get("rewrittenText", "")).strip()
    if not rewritten_text:
        return rewrite_locally(request)

    _input_tokens = input_tokens if input_tokens is not None else _estimate_tokens(request.text)
    _output_tokens = output_tokens if output_tokens is not None else _estimate_tokens(rewritten_text)

    evaluation = evaluate_texts(request.text, rewritten_text, request.meaning_lock)
    diffs = build_diffs(request.text, rewritten_text, evaluation.meaning_score)
    return AIRewriteResponse(
        rewrittenText=rewritten_text,
        provider=provider,
        diffs=diffs,
        evaluation=evaluation,
        input_tokens=_input_tokens,
        output_tokens=_output_tokens,
    )


# ---------------------------------------------------------------------------
# Non-streaming providers
# ---------------------------------------------------------------------------

async def rewrite_with_provider(request: RewriteRequest) -> AIRewriteResponse:
    """Dispatch to the appropriate provider and return a full response."""
    if request.provider == "openai-compatible":
        return await rewrite_with_openai_compatible(request)
    if request.provider == "ollama":
        return await rewrite_with_ollama(request)
    return rewrite_locally(request)


async def rewrite_with_openai_compatible(request: RewriteRequest) -> AIRewriteResponse:
    api_key = os.getenv("OPENAI_COMPATIBLE_API_KEY", "")
    base_url = os.getenv("OPENAI_COMPATIBLE_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_COMPATIBLE_MODEL", "gpt-4.1-mini")
    if not api_key:
        return rewrite_locally(request)

    payload = {
        "model": model,
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": provider_system_prompt()},
            {"role": "user", "content": provider_user_prompt(request)},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await _call_with_retry(
                client,
                "POST",
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage")
        input_tokens, output_tokens = _extract_token_counts(usage, request.text, content)
        return parse_provider_text(
            content,
            request,
            "openai-compatible",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
    except Exception:
        return rewrite_locally(request)


async def rewrite_with_ollama(request: RewriteRequest) -> AIRewriteResponse:
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "gemma4:latest")

    payload = {
        "model": model,
        "format": "json",
        "stream": False,
        "messages": [
            {"role": "system", "content": provider_system_prompt()},
            {"role": "user", "content": provider_user_prompt(request)},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await _call_with_retry(
                client,
                "POST",
                f"{base_url}/api/chat",
                json=payload,
            )
        data = response.json()
        content = data["message"]["content"]
        # Ollama exposes eval_count (output tokens) and prompt_eval_count (input tokens)
        usage = {
            "prompt_tokens": data.get("prompt_eval_count"),
            "completion_tokens": data.get("eval_count"),
        }
        input_tokens, output_tokens = _extract_token_counts(usage, request.text, content)
        return parse_provider_text(
            content,
            request,
            "ollama",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
    except Exception:
        return rewrite_locally(request)


# ---------------------------------------------------------------------------
# Streaming generator
# ---------------------------------------------------------------------------

async def rewrite_streaming(request: RewriteRequest) -> AsyncGenerator[str, None]:
    """Yield text chunks from the provider as they arrive.

    For the local provider, sentences are yielded one at a time.
    For openai-compatible, SSE chunks are forwarded as they stream.
    For Ollama, streaming JSON lines are forwarded as they arrive.
    """
    if request.provider == "openai-compatible":
        async for chunk in _stream_openai_compatible(request):
            yield chunk
        return

    if request.provider == "ollama":
        async for chunk in _stream_ollama(request):
            yield chunk
        return

    # Local provider: yield sentence by sentence
    async for chunk in _stream_local(request):
        yield chunk


async def _stream_local(request: RewriteRequest) -> AsyncGenerator[str, None]:
    """Yield the local rewrite result sentence by sentence."""
    result = rewrite_locally(request)
    sentences = _split_sentences(result.rewritten_text)
    for sentence in sentences:
        if sentence:
            yield sentence
            # Small yield-point so the event loop can interleave other tasks
            await asyncio.sleep(0)


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences, preserving trailing punctuation and spacing."""
    # Split after sentence-ending punctuation followed by whitespace or end of string
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    result: list[str] = []
    for i, part in enumerate(parts):
        if i < len(parts) - 1:
            result.append(part + " ")
        else:
            result.append(part)
    return result


async def _stream_openai_compatible(request: RewriteRequest) -> AsyncGenerator[str, None]:
    """Stream text chunks from an OpenAI-compatible SSE endpoint."""
    api_key = os.getenv("OPENAI_COMPATIBLE_API_KEY", "")
    base_url = os.getenv("OPENAI_COMPATIBLE_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_COMPATIBLE_MODEL", "gpt-4.1-mini")

    if not api_key:
        async for chunk in _stream_local(request):
            yield chunk
        return

    payload = {
        "model": model,
        "temperature": 0.3,
        "stream": True,
        "messages": [
            {"role": "system", "content": provider_system_prompt()},
            {"role": "user", "content": provider_user_prompt(request)},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    text_chunk = delta.get("content")
                    if text_chunk:
                        yield text_chunk
    except Exception:
        # Fall back to local streaming on any error
        async for chunk in _stream_local(request):
            yield chunk


async def _stream_ollama(request: RewriteRequest) -> AsyncGenerator[str, None]:
    """Stream text chunks from the Ollama streaming API."""
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "gemma4:latest")

    payload = {
        "model": model,
        "stream": True,
        "messages": [
            {"role": "system", "content": provider_system_prompt()},
            {"role": "user", "content": provider_user_prompt(request)},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            async with client.stream(
                "POST",
                f"{base_url}/api/chat",
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    text_chunk = data.get("message", {}).get("content")
                    if text_chunk:
                        yield text_chunk
                    if data.get("done"):
                        break
    except Exception:
        # Fall back to local streaming on any error
        async for chunk in _stream_local(request):
            yield chunk

from __future__ import annotations

import json
import os

import httpx

from app.models import AIRewriteResponse, RewriteRequest
from app.rewrite_engine import build_diffs, evaluate_texts, rewrite_locally


async def rewrite_with_provider(request: RewriteRequest) -> AIRewriteResponse:
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

    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "temperature": 0.3,
                "messages": [
                    {"role": "system", "content": provider_system_prompt()},
                    {"role": "user", "content": provider_user_prompt(request)},
                ],
            },
        )
        response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return parse_provider_text(content, request, "openai-compatible")


async def rewrite_with_ollama(request: RewriteRequest) -> AIRewriteResponse:
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "gemma4:latest")
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            f"{base_url}/api/chat",
            json={
                "model": model,
                "format": "json",
                "stream": False,
                "messages": [
                    {"role": "system", "content": provider_system_prompt()},
                    {"role": "user", "content": provider_user_prompt(request)},
                ],
            },
        )
        response.raise_for_status()
    content = response.json()["message"]["content"]
    return parse_provider_text(content, request, "ollama")


def provider_system_prompt() -> str:
    return (
        "You rewrite text ethically. Preserve meaning, facts, numbers, citations, quotes, and named entities. "
        "For humanize mode, make the writing sound natural, specific, and human-edited without changing the idea. "
        "Prefer concrete verbs, varied sentence rhythm, contractions where appropriate, and plain human phrasing. "
        "Avoid stock AI phrases, generic filler, exaggerated claims, over-polished corporate language, and detector-bypass claims. "
        "Return only valid compact JSON with key rewrittenText."
    )


def provider_user_prompt(request: RewriteRequest) -> str:
    return json.dumps(
        {
            "mode": request.mode,
            "tone": request.tone,
            "strength": request.strength,
            "meaningLock": request.meaning_lock,
            "text": request.text,
        }
    )


def parse_provider_text(content: str, request: RewriteRequest, provider: str) -> AIRewriteResponse:
    parsed = json.loads(extract_json_object(content))
    rewritten_text = str(parsed.get("rewrittenText", "")).strip()
    if not rewritten_text:
        return rewrite_locally(request)
    evaluation = evaluate_texts(request.text, rewritten_text, request.meaning_lock)
    diffs = build_diffs(request.text, rewritten_text, evaluation.meaning_score)
    return AIRewriteResponse(rewrittenText=rewritten_text, provider=provider, diffs=diffs, evaluation=evaluation)


def extract_json_object(content: str) -> str:
    stripped = content.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        return stripped

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise json.JSONDecodeError("No JSON object found in provider response", stripped, 0)
    return stripped[start : end + 1]

from __future__ import annotations

import json
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from httpx import HTTPError
from pydantic import ValidationError
from prometheus_fastapi_instrumentator import Instrumentator

from app.models import AIRewriteResponse, EvaluationRequest, RewriteEvaluation, RewriteRequest
from app import providers
from app.providers import rewrite_with_provider
from app.rewrite_engine import evaluate_request

app = FastAPI(title="OpenRewrite AI Service", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app)

_MAX_TEXT_CHARS = 15000


@app.middleware("http")
async def validate_request_size(request: Request, call_next):
    if request.method == "POST":
        body = await request.body()
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = {}
        text = payload.get("text", "")
        if isinstance(text, str) and len(text) > _MAX_TEXT_CHARS:
            return StreamingResponse(
                iter([
                    json.dumps({
                        "detail": (
                            f"Request text exceeds maximum allowed length of "
                            f"{_MAX_TEXT_CHARS} characters "
                            f"(received {len(text)} characters)."
                        )
                    }).encode()
                ]),
                status_code=422,
                media_type="application/json",
            )
        # Re-attach the body so downstream handlers can read it
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request = Request(request.scope, receive)
    return await call_next(request)


@app.get("/health")
async def health() -> dict:
    models_loaded: bool = False
    spacy_loaded: bool = False

    try:
        from app.rewrite_engine import _model  # type: ignore
        models_loaded = _model is not None
    except Exception:
        pass

    try:
        import spacy
        spacy_loaded = spacy.util.is_package("en_core_web_sm") or bool(spacy.util.get_installed_models())
    except Exception:
        pass

    provider = os.environ.get("AI_PROVIDER", "unknown")
    status = "ok" if models_loaded else "degraded"

    return {
        "status": status,
        "models_loaded": models_loaded,
        "spacy_loaded": spacy_loaded,
        "provider": provider,
        "version": "0.2.0",
    }


@app.post("/rewrite", response_model=AIRewriteResponse, response_model_by_alias=True)
async def rewrite(request: RewriteRequest) -> AIRewriteResponse:
    try:
        return await rewrite_with_provider(request)
    except (HTTPError, KeyError, json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=502, detail=f"provider failed: {exc}") from exc


@app.post("/rewrite/stream")
async def rewrite_stream(request: RewriteRequest):
    async def event_generator():
        async for chunk in providers.rewrite_streaming(request):
            yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/evaluate", response_model=RewriteEvaluation, response_model_by_alias=True)
async def evaluate(request: EvaluationRequest) -> RewriteEvaluation:
    return evaluate_request(request)

from __future__ import annotations

import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from httpx import HTTPError
from pydantic import ValidationError

from app.models import AIRewriteResponse, EvaluationRequest, RewriteEvaluation, RewriteRequest
from app.providers import rewrite_with_provider
from app.rewrite_engine import evaluate_request

app = FastAPI(title="OpenRewrite AI Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/rewrite", response_model=AIRewriteResponse, response_model_by_alias=True)
async def rewrite(request: RewriteRequest) -> AIRewriteResponse:
    try:
        return await rewrite_with_provider(request)
    except (HTTPError, KeyError, json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=502, detail=f"provider failed: {exc}") from exc


@app.post("/evaluate", response_model=RewriteEvaluation, response_model_by_alias=True)
async def evaluate(request: EvaluationRequest) -> RewriteEvaluation:
    return evaluate_request(request)

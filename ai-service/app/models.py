from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


RewriteMode = Literal["standard", "fluency", "professional", "simple", "shorten", "expand", "natural", "humanize", "academic"]
RewriteTone = Literal["neutral", "warm", "direct", "formal", "confident", "friendly"]
RewriteProvider = Literal["local", "openai-compatible", "ollama"]
DiffStatus = Literal["unchanged", "light", "changed", "high-risk"]


class RewriteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str = Field(min_length=1, max_length=12_000)
    mode: RewriteMode
    tone: RewriteTone
    strength: int = Field(ge=0, le=100)
    meaning_lock: bool = Field(alias="meaningLock")
    provider: RewriteProvider = "local"

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("text is required")
        return normalized


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    original_text: str = Field(alias="originalText", min_length=1)
    rewritten_text: str = Field(alias="rewrittenText", min_length=1)
    meaning_lock: bool = Field(default=True, alias="meaningLock")


class SentenceDiff(BaseModel):
    index: int
    original: str
    rewritten: str
    change_ratio: float = Field(alias="changeRatio")
    status: DiffStatus


class RewriteWarning(BaseModel):
    code: str
    message: str
    sentence_index: int | None = Field(default=None, alias="sentenceIndex")
    confidence: float


class RewriteEvaluation(BaseModel):
    meaning_score: float = Field(alias="meaningScore")
    confidence_score: float = Field(alias="confidenceScore")
    humanizer_score: float = Field(alias="humanizerScore")
    naturalness_score: float = Field(alias="naturalnessScore")
    style_notes: list[str] = Field(default_factory=list, alias="styleNotes")
    facts_preserved: bool = Field(alias="factsPreserved")
    citations_preserved: bool = Field(alias="citationsPreserved")
    warnings: list[RewriteWarning]


class AIRewriteResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rewritten_text: str = Field(alias="rewrittenText")
    provider: str
    diffs: list[SentenceDiff]
    evaluation: RewriteEvaluation

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


RewriteMode = Literal["standard", "fluency", "professional", "simple", "shorten", "expand", "natural", "humanize", "academic"]
RewriteTone = Literal["neutral", "warm", "direct", "formal", "confident", "friendly"]
RewriteProvider = Literal["local", "openai-compatible", "ollama"]
DiffStatus = Literal["unchanged", "light", "changed", "high-risk"]


class QualityTier(str, Enum):
    EXCELLENT = "excellent"   # meaning >= 0.9, confidence >= 0.85
    GOOD = "good"             # meaning >= 0.75, confidence >= 0.70
    FAIR = "fair"             # meaning >= 0.60, confidence >= 0.55
    POOR = "poor"             # below thresholds


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
    # New evaluation fields
    readability_score: float = Field(default=0.0, alias="readabilityScore", ge=0.0, le=1.0)
    sentence_variety_score: float = Field(default=0.0, alias="sentenceVarietyScore", ge=0.0, le=1.0)
    passive_voice_reduced: bool = Field(default=False, alias="passiveVoiceReduced")
    ai_signatures_removed: int = Field(default=0, alias="aiSignaturesRemoved")
    word_count_delta: int = Field(default=0, alias="wordCountDelta")
    quality_tier: QualityTier = Field(default=QualityTier.FAIR, alias="qualityTier")


class AIRewriteResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rewritten_text: str = Field(alias="rewrittenText")
    provider: str
    diffs: list[SentenceDiff]
    evaluation: RewriteEvaluation
    input_tokens: int = Field(default=0, alias="inputTokens")
    output_tokens: int = Field(default=0, alias="outputTokens")

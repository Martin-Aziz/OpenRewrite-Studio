from app.models import EvaluationRequest, RewriteRequest
from app.rewrite_engine import evaluate_humanizer_quality, evaluate_request, rewrite_locally, split_sentences


def test_split_sentences_handles_multiple_boundaries() -> None:
    assert split_sentences("One. Two! Three?") == ["One.", "Two!", "Three?"]


def test_local_rewrite_preserves_numbers() -> None:
    request = RewriteRequest(
        text="The team shipped 12 updates in 2026.",
        mode="natural",
        tone="warm",
        strength=50,
        meaningLock=True,
        provider="local",
    )

    response = rewrite_locally(request)

    assert "12" in response.rewritten_text
    assert response.evaluation.facts_preserved is True


def test_evaluation_warns_when_number_is_missing() -> None:
    request = EvaluationRequest(originalText="Revenue grew 42% in 2026.", rewrittenText="Revenue grew last year.", meaningLock=True)

    evaluation = evaluate_request(request)

    assert evaluation.facts_preserved is False
    assert any(warning.code == "NUMBER_CHANGED" for warning in evaluation.warnings)


def test_humanizer_quality_penalizes_stock_phrases() -> None:
    humanizer_score, naturalness_score, notes = evaluate_humanizer_quality(
        "It is important to note that this robust solution will significantly improve communication."
    )

    assert humanizer_score < 0.8
    assert naturalness_score < 0.9
    assert any("generic" in note.lower() for note in notes)


def test_humanize_mode_returns_style_scores() -> None:
    request = RewriteRequest(
        text="It is important to note that our organization will utilize this workflow to improve communication.",
        mode="humanize",
        tone="warm",
        strength=70,
        meaningLock=True,
        provider="local",
    )

    response = rewrite_locally(request)

    assert response.evaluation.humanizer_score > 0
    assert response.evaluation.naturalness_score > 0
    assert response.evaluation.style_notes

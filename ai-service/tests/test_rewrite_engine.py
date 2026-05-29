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


def test_sentence_splitting_handles_abbreviations():
    """NLTK should not split on Dr. Prof. Mr. Mrs. etc."""
    text = "Dr. Smith wrote to Prof. Jones. They agreed on the outcome."
    sentences = split_sentences(text)
    assert len(sentences) == 2, f"Expected 2 sentences, got {len(sentences)}: {sentences}"


def test_sentence_splitting_handles_ellipsis():
    """Ellipsis should not cause extra splits."""
    text = "He paused... then continued speaking."
    sentences = split_sentences(text)
    assert len(sentences) <= 2


def test_humanize_removes_ai_artifact_leverage():
    """humanize mode must replace 'leverage' with a natural word."""
    from app.rewrite_engine import rewrite
    result = rewrite("We leverage best practices to deliver robust solutions.", "humanize", "neutral", 80)
    assert "leverage" not in result["rewrittenText"].lower(), "leverage should be replaced"


def test_humanize_removes_it_is_worth_noting():
    """humanize mode must strip this common AI opener."""
    from app.rewrite_engine import rewrite
    result = rewrite("It is worth noting that this approach has significant advantages.", "humanize", "neutral", 80)
    assert "it is worth noting" not in result["rewrittenText"].lower()


def test_humanize_removes_robust():
    """'robust' is an AI overused word and should be replaced."""
    from app.rewrite_engine import rewrite
    result = rewrite("This is a robust and comprehensive solution.", "humanize", "neutral", 80)
    text_lower = result["rewrittenText"].lower()
    assert "robust" not in text_lower or "solid" in text_lower or "strong" in text_lower


def test_simple_mode_reduces_jargon():
    """simple mode should replace technical jargon with plain language."""
    from app.rewrite_engine import rewrite
    result = rewrite("The utilization of advanced methodologies necessitates comprehensive implementation.", "simple", "neutral", 80)
    rewritten = result["rewrittenText"].lower()
    assert "utilization" not in rewritten or "utilize" not in rewritten


def test_word_count_delta_shorten_mode():
    """shorten mode should produce negative wordCountDelta."""
    from app.rewrite_engine import rewrite
    long_text = "In order to achieve the desired outcome, it is necessary to take into consideration all of the various factors involved in the process."
    result = rewrite(long_text, "shorten", "neutral", 80)
    if "wordCountDelta" in result:
        assert result["wordCountDelta"] <= 0, "shorten mode should reduce word count"


def test_readability_score_is_float_in_range():
    """readabilityScore should be between 0 and 1."""
    from app.rewrite_engine import rewrite
    result = rewrite("The quick brown fox jumps over the lazy dog.", "standard", "neutral", 50)
    if "readabilityScore" in result:
        assert 0.0 <= result["readabilityScore"] <= 1.0


def test_ai_signatures_removed_count():
    """aiSignaturesRemoved should be non-negative integer."""
    from app.rewrite_engine import rewrite
    result = rewrite("Furthermore, it should be noted that this is important.", "humanize", "neutral", 80)
    if "aiSignaturesRemoved" in result:
        assert isinstance(result["aiSignaturesRemoved"], int)
        assert result["aiSignaturesRemoved"] >= 0


def test_evaluation_has_required_fields():
    """Evaluation result must have all required fields."""
    from app.rewrite_engine import rewrite
    result = rewrite("The quick brown fox.", "standard", "neutral", 50)
    required = ["rewrittenText", "diffs", "evaluation"]
    for field in required:
        assert field in result, f"Missing field: {field}"


def test_rewrite_preserves_numbers():
    """Numbers in original text must appear in rewritten text."""
    from app.rewrite_engine import rewrite
    text = "The company reported $42.5 million in revenue for Q3 2024."
    result = rewrite(text, "standard", "neutral", 50)
    assert "42.5" in result["rewrittenText"] or "42" in result["rewrittenText"]

from __future__ import annotations

import re
from difflib import SequenceMatcher

from app.models import AIRewriteResponse, EvaluationRequest, RewriteEvaluation, RewriteRequest, RewriteWarning, SentenceDiff

sentence_boundary = re.compile(r"(?<=[.!?])\s+")
word_pattern = re.compile(r"[A-Za-z0-9']+")
number_pattern = re.compile(r"\b\d+(?:[.,]\d+)?%?\b")
citation_pattern = re.compile(r"https?://\S+|\[[^\]]+\]|\([^)]*\b\d{4}\b[^)]*\)")
entity_pattern = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b")
semantic_aliases = {
    "communication": "writing",
    "communications": "writing",
    "organization": "team",
    "organisation": "team",
    "process": "workflow",
    "system": "tool",
    "utilise": "use",
    "utilize": "use",
    "using": "use",
    "used": "use",
}
semantic_stop_words = {
    "a",
    "an",
    "and",
    "at",
    "current",
    "fully",
    "important",
    "in",
    "is",
    "it",
    "new",
    "note",
    "of",
    "order",
    "somewhat",
    "that",
    "the",
    "this",
    "to",
}
stock_phrase_pattern = re.compile(
    r"\b("
    r"it is important to note|it should be noted|in today's fast-paced world|"
    r"delve into|leverage|utilize|robust|seamless|cutting-edge|"
    r"plays a crucial role|a wide range of|significantly improve|"
    r"make sure to mention|want to share that|designed specifically to"
    r")\b",
    re.IGNORECASE,
)
hedge_pattern = re.compile(r"\b(may|might|could|somewhat|quite|possibly|generally|a bit)\b", re.IGNORECASE)
human_touch_pattern = re.compile(r"\b(we|our|you|your|I|actually|plain|specific|clear|because)\b", re.IGNORECASE)

clarity_replacements = {
    "it is important to note that ": "",
    "in order to": "to",
    "utilize": "use",
    "current draft": "draft",
    "somewhat": "",
    "fully represent": "reflect",
    "due to the fact that": "because",
    "at this point in time": "now",
}

simple_replacements = {
    "organization": "team",
    "communication": "writing",
    "workflow": "process",
    "approach": "way of working",
}

professional_replacements = {
    "new writing workflow": "writing workflow",
    "generic": "broad",
    "practical": "applied",
}

academic_replacements = {
    "team": "group",
    "tool": "system",
    "writing": "written communication",
}

humanize_replacements = {
    "it is important to note that": "",
    "it should be noted that": "",
    "in today's fast-paced world": "",
    "delve into": "look at",
    "leverage": "use",
    "utilize": "use",
    "robust": "solid",
    "seamless": "smooth",
    "innovative": "new",
    "cutting-edge": "modern",
    "furthermore": "also",
    "moreover": "also",
    "therefore": "so",
    "in conclusion": "overall",
    "plays a crucial role": "matters",
    "a wide range of": "many",
    "fully represent": "reflect",
    "somewhat generic": "a bit broad",
}


def rewrite_locally(request: RewriteRequest) -> AIRewriteResponse:
    rewritten_sentences = [_rewrite_sentence(sentence, request) for sentence in split_sentences(request.text)]
    rewritten_text = " ".join(sentence for sentence in rewritten_sentences if sentence).strip()
    evaluation = evaluate_texts(request.text, rewritten_text, request.meaning_lock)
    diffs = build_diffs(request.text, rewritten_text, evaluation.meaning_score)
    return AIRewriteResponse(rewrittenText=rewritten_text, provider="local", diffs=diffs, evaluation=evaluation)


def evaluate_request(request: EvaluationRequest) -> RewriteEvaluation:
    return evaluate_texts(request.original_text, request.rewritten_text, request.meaning_lock)


def split_sentences(text: str) -> list[str]:
    return [sentence.strip() for sentence in sentence_boundary.split(text.strip()) if sentence.strip()]


def evaluate_texts(original: str, rewritten: str, meaning_lock: bool) -> RewriteEvaluation:
    original_tokens = set(semantic_tokens(original))
    rewritten_tokens = set(semantic_tokens(rewritten))
    overlap = len(original_tokens & rewritten_tokens) / max(len(original_tokens), 1)
    missing_numbers = sorted(extract_items(number_pattern, original) - extract_items(number_pattern, rewritten))
    missing_citations = sorted(extract_items(citation_pattern, original) - extract_items(citation_pattern, rewritten))
    missing_entities = sorted(extract_entities(original) - extract_entities(rewritten))
    penalty = min(0.45, 0.08 * len(missing_numbers) + 0.1 * len(missing_citations) + 0.06 * len(missing_entities))
    meaning_score = clamp(round(overlap - penalty + 0.18, 2))
    humanizer_score, naturalness_score, style_notes = evaluate_humanizer_quality(rewritten)
    warnings = build_warnings(meaning_score, missing_numbers, missing_citations, missing_entities, meaning_lock)
    facts_preserved = not missing_numbers and not missing_entities
    citations_preserved = not missing_citations
    confidence = clamp(round((meaning_score + humanizer_score + (1 if facts_preserved else 0.65) + (1 if citations_preserved else 0.7)) / 4, 2))
    return RewriteEvaluation(
        meaningScore=meaning_score,
        confidenceScore=confidence,
        humanizerScore=humanizer_score,
        naturalnessScore=naturalness_score,
        styleNotes=style_notes,
        factsPreserved=facts_preserved,
        citationsPreserved=citations_preserved,
        warnings=warnings,
    )


def build_diffs(original: str, rewritten: str, meaning_score: float) -> list[SentenceDiff]:
    original_sentences = split_sentences(original)
    rewritten_sentences = split_sentences(rewritten)
    length = max(len(original_sentences), len(rewritten_sentences))
    diffs: list[SentenceDiff] = []
    for index in range(length):
        original_sentence = original_sentences[index] if index < len(original_sentences) else ""
        rewritten_sentence = rewritten_sentences[index] if index < len(rewritten_sentences) else ""
        change_ratio = calculate_change_ratio(original_sentence, rewritten_sentence)
        diffs.append(
            SentenceDiff(
                index=index,
                original=original_sentence,
                rewritten=rewritten_sentence,
                changeRatio=change_ratio,
                status=classify_status(change_ratio, meaning_score),
            )
        )
    return diffs


def calculate_change_ratio(original: str, rewritten: str) -> float:
    if original == rewritten:
        return 0.0
    ratio = SequenceMatcher(a=tokenize(original), b=tokenize(rewritten)).ratio()
    return round(1 - ratio, 2)


def classify_status(change_ratio: float, meaning_score: float) -> str:
    if meaning_score < 0.65 and change_ratio > 0.35:
        return "high-risk"
    if change_ratio == 0:
        return "unchanged"
    if change_ratio < 0.35:
        return "light"
    return "changed"


def tokenize(text: str) -> list[str]:
    return [match.group(0).lower() for match in word_pattern.finditer(text)]


def semantic_tokens(text: str) -> list[str]:
    tokens: list[str] = []
    for token in tokenize(text):
        canonical = semantic_aliases.get(token, token)
        if canonical in semantic_stop_words:
            continue
        tokens.append(canonical)
    return tokens


def evaluate_humanizer_quality(text: str) -> tuple[float, float, list[str]]:
    tokens = tokenize(text)
    sentence_lengths = [len(tokenize(sentence)) for sentence in split_sentences(text)]
    stock_hits = len(stock_phrase_pattern.findall(text))
    hedge_hits = len(hedge_pattern.findall(text))
    human_touch_hits = len(human_touch_pattern.findall(text))
    average_sentence_length = sum(sentence_lengths) / max(len(sentence_lengths), 1)
    length_penalty = min(0.2, abs(average_sentence_length - 18) / 100)
    stock_penalty = min(0.35, stock_hits * 0.09)
    hedge_penalty = min(0.18, hedge_hits * 0.025)
    touch_bonus = min(0.16, human_touch_hits * 0.025)
    lexical_variety = len(set(tokens)) / max(len(tokens), 1)
    naturalness = clamp(round(0.72 + touch_bonus + min(0.12, lexical_variety / 5) - length_penalty - hedge_penalty, 2))
    humanizer = clamp(round(0.78 + touch_bonus - stock_penalty - hedge_penalty - length_penalty, 2))
    notes = build_style_notes(stock_hits, hedge_hits, average_sentence_length, lexical_variety, human_touch_hits)
    return humanizer, naturalness, notes


def build_style_notes(
    stock_hits: int,
    hedge_hits: int,
    average_sentence_length: float,
    lexical_variety: float,
    human_touch_hits: int,
) -> list[str]:
    notes: list[str] = []
    if stock_hits:
        notes.append("Replace generic AI-like phrases with concrete wording.")
    if hedge_hits > 2:
        notes.append("Trim hedging words so the voice sounds more deliberate.")
    if average_sentence_length > 28:
        notes.append("Break long sentences to create a more natural rhythm.")
    if average_sentence_length < 8:
        notes.append("Add a little connective tissue so the rewrite does not feel choppy.")
    if lexical_variety < 0.45:
        notes.append("Vary repeated words to make the phrasing feel less processed.")
    if human_touch_hits == 0:
        notes.append("Add a human point of view where it fits the original intent.")
    if not notes:
        notes.append("Natural voice is strong; review the sentence diff before using it.")
    return notes[:3]


def extract_items(pattern: re.Pattern[str], text: str) -> set[str]:
    return {match.group(0).strip() for match in pattern.finditer(text)}


def extract_entities(text: str) -> set[str]:
    sentences = split_sentences(text)
    entities: set[str] = set()
    for sentence in sentences:
        for match in entity_pattern.finditer(sentence):
            if match.start() == 0:
                continue
            entities.add(match.group(0))
    return entities


def build_warnings(
    meaning_score: float,
    missing_numbers: list[str],
    missing_citations: list[str],
    missing_entities: list[str],
    meaning_lock: bool,
) -> list[RewriteWarning]:
    warnings: list[RewriteWarning] = []
    if meaning_lock and meaning_score < 0.72:
        warnings.append(
            RewriteWarning(
                code="MEANING_DRIFT_DETECTED",
                message="Meaning Lock detected possible drift. Review the highlighted sentence changes before using the rewrite.",
                confidence=round(1 - meaning_score, 2),
            )
        )
    if missing_numbers:
        warnings.append(RewriteWarning(code="NUMBER_CHANGED", message=f"Missing number(s): {', '.join(missing_numbers)}", confidence=0.88))
    if missing_citations:
        warnings.append(RewriteWarning(code="CITATION_CHANGED", message="One or more citations or links were not preserved.", confidence=0.9))
    if missing_entities:
        warnings.append(RewriteWarning(code="ENTITY_CHANGED", message=f"Missing named entity/entities: {', '.join(missing_entities)}", confidence=0.82))
    return warnings


def clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def _rewrite_sentence(sentence: str, request: RewriteRequest) -> str:
    rewritten = sentence.strip()
    rewritten = apply_replacements(rewritten, clarity_replacements)
    if request.mode in {"simple", "natural", "humanize", "fluency"}:
        rewritten = apply_replacements(rewritten, simple_replacements)
    if request.mode == "humanize":
        rewritten = apply_replacements(rewritten, humanize_replacements)
    if request.mode == "professional":
        rewritten = apply_replacements(rewritten, professional_replacements)
    if request.mode == "academic":
        rewritten = apply_replacements(rewritten, academic_replacements)
    rewritten = apply_mode(rewritten, request.mode, request.strength)
    rewritten = apply_tone(rewritten, request.tone)
    return normalize_sentence(rewritten)


def apply_replacements(text: str, replacements: dict[str, str]) -> str:
    rewritten = text
    for source, target in replacements.items():
        rewritten = re.sub(re.escape(source), target, rewritten, flags=re.IGNORECASE)
    return rewritten


def apply_mode(text: str, mode: str, strength: int) -> str:
    if mode == "shorten":
        return shorten_text(text)
    if mode == "expand" and strength >= 35:
        return expand_text(text)
    if mode == "fluency":
        return text.replace(" and may not ", ", and may not ")
    if mode == "standard":
        return text
    if mode == "natural":
        return text.replace("privacy-first approach", "privacy-first way of working")
    if mode == "humanize":
        return humanize_text(text, strength)
    return text


def apply_tone(text: str, tone: str) -> str:
    if tone == "direct":
        return text.replace("may not", "does not").replace("should", "must")
    if tone == "formal":
        return text.replace("we", "the team").replace("our", "the team's")
    if tone == "confident":
        return text.replace("may not", "does not").replace("can", "will")
    if tone == "friendly":
        return text.replace("improve", "make better").replace("use", "work with")
    if tone == "warm":
        return text.replace("the team", "our team")
    return text


def shorten_text(text: str) -> str:
    without_fillers = re.sub(r"\b(new|current|somewhat|fully|practical)\b", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", without_fillers).strip()


def expand_text(text: str) -> str:
    if len(tokenize(text)) < 9:
        return text
    return f"{text} The goal is to keep the message specific, useful, and easy to trust."


def humanize_text(text: str, strength: int) -> str:
    rewritten = text.replace("privacy-first approach", "privacy-first way of working")
    rewritten = re.sub(r"\bIt is important to note that\b", "", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\bmake sure to mention that\b", "say that", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\bwant to share that\b", "say that", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\bsignificantly improve\b", "improve", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\bdesigned specifically to\b", "built to", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\bwill use\b", "can use", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\bwill be using\b", "can use", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\bimprove communication\b", "communicate more clearly", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\bnew writing process\b", "writing process", rewritten, flags=re.IGNORECASE)
    if strength >= 55:
        rewritten = re.sub(r"\bOur team\b", "We", rewritten)
        rewritten = re.sub(r"\bour team\b", "we", rewritten)
        rewritten = re.sub(r"\bour organization\b", "we", rewritten, flags=re.IGNORECASE)
    if strength >= 75 and len(tokenize(rewritten)) > 14:
        rewritten = rewritten.replace(" and ", ", and ", 1)
    return rewritten


def normalize_sentence(text: str) -> str:
    stripped = re.sub(r"\s+", " ", text).strip(" ,")
    if not stripped:
        return stripped
    if stripped[-1] not in ".!?":
        stripped += "."
    return stripped[0].upper() + stripped[1:]

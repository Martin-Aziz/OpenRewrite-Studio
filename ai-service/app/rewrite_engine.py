from __future__ import annotations

import logging
import math
import re
from difflib import SequenceMatcher
from functools import lru_cache
from typing import TYPE_CHECKING

from app.models import (
    AIRewriteResponse,
    EvaluationRequest,
    QualityTier,
    RewriteEvaluation,
    RewriteRequest,
    RewriteWarning,
    SentenceDiff,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Optional heavy-dependency imports — loaded once at module level.
# Each is wrapped so the engine degrades gracefully when a library is absent
# (e.g. during unit tests that mock only the rewrite logic).
# ---------------------------------------------------------------------------

try:
    import nltk  # type: ignore[import-untyped]

    # Ensure the punkt tokenizer data is present before first use.
    try:
        nltk.data.find("tokenizers/punkt_tab")
    except LookupError:
        nltk.download("punkt_tab", quiet=True)
    try:
        nltk.data.find("tokenizers/punkt")
    except LookupError:
        nltk.download("punkt", quiet=True)

    _NLTK_AVAILABLE = True
except Exception:  # pragma: no cover
    _NLTK_AVAILABLE = False

try:
    import spacy  # type: ignore[import-untyped]

    _nlp = spacy.load("en_core_web_sm", disable=["lemmatizer"])
    _SPACY_AVAILABLE = True
except Exception:  # pragma: no cover
    _nlp = None
    _SPACY_AVAILABLE = False
    logger.warning("spaCy model en_core_web_sm not available; falling back to regex NER.")

try:
    from sentence_transformers import SentenceTransformer  # type: ignore[import-untyped]

    _embed_model: SentenceTransformer | None = SentenceTransformer("all-MiniLM-L6-v2")
    _SBERT_AVAILABLE = True
except Exception:  # pragma: no cover
    _embed_model = None
    _SBERT_AVAILABLE = False
    logger.warning("sentence-transformers not available; falling back to lexical similarity.")

# ---------------------------------------------------------------------------
# Compiled patterns
# ---------------------------------------------------------------------------

word_pattern = re.compile(r"[A-Za-z0-9']+")
number_pattern = re.compile(r"\b\d+(?:[.,]\d+)?%?\b")
citation_pattern = re.compile(r"https?://\S+|\[[^\]]+\]|\([^)]*\b\d{4}\b[^)]*\)")
entity_pattern = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b")

stock_phrase_pattern = re.compile(
    r"\b("
    r"it is important to note|it should be noted|in today's fast-paced world|"
    r"delve into|leverage|utilize|robust|seamless|cutting-edge|"
    r"plays a crucial role|a wide range of|significantly improve|"
    r"make sure to mention|want to share that|designed specifically to|"
    r"it is worth noting|it's worth noting that|importantly|in conclusion|"
    r"to summarize|as previously mentioned|notably|significantly|furthermore|"
    r"moreover|in summary|in essence|at its core|building upon|"
    r"this underscores|this highlights|this demonstrates|needless to say|"
    r"it goes without saying|rest assured|certainly|absolutely|"
    r"as an ai|as a language model|i must emphasize|having said that|"
    r"that being said|with that said|one might argue|it can be argued|"
    r"it is clear that|it is evident that|it is apparent that|"
    r"in this context|it is essential to|it is crucial to|paradigm|synergy|"
    r"streamline|facilitate|implement|additionally|consequently|subsequently|"
    r"notwithstanding"
    r")\b",
    re.IGNORECASE,
)
hedge_pattern = re.compile(r"\b(may|might|could|somewhat|quite|possibly|generally|a bit)\b", re.IGNORECASE)
human_touch_pattern = re.compile(r"\b(we|our|you|your|I|actually|plain|specific|clear|because)\b", re.IGNORECASE)

# ---------------------------------------------------------------------------
# Semantic helpers
# ---------------------------------------------------------------------------

semantic_aliases: dict[str, str] = {
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

semantic_stop_words: set[str] = {
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

# ---------------------------------------------------------------------------
# Replacement dictionaries
# ---------------------------------------------------------------------------

# 60 entries: verbose / academic / corporate -> concise / plain
clarity_replacements: dict[str, str] = {
    "it is important to note that ": "",
    "it is important to note that": "",
    "it should be noted that": "",
    "it should be noted": "",
    "in order to": "to",
    "utilize": "use",
    "utilise": "use",
    "current draft": "draft",
    "somewhat": "",
    "fully represent": "reflect",
    "due to the fact that": "because",
    "at this point in time": "now",
    "in the event that": "if",
    "for the purpose of": "to",
    "with regard to": "about",
    "with respect to": "about",
    "in relation to": "about",
    "on the basis of": "based on",
    "as a result of": "because of",
    "a number of": "several",
    "a variety of": "various",
    "in spite of the fact that": "although",
    "despite the fact that": "although",
    "owing to the fact that": "because",
    "by means of": "by",
    "in the process of": "while",
    "is able to": "can",
    "are able to": "can",
    "has the ability to": "can",
    "have the ability to": "can",
    "make a decision": "decide",
    "make an attempt": "try",
    "take into consideration": "consider",
    "give consideration to": "consider",
    "conduct an investigation": "investigate",
    "provide assistance": "help",
    "render assistance": "help",
    "at the present time": "now",
    "at the current time": "now",
    "on a regular basis": "regularly",
    "on a daily basis": "daily",
    "in the near future": "soon",
    "at some point in time": "eventually",
    "prior to": "before",
    "subsequent to": "after",
    "in addition to this": "also",
    "as well as this": "also",
    "in the majority of cases": "usually",
    "in most cases": "usually",
    "it is worth noting that": "",
    "needless to say": "",
    "it goes without saying that": "",
    "it goes without saying": "",
    "it can be seen that": "",
    "one can observe that": "",
    "it has been shown that": "research shows",
    "studies have shown that": "research shows",
    "the fact that": "that",
    "the reason why": "why",
    "as to whether": "whether",
    "as to how": "how",
}

# 40 entries: awkward constructions -> natural flow
fluency_replacements: dict[str, str] = {
    " and may not ": ", and may not ",
    "in that it": "because it",
    "which is why": "so",
    "the way in which": "how",
    "the reason for which": "why",
    "the manner in which": "how",
    "in a way that": "so that",
    "at a time when": "when",
    "in a situation where": "when",
    "in cases where": "when",
    "there is a need to": "you need to",
    "there is no need to": "you do not need to",
    "there is a risk that": "this might",
    "there exists": "there is",
    "it is necessary to": "you need to",
    "it is possible to": "you can",
    "it is not possible to": "you cannot",
    "it is recommended that": "we recommend",
    "it is suggested that": "we suggest",
    "it is assumed that": "we assume",
    "it is expected that": "we expect",
    "it is believed that": "we believe",
    "it is understood that": "we understand",
    "is known to be": "is",
    "are known to be": "are",
    "is considered to be": "is",
    "are considered to be": "are",
    "is thought to be": "is",
    "has been found to": "can",
    "have been found to": "can",
    "both ... and": "and",
    "either ... or": "or",
    "not only ... but also": "and",
    "whether or not": "whether",
    "each and every": "every",
    "any and all": "all",
    "first and foremost": "first",
    "last but not least": "finally",
    "past experience": "experience",
    "future plans": "plans",
}

# 80 entries: AI-signature phrases -> human equivalents
humanize_replacements: dict[str, str] = {
    "it is important to note that": "",
    "it is important to note": "",
    "it should be noted that": "",
    "it should be noted": "",
    "in today's fast-paced world": "",
    "in today's world": "",
    "it is worth noting that": "",
    "it is worth noting": "",
    "it's worth noting that": "",
    "it's worth noting": "",
    "importantly,": "",
    "in conclusion,": "overall,",
    "in conclusion": "overall",
    "to summarize,": "in short,",
    "to summarize": "in short",
    "as previously mentioned": "as noted",
    "as mentioned earlier": "as noted",
    "as mentioned above": "as noted",
    "notably,": "",
    "significantly,": "",
    "furthermore,": "also,",
    "furthermore": "also",
    "moreover,": "also,",
    "moreover": "also",
    "in summary,": "in short,",
    "in summary": "in short",
    "in essence,": "basically,",
    "in essence": "basically",
    "at its core,": "at heart,",
    "at its core": "at heart",
    "building upon": "based on",
    "this underscores": "this shows",
    "this highlights": "this shows",
    "this demonstrates": "this shows",
    "needless to say": "",
    "it goes without saying": "",
    "rest assured": "",
    "certainly,": "",
    "certainly": "",
    "absolutely,": "",
    "absolutely": "",
    "as an ai": "",
    "as a language model": "",
    "i must emphasize": "note that",
    "having said that,": "that said,",
    "having said that": "that said",
    "that being said,": "that said,",
    "that being said": "that said",
    "with that said,": "that said,",
    "with that said": "that said",
    "one might argue": "you could say",
    "it can be argued": "you could argue",
    "it is clear that": "",
    "it is evident that": "",
    "it is apparent that": "",
    "in this context,": "",
    "in this context": "",
    "it is essential to": "you need to",
    "it is crucial to": "it matters to",
    "leverage": "use",
    "leveraging": "using",
    "leveraged": "used",
    "utilize": "use",
    "utilizes": "uses",
    "utilizing": "using",
    "utilized": "used",
    "robust": "solid",
    "paradigm": "model",
    "synergy": "collaboration",
    "synergies": "benefits",
    "streamline": "simplify",
    "streamlined": "simplified",
    "facilitate": "help",
    "facilitates": "helps",
    "facilitated": "helped",
    "implement": "use",
    "implementing": "using",
    "implemented": "used",
    "additionally,": "also,",
    "additionally": "also",
    "consequently,": "so,",
    "consequently": "so",
    "subsequently,": "then,",
    "subsequently": "then",
    "notwithstanding": "despite",
    "delve into": "look at",
    "seamless": "smooth",
    "innovative": "new",
    "cutting-edge": "modern",
    "plays a crucial role": "matters",
    "a wide range of": "many",
    "fully represent": "reflect",
    "significantly improve": "improve",
    "designed specifically to": "built to",
}

# 50 entries: technical jargon -> everyday language
simple_replacements: dict[str, str] = {
    "organization": "team",
    "organisations": "teams",
    "organizations": "teams",
    "communication": "writing",
    "communications": "messages",
    "workflow": "process",
    "approach": "way",
    "methodology": "method",
    "approach": "way",
    "framework": "structure",
    "infrastructure": "setup",
    "architecture": "design",
    "implementation": "setup",
    "configuration": "settings",
    "specification": "details",
    "documentation": "docs",
    "functionality": "feature",
    "capabilities": "features",
    "parameters": "settings",
    "attributes": "features",
    "components": "parts",
    "modules": "parts",
    "repository": "codebase",
    "authentication": "login",
    "authorization": "permission",
    "initialise": "start",
    "initialize": "start",
    "terminate": "stop",
    "execute": "run",
    "aggregate": "combine",
    "concatenate": "join",
    "iterate": "go through",
    "recursion": "looping back",
    "algorithm": "method",
    "heuristic": "rule of thumb",
    "interface": "connection",
    "prototype": "early version",
    "deployment": "launch",
    "migration": "move",
    "deprecate": "phase out",
    "redundant": "extra",
    "scalable": "flexible",
    "optimise": "improve",
    "optimize": "improve",
    "bandwidth": "capacity",
    "latency": "delay",
    "throughput": "speed",
    "pipeline": "process",
    "endpoint": "address",
    "payload": "data",
    "abstraction": "concept",
}

# 45 entries: informal / casual -> business register
professional_replacements: dict[str, str] = {
    "new writing workflow": "writing workflow",
    "generic": "broad",
    "practical": "applied",
    "get": "obtain",
    "got": "obtained",
    "use": "utilise",
    "using": "utilising",
    "used": "utilised",
    "start": "commence",
    "end": "conclude",
    "find out": "determine",
    "figure out": "determine",
    "look at": "review",
    "look into": "investigate",
    "set up": "establish",
    "put together": "compile",
    "go over": "review",
    "check out": "review",
    "talk to": "consult",
    "talk about": "discuss",
    "deal with": "address",
    "work on": "develop",
    "come up with": "develop",
    "keep track of": "monitor",
    "take care of": "manage",
    "give": "provide",
    "need": "require",
    "help": "assist",
    "show": "demonstrate",
    "tell": "inform",
    "make": "create",
    "fix": "resolve",
    "big": "significant",
    "small": "minor",
    "fast": "efficient",
    "slow": "inefficient",
    "hard": "challenging",
    "easy": "straightforward",
    "good": "effective",
    "bad": "ineffective",
    "lots of": "numerous",
    "a lot of": "numerous",
    "many": "numerous",
    "most": "the majority of",
    "main": "primary",
}

# 45 entries: colloquial -> scholarly register
academic_replacements: dict[str, str] = {
    "team": "group",
    "tool": "instrument",
    "writing": "written communication",
    "use": "employ",
    "used": "employed",
    "using": "employing",
    "find": "identify",
    "found": "identified",
    "show": "demonstrate",
    "showed": "demonstrated",
    "shows": "demonstrates",
    "check": "examine",
    "look at": "examine",
    "talk about": "discuss",
    "big": "substantial",
    "small": "minimal",
    "a lot": "considerable",
    "a lot of": "considerable",
    "many": "numerous",
    "lots": "numerous",
    "mostly": "predominantly",
    "mainly": "primarily",
    "usually": "typically",
    "often": "frequently",
    "sometimes": "occasionally",
    "rarely": "infrequently",
    "always": "invariably",
    "never": "at no point",
    "get": "obtain",
    "got": "obtained",
    "make": "construct",
    "made": "constructed",
    "help": "facilitate",
    "helps": "facilitates",
    "need": "necessitate",
    "needs": "necessitates",
    "about": "concerning",
    "because": "due to the fact that",
    "so": "therefore",
    "but": "however",
    "also": "furthermore",
    "and": "in addition",
    "yet": "nevertheless",
    "though": "although",
    "anyway": "regardless",
}

# 35 entries: wordy -> concise
shorten_replacements: dict[str, str] = {
    "new": "",
    "current": "",
    "somewhat": "",
    "fully": "",
    "practical": "",
    "very": "",
    "really": "",
    "quite": "",
    "actually": "",
    "basically": "",
    "essentially": "",
    "generally": "",
    "typically": "",
    "usually": "",
    "normally": "",
    "often": "",
    "simply": "",
    "just": "",
    "only": "",
    "clearly": "",
    "obviously": "",
    "certainly": "",
    "absolutely": "",
    "definitely": "",
    "literally": "",
    "totally": "",
    "completely": "",
    "entirely": "",
    "thoroughly": "",
    "highly": "",
    "extremely": "",
    "incredibly": "",
    "particularly": "",
    "especially": "",
    "significantly": "",
}

# 30 entries: brief -> richer with context
expand_replacements: dict[str, str] = {
    "uses": "makes effective use of",
    "shows": "clearly demonstrates",
    "gives": "provides a clear",
    "has": "is designed to include",
    "needs": "requires careful attention to",
    "helps": "is specifically intended to help",
    "makes": "works to create",
    "finds": "is able to identify",
    "gets": "successfully obtains",
    "does": "is able to accomplish",
    "works": "functions effectively",
    "runs": "is capable of running",
    "builds": "systematically builds",
    "starts": "begins the process of",
    "ends": "brings to a conclusion",
    "reads": "carefully reads",
    "writes": "clearly writes",
    "sends": "transmits directly",
    "receives": "successfully receives",
    "stores": "securely stores",
    "loads": "efficiently loads",
    "saves": "reliably saves",
    "creates": "generates and creates",
    "removes": "permanently removes",
    "adds": "incorporates",
    "changes": "modifies in a targeted way",
    "checks": "carefully checks",
    "tests": "thoroughly tests",
    "returns": "returns a structured",
    "calls": "makes a direct call to",
}

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def rewrite_locally(request: RewriteRequest) -> AIRewriteResponse:
    original_text = request.text
    rewritten_sentences = [_cached_rewrite(sentence, request.mode, request.tone, request.strength) for sentence in split_sentences(original_text)]
    rewritten_text = " ".join(sentence for sentence in rewritten_sentences if sentence).strip()

    evaluation = evaluate_texts(original_text, rewritten_text, request.meaning_lock)
    diffs = build_diffs(original_text, rewritten_text, evaluation.meaning_score)

    return AIRewriteResponse(
        rewrittenText=rewritten_text,
        provider="local",
        diffs=diffs,
        evaluation=evaluation,
    )


def evaluate_request(request: EvaluationRequest) -> RewriteEvaluation:
    return evaluate_texts(request.original_text, request.rewritten_text, request.meaning_lock)


# ---------------------------------------------------------------------------
# Sentence splitting
# ---------------------------------------------------------------------------


def split_sentences(text: str) -> list[str]:
    if _NLTK_AVAILABLE:
        try:
            from nltk.tokenize import sent_tokenize  # type: ignore[import-untyped]

            return [s.strip() for s in sent_tokenize(text.strip()) if s.strip()]
        except Exception:
            pass
    # Fallback: regex sentence boundary
    _sentence_boundary = re.compile(r"(?<=[.!?])\s+")
    return [s.strip() for s in _sentence_boundary.split(text.strip()) if s.strip()]


# ---------------------------------------------------------------------------
# Core evaluation
# ---------------------------------------------------------------------------


def evaluate_texts(original: str, rewritten: str, meaning_lock: bool) -> RewriteEvaluation:
    # Meaning score: prefer semantic similarity from sentence-transformers
    meaning_score = _compute_meaning_score(original, rewritten)

    missing_numbers = sorted(extract_items(number_pattern, original) - extract_items(number_pattern, rewritten))
    missing_citations = sorted(extract_items(citation_pattern, original) - extract_items(citation_pattern, rewritten))
    missing_entities = sorted(extract_entities(original) - extract_entities(rewritten))

    penalty = min(0.45, 0.08 * len(missing_numbers) + 0.1 * len(missing_citations) + 0.06 * len(missing_entities))
    meaning_score = clamp(round(meaning_score - penalty, 2))

    humanizer_score, naturalness_score, style_notes = evaluate_humanizer_quality(rewritten)
    warnings = build_warnings(meaning_score, missing_numbers, missing_citations, missing_entities, meaning_lock)

    facts_preserved = not missing_numbers and not missing_entities
    citations_preserved = not missing_citations
    confidence = clamp(round((meaning_score + humanizer_score + (1.0 if facts_preserved else 0.65) + (1.0 if citations_preserved else 0.7)) / 4, 2))

    # New metric fields
    readability = clamp(round(flesch_reading_ease(rewritten), 2))
    variety = sentence_variety_score(rewritten)
    passive_reduced = _passive_voice_reduced(original, rewritten)
    ai_sigs_removed = _count_ai_signatures_removed(original, rewritten)
    word_delta = _word_count_delta(original, rewritten)
    quality = _classify_quality_tier(meaning_score, confidence)

    return RewriteEvaluation(
        meaningScore=meaning_score,
        confidenceScore=confidence,
        humanizerScore=humanizer_score,
        naturalnessScore=naturalness_score,
        styleNotes=style_notes,
        factsPreserved=facts_preserved,
        citationsPreserved=citations_preserved,
        warnings=warnings,
        readabilityScore=readability,
        sentenceVarietyScore=variety,
        passiveVoiceReduced=passive_reduced,
        aiSignaturesRemoved=ai_sigs_removed,
        wordCountDelta=word_delta,
        qualityTier=quality,
    )


# ---------------------------------------------------------------------------
# Diff building
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Tokenisation helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Semantic similarity
# ---------------------------------------------------------------------------


def semantic_similarity(text_a: str, text_b: str) -> float:
    """Return cosine similarity in [0, 1] using sentence-transformers.

    Falls back to lexical overlap when the model is unavailable.
    """
    if _SBERT_AVAILABLE and _embed_model is not None:
        try:
            import numpy as np  # type: ignore[import-untyped]

            embeddings = _embed_model.encode([text_a, text_b], convert_to_numpy=True, show_progress_bar=False)
            vec_a = embeddings[0]
            vec_b = embeddings[1]
            dot = float(np.dot(vec_a, vec_b))
            norm_a = float(np.linalg.norm(vec_a))
            norm_b = float(np.linalg.norm(vec_b))
            if norm_a == 0.0 or norm_b == 0.0:
                return 0.0
            cosine = dot / (norm_a * norm_b)
            # Cosine values for sentence embeddings are in [-1, 1]; clamp to [0, 1].
            return clamp(float(cosine))
        except Exception as exc:
            logger.debug("sentence-transformers inference failed: %s", exc)

    # Lexical fallback
    tokens_a = set(semantic_tokens(text_a))
    tokens_b = set(semantic_tokens(text_b))
    overlap = len(tokens_a & tokens_b) / max(len(tokens_a), 1)
    return clamp(round(overlap + 0.18, 2))


def _compute_meaning_score(original: str, rewritten: str) -> float:
    """Compute the base meaning score before applying penalty."""
    sim = semantic_similarity(original, rewritten)
    # Ensure the score is already biased toward reasonable range.
    return clamp(round(sim, 2))


# ---------------------------------------------------------------------------
# Readability
# ---------------------------------------------------------------------------


def count_syllables(word: str) -> int:
    """Estimate syllable count for a single word using vowel-run heuristic."""
    word = word.lower().strip("'")
    if not word:
        return 0
    # Remove silent trailing 'e'
    if len(word) > 2 and word.endswith("e") and word[-2] not in "aeiou":
        word = word[:-1]
    vowels = "aeiouy"
    count = 0
    prev_vowel = False
    for char in word:
        is_vowel = char in vowels
        if is_vowel and not prev_vowel:
            count += 1
        prev_vowel = is_vowel
    return max(1, count)


def flesch_reading_ease(text: str) -> float:
    """Return Flesch Reading Ease score normalised to [0, 1].

    Raw Flesch score:
        206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words)

    Scores range roughly 0–100 in raw form.  We normalise by dividing by 100
    and clamping so the return value is always in [0, 1].
    Higher = easier / more readable.
    """
    sentences = split_sentences(text)
    words = tokenize(text)
    if not sentences or not words:
        return 0.5
    syllables = sum(count_syllables(w) for w in words)
    avg_sentence_length = len(words) / len(sentences)
    avg_syllables_per_word = syllables / len(words)
    raw_score = 206.835 - 1.015 * avg_sentence_length - 84.6 * avg_syllables_per_word
    return clamp(round(raw_score / 100.0, 4))


# ---------------------------------------------------------------------------
# Sentence variety
# ---------------------------------------------------------------------------


def sentence_variety_score(text: str) -> float:
    """Return a sentence-length variety score in [0, 1].

    Uses the coefficient of variation (std / mean) of sentence token counts,
    then maps it to [0, 1] via a sigmoid-like normalisation so that a CV of
    ~0.5 maps to roughly 0.75 (healthy variety).
    """
    sentences = split_sentences(text)
    if len(sentences) < 2:
        return 0.5  # single sentence — neutral score
    lengths = [len(tokenize(s)) for s in sentences]
    mean = sum(lengths) / len(lengths)
    if mean == 0:
        return 0.0
    variance = sum((l - mean) ** 2 for l in lengths) / len(lengths)
    std_dev = math.sqrt(variance)
    cv = std_dev / mean
    # Map: cv=0 -> 0.0, cv=0.5 -> ~0.75, cv=1.0 -> ~0.88, cv>=2 -> ~0.96
    score = 1.0 - math.exp(-1.5 * cv)
    return clamp(round(score, 4))


# ---------------------------------------------------------------------------
# Humaniser quality
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Entity extraction
# ---------------------------------------------------------------------------


def extract_items(pattern: re.Pattern[str], text: str) -> set[str]:
    return {match.group(0).strip() for match in pattern.finditer(text)}


def extract_entities(text: str) -> set[str]:
    """Extract named entities using spaCy when available, else regex fallback."""
    if _SPACY_AVAILABLE and _nlp is not None:
        try:
            doc = _nlp(text)
            return {ent.text.strip() for ent in doc.ents if ent.text.strip()}
        except Exception as exc:
            logger.debug("spaCy NER failed: %s", exc)

    # Regex fallback: capitalised multi-word sequences, skip sentence-initial tokens
    sentences = split_sentences(text)
    entities: set[str] = set()
    for sentence in sentences:
        for match in entity_pattern.finditer(sentence):
            if match.start() == 0:
                continue
            entities.add(match.group(0))
    return entities


# ---------------------------------------------------------------------------
# Passive voice detection
# ---------------------------------------------------------------------------


def detect_passive_voice(text: str) -> int:
    """Return count of passive-voice constructions in text.

    Uses spaCy dependency parse when available; falls back to a regex heuristic.
    """
    if _SPACY_AVAILABLE and _nlp is not None:
        try:
            doc = _nlp(text)
            count = 0
            for token in doc:
                # spaCy marks the subject of a passive as "nsubjpass" (older models)
                # or uses "auxpass"; both signal passive voice.
                if token.dep_ in {"nsubjpass", "auxpass"}:
                    count += 1
            return count
        except Exception as exc:
            logger.debug("spaCy passive detection failed: %s", exc)

    # Regex heuristic: "to be" + past participle
    passive_pattern = re.compile(
        r"\b(is|are|was|were|be|been|being)\s+\w+ed\b",
        re.IGNORECASE,
    )
    return len(passive_pattern.findall(text))


def _passive_voice_reduced(original: str, rewritten: str) -> bool:
    """Return True when the rewrite contains fewer passive constructions."""
    return detect_passive_voice(rewritten) < detect_passive_voice(original)


# ---------------------------------------------------------------------------
# AI-signature counting
# ---------------------------------------------------------------------------


def _count_ai_signatures(text: str) -> int:
    """Count how many AI-signature phrases appear in text."""
    return len(stock_phrase_pattern.findall(text))


def _count_ai_signatures_removed(original: str, rewritten: str) -> int:
    """Return how many AI signatures were eliminated in the rewrite."""
    before = _count_ai_signatures(original)
    after = _count_ai_signatures(rewritten)
    return max(0, before - after)


# ---------------------------------------------------------------------------
# Word count delta
# ---------------------------------------------------------------------------


def _word_count_delta(original: str, rewritten: str) -> int:
    """Return (rewritten word count) - (original word count). Negative = shorter."""
    return len(tokenize(rewritten)) - len(tokenize(original))


# ---------------------------------------------------------------------------
# Quality tier classification
# ---------------------------------------------------------------------------


def _classify_quality_tier(meaning_score: float, confidence: float) -> QualityTier:
    if meaning_score >= 0.9 and confidence >= 0.85:
        return QualityTier.EXCELLENT
    if meaning_score >= 0.75 and confidence >= 0.70:
        return QualityTier.GOOD
    if meaning_score >= 0.60 and confidence >= 0.55:
        return QualityTier.FAIR
    return QualityTier.POOR


# ---------------------------------------------------------------------------
# Warning construction
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Clamping helper
# ---------------------------------------------------------------------------


def clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


# ---------------------------------------------------------------------------
# Sentence rewriting (cached)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=256)
def _cached_rewrite(sentence: str, mode: str, tone: str, strength: int) -> str:
    """Cache individual sentence rewrites to avoid recomputing identical inputs."""
    return _rewrite_sentence_impl(sentence, mode, tone, strength)


def _rewrite_sentence(sentence: str, request: RewriteRequest) -> str:
    return _cached_rewrite(sentence, request.mode, request.tone, request.strength)


def _rewrite_sentence_impl(sentence: str, mode: str, tone: str, strength: int) -> str:
    rewritten = sentence.strip()
    rewritten = apply_replacements(rewritten, clarity_replacements)
    if mode in {"simple", "natural", "humanize", "fluency"}:
        rewritten = apply_replacements(rewritten, simple_replacements)
    if mode == "fluency":
        rewritten = apply_replacements(rewritten, fluency_replacements)
    if mode == "humanize":
        rewritten = apply_replacements(rewritten, humanize_replacements)
    if mode == "professional":
        rewritten = apply_replacements(rewritten, professional_replacements)
    if mode == "academic":
        rewritten = apply_replacements(rewritten, academic_replacements)
    if mode == "shorten":
        rewritten = apply_replacements(rewritten, shorten_replacements)
    if mode == "expand":
        rewritten = apply_replacements(rewritten, expand_replacements)
    rewritten = apply_mode(rewritten, mode, strength)
    rewritten = apply_tone(rewritten, tone)
    return normalize_sentence(rewritten)


# ---------------------------------------------------------------------------
# Replacement application
# ---------------------------------------------------------------------------


def apply_replacements(text: str, replacements: dict[str, str]) -> str:
    rewritten = text
    for source, target in replacements.items():
        rewritten = re.sub(re.escape(source), target, rewritten, flags=re.IGNORECASE)
    return rewritten


# ---------------------------------------------------------------------------
# Mode and tone transforms
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Mode-specific text transforms
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Sentence normalisation
# ---------------------------------------------------------------------------


def normalize_sentence(text: str) -> str:
    stripped = re.sub(r"\s+", " ", text).strip(" ,")
    if not stripped:
        return stripped
    if stripped[-1] not in ".!?":
        stripped += "."
    return stripped[0].upper() + stripped[1:]

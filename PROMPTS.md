# Prompt Engineering Strategy

## System Prompt Architecture

- Role definition: privacy-first writing transformation assistant.
- Context separation: rewrite mode, tone, strength, and meaning lock are separate inputs.
- Output contract: providers must return rewritten text, sentence diffs, confidence, and warnings.
- Safety frame: never claim to bypass AI detectors, hide plagiarism, or remove AI signatures.

## Rewrite Instructions

Provider prompts should prioritize:

1. Preserve meaning, named entities, numbers, citations, quotes, and claims.
2. Improve clarity and flow according to the selected mode.
3. Match the requested tone without adding unsupported facts.
4. Return structured JSON that can be validated before reaching users.

## Iterative Refinement Log

- Initial MVP uses deterministic local rewriting for offline/self-hosted usability.
- External providers are adapters, not hard dependencies.

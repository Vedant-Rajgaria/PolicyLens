"""
app/ai/analyser.py

Calls the Gemini API to reason over the bounded, structured evidence
produced by the deterministic pipeline (validator -> classifier ->
checklist -> optimizer) and returns the {cards, warnings} shape the
extension popup renders.

Uses the google-genai SDK (the unified `from google import genai`
client), NOT the older google-generativeai package — the two have
different import paths and calling conventions, and this file is
written specifically for the newer one:

    pip install google-genai

Error contract: analyse_policy() raises ONLY AnalyserError. Any
underlying SDK exception, JSON parse failure, or malformed model
response is caught and re-raised as AnalyserError, so callers
(main.py) only ever need to handle one exception type from this
module — same pattern as validator.py's ScannerValidationError.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict

from google import genai
from google.genai import types

from app.processing.schemas import OptimizedPolicyInput

logger = logging.getLogger(__name__)

GEMINI_MODEL = os.environ.get("POLICYLENS_GEMINI_MODEL", "gemini-3.6-flash")
_api_key = os.environ.get("GEMINI_API_KEY")

# Client is created lazily (see _get_client) rather than at import time,
# so importing this module never fails just because GEMINI_API_KEY isn't
# set yet (e.g. during tests, or if main.py is imported before .env is
# loaded) — the failure is deferred to the point of actually calling the
# AI, where it can be reported as a clean AnalyserError instead of an
# import-time crash.
_client: "genai.Client | None" = None


class AnalyserError(Exception):
    """
    Raised for any failure in the AI analysis step: missing API key,
    SDK/network failure, or a model response that isn't usable JSON in
    the expected shape. main.py catches this and returns a 502 rather
    than letting a raw SDK exception leak out.
    """
    pass


_SYSTEM_PROMPT = """You are PolicyLens. Read the JSON policy evidence and return ONLY valid JSON:
{"cards": [{"label": str, "badgeText": str, "badgeType": "safe"|"attention"|"danger", "detail": str}],
 "warnings": [str]}
Rules:
- One card per category in checklist.required_categories plus any category present in policy_evidence.
- If a required category has no evidence, still add a card: badgeText "NOT FOUND", badgeType "attention".
- badgeType "danger" = blocks refunds/cancellation; "attention" = conditional/time-limited; "safe" = clear/favorable.
- warnings: up to 8 concrete restrictions, one sentence each.
- Never invent facts not present in the evidence."""


def _get_client() -> "genai.Client":
    """
    Builds (and caches) the genai.Client on first use. Raising here
    rather than at import time keeps the missing-key failure inside
    analyse_policy()'s try/except, so it surfaces as a normal
    AnalyserError instead of crashing app startup.
    """
    global _client

    if not _api_key:
        raise AnalyserError("GEMINI_API_KEY is not configured.")

    if _client is None:
        _client = genai.Client(api_key=_api_key)

    return _client


def _extract_response_text(response: Any) -> str:
    """
    The SDK's `.text` convenience property is normally enough, but stays
    defensive here: if a future SDK version changes that shape, or a
    response comes back with no text (e.g. blocked by safety filters),
    this raises a clear AnalyserError instead of an opaque AttributeError
    deeper in json.loads().
    """
    text = getattr(response, "text", None)
    if not text:
        raise AnalyserError("Gemini returned an empty response.")
    return text


def _parse_model_json(raw_text: str) -> Dict[str, Any]:
    """
    Parses the model's response text as JSON and validates it has the
    two top-level keys the popup expects. Kept as its own function so
    both the "clean JSON" path and any future retry/repair logic can
    share the same validation.
    """
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.warning("Gemini response was not valid JSON.")
        raise AnalyserError("Model response was not valid JSON.") from exc

    if not isinstance(parsed, dict) or "cards" not in parsed or "warnings" not in parsed:
        raise AnalyserError("Model response missing 'cards' or 'warnings'.")

    return parsed


def analyse_policy(optimized: OptimizedPolicyInput) -> Dict[str, Any]:
    """
    Sends the optimized policy evidence to Gemini and returns the parsed
    {cards, warnings} dict.

    Raises AnalyserError — and ONLY AnalyserError — for:
    - missing GEMINI_API_KEY
    - any SDK/network failure calling the model
    - a response that isn't valid JSON, or is missing 'cards'/'warnings'

    Never invents or falls back to placeholder data on failure — callers
    decide how to degrade (e.g. main.py returns a 502; the extension
    falls back to local keyword-based warnings in the popup).
    """
    client = _get_client()

    prompt = _SYSTEM_PROMPT + "\n\nEVIDENCE:\n" + json.dumps(optimized.model_dump(mode="json"))

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
    except Exception as exc:
        logger.exception("Gemini call failed")
        raise AnalyserError(str(exc)) from exc

    raw_text = _extract_response_text(response)
    return _parse_model_json(raw_text)
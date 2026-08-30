"""
The "small packet" AI step: given evidence extracted from ONE crawled page,
scoped to only the still-missing categories, ask the model to resolve just
those — instead of ever re-sending the full evidence set gathered so far.
Called once per crawled page by the discovery orchestrator, which stops
calling this as soon as every missing category is resolved.

Reuses the same lazily-built Gemini client, model name, and single
exception type (AnalyserError) as the main analyser.py, so there's one
place that owns API-key/client-construction behavior.

INTEGRATION NOTE: this imports `_get_client` from analyser.py, which is a
private (underscore-prefixed) name by convention. Recommend adding a small
public alias in analyser.py, e.g.:
    get_client = _get_client
so this cross-module reuse isn't relying on a "private" function. See
INTEGRATION.md.
"""

import json
import logging

from google.genai import types

from app.ai.analyser import GEMINI_MODEL, AnalyserError, _get_client  # see note above
from app.discovery.schemas import ResolvedCategory, SupplementaryAIResult, SupplementaryEvidenceInput

logger = logging.getLogger(__name__)

_SUPPLEMENTARY_SYSTEM_PROMPT = """You are continuing a policy analysis for a webpage. The main page has already \
been analyzed, and a specific set of policy categories could not be confirmed from it. You are now given evidence \
extracted from ONE additional, official page from the same website (either linked from the original page, or found \
via a site-restricted search of the same domain).

Return ONLY JSON, no other text, matching this exact shape:
{"resolved": [{"category": "<CATEGORY>", "status": "FOUND" | "STILL_MISSING",
               "card": {"label": str, "badgeText": str, "badgeType": "danger" | "attention" | "safe", "detail": str} | null}],
 "warnings": [str]}

Rules:
- Return exactly one entry in "resolved" for EACH category listed in target_categories, in the same order, using \
the category string exactly as given.
- Only mark a category "FOUND" if this page's evidence actually contains a real, specific statement about it — \
never infer or invent facts that are not present in the evidence provided.
- If "FOUND", include a "card" with these badge semantics: "danger" = blocks or seriously limits refunds/\
cancellation, "attention" = conditional or time-limited, "safe" = clear and customer-favorable.
- If "STILL_MISSING", set "card" to null.
- Include up to 4 "warnings" — only for genuinely concerning conditions actually found on this page (e.g. hidden \
fees, short deadlines, non-refundable clauses). Do not repeat category information already covered by a card.
- Never invent facts, numbers, or deadlines not present in the evidence.
"""


async def resolve_missing_categories(evidence: SupplementaryEvidenceInput) -> SupplementaryAIResult:
    client = _get_client()
    prompt = _SUPPLEMENTARY_SYSTEM_PROMPT + "\n\n" + json.dumps(evidence.model_dump(mode="json"))

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
    except Exception as exc:
        raise AnalyserError(f"Supplementary AI call failed for {evidence.source_url}: {exc}") from exc

    text = getattr(response, "text", None)
    if not text:
        raise AnalyserError(f"Empty supplementary AI response for {evidence.source_url}")

    try:
        data = json.loads(text)
        resolved = [ResolvedCategory(**item) for item in data.get("resolved", [])]
        warnings = list(data.get("warnings", []))
    except Exception as exc:
        raise AnalyserError(f"Malformed supplementary AI JSON for {evidence.source_url}: {exc}") from exc

    return SupplementaryAIResult(resolved=resolved, warnings=warnings)
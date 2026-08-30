"""
Loads POLICY_VOCABULARY from the extension's real policyVocabulary.js (via
scripts/export_vocabulary.js + Node) so that link/search-result relevance
scoring during discovery uses the exact same term lists the browser
extractor uses for categorization — one source of truth, not two lists that
can silently drift apart.

If Node isn't available, or the export fails for any reason, this falls
back to a small built-in term set rather than raising — discovery should
degrade in quality, never crash the analysis, if this optional dependency
is missing.

The result is cached for the lifetime of the process (an `lru_cache` on a
function keyed by directory path), so the Node subprocess only ever runs
once per process, not once per request.
"""

import json
import logging
import subprocess
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

# Deliberately small: just enough for reasonable link-text/search-snippet
# scoring if the real vocabulary can't be loaded. This is NOT meant to
# match the quality of the real POLICY_VOCABULARY — it's a safety net.
_FALLBACK_VOCABULARY = {
    "RETURN": {"terms": ["return", "returns", "return policy", "returning an item"], "urlHints": ["return"]},
    "REFUND": {"terms": ["refund", "refunds", "money back", "reimbursement"], "urlHints": ["refund"]},
    "WARRANTY": {"terms": ["warranty", "guarantee", "warranties"], "urlHints": ["warrant"]},
    "CANCELLATION": {"terms": ["cancel", "cancellation", "cancel order"], "urlHints": ["cancel"]},
    "EXCHANGE": {"terms": ["exchange", "exchanges", "swap item"], "urlHints": ["exchange"]},
    "SHIPPING": {"terms": ["shipping", "shipment", "shipping policy"], "urlHints": ["shipping"]},
    "DELIVERY": {"terms": ["delivery", "delivery time", "estimated delivery"], "urlHints": ["delivery"]},
    "PAYMENT": {"terms": ["payment", "billing", "payment methods"], "urlHints": ["payment", "billing"]},
    "SUBSCRIPTION": {"terms": ["subscription", "auto-renew", "recurring billing"], "urlHints": ["subscription"]},
    "SUBSCRIPTION_OR_PAYMENT": {"terms": ["subscription", "billing", "payment terms"], "urlHints": ["subscription", "billing"]},
    "SUBSCRIPTION_OR_FINANCIAL": {"terms": ["subscription", "billing", "financial terms"], "urlHints": ["subscription", "billing"]},
    "PRIVACY": {"terms": ["privacy", "personal data", "privacy policy"], "urlHints": ["privacy"]},
    "TERMS": {"terms": ["terms of service", "terms and conditions", "terms of use"], "urlHints": ["terms"]},
}


@lru_cache(maxsize=1)
def load_vocabulary(extension_content_dir: str) -> dict:
    script_path = Path(__file__).resolve().parents[2] / "scripts" / "export_vocabulary.js"
    vocab_path = Path(extension_content_dir) / "policyVocabulary.js"

    if not script_path.exists() or not vocab_path.exists():
        logger.warning(
            "Vocabulary export script (%s) or policyVocabulary.js (%s) not found; "
            "using built-in fallback vocabulary for discovery link ranking.",
            script_path,
            vocab_path,
        )
        return _FALLBACK_VOCABULARY

    try:
        result = subprocess.run(
            ["node", str(script_path), str(vocab_path)],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        data = json.loads(result.stdout)
        vocabulary = data.get("POLICY_VOCABULARY")
        if not isinstance(vocabulary, dict) or not vocabulary:
            raise ValueError("Exported vocabulary was empty or malformed")
        logger.info("Loaded live POLICY_VOCABULARY for discovery (%d categories).", len(vocabulary))
        return vocabulary
    except Exception as exc:
        logger.warning(
            "Failed to export live POLICY_VOCABULARY (%s); falling back to built-in "
            "vocabulary for discovery link ranking. Discovery will still work, just "
            "with slightly less precise link/query relevance scoring.",
            exc,
        )
        return _FALLBACK_VOCABULARY
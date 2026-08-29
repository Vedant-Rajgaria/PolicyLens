"""
app/processing/classifier.py

Deterministic, lightweight page-type classification. No LLM calls here —
this exists purely to pick which checklist applies, using cheap signals
already present in the validated extraction.

Design principle: the classifier should not try to be "smart". Its only
job is a conservative routing decision — GENERIC is a safe fallback, a
wrong specific PageType is not, because it drives the wrong checklist for
the rest of the pipeline. The LLM (in ai/analyser.py) is reserved for the
nuanced interpretation this module deliberately avoids.

Designed so a smarter (ML/LLM-based) classifier can replace the internals
later without changing the public interface: classify_page(extraction) ->
PageClassification.
"""

from __future__ import annotations

import re
from typing import Dict, List, Tuple

from .schemas import PageClassification, PageType, ValidatedExtraction

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

# Two separate gates, not one threshold:
# - MIN_CONFIDENCE: is there enough total evidence to trust the winner?
# - MIN_MARGIN: is the winner clearly ahead of the runner-up, or is
#   evidence too spread out across categories to mean anything?
# Both must pass, or we fall back to GENERIC.
CLASSIFIER_MIN_CONFIDENCE = 0.45
CLASSIFIER_MIN_MARGIN = 0.15

# Not every source is equally trustworthy. A keyword in the page title or
# in the scanner's own policy-category labels is much stronger evidence
# than the same keyword appearing once in a random paragraph.
_SOURCE_WEIGHTS: Dict[str, float] = {
    "title": 3.0,
    "domain": 2.0,
    "headings": 2.0,
    "policy_categories": 3.0,
    "blocks": 1.0,
}

# Keyword signals per page type. Kept simple/deterministic for the
# prototype — a real implementation might weight phrase matches over
# single-word matches, but that's a v2 concern.
_PAGE_TYPE_KEYWORDS: Dict[PageType, List[str]] = {
    PageType.PRODUCT: [
        "warranty", "return", "returns", "exchange", "shipping", "delivery",
        "refund", "product", "order", "purchase",
    ],
    PageType.SERVICE: [
        "booking", "appointment", "cancellation", "service terms",
        "reservation", "consultation", "session",
    ],
    PageType.SOFTWARE: [
        "license", "download", "software", "account", "subscription",
        "data", "api", "sdk", "installation",
    ],
    PageType.SOCIAL_MEDIA: [
        "community guidelines", "account rules", "content", "privacy",
        "moderation", "post", "follower", "profile",
    ],
    PageType.MARKETPLACE: [
        "seller", "buyer", "listing", "marketplace", "vendor", "escrow",
        "dispute",
    ],
    PageType.SUBSCRIPTION_OR_FINANCIAL: [
        "monthly", "annual", "billing", "recurring", "cancel anytime",
        "subscription", "plan", "auto-renew", "payment method",
    ],
}


# --------------------------------------------------------------------------
# Matching helpers
# --------------------------------------------------------------------------

def _keyword_matches(keyword: str, text: str) -> bool:
    """
    Phrase keywords (containing a space) use substring matching, since
    word-boundary regex on multi-word phrases adds little value here.
    Single-word keywords use \\b word-boundary matching so short keywords
    like "data" don't match inside unrelated words like "database" or
    "updated" — a plain `in` check would.
    """
    if " " in keyword:
        return keyword in text
    return bool(re.search(rf"\b{re.escape(keyword)}\b", text))


def _build_source_texts(extraction: ValidatedExtraction) -> Dict[str, str]:
    """
    One lowercase text blob per source, built once and reused across all
    page-type candidates — O(sources) instead of O(sources * page_types).
    """
    return {
        "title": extraction.page.title.lower(),
        "domain": (extraction.page.domain or "").lower(),
        "headings": " ".join(extraction.content.headings).lower(),
        # The scanner's own categorization (policySections) is treated as
        # a strong signal in its own right — if the scanner already
        # thinks a block is about "WARRANTY", that's meaningful routing
        # evidence independent of any keyword coincidence.
        "policy_categories": " ".join(s.category for s in extraction.policy_sections).lower(),
        "blocks": " ".join(b.text for b in extraction.content.blocks).lower(),
    }


def _score_page_type(keywords: List[str], source_texts: Dict[str, str]) -> Tuple[float, List[str]]:
    """
    Weighted score = sum of source-weight for every (source, keyword)
    pair that matches. A keyword matching in multiple sources
    accumulates weight from each — e.g. "license" in both title and
    headings counts twice, which is intentional: corroborating signals
    across sources are stronger evidence than a single mention.
    """
    score = 0.0
    matched: List[str] = []
    for source, weight in _SOURCE_WEIGHTS.items():
        text = source_texts[source]
        if not text:
            continue
        for keyword in keywords:
            if _keyword_matches(keyword, text):
                score += weight
                if keyword not in matched:
                    matched.append(keyword)
    return score, matched


def classify_page(extraction: ValidatedExtraction) -> PageClassification:
    """
    Classify the page type using deterministic, source-weighted keyword
    signals. Returns GENERIC whenever:
    - no keywords matched anywhere, or
    - the top two candidates are tied, or
    - the winner doesn't clear both the confidence and margin gates.

    A false specific classification is worse than GENERIC here, since it
    silently drives the wrong checklist for the rest of the pipeline —
    so this function is deliberately conservative.
    """
    source_texts = _build_source_texts(extraction)

    if not any(source_texts.values()):
        return PageClassification(
            page_type=PageType.GENERIC,
            confidence=0.0,
            reasons=["No page text available to classify."],
        )

    scores: Dict[PageType, Tuple[float, List[str]]] = {
        page_type: _score_page_type(keywords, source_texts)
        for page_type, keywords in _PAGE_TYPE_KEYWORDS.items()
    }

    # Sort explicitly rather than using max(), so ties are visible instead
    # of silently resolving to whichever PageType happens to appear first
    # in _PAGE_TYPE_KEYWORDS.
    ranked = sorted(scores.items(), key=lambda item: item[1][0], reverse=True)
    best_type, (best_score, best_keywords) = ranked[0]
    second_score = ranked[1][1][0] if len(ranked) > 1 else 0.0

    if best_score == 0:
        return PageClassification(
            page_type=PageType.GENERIC,
            confidence=0.0,
            reasons=["No known page-type keywords matched."],
        )

    if best_score == second_score:
        return PageClassification(
            page_type=PageType.GENERIC,
            confidence=0.0,
            reasons=["Multiple page types received equal classification scores."],
        )

    evidence_strength = min(best_score / 3.0, 1.0)
    margin = (best_score - second_score) / max(best_score, 1.0)
    confidence = round(0.6 * evidence_strength + 0.4 * margin, 2)

    if confidence < CLASSIFIER_MIN_CONFIDENCE or margin < CLASSIFIER_MIN_MARGIN:
        return PageClassification(
            page_type=PageType.GENERIC,
            confidence=confidence,
            reasons=[
                f"Best candidate '{best_type.value}' did not clear the confidence/margin "
                f"gates (confidence={confidence:.2f}, margin={margin:.2f}; require "
                f"confidence>={CLASSIFIER_MIN_CONFIDENCE}, margin>={CLASSIFIER_MIN_MARGIN})."
            ],
        )

    return PageClassification(
        page_type=best_type,
        confidence=confidence,
        reasons=[
            f"Matched keywords: {', '.join(best_keywords)}",
            f"'{best_type.value}' scored {best_score:.1f} vs next-best {second_score:.1f} "
            f"(margin={margin:.0%}).",
        ],
    )
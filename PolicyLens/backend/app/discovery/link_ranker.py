"""
Ranks candidate URLs (from the original page's own extracted links, and/or
from search results) by how likely they are to contain evidence for the
still-missing policy categories — using the same term/URL-hint scoring
philosophy as the extension's own detector.js, just applied to link text
and search snippets instead of full page content.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from app.discovery.domain_utils import has_valid_http_scheme

# Mirrors the spirit of detector.js's weighting (heading/URL matches worth
# more than a single body-term hit) without pretending to replicate its full
# scoring model — at this stage we only have short link text/snippets, not
# full page content, so a simpler model is both honest and sufficient.
_TERM_WEIGHT = 2.0
_URL_HINT_WEIGHT = 2.0


@dataclass
class CandidateLink:
    url: str
    label: str
    source: str  # "page_link" | "search_result"
    score: float
    matched_categories: List[str] = field(default_factory=list)


def _score_against_category(text_lower: str, url_lower: str, category: str, vocabulary: dict) -> float:
    entry = vocabulary.get(category) or vocabulary.get(category.upper()) or {}
    score = 0.0
    for term in entry.get("terms", []):
        if term.lower() in text_lower:
            score += _TERM_WEIGHT
    for hint in entry.get("urlHints", []):
        if hint.lower() in url_lower:
            score += _URL_HINT_WEIGHT
    return score


def rank_candidates(
    raw_candidates: List[Tuple[str, str, str, str]],
    missing_categories: List[str],
    vocabulary: dict,
    min_score: float,
) -> List[CandidateLink]:
    """
    raw_candidates: list of (url, label_or_title, source, snippet).
    Returns candidates sorted by relevance score, descending, deduped by
    normalized URL (keeping the highest-scoring occurrence of each).
    """
    best_by_url: Dict[str, CandidateLink] = {}

    for url, label, source, snippet in raw_candidates:
        if not url or not has_valid_http_scheme(url):
            continue
        norm_url = url.strip().rstrip("/").lower()

        text_lower = f"{label or ''} {snippet or ''}".lower()
        url_lower = url.lower()

        matched: List[str] = []
        total = 0.0
        for category in missing_categories:
            s = _score_against_category(text_lower, url_lower, category, vocabulary)
            if s > 0:
                matched.append(category)
                total += s

        if total < min_score:
            continue

        existing = best_by_url.get(norm_url)
        if existing is None or total > existing.score:
            best_by_url[norm_url] = CandidateLink(
                url=url, label=label or "", source=source, score=total, matched_categories=matched
            )

    return sorted(best_by_url.values(), key=lambda c: c.score, reverse=True)
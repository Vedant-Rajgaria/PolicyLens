"""
Entry point for the discovery subsystem: given the main page's already-
optimized evidence (which includes `discovery_hints.relevant_links` — links
whose category matches a missing one, already computed by optimizer.py) and
the list of still-missing categories, this:

  1. Gathers candidate URLs from two sources: the original page's own
     relevant links, and (if configured) a site-restricted search per
     missing category.
  2. Filters to same-registrable-domain only ("official site" check).
  3. Ranks candidates by relevance to the missing categories.
  4. Crawls a bounded, ranked set of pages — ONE LAYER ONLY. Pages found
     via a crawled page's own links are never themselves queued; only the
     original page's links and the initial search results are ever
     candidates.
  5. For each page, sends a small evidence packet to the AI scoped to only
     the categories still missing, and stops as soon as every category is
     resolved or the page/time budget is exhausted.

Never raises: any internal failure results in "resolved nothing," so a
problem here can never break the main single-page analysis.
"""

import asyncio
import logging
import time
from typing import Dict, List, Optional, Tuple

from app.ai.analyser import AnalyserError
from app.ai.supplementary import resolve_missing_categories
from app.crawl.browser_extractor import CrawlError, extract_and_validate
from app.discovery.config import DISCOVERY_CONFIG
from app.discovery.domain_utils import is_same_registrable_domain, registrable_domain
from app.discovery.evidence_builder import build_supplementary_evidence
from app.discovery.link_ranker import CandidateLink, rank_candidates
from app.discovery.schemas import CrawlAuditEntry, DiscoveryOutcome
from app.discovery.search_provider import GoogleCustomSearchProvider, SearchProvider, build_queries
from app.discovery.vocabulary_bridge import load_vocabulary
from app.processing.schemas import OptimizedPolicyInput

logger = logging.getLogger(__name__)


def _get_search_provider() -> Optional[SearchProvider]:
    if not DISCOVERY_CONFIG.enable_search:
        return None
    if not (DISCOVERY_CONFIG.google_cse_api_key and DISCOVERY_CONFIG.google_cse_id):
        logger.info("Search discovery skipped: GOOGLE_CSE_API_KEY / GOOGLE_CSE_ID not configured.")
        return None
    return GoogleCustomSearchProvider(DISCOVERY_CONFIG.google_cse_api_key, DISCOVERY_CONFIG.google_cse_id)


async def _gather_candidates(
    optimized: OptimizedPolicyInput,
    missing_categories: List[str],
    domain: str,
) -> List[CandidateLink]:
    vocabulary = load_vocabulary(DISCOVERY_CONFIG.extension_content_dir)

    # Source 1: links already surfaced by the existing optimizer step
    # (discovery_hints.relevant_links — already filtered to categories that
    # are missing, capped, computed with zero extra work here).
    page_links: List[Tuple[str, str, str, str]] = [
        (link.url, link.text or "", "page_link", "")
        for link in optimized.discovery_hints.relevant_links[: DISCOVERY_CONFIG.max_links_from_page]
    ]

    # Source 2: a live, site-restricted search — only fills gaps the page's
    # own links don't already cover.
    search_links: List[Tuple[str, str, str, str]] = []
    provider = _get_search_provider()
    if provider is not None:
        queries = build_queries(domain, missing_categories, DISCOVERY_CONFIG.max_search_queries)
        query_results = await asyncio.gather(
            *(provider.search(q, DISCOVERY_CONFIG.max_search_results_per_query) for q in queries),
            return_exceptions=True,
        )
        for res in query_results:
            if isinstance(res, Exception):
                logger.warning("Search query raised: %s", res)
                continue
            for r in res:
                search_links.append((r.url, r.title, "search_result", r.snippet))

    all_candidates = page_links + search_links
    same_domain = [c for c in all_candidates if is_same_registrable_domain(c[0], domain)]

    return rank_candidates(same_domain, missing_categories, vocabulary, DISCOVERY_CONFIG.min_link_relevance_score)


async def _resolve_one(candidate: CandidateLink, target_categories: List[str]):
    """Crawls + resolves a single candidate page. Raises CrawlError/AnalyserError
    on failure — callers run this via asyncio.gather(return_exceptions=True)."""
    extraction = await extract_and_validate(candidate.url)  # raises CrawlError

    evidence = build_supplementary_evidence(candidate.url, extraction, target_categories)
    if not evidence.policy_evidence and not evidence.additional_relevant_evidence:
        entry = CrawlAuditEntry(
            url=candidate.url,
            source=candidate.source,
            relevance_score=candidate.score,
            matched_categories=candidate.matched_categories,
        )
        return {}, [], entry

    try:
        ai_result = await resolve_missing_categories(evidence)
    except AnalyserError as exc:
        raise CrawlError(str(exc)) from exc

    page_resolved: Dict[str, dict] = {
        item.category: item.card for item in ai_result.resolved if item.status == "FOUND" and item.card
    }

    entry = CrawlAuditEntry(
        url=candidate.url,
        source=candidate.source,
        relevance_score=candidate.score,
        matched_categories=candidate.matched_categories,
        categories_resolved=sorted(page_resolved.keys()),
    )
    return page_resolved, ai_result.warnings, entry


async def resolve_missing_policies(
    *,
    optimized: OptimizedPolicyInput,
    missing_categories: List[str],
) -> Tuple[Dict[str, dict], List[str], DiscoveryOutcome]:
    """Returns (resolved_cards_by_category, extra_warnings, audit_outcome)."""
    if not missing_categories:
        return {}, [], DiscoveryOutcome(ran=False, reason="No missing categories.")
    if not DISCOVERY_CONFIG.enabled:
        return {}, [], DiscoveryOutcome(ran=False, reason="Discovery disabled via config.")

    domain = registrable_domain(optimized.page.url)
    if not domain:
        return {}, [], DiscoveryOutcome(ran=False, reason="Could not determine registrable domain of the page.")

    started = time.monotonic()
    still_missing = set(c.upper() for c in missing_categories)
    resolved_cards: Dict[str, dict] = {}
    extra_warnings: List[str] = []
    audit: List[CrawlAuditEntry] = []

    try:
        candidates = await _gather_candidates(optimized, sorted(still_missing), domain)
    except Exception as exc:
        logger.warning("Candidate discovery failed for %s: %s", optimized.page.url, exc)
        return {}, [], DiscoveryOutcome(ran=True, reason=f"Candidate discovery failed: {exc}")

    candidates = candidates[: DISCOVERY_CONFIG.max_pages_to_crawl]
    if not candidates:
        return (
            {},
            [],
            DiscoveryOutcome(
                ran=True,
                reason="No relevant same-domain candidate pages found.",
                still_missing_categories=sorted(still_missing),
            ),
        )

    batch_size = max(1, DISCOVERY_CONFIG.crawl_batch_size)
    for i in range(0, len(candidates), batch_size):
        if not still_missing:
            break
        if time.monotonic() - started > DISCOVERY_CONFIG.overall_time_budget_seconds:
            logger.info("Discovery time budget exceeded for %s; stopping early.", optimized.page.url)
            break

        batch = candidates[i : i + batch_size]
        results = await asyncio.gather(
            *(_resolve_one(c, sorted(still_missing)) for c in batch), return_exceptions=True
        )
        for candidate, outcome in zip(batch, results):
            if isinstance(outcome, Exception):
                audit.append(
                    CrawlAuditEntry(
                        url=candidate.url,
                        source=candidate.source,
                        relevance_score=candidate.score,
                        matched_categories=candidate.matched_categories,
                        error=str(outcome),
                    )
                )
                logger.info("Discovery crawl of %s failed: %s", candidate.url, outcome)
                continue

            page_resolved, page_warnings, entry = outcome
            for category, card in page_resolved.items():
                if category in still_missing:
                    resolved_cards[category] = card
                    still_missing.discard(category)
            extra_warnings.extend(page_warnings)
            audit.append(entry)

    outcome = DiscoveryOutcome(
        ran=True,
        crawled=audit,
        resolved_categories=sorted(resolved_cards.keys()),
        still_missing_categories=sorted(still_missing),
    )
    return resolved_cards, extra_warnings, outcome


def merge_cards(main_cards: List[dict], resolved_cards_by_category: Dict[str, dict]) -> List[dict]:
    """
    Merges discovery-resolved cards into the main page's card list.

    If a main card carries an explicit "category" field, the matching
    resolved card REPLACES it. If not (the current main prompt doesn't emit
    "category" as of this doc — see INTEGRATION.md for the one-line prompt
    addition that enables replacement), resolved cards are safely APPENDED
    instead of guessed at — duplicating a "NOT FOUND" card is a much safer
    failure mode than silently overwriting the wrong one.
    """
    cards = list(main_cards)
    seen_by_category = {(c.get("category") or "").upper(): i for i, c in enumerate(cards) if c.get("category")}

    for category, card in resolved_cards_by_category.items():
        card = dict(card)
        card.setdefault("category", category)
        idx = seen_by_category.get(category)
        if idx is not None:
            cards[idx] = card
        else:
            cards.append(card)

    return cards
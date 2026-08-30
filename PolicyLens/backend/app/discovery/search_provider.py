"""
Search-provider abstraction for discovering candidate official pages that
aren't already linked from the page the user is looking at (e.g. a T&C page
that's only reachable from the site's footer nav on a different page, or an
FAQ subdomain).

Only Google's Custom Search JSON API is implemented here, restricted per
query via `site:<domain>` so results are pre-filtered to the same site
before the registrable-domain check runs again downstream (belt and
braces). The interface is intentionally small so another provider can be
added later (e.g. Bing was retired as a public API in 2025, so it's
deliberately not included) without touching orchestrator.py.

All failures degrade to "no results for this query" — a flaky search API
must never fail the overall analysis.
"""

import logging
from dataclasses import dataclass
from typing import List, Protocol

import httpx

logger = logging.getLogger(__name__)

# Human-readable phrase per category, used to build search queries. Falls
# back to a readable version of the raw category name for anything not
# listed here, so new/future categories don't silently produce empty
# queries.
_CATEGORY_QUERY_PHRASES = {
    "RETURN": "return policy",
    "REFUND": "refund policy",
    "WARRANTY": "warranty policy",
    "CANCELLATION": "cancellation policy",
    "EXCHANGE": "exchange policy",
    "SHIPPING": "shipping policy",
    "DELIVERY": "delivery policy",
    "PAYMENT": "payment terms",
    "SUBSCRIPTION": "subscription terms",
    "SUBSCRIPTION_OR_PAYMENT": "subscription and payment terms",
    "SUBSCRIPTION_OR_FINANCIAL": "subscription and billing terms",
    "PRIVACY": "privacy policy",
    "TERMS": "terms and conditions",
}


def phrase_for_category(category: str) -> str:
    return _CATEGORY_QUERY_PHRASES.get(category.upper(), category.replace("_", " ").lower())


def build_queries(domain: str, missing_categories: List[str], max_queries: int) -> List[str]:
    """One site-restricted query per missing category, capped at max_queries."""
    return [f"site:{domain} {phrase_for_category(cat)}" for cat in missing_categories[:max_queries]]


@dataclass
class SearchResult:
    url: str
    title: str
    snippet: str


class SearchProvider(Protocol):
    async def search(self, query: str, num: int) -> List[SearchResult]: ...


class GoogleCustomSearchProvider:
    """Requires a Google Programmable Search Engine (CSE) configured to
    search the whole web (or at least not restricted away from the target
    domain) and a Custom Search JSON API key."""

    _ENDPOINT = "https://www.googleapis.com/customsearch/v1"

    def __init__(self, api_key: str, cx: str, timeout: float = 6.0):
        self._api_key = api_key
        self._cx = cx
        self._timeout = timeout

    async def search(self, query: str, num: int = 4) -> List[SearchResult]:
        params = {
            "key": self._api_key,
            "cx": self._cx,
            "q": query,
            "num": max(1, min(num, 10)),
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(self._ENDPOINT, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.warning("Search query failed (%r): %s", query, exc)
            return []

        results: List[SearchResult] = []
        for item in data.get("items", []) or []:
            url = item.get("link")
            if not url:
                continue
            results.append(SearchResult(url=url, title=item.get("title", ""), snippet=item.get("snippet", "")))
        return results
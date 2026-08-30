"""
Central configuration for the discovery subsystem (candidate-page search,
ranking, crawling, and the supplementary AI packets). Every knob is env-var
driven with a conservative default, so the system is tunable per-deployment
without code changes — important for both reliability (tight timeouts /
budgets in production) and scalability (concurrency limits that match the
host's resources).
"""

import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool_env(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _default_extension_content_dir() -> str:
    # backend/app/discovery/config.py -> backend/app/discovery -> backend/app
    # -> backend -> PolicyLens/ -> extension/content
    return str(Path(__file__).resolve().parents[3] / "extension" / "content")


@dataclass(frozen=True)
class DiscoveryConfig:
    # Master switches
    enabled: bool = field(default_factory=lambda: _bool_env("POLICYLENS_DISCOVERY_ENABLED", True))
    enable_search: bool = field(default_factory=lambda: _bool_env("POLICYLENS_DISCOVERY_SEARCH_ENABLED", True))

    # Crawl scope limits (the "single layer, bounded pages" architecture constraint)
    max_pages_to_crawl: int = field(default_factory=lambda: _int_env("POLICYLENS_MAX_PAGES_TO_CRAWL", 4))
    max_search_queries: int = field(default_factory=lambda: _int_env("POLICYLENS_MAX_SEARCH_QUERIES", 4))
    max_search_results_per_query: int = field(
        default_factory=lambda: _int_env("POLICYLENS_MAX_SEARCH_RESULTS", 4)
    )
    max_links_from_page: int = field(default_factory=lambda: _int_env("POLICYLENS_MAX_PAGE_LINKS_CONSIDERED", 20))
    min_link_relevance_score: float = field(default_factory=lambda: _float_env("POLICYLENS_MIN_LINK_SCORE", 2.0))

    # Concurrency / batching for the crawl loop
    crawl_batch_size: int = field(default_factory=lambda: _int_env("POLICYLENS_CRAWL_BATCH_SIZE", 2))

    # Timeouts / budgets — bound worst-case latency so discovery can never
    # hang a request indefinitely. Reliability over completeness.
    page_load_timeout_ms: int = field(default_factory=lambda: _int_env("POLICYLENS_PAGE_LOAD_TIMEOUT_MS", 15000))
    overall_time_budget_seconds: float = field(
        default_factory=lambda: _float_env("POLICYLENS_DISCOVERY_TIME_BUDGET_S", 25.0)
    )

    # Where the (unmodified) extension content scripts live on disk, so the
    # headless-browser crawler can inject the exact same extraction pipeline.
    extension_content_dir: str = field(
        default_factory=lambda: os.environ.get(
            "POLICYLENS_EXTENSION_CONTENT_DIR", _default_extension_content_dir()
        )
    )

    # Search provider credentials (Google Programmable Search / Custom Search JSON API)
    google_cse_api_key: str = field(default_factory=lambda: os.environ.get("GOOGLE_CSE_API_KEY", ""))
    google_cse_id: str = field(default_factory=lambda: os.environ.get("GOOGLE_CSE_ID", ""))


DISCOVERY_CONFIG = DiscoveryConfig()
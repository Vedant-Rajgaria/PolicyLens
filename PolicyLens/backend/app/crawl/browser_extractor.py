"""
Loads a candidate URL in a headless browser and runs the SAME
extractor.js / cleaner.js / detector.js / policyVocabulary.js /
siteAdapters.js files the real Chrome extension ships — unmodified — via
Playwright script injection. This is the key architectural choice behind
server-side discovery: there is exactly one implementation of "how to
extract policy content from a page," shared by the live extension and
server-side crawling, instead of two implementations (JS + a parallel
Python port) that can silently drift apart over time.

Assumption worth verifying against your actual source: this only works
because extractor.js/cleaner.js/detector.js/siteAdapters.js/
policyVocabulary.js attach pure `window.*` globals and never call
`chrome.*` APIs (only backendClient.js and index.js's message listener do,
per the project reference doc — neither is injected here). If that
assumption turns out to be wrong for extractor.js specifically (the one
file whose body wasn't available when this was written), any chrome.*
call inside it will throw when evaluated in this context, and extract_page()
will raise CrawlError, which callers already handle gracefully.
"""

import logging
import time
from pathlib import Path
from typing import Any, Dict

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

from app.discovery.config import DISCOVERY_CONFIG
from app.crawl.browser_pool import browser_pool
from app.processing.schemas import ScannerValidationError
from app.processing.validator import validate_scanner_payload

logger = logging.getLogger(__name__)

# Must match manifest.json's content_scripts.js load order exactly —
# extractor.js/detector.js reference globals defined by the earlier files.
_CONTENT_SCRIPT_FILES = [
    "policyVocabulary.js",
    "siteAdapters.js",
    "extractor.js",
    "cleaner.js",
    "detector.js",
]

_RUN_EXTRACTION_JS = """
() => {
    if (!window.PolicyLensExtractor || !window.PolicyLensCleaner || !window.PolicyLensDetector) {
        throw new Error("PolicyLens content scripts did not initialize on this page.");
    }
    const raw = window.PolicyLensExtractor.extractPage();
    const cleaned = window.PolicyLensCleaner.clean(raw);
    return window.PolicyLensDetector.detect(cleaned);
}
"""


class CrawlError(Exception):
    """Raised whenever a candidate page can't be loaded or extracted.
    Always caught by the discovery orchestrator — one bad page must never
    fail the overall analysis."""


def _script_paths() -> list[Path]:
    base = Path(DISCOVERY_CONFIG.extension_content_dir)
    paths = [base / name for name in _CONTENT_SCRIPT_FILES]
    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        raise CrawlError(
            f"Missing extension content script(s) — check POLICYLENS_EXTENSION_CONTENT_DIR: {missing}"
        )
    return paths


async def extract_page(url: str) -> Dict[str, Any]:
    """
    Returns the same shape detector.js's detect() returns:
    {page, content, policySections, links, interactiveElements}
    Raises CrawlError on any failure.
    """
    scripts = _script_paths()
    context = None
    started = time.monotonic()
    try:
        context = await browser_pool.new_context()
        page: Page = await context.new_page()

        # Speed: don't fetch assets we never read. Also caps how long a
        # slow third-party tracker/ad script can hold up the page load.
        async def _route_handler(route):
            if route.request.resource_type in {"image", "media", "font"}:
               await route.abort()
            else:
                await route.continue_()
        await page.route("**/*", _route_handler)

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=DISCOVERY_CONFIG.page_load_timeout_ms)
        except PlaywrightTimeoutError as exc:
            raise CrawlError(f"Timed out loading {url}: {exc}") from exc

        for script_path in scripts:
            await page.add_script_tag(path=str(script_path))

        try:
            result = await page.evaluate(_RUN_EXTRACTION_JS)
        except Exception as exc:
            raise CrawlError(f"Extraction pipeline failed on {url}: {exc}") from exc

        logger.info("Discovery crawl extracted %s in %.2fs", url, time.monotonic() - started)
        return result
    except CrawlError:
        raise
    except Exception as exc:
        raise CrawlError(f"Unexpected error crawling {url}: {exc}") from exc
    finally:
        if context is not None:
            await context.close()


async def extract_and_validate(url: str):
    """extract_page() + wraps into the same scanner-payload shape the
    extension itself sends, then runs it through the existing
    validate_scanner_payload() — so every downstream consumer works
    identically regardless of whether evidence came from the extension or
    from server-side discovery."""
    raw_result = await extract_page(url)
    scanner_payload = {"success": True, "data": raw_result, "stats": {}}
    try:
        return validate_scanner_payload(scanner_payload)
    except ScannerValidationError as exc:
        raise CrawlError(f"Extracted data from {url} failed validation: {exc}") from exc
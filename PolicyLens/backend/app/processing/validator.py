"""
app/processing/validator.py

Validates and normalizes the raw JS scanner payload before any real
processing happens. This is the only module allowed to touch the raw,
untyped scanner dict — everything downstream works with ValidatedExtraction.

Responsibilities here are deliberately narrow:
- structural validation (is this even a usable payload?)
- safe defaults for optional scanner features
- light text normalization (whitespace, empty blocks)

NOT this module's job: semantic filtering, deduplication, relevance
scoring, or policy interpretation — that's optimizer.py and analyser.py.

Error contract: validate_scanner_payload() raises ONLY
ScannerValidationError. Any pydantic ValidationError raised while
constructing the internal models is caught and re-raised as
ScannerValidationError, so callers (pipeline.py/main.py) only ever need
to handle one exception type from this module.
"""

from __future__ import annotations

import logging
from typing import Any, List, Optional
from urllib.parse import urlparse

from pydantic import ValidationError

from .schemas import (
    ContentBlockModel,
    ExtractedContent,
    LinkModel,
    PageMetadata,
    PolicySectionModel,
    ScannerValidationError,
    ValidatedExtraction,
)

logger = logging.getLogger(__name__)


def _validate_url(url: str) -> str:
    """
    Confirms the URL is a genuine http(s) URL, not just a non-empty
    string. Rejects things like "hello", "not-a-url", "example.com"
    (no scheme), and "javascript:void(0)" (wrong scheme). The page URL
    matters beyond display — it's the identity of the analysis and may
    later back caching, history, or persistence, so it's worth rejecting
    early rather than storing garbage.
    """
    cleaned = url.strip()
    parsed = urlparse(cleaned)

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ScannerValidationError("Scanner payload contains an invalid page URL.")

    return cleaned


def _derive_domain(url: str) -> Optional[str]:
    """Best-effort domain extraction when the scanner didn't supply one."""
    try:
        return urlparse(url).netloc or None
    except Exception:
        return None


def _clean_text(value: Any) -> str:
    """
    Light, non-destructive normalization: strip outer whitespace and
    collapse internal whitespace runs. Does not rewrite policy wording —
    it just trims noise so downstream comparisons are reliable.
    """
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())


def _normalize_page(raw_page: dict) -> PageMetadata:
    """
    Builds page metadata. Raises ScannerValidationError directly for
    application-level checks (missing/invalid URL) — these aren't
    pydantic schema failures, they're business rules we want a specific
    message for. Pydantic-level failures on construction are left to
    propagate; the caller (validate_scanner_payload) catches
    ValidationError in one place for the whole payload.
    """
    if not isinstance(raw_page, dict):
        raise ScannerValidationError("Scanner payload is missing page information.")

    url = raw_page.get("url")
    if not url or not isinstance(url, str):
        raise ScannerValidationError("Scanner payload is missing a valid page URL.")
    url = _validate_url(url)

    title = _clean_text(raw_page.get("title", ""))
    domain = raw_page.get("domain") or _derive_domain(url)

    # Preserve any extra fields the scanner sent without needing to know
    # their names in advance.
    known_keys = {"url", "title", "domain"}
    extra = {k: v for k, v in raw_page.items() if k not in known_keys}

    return PageMetadata(url=url, title=title, domain=domain, extra=extra)


def _normalize_content(raw_content: Any) -> ExtractedContent:
    if not isinstance(raw_content, dict):
        # Optional-ish in spirit even though usually present — a scanner
        # failure on this specific extraction step shouldn't crash the
        # whole request.
        return ExtractedContent()

    raw_blocks = raw_content.get("blocks", []) or []
    blocks: List[ContentBlockModel] = []
    for raw_block in raw_blocks:
        if isinstance(raw_block, str):
            text = _clean_text(raw_block)
            if text:
                blocks.append(ContentBlockModel(text=text))
        elif isinstance(raw_block, dict):
            text = _clean_text(raw_block.get("text", ""))
            if not text:
                continue  # ignore empty blocks, per spec
            blocks.append(
                ContentBlockModel(
                    text=text,
                    tag=raw_block.get("tag"),
                    nearby_heading=raw_block.get("nearby_heading") or raw_block.get("nearbyHeading"),
                )
            )

    headings = [
        _clean_text(h) for h in (raw_content.get("headings", []) or []) if _clean_text(h)
    ]
    lists = raw_content.get("lists", []) or []
    tables = raw_content.get("tables", []) or []

    return ExtractedContent(blocks=blocks, headings=headings, lists=lists, tables=tables)


def _normalize_policy_sections(raw_sections: Any) -> List[PolicySectionModel]:
    if not isinstance(raw_sections, list):
        return []  # no policySections -> empty list, not a crash

    sections: List[PolicySectionModel] = []
    for raw_section in raw_sections:
        if not isinstance(raw_section, dict):
            continue
        category = raw_section.get("category")
        if not category or not isinstance(category, str):
            continue  # a section without a category isn't usable evidence

        raw_blocks = raw_section.get("blocks", []) or []
        blocks = [_clean_text(b) for b in raw_blocks if _clean_text(b)]

        confidence = raw_section.get("confidence")
        if confidence is not None and not isinstance(confidence, (int, float)):
            # e.g. scanner sent "very high" instead of a number — drop the
            # bad value rather than let it fail schema validation later on
            # a field that's genuinely optional.
            confidence = None

        sections.append(
            PolicySectionModel(
                category=category.strip().upper(),
                confidence=confidence,
                blocks=blocks,
            )
        )
    return sections


def _normalize_links(raw_links: Any) -> List[LinkModel]:
    if not isinstance(raw_links, list):
        return []  # no links -> empty list

    links: List[LinkModel] = []
    for raw_link in raw_links:
        if not isinstance(raw_link, dict):
            continue
        url = raw_link.get("url")
        if not url or not isinstance(url, str):
            continue  # a link without a URL isn't usable

        try:
            url = _validate_url(url)
        except ScannerValidationError:
            # Unlike the page URL, a single bad link is not fatal to the
            # whole request — links are supplementary evidence. Skip it
            # and keep processing the rest.
            logger.info("Skipping link with invalid URL scheme/format.")
            continue

        links.append(
            LinkModel(
                text=_clean_text(raw_link.get("text", "")),
                url=url,
                category=raw_link.get("category") or raw_link.get("suggested_category"),
                relevance=raw_link.get("relevance"),
            )
        )
    return links


def validate_scanner_payload(payload: Any) -> ValidatedExtraction:
    """
    Validate and normalize the raw scanner payload into a typed
    ValidatedExtraction.

    Raises ScannerValidationError — and ONLY ScannerValidationError — for:
    - non-dict payloads
    - explicit scanner failure (payload["success"] is False)
    - missing/invalid page URL (must be a genuine http(s) URL)
    - any data that fails schema validation while building the internal
      models (e.g. a field with an unexpected type)

    Everything else that's optional (policySections, links, headings,
    tables, lists) degrades to an empty default rather than raising.
    """
    if not isinstance(payload, dict):
        raise ScannerValidationError("Scanner payload must be a JSON object.")

    # Respect an explicit failure signal from the scanner — don't attempt
    # to salvage a run the frontend itself flagged as unsuccessful.
    success = payload.get("success", True)
    if success is False:
        # Do not log the raw payload — it may contain full page content.
        logger.warning("Scanner reported failure; aborting processing.")
        raise ScannerValidationError("The page scanner reported a failure and returned no usable data.")

    data = payload.get("data")
    if not isinstance(data, dict):
        raise ScannerValidationError("Scanner payload is missing its 'data' object.")

    stats = payload.get("stats")
    stats = stats if isinstance(stats, dict) else None

    # Single catch point: ANY pydantic ValidationError raised while
    # building page/content/sections/links/the final ValidatedExtraction
    # itself is normalized into ScannerValidationError here, so this
    # function guarantees exactly one exception type to callers.
    try:
        page = _normalize_page(data.get("page", {}))
        content = _normalize_content(data.get("content", {}))
        policy_sections = _normalize_policy_sections(data.get("policySections", []))
        links = _normalize_links(data.get("links", []))

        return ValidatedExtraction(
            page=page,
            content=content,
            policy_sections=policy_sections,
            links=links,
            stats=stats,
        )
    except ValidationError as exc:
        logger.warning("Scanner payload failed schema validation.")
        raise ScannerValidationError("Scanner payload contains invalid data.") from exc
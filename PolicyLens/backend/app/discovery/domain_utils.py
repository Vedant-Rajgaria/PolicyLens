"""
Registrable-domain helpers used to enforce "official site only" — i.e. a
candidate page is only ever crawled if it shares a registrable domain
(domain + public suffix, e.g. "amazon.co.uk") with the page the user is
actually looking at. Subdomains are allowed (help.amazon.com,
www.amazon.co.uk); unrelated domains are not, even if linked from the page.

Uses tldextract with remote suffix-list fetching disabled — the library
ships a bundled snapshot, so this never makes a network call and never adds
unpredictable startup latency or a hard external dependency in production.
"""

import logging
from functools import lru_cache
from urllib.parse import urlparse

import tldextract

logger = logging.getLogger(__name__)

# suffix_list_urls=() disables fetching the public suffix list remotely;
# tldextract falls back to its bundled snapshot instead. This is a
# deliberate reliability choice: no network call, no flaky startup.
_extractor = tldextract.TLDExtract(suffix_list_urls=())


@lru_cache(maxsize=2048)
def registrable_domain(url_or_host: str) -> str:
    """Returns e.g. 'amazon.co.uk' for 'https://www.amazon.co.uk/returns',
    or '' if it can't be determined (malformed input, IP address, etc.)."""
    if not url_or_host:
        return ""
    try:
        ext = _extractor(url_or_host)
    except Exception as exc:  # never let a malformed URL blow up the caller
        logger.debug("registrable_domain() failed for %r: %s", url_or_host, exc)
        return ""
    if not ext.domain or not ext.suffix:
        return ""
    return f"{ext.domain}.{ext.suffix}".lower()


def is_same_registrable_domain(url: str, reference_domain: str) -> bool:
    """reference_domain should already be a registrable domain (output of
    registrable_domain()), not a full URL."""
    if not reference_domain:
        return False
    candidate = registrable_domain(url)
    return bool(candidate) and candidate == reference_domain.lower()


def has_valid_http_scheme(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
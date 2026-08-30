"""
Data shapes used only within the discovery subsystem. Deliberately kept
separate from app/processing/schemas.py rather than added to it — discovery
is an optional, additive layer on top of the existing pipeline, not a
change to its core contract, so its models live on their own.
"""

from typing import List, Optional

from pydantic import BaseModel

from app.processing.schemas import AdditionalEvidenceItem, PageMetadata, PolicyEvidenceGroup


class SupplementaryEvidenceInput(BaseModel):
    """The 'small packet' sent to the AI for a single crawled page — scoped
    to only the categories still missing, never the full evidence set."""

    source_url: str
    page: PageMetadata
    target_categories: List[str]
    policy_evidence: List[PolicyEvidenceGroup] = []
    additional_relevant_evidence: List[AdditionalEvidenceItem] = []


class ResolvedCategory(BaseModel):
    category: str
    status: str  # "FOUND" | "STILL_MISSING"
    card: Optional[dict] = None


class SupplementaryAIResult(BaseModel):
    resolved: List[ResolvedCategory] = []
    warnings: List[str] = []


class CrawlAuditEntry(BaseModel):
    """One entry per candidate page actually crawled, kept for debugging /
    transparency (e.g. surfaced as an optional `discoveryDebug` field)."""

    url: str
    source: str  # "page_link" | "search_result"
    relevance_score: float
    matched_categories: List[str] = []
    categories_resolved: List[str] = []
    error: Optional[str] = None
    domain: Optional[str] = None   # NEW — registrable domain of the crawled page
    title: Optional[str] = None    # NEW — page title, falls back to link label/domain


class DiscoveryOutcome(BaseModel):
    ran: bool
    reason: Optional[str] = None
    crawled: List[CrawlAuditEntry] = []
    resolved_categories: List[str] = []
    still_missing_categories: List[str] = []
"""
app/processing/schemas.py

Internal Pydantic models that move data safely between the scanner payload,
the validator, the classifier, the checklist engine, and the optimizer.

These models exist so downstream code works with typed objects instead of
raw nested dicts. Everything here is tolerant of missing/optional scanner
fields on purpose — the frontend scanner will not always find headings,
tables, links, or policy sections on every page, and that must not crash
the pipeline.

Dependency direction (see project docs): this file has no dependencies on
the other processing modules, so it sits at the bottom of the import graph:

    schemas
       ^
    validator / classifier / optimizer
       ^
    pipeline
"""

from __future__ import annotations

from enum import Enum
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field


# ==========================================================================
# Shared enums
# ==========================================================================

class PageType(str, Enum):
    PRODUCT = "PRODUCT"
    SERVICE = "SERVICE"
    SOFTWARE = "SOFTWARE"
    SOCIAL_MEDIA = "SOCIAL_MEDIA"
    MARKETPLACE = "MARKETPLACE"
    SUBSCRIPTION_OR_FINANCIAL = "SUBSCRIPTION_OR_FINANCIAL"
    GENERIC = "GENERIC"


class ChecklistStatus(str, Enum):
    FOUND = "FOUND"
    # Deliberately not "NOT_FOUND" or "MISSING_POLICY" — we are only ever
    # claiming an absence of *evidence*, never an absence of the actual
    # policy. See PolicyLens' core principle: never assume missing
    # evidence means the underlying policy doesn't exist.
    NOT_FOUND_IN_CURRENT_EVIDENCE = "NOT_FOUND_IN_CURRENT_EVIDENCE"
    UNCLEAR = "UNCLEAR"


# ==========================================================================
# A. Raw scanner input models
# ==========================================================================

class PageMetadata(BaseModel):
    """Page-level metadata as produced by the JS scanner."""

    url: str
    title: str = ""
    domain: Optional[str] = None
    # Scanner may attach extra metadata (e.g. locale, detected language).
    # We don't need to know every field in advance, so anything beyond the
    # named fields is preserved here rather than silently dropped.
    extra: dict = Field(default_factory=dict)


class ContentBlockModel(BaseModel):
    """A single block of extracted page text."""

    text: str = ""
    # Optional structural hints the scanner *may* attach; not guaranteed.
    tag: Optional[str] = None
    nearby_heading: Optional[str] = None


class ExtractedContent(BaseModel):
    """The broad, uncategorized content extracted from the page."""

    blocks: List[ContentBlockModel] = Field(default_factory=list)
    headings: List[str] = Field(default_factory=list)
    lists: List[Any] = Field(default_factory=list)
    tables: List[Any] = Field(default_factory=list)


class PolicySectionModel(BaseModel):
    """
    A section the scanner's own (lightweight, client-side) categorizer
    already believes is relevant to a specific policy category. Treated
    as high-priority evidence downstream.
    """

    category: str
    confidence: Optional[float] = None
    blocks: List[str] = Field(default_factory=list)


class LinkModel(BaseModel):
    """A link extracted from the page, possibly policy-relevant."""

    text: str = ""
    url: str
    category: Optional[str] = None
    relevance: Optional[float] = None


class ScannerStats(BaseModel):
    """Loose bag for scanner-reported stats; not required for processing."""

    model_config = {"extra": "allow"}


class ValidatedExtraction(BaseModel):
    """
    The fully validated, normalized scanner payload. This is the object
    validator.py hands to classifier.py and optimizer.py — nothing
    downstream should need to touch the raw scanner dict again.
    """

    page: PageMetadata
    content: ExtractedContent = Field(default_factory=ExtractedContent)
    policy_sections: List[PolicySectionModel] = Field(default_factory=list)
    links: List[LinkModel] = Field(default_factory=list)
    stats: Optional[dict] = None


# ==========================================================================
# B. Processing / checklist result models
# ==========================================================================

class PageClassification(BaseModel):
    page_type: PageType
    confidence: float
    reasons: List[str] = Field(default_factory=list)


class ChecklistCategoryResult(BaseModel):
    category: str
    status: ChecklistStatus
    required: bool
    evidence_count: int = 0


class ChecklistResult(BaseModel):
    page_type: PageType
    required_categories: List[str] = Field(default_factory=list)
    important_categories: List[str] = Field(default_factory=list)
    found_categories: List[str] = Field(default_factory=list)
    missing_categories: List[str] = Field(default_factory=list)
    unclear_categories: List[str] = Field(default_factory=list)
    details: List[ChecklistCategoryResult] = Field(default_factory=list)


# ==========================================================================
# C. Optimized AI input models — the contract with analyser.py
# ==========================================================================

class OptimizedPageInfo(BaseModel):
    url: str
    title: str = ""
    domain: Optional[str] = None
    page_type: PageType
    classification_confidence: float


class OptimizedChecklist(BaseModel):
    page_type: PageType
    required_categories: List[str] = Field(default_factory=list)
    found_categories: List[str] = Field(default_factory=list)
    missing_categories: List[str] = Field(default_factory=list)
    unclear_categories: List[str] = Field(default_factory=list)


class PolicyEvidenceGroup(BaseModel):
    category: str
    confidence: Optional[float] = None
    statements: List[str] = Field(default_factory=list)


class AdditionalEvidenceItem(BaseModel):
    text: str
    source: Literal["content_block", "heading", "list", "table"] = "content_block"
    nearby_heading: Optional[str] = None


class RelevantLink(BaseModel):
    text: str = ""
    url: str
    suggested_category: Optional[str] = None


class DiscoveryHints(BaseModel):
    missing_categories: List[str] = Field(default_factory=list)
    relevant_links: List[RelevantLink] = Field(default_factory=list)


class OptimizedPolicyInput(BaseModel):
    """
    The stable output contract of optimizer.py. This is what gets passed
    (via .model_dump()) into the existing analyse_policy() in analyser.py.
    Keep this model's shape stable — it's the seam between the
    deterministic processing layer and the Gemini reasoning layer.
    """

    page: OptimizedPageInfo
    checklist: OptimizedChecklist
    policy_evidence: List[PolicyEvidenceGroup] = Field(default_factory=list)
    additional_relevant_evidence: List[AdditionalEvidenceItem] = Field(default_factory=list)
    discovery_hints: DiscoveryHints = Field(default_factory=DiscoveryHints)


# ==========================================================================
# Controlled errors
# ==========================================================================

class ScannerValidationError(Exception):
    """
    Raised by validator.py when the incoming scanner payload is malformed
    or explicitly reports failure. pipeline.py/main.py should catch this
    and return a clean 4xx-style response to the extension — never let a
    raw KeyError/AttributeError/pydantic ValidationError leak out.
    """
    pass
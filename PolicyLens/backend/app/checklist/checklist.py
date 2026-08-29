"""
app/checklist/checklist.py

The checklist engine: defines which policy categories matter for each
page type, and evaluates the validated extraction against that spec.

NOTE ON SCOPE: this file wasn't in the original four-module list (schemas/
validator/classifier/optimizer), but the requested orchestration function
(get_checklist_for_page_type + run_checklist) needs a home, and section 5
of the spec fully describes its required behavior. Implemented here as a
standalone module so it's easy to relocate or replace if a fuller
checklist system already exists elsewhere in the project — nothing in
optimizer.py depends on this file's internals, only on ChecklistResult's
shape (see processing/schemas.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

from app.processing.schemas import (
    ChecklistCategoryResult,
    ChecklistResult,
    ChecklistStatus,
    PageType,
    PolicySectionModel,
    ValidatedExtraction,
)

# --------------------------------------------------------------------------
# Per-page-type requirements
# --------------------------------------------------------------------------
# These are prototype defaults per the spec examples — easy to extend
# without touching classifier.py or optimizer.py.


@dataclass(frozen=True)
class ChecklistSpec:
    page_type: PageType
    required: List[str] = field(default_factory=list)
    important: List[str] = field(default_factory=list)


_PAGE_TYPE_CHECKLISTS: Dict[PageType, ChecklistSpec] = {
    PageType.PRODUCT: ChecklistSpec(
        page_type=PageType.PRODUCT,
        required=["RETURN", "REFUND", "WARRANTY"],
        important=["EXCHANGE", "SHIPPING", "DELIVERY", "PAYMENT"],
    ),
    PageType.SERVICE: ChecklistSpec(
        page_type=PageType.SERVICE,
        required=["CANCELLATION", "REFUND", "PAYMENT"],
        important=[],
    ),
    PageType.SOFTWARE: ChecklistSpec(
        page_type=PageType.SOFTWARE,
        required=["PRIVACY", "TERMS", "SUBSCRIPTION_OR_PAYMENT"],
        important=["CANCELLATION", "DATA_COLLECTION", "ACCOUNT_TERMINATION"],
    ),
    PageType.SOCIAL_MEDIA: ChecklistSpec(
        page_type=PageType.SOCIAL_MEDIA,
        required=["PRIVACY", "TERMS"],
        important=["DATA_COLLECTION", "ACCOUNT_DELETION", "CONTENT_RULES"],
    ),
    PageType.MARKETPLACE: ChecklistSpec(
        page_type=PageType.MARKETPLACE,
        required=["RETURN", "REFUND"],
        important=["PAYMENT", "DISPUTE_RESOLUTION"],
    ),
    PageType.SUBSCRIPTION_OR_FINANCIAL: ChecklistSpec(
        page_type=PageType.SUBSCRIPTION_OR_FINANCIAL,
        required=["CANCELLATION", "PAYMENT", "REFUND"],
        important=["AUTO_RENEWAL", "PRICE_CHANGES"],
    ),
    PageType.GENERIC: ChecklistSpec(
        page_type=PageType.GENERIC,
        required=["TERMS", "PRIVACY"],
        important=["RETURN", "REFUND"],
    ),
}

# Lightweight keyword hints used to detect *weak* (uncategorized) signals
# for a checklist category inside content.blocks/headings, when the
# scanner's own categorizer didn't produce a dedicated policySections
# entry. A hit here means UNCLEAR, not FOUND — it's evidence the topic is
# discussed, not that we have a clean statement of the policy.
_CATEGORY_HINT_KEYWORDS: Dict[str, List[str]] = {
    "RETURN": ["return", "returns", "returned"],
    "REFUND": ["refund", "reimburse", "money back"],
    "WARRANTY": ["warranty", "guarantee"],
    "EXCHANGE": ["exchange", "replacement"],
    "SHIPPING": ["shipping", "shipment"],
    "DELIVERY": ["delivery", "delivered"],
    "PAYMENT": ["payment", "billing", "charge"],
    "CANCELLATION": ["cancel", "cancellation"],
    "PRIVACY": ["privacy", "personal data", "data protection"],
    "TERMS": ["terms of service", "terms and conditions", "terms of use"],
    "SUBSCRIPTION_OR_PAYMENT": ["subscription", "billing cycle", "plan"],
    "DATA_COLLECTION": ["data collection", "we collect", "cookies"],
    "ACCOUNT_TERMINATION": ["terminate", "suspend", "account termination"],
    "ACCOUNT_DELETION": ["delete your account", "account deletion"],
    "CONTENT_RULES": ["community guidelines", "content policy"],
    "DISPUTE_RESOLUTION": ["dispute", "arbitration"],
    "AUTO_RENEWAL": ["auto-renew", "automatically renew"],
    "PRICE_CHANGES": ["price change", "price increase"],
}


def get_checklist_for_page_type(page_type: PageType) -> ChecklistSpec:
    """Returns the checklist spec for a page type, defaulting to GENERIC."""
    return _PAGE_TYPE_CHECKLISTS.get(page_type, _PAGE_TYPE_CHECKLISTS[PageType.GENERIC])


def _index_policy_sections(sections: List[PolicySectionModel]) -> Dict[str, List[PolicySectionModel]]:
    """Build a category -> sections index once, instead of re-scanning per category."""
    index: Dict[str, List[PolicySectionModel]] = {}
    for section in sections:
        index.setdefault(section.category, []).append(section)
    return index


def run_checklist(extraction: ValidatedExtraction, checklist: ChecklistSpec) -> ChecklistResult:
    """
    Evaluate the validated extraction against a checklist spec.

    Status semantics:
    - FOUND: at least one policySections entry for this category has
      non-empty evidence blocks.
    - UNCLEAR: no dedicated policySections entry, but a keyword hint for
      this category appears somewhere in content.blocks or headings.
    - NOT_FOUND_IN_CURRENT_EVIDENCE: no dedicated section and no keyword
      hint. This is a statement about the evidence, not the policy.
    """
    section_index = _index_policy_sections(extraction.policy_sections)

    # Build one lowercase searchable blob for the weak-signal hint pass,
    # same trick as classifier.py — avoid rescanning content per category.
    supplementary_text = " ".join(
        [*extraction.content.headings, *(b.text for b in extraction.content.blocks)]
    ).lower()

    all_categories = list(dict.fromkeys([*checklist.required, *checklist.important]))

    details: List[ChecklistCategoryResult] = []
    found: List[str] = []
    missing: List[str] = []
    unclear: List[str] = []

    for category in all_categories:
        sections = section_index.get(category, [])
        evidence_count = sum(1 for s in sections for block in s.blocks if block.strip())

        if evidence_count > 0:
            status = ChecklistStatus.FOUND
            found.append(category)
        else:
            hints = _CATEGORY_HINT_KEYWORDS.get(category, [])
            has_weak_signal = any(hint in supplementary_text for hint in hints)
            if has_weak_signal:
                status = ChecklistStatus.UNCLEAR
                unclear.append(category)
            else:
                status = ChecklistStatus.NOT_FOUND_IN_CURRENT_EVIDENCE
                missing.append(category)

        details.append(
            ChecklistCategoryResult(
                category=category,
                status=status,
                required=category in checklist.required,
                evidence_count=evidence_count,
            )
        )

    return ChecklistResult(
        page_type=checklist.page_type,
        required_categories=checklist.required,
        important_categories=checklist.important,
        found_categories=found,
        missing_categories=missing,
        unclear_categories=unclear,
        details=details,
    )
"""
Turns a crawled sub-page's ValidatedExtraction into a small, category-scoped
SupplementaryEvidenceInput — the "packet" sent to the AI for that one page.
Deliberately does NOT run classifier.py/checklist.py against sub-pages:
those pages aren't being classified as a "page type" in their own right,
we're only asking "does this page contain evidence for these specific
still-missing categories," which is a narrower and cheaper question.
"""

from typing import List

from app.discovery.config import DISCOVERY_CONFIG
from app.discovery.vocabulary_bridge import load_vocabulary
from app.discovery.schemas import SupplementaryEvidenceInput
from app.processing.schemas import AdditionalEvidenceItem, PolicyEvidenceGroup, ValidatedExtraction

_MAX_STATEMENTS_PER_CATEGORY = 6
_MAX_ADDITIONAL_EVIDENCE = 10


def _mentions_any_target_category(text: str, categories: List[str], vocabulary: dict) -> bool:
    text_lower = text.lower()
    for category in categories:
        entry = vocabulary.get(category) or vocabulary.get(category.upper()) or {}
        for term in entry.get("terms", []):
            if term.lower() in text_lower:
                return True
    return False


def build_supplementary_evidence(
    url: str,
    extraction: ValidatedExtraction,
    target_categories: List[str],
) -> SupplementaryEvidenceInput:
    vocabulary = load_vocabulary(DISCOVERY_CONFIG.extension_content_dir)
    target_upper = [c.upper() for c in target_categories]

    covered: set[str] = set()
    evidence_groups: List[PolicyEvidenceGroup] = []

    for section in extraction.policy_sections:
        category = (section.category or "").upper()
        if category not in target_upper:
            continue
        statements = [b for b in section.blocks if b][:_MAX_STATEMENTS_PER_CATEGORY]
        if not statements:
            continue
        evidence_groups.append(
            PolicyEvidenceGroup(category=category, confidence=section.confidence, statements=statements)
        )
        covered.update(s.lower() for s in statements)

    additional: List[AdditionalEvidenceItem] = []
    for block in extraction.content.blocks:
        text = (block.text or "").strip()
        if not text or text.lower() in covered:
            continue
        if not _mentions_any_target_category(text, target_upper, vocabulary):
            continue
        additional.append(AdditionalEvidenceItem(text=text, source="content_block", nearby_heading=block.nearby_heading))
        if len(additional) >= _MAX_ADDITIONAL_EVIDENCE:
            break

    return SupplementaryEvidenceInput(
        source_url=url,
        page=extraction.page,
        target_categories=target_upper,
        policy_evidence=evidence_groups,
        additional_relevant_evidence=additional,
    )
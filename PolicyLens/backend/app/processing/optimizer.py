"""
app/processing/optimizer.py

Converts a large raw scanner extraction into concise, high-value,
structured evidence for the Gemini analyzer (ai/analyser.py).

This module performs NO consumer-facing interpretation — no summarizing,
no "this means X for you" reasoning. It only selects, dedupes, and
truncates evidence so the reasoning layer (Gemini) gets a clean, bounded
input. All semantic understanding stays in analyser.py.

This module also does NOT orchestrate the pipeline — it doesn't validate,
classify, or run the checklist itself; it only transforms the results of
those stages (see pipeline.py, which owns that sequencing).
"""

from __future__ import annotations
from typing import List

import logging
from typing import Dict, List, Set

from .schemas import (
    AdditionalEvidenceItem,
    ChecklistResult,
    ContentBlockModel,
    DiscoveryHints,
    OptimizedChecklist,
    OptimizedPageInfo,
    OptimizedPolicyInput,
    PageClassification,
    PolicyEvidenceGroup,
    RelevantLink,
    ValidatedExtraction,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# Configuration — named constants instead of magic numbers, per spec.
# --------------------------------------------------------------------------

MAX_STATEMENTS_PER_CATEGORY = 6
MAX_STATEMENT_LENGTH = 400          # characters, per statement
MAX_ADDITIONAL_EVIDENCE_ITEMS = 10
MAX_ADDITIONAL_EVIDENCE = 15
MAX_RELEVANT_LINKS = 8
MAX_TOTAL_EVIDENCE_CHARS = 12_000   # rough character budget standing in for a token budget
MIN_STATEMENTS_KEPT_PER_CATEGORY = 1  # floor when trimming to fit the budget
NEAR_DUPLICATE_TOKEN_OVERLAP = 0.8  # jaccard similarity threshold
MAX_RELEVANT_LINKS_PER_CATEGORY = 2
MIN_BLOCK_LENGTH_TO_CONSIDER = 15   # chars — filters obvious UI labels/nav crumbs

# Boilerplate substrings that suggest navigation/marketing noise rather
# than policy content. Deliberately narrow and literal for the prototype
# — false negatives (missing a boilerplate line) are cheaper than false
# positives (dropping real policy text).
_BOILERPLATE_MARKERS = [
    "all rights reserved",
    "subscribe to our newsletter",
    "follow us on",
    "accept all cookies",
    "cookie settings",
    "add to cart",
    "sign in",
    "sign up",
    "skip to content",
]

# Signal keyword groups used to score how policy-relevant a statement is.
_DEADLINE_SIGNALS = ["day", "days", "week", "weeks", "month", "months", "within", "before", "after", "expiry", "expires"]
_CONDITION_SIGNALS = ["if ", "only if", "provided that", "subject to", "must ", "required"]
_RESTRICTION_SIGNALS = ["except", "excluded", "does not cover", "non-refundable", "cannot", "not eligible"]
_FINANCIAL_SIGNALS = ["price", "fee", "charge", "refund amount", "payment", "$", "€", "£", "₹"]


# --------------------------------------------------------------------------
# Text helpers
# --------------------------------------------------------------------------

def _normalize_for_dedup(text: str) -> str:
    return " ".join(text.lower().split())


def _token_set(text: str) -> Set[str]:
    return set(_normalize_for_dedup(text).split())


def _jaccard_overlap(a: str, b: str) -> float:
    tokens_a, tokens_b = _token_set(a), _token_set(b)
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = len(tokens_a & tokens_b)
    union = len(tokens_a | tokens_b)
    return intersection / union if union else 0.0

def _containment_overlap(a: str, b: str) -> float:
    tokens_a = _token_set(a)
    tokens_b = _token_set(b)

    if not tokens_a or not tokens_b:
        return 0.0

    intersection = len(tokens_a & tokens_b)
    smaller_set_size = min(len(tokens_a), len(tokens_b))

    return intersection / smaller_set_size


def _signal_score(text: str) -> int:
    """
    Counts how many distinct policy-signal categories a statement touches
    (deadline/condition/restriction/financial). Used to prioritize which
    statements survive truncation — more signal-rich statements first.
    """
    lower = text.lower()
    score = 0
    for group in (_DEADLINE_SIGNALS, _CONDITION_SIGNALS, _RESTRICTION_SIGNALS, _FINANCIAL_SIGNALS):
        if any(signal in lower for signal in group):
            score += 1
    return score


def _is_boilerplate(text: str) -> bool:
    if len(text) < MIN_BLOCK_LENGTH_TO_CONSIDER:
        return True
    lower = text.lower()
    return any(marker in lower for marker in _BOILERPLATE_MARKERS)


def _truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    # Truncate at the last whitespace before the limit so we don't cut a
    # word (and therefore a number/date) in half.
    cut = text[:max_len].rsplit(" ", 1)[0]
    return cut.rstrip(",.;: ") + "…"


def _dedupe_statements(statements: List[str]) -> List[str]:
    """
    Removes exact duplicates and near-duplicates.

    Two statements are considered duplicates when either:
    - their Jaccard similarity is above the configured threshold, or
    - one statement's tokens are largely contained within the other.

    For duplicate/contained statements, the longer statement is retained
    as a simple deterministic proxy for the more detailed version.
    """
    kept: List[str] = []

    for candidate in statements:
        normalized_candidate = _normalize_for_dedup(candidate)
        replaced_existing = False

        for i, existing in enumerate(kept):
            normalized_existing = _normalize_for_dedup(existing)

            # Exact duplicate
            if normalized_existing == normalized_candidate:
                replaced_existing = True
                break

            jaccard = _jaccard_overlap(candidate, existing)
            containment = _containment_overlap(candidate, existing)

            if (
                jaccard >= NEAR_DUPLICATE_TOKEN_OVERLAP
                or containment >= NEAR_DUPLICATE_TOKEN_OVERLAP
            ):
                if len(candidate) > len(existing):
                    kept[i] = candidate

                replaced_existing = True
                break

        if not replaced_existing:
            kept.append(candidate)

    return kept


# --------------------------------------------------------------------------
# Evidence builders
# --------------------------------------------------------------------------

def _build_policy_evidence(extraction: ValidatedExtraction) -> List[PolicyEvidenceGroup]:
    """
    Groups policySections by category (the scanner may emit multiple
    sections for the same category on a long page), dedupes statements
    within each group, ranks by policy-signal richness, and caps to
    MAX_STATEMENTS_PER_CATEGORY.
    """
    grouped: Dict[str, List[str]] = {}
    confidence_by_category: Dict[str, float] = {}

    for section in extraction.policy_sections:
        clean_blocks = [b for b in section.blocks if b.strip()]
        grouped.setdefault(section.category, []).extend(clean_blocks)
        if section.confidence is not None:
            confidence_by_category[section.category] = max(
                confidence_by_category.get(section.category, 0.0), section.confidence
            )

    evidence_groups: List[PolicyEvidenceGroup] = []
    for category, statements in grouped.items():
        deduped = _dedupe_statements(statements)
        ranked = sorted(deduped, key=_signal_score, reverse=True)
        capped = [_truncate(s, MAX_STATEMENT_LENGTH) for s in ranked[:MAX_STATEMENTS_PER_CATEGORY]]

        evidence_groups.append(
            PolicyEvidenceGroup(
                category=category,
                confidence=confidence_by_category.get(category),
                statements=capped,
            )
        )

    return evidence_groups


def _already_covered(text: str, covered_texts: List[str]) -> bool:
    normalized = _normalize_for_dedup(text)
    for covered in covered_texts:
        if normalized == _normalize_for_dedup(covered):
            return True
        if _jaccard_overlap(text, covered) >= NEAR_DUPLICATE_TOKEN_OVERLAP:
            return True
    return False


def _build_additional_evidence(
    extraction: ValidatedExtraction,
    policy_evidence: List[PolicyEvidenceGroup],
) -> List[AdditionalEvidenceItem]:
    """
    Scans content.blocks the scanner's own categorizer missed, looking for
    blocks that still carry a policy signal (deadline/condition/
    restriction/financial keyword). This is how the pipeline recovers
    evidence the frontend categorizer overlooked, per the architectural
    requirement that content.blocks is supplementary evidence, not
    ignorable just because it's uncategorized.
    """
    already_covered_texts = [s for group in policy_evidence for s in group.statements]

    candidates: List[ContentBlockModel] = [
        block for block in extraction.content.blocks
        if not _is_boilerplate(block.text) and _signal_score(block.text) > 0
    ]

    # Rank richest-signal blocks first so truncation (if needed) drops the
    # weakest supplementary evidence, not the strongest.
    candidates.sort(key=lambda b: _signal_score(b.text), reverse=True)

    additional: List[AdditionalEvidenceItem] = []
    seen_in_this_pass: List[str] = []

    for block in candidates:
        if len(additional) >= MAX_ADDITIONAL_EVIDENCE_ITEMS:
            break
        if _already_covered(block.text, already_covered_texts) or _already_covered(block.text, seen_in_this_pass):
            continue  # don't duplicate evidence already captured by policy_evidence

        additional.append(
            AdditionalEvidenceItem(
                text=_truncate(block.text, MAX_STATEMENT_LENGTH),
                source="content_block",
                nearby_heading=block.nearby_heading,
            )
        )
        seen_in_this_pass.append(block.text)

    return additional


def _build_discovery_hints(
    extraction: ValidatedExtraction,
    checklist_result: ChecklistResult,
) -> DiscoveryHints:
    """
    For each missing category, look for links whose visible text or
    scanner-assigned category hints at that category, so the (future)
    discovery/crawler module has a head start rather than searching blind.
    """
    relevant_links: List[RelevantLink] = []

    for category in checklist_result.missing_categories:
        category_lower = category.lower().replace("_", " ")
        matches = 0
        for link in extraction.links:
            link_category = (link.category or "").lower()
            link_text = link.text.lower()
            if category_lower in link_category or category_lower in link_text:
                relevant_links.append(
                    RelevantLink(text=link.text, url=link.url, suggested_category=category)
                )
                matches += 1
                if matches >= MAX_RELEVANT_LINKS_PER_CATEGORY:
                    break

    return DiscoveryHints(
        missing_categories=checklist_result.missing_categories,
        relevant_links=relevant_links,
    )


# --------------------------------------------------------------------------
# Size budget enforcement
# --------------------------------------------------------------------------

def _total_chars(policy_evidence: List[PolicyEvidenceGroup], additional: List[AdditionalEvidenceItem]) -> int:
    total = sum(len(s) for group in policy_evidence for s in group.statements)
    total += sum(len(item.text) for item in additional)
    return total


def _enforce_size_budget(
    policy_evidence: List[PolicyEvidenceGroup],
    additional: List[AdditionalEvidenceItem],
) -> tuple[List[PolicyEvidenceGroup], List[AdditionalEvidenceItem]]:
    """
    If the combined evidence exceeds MAX_TOTAL_EVIDENCE_CHARS, trim the
    cheapest evidence first: additional_relevant_evidence (lowest
    priority, per the spec's evidence-priority ordering) before touching
    categorized policy_evidence. Within policy_evidence, trim from the
    end of each category's statement list (already sorted richest-first)
    down to MIN_STATEMENTS_KEPT_PER_CATEGORY, preserving category
    coverage rather than dropping whole categories.
    """
    if _total_chars(policy_evidence, additional) <= MAX_TOTAL_EVIDENCE_CHARS:
        return policy_evidence, additional

    # Step 1: drop additional evidence items from the tail (weakest signal
    # first, since the list is sorted strongest-first) until it's gone or
    # we're back under budget.
    trimmed_additional = list(additional)
    while trimmed_additional and _total_chars(policy_evidence, trimmed_additional) > MAX_TOTAL_EVIDENCE_CHARS:
        trimmed_additional.pop()

    if _total_chars(policy_evidence, trimmed_additional) <= MAX_TOTAL_EVIDENCE_CHARS:
        return policy_evidence, trimmed_additional

    # Step 2: still over budget — trim per-category statements down to the
    # floor, round-robin, so no single category loses all its evidence.
    trimmed_groups = [g.model_copy(deep=True) for g in policy_evidence]
    changed = True
    while changed and _total_chars(trimmed_groups, trimmed_additional) > MAX_TOTAL_EVIDENCE_CHARS:
        changed = False
        for group in trimmed_groups:
            if len(group.statements) > MIN_STATEMENTS_KEPT_PER_CATEGORY:
                group.statements.pop()
                changed = True
                if _total_chars(trimmed_groups, trimmed_additional) <= MAX_TOTAL_EVIDENCE_CHARS:
                    break

    return trimmed_groups, trimmed_additional


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------

def optimize_policy_data(
    extraction: ValidatedExtraction,
    classification: PageClassification,
    checklist_result: ChecklistResult,
) -> OptimizedPolicyInput:
    page = OptimizedPageInfo(
        url=extraction.page.url, title=extraction.page.title, domain=extraction.page.domain,
        page_type=classification.page_type, classification_confidence=classification.confidence,
    )
    checklist = OptimizedChecklist(
        page_type=checklist_result.page_type,
        required_categories=checklist_result.required_categories,
        found_categories=checklist_result.found_categories,
        missing_categories=checklist_result.missing_categories,
        unclear_categories=checklist_result.unclear_categories,
    )

    policy_evidence: List[PolicyEvidenceGroup] = []
    covered = set()
    for section in extraction.policy_sections:
        statements = [b for b in section.blocks if b.strip()][:MAX_STATEMENTS_PER_CATEGORY]
        if not statements:
            continue
        covered.update(s.lower() for s in statements)
        policy_evidence.append(PolicyEvidenceGroup(
            category=section.category, confidence=section.confidence, statements=statements,
        ))

    additional: List[AdditionalEvidenceItem] = []
    for block in extraction.content.blocks:
        if len(additional) >= MAX_ADDITIONAL_EVIDENCE:
            break
        if block.text.lower() in covered:
            continue
        additional.append(AdditionalEvidenceItem(
            text=block.text, source="content_block", nearby_heading=block.nearby_heading,
        ))

    relevant_links = [
        RelevantLink(text=link.text, url=link.url, suggested_category=link.category)
        for link in extraction.links
        if link.category in checklist_result.missing_categories
    ][:MAX_RELEVANT_LINKS]

    return OptimizedPolicyInput(
        page=page, checklist=checklist, policy_evidence=policy_evidence,
        additional_relevant_evidence=additional,
        discovery_hints=DiscoveryHints(
            missing_categories=checklist_result.missing_categories,
            relevant_links=relevant_links,
        ),
    )
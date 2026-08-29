"""
app/processing/pipeline.py

The orchestrator for the deterministic processing pipeline:

    raw scanner payload
            |
            v
      validator.py      (validate_scanner_payload)
            |
            v
      classifier.py     (classify_page)
            |
            v
      app/checklist/     (get_checklist_for_page_type, run_checklist)
            |
            v
      optimizer.py       (optimize_policy_data)
            |
            v
      OptimizedPolicyInput

No LLM call happens in this module or anything it calls. This file is
the ONLY place that sequences validator/classifier/checklist/optimizer
together — each of those modules stays independently testable and has no
knowledge of the others' existence.

Import style note: relative imports (.validator, .classifier, .optimizer)
are used for sibling modules within this same processing/ package;
app.checklist.checklist uses an absolute import since checklist/ is a
separate top-level package (domain configuration, not a processing
transformation stage) — see app/checklist/checklist.py for why it's kept
separate rather than folded into processing/.
"""

from __future__ import annotations

from typing import Any

from app.checklist.checklist import get_checklist_for_page_type, run_checklist

from .classifier import classify_page
from .optimizer import optimize_policy_data
from .schemas import OptimizedPolicyInput
from .validator import validate_scanner_payload


def process_scan(scanner_payload: Any) -> OptimizedPolicyInput:
    """
    Run the full deterministic processing pipeline on a raw scanner
    payload and return the bounded, structured evidence ready for the AI
    analyzer.

    Raises ScannerValidationError (from validator.py) if the payload is
    malformed or the scanner explicitly reported failure. Callers (the
    API route, or a future step that calls the analyzer) should catch
    this and return a clean error to the extension — this function
    guarantees it never reaches the optimizer or any AI call in that
    case.

    Does not call the AI analyzer. That's a deliberate boundary: this
    pipeline only produces OptimizedPolicyInput; calling analyze_policy()
    on the result is the caller's responsibility (e.g. a future
    orchestration step or the API route), keeping this module free of
    any Gemini-specific concerns.
    """
    extraction = validate_scanner_payload(scanner_payload)
    classification = classify_page(extraction)

    checklist_spec = get_checklist_for_page_type(classification.page_type)
    checklist_result = run_checklist(extraction, checklist_spec)

    return optimize_policy_data(
        extraction=extraction,
        classification=classification,
        checklist_result=checklist_result,
    )
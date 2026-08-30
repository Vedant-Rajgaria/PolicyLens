from dotenv import load_dotenv
load_dotenv() 

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict

from app.processing.pipeline import process_scan
from app.processing.schemas import ScannerValidationError
from app.ai.analyser import analyse_policy, AnalyserError

# Phase 2: Import the browser pool module for the crawler
from app.crawl.browser_pool import browser_pool

# Phase 3: Import the orchestrator functions
from app.discovery.orchestrator import resolve_missing_policies, merge_cards


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan hook to safely manage the Playwright browser pool.
    Fails open: if the browser cannot start, we swallow the error 
    so the main API continues to function for single-page scans.
    """
    try:
        browser_pool.start()
    except Exception as exc:
        print(f"Warning: Discovery browser pool failed to start: {exc}")
    
    yield
    
    try:
        browser_pool.stop()
    except Exception:
        pass


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["POST"], allow_headers=["Content-Type"],
)

@app.post("/analyze")
def analyze(payload: Dict[str, Any]):
    # 1. Main Pipeline (Unchanged)
    try:
        optimized = process_scan(payload)
    except ScannerValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    
    try:
        main_result = analyse_policy(optimized)
    except AnalyserError as exc:
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {exc}")

    # 2. Discovery Crawler (Phase 3 Additive Integration)
    missing_categories = optimized.checklist.missing_categories
    
    if missing_categories:
        try:
            # Execute the async crawler within this sync route thread
            resolved_cards, extra_warnings, outcome = asyncio.run(
                resolve_missing_policies(
                    optimized=optimized,
                    missing_categories=missing_categories
                )
            )
            
            # Merge successfully resolved cards into the main result safely
            if resolved_cards:
                main_result["cards"] = merge_cards(main_result.get("cards", []), resolved_cards)
            
            # Append any extra warnings
            if extra_warnings:
                main_result["warnings"] = main_result.get("warnings", []) + extra_warnings
                
        except Exception as exc:
            # FAIL OPEN: If the crawler crashes, log it and return the healthy main_result
            print(f"Warning: Discovery subsystem failed, falling back to single-page. Error: {exc}")

    # 3. Return final result
    return main_result


@app.get("/health")
def health():
    return {"status": "ok"}
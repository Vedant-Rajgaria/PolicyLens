from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict

from app.processing.pipeline import process_scan
from app.processing.schemas import ScannerValidationError
from app.ai.analyser import analyse_policy, AnalyserError

app = FastAPI()

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["POST"], allow_headers=["Content-Type"],
)

@app.post("/analyze")
def analyze(payload: Dict[str, Any]):
    try:
        optimized = process_scan(payload)
    except ScannerValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    try:
        return analyse_policy(optimized)
    except AnalyserError as exc:
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {exc}")

@app.get("/health")
def health():
    return {"status": "ok"}
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    url: str
    title: str
    text: str

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    # Stub logic standing in for pipeline.py — proves the round trip.
    # Later this becomes checker.py + search.py + analyzer.py output.
    return {
        "cards": [
            {"label": "Return Window", "badgeText": "ATTENTION", "badgeType": "attention", "detail": "7 days"},
            {"label": "Refund", "badgeText": "AVAILABLE", "badgeType": "safe", "detail": "After product inspection"},
            {"label": "Warranty", "badgeText": "1 YEAR", "badgeType": "safe", "detail": "Physical damage is excluded"},
        ],
        "warnings": [
            "Only 7 days to return the product.",
            "Refund depends on product inspection.",
            "Physical damage is not covered by warranty.",
        ],
    }
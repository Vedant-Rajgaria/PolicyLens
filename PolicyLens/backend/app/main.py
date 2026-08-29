from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# Extensions send requests from a chrome-extension:// origin.
# Locking this down later is fine; for now allow all so nothing blocks you.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
#defines expected request format
class AnalyzeRequest(BaseModel):
    url: str
    title: str
    text: str

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    # Placeholder for pipeline.py — proves the round trip works.
    return {
        "summary": f"Received {len(req.text)} characters from {req.title}",
        "word_count": len(req.text.split()),
        "echo_url": req.url,
    }
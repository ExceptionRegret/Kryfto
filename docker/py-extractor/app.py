from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel
from bs4 import BeautifulSoup

app = FastAPI(title="collector-py-extractor", version="1.0.0")


class ExtractRequest(BaseModel):
    mode: str
    html: str
    selectors: dict[str, str] | None = None


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/extract")
def extract(req: ExtractRequest) -> dict[str, object]:
    if req.mode != "selectors":
        return {"mode": req.mode, "data": {"warning": "python extractor scaffold supports selectors mode only"}}

    soup = BeautifulSoup(req.html, "html.parser")
    out: dict[str, object] = {}
    for key, selector in (req.selectors or {}).items():
        node = soup.select_one(selector)
        out[key] = node.get_text(strip=True) if node else None
    return {"mode": req.mode, "data": out}
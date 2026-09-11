from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import get_settings
from app.pipeline import process_records

settings = get_settings()
app = FastAPI(title=settings.service_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProcessRequest(BaseModel):
    records: list[dict[str, Any]] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)


class ProcessResponse(BaseModel):
    records: list[dict[str, Any]]
    summary: dict[str, Any]


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": settings.service_name, "status": "ok"}


@app.post("/v1/process", response_model=ProcessResponse)
def process(request: ProcessRequest) -> ProcessResponse:
    records, summary = process_records(request.records, request.parameters)
    return ProcessResponse(records=records, summary=summary)

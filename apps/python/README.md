# Python service

This optional FastAPI service is for data processing and machine-learning work that does not fit in the web worker.

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

- `GET /health` checks the service.
- `POST /v1/process` accepts `records` and `parameters`.
- Replace `app/pipeline.py` with problem-specific feature or model logic.

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_process_contract() -> None:
    response = client.post(
        "/v1/process",
        json={"records": [{"value": 4}], "parameters": {"mode": "demo"}},
    )

    assert response.status_code == 200
    assert response.json()["summary"]["row_count"] == 1
    assert response.json()["records"] == [{"value": 4}]

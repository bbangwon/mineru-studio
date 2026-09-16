import pytest
from starlette.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


def test_api_qdrant_sync():
    response = client.post("/api/qdrant/sync")
    assert response.status_code == 200
    data = response.json()
    assert "success" in data
    assert "status" in data
    assert "manifest" in data
    assert "indexed_doc_count" in data

import json
from pathlib import Path
from fastapi.testclient import TestClient
from backend.app.main import app, BASE_DIR

client = TestClient(app)

def test_api_pdf_list_preserves_strategy():
    response = client.get("/api/pdf/list")
    assert response.status_code == 200
    data = response.json()
    assert "pdfs" in data
    # 각 PDF의 strategy 및 상태 검증
    for pdf in data["pdfs"]:
        assert "strategy" in pdf
        assert "method" in pdf
        assert "backend" in pdf

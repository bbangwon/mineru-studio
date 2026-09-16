import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.parser_config_svc import (
    get_parser_config,
    save_parser_config,
    reset_parser_config,
    ParserConfig,
)

client = TestClient(app)


def test_api_get_parser_config():
    response = client.get("/api/parser/config")
    assert response.status_code == 200
    data = response.json()
    assert "backend" in data
    assert "method" in data
    assert "strategy" in data
    assert "formula" in data
    assert "all_pages" in data


def test_api_save_and_reset_parser_config():
    # 1. Update config
    new_cfg = {
        "backend": "hybrid-engine",
        "method": "ocr",
        "formula": False,
        "strategy": "legal",
        "all_pages": False,
        "start_page": 1,
        "end_page": 5,
    }
    res = client.post("/api/parser/config", json=new_cfg)
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["config"]["backend"] == "hybrid-engine"
    assert data["config"]["method"] == "ocr"
    assert data["config"]["strategy"] == "legal"
    assert data["config"]["formula"] is False
    assert data["config"]["all_pages"] is False
    assert data["config"]["start_page"] == 1
    assert data["config"]["end_page"] == 5

    # 2. Verify persisted
    get_res = client.get("/api/parser/config")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert get_data["backend"] == "hybrid-engine"
    assert get_data["method"] == "ocr"

    # 3. Reset to default
    reset_res = client.post("/api/parser/config/reset")
    assert reset_res.status_code == 200
    reset_data = reset_res.json()
    assert reset_data["success"] is True
    assert reset_data["config"]["backend"] == "pipeline"
    assert reset_data["config"]["method"] == "auto"
    assert reset_data["config"]["strategy"] == "general"
    assert reset_data["config"]["all_pages"] is True

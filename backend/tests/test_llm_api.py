from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.llm_config_svc import get_llm_config, save_llm_config, LLMConfig

client = TestClient(app)


def test_api_get_llm_config():
    response = client.get("/api/llm/config")
    assert response.status_code == 200
    data = response.json()
    assert data["model_name"] == "gemma4:12b-mlx"
    assert data["temperature"] == 0.0
    assert "base_url" in data
    assert "system_prompt" in data


def test_api_save_llm_config():
    current = get_llm_config()
    test_cfg = {
        "base_url": "http://localhost:11434/v1",
        "model_name": "gemma4:12b-mlx",
        "temperature": 0.1,
        "api_key": "test-key",
        "max_tokens": 1024,
        "timeout": 45,
        "system_prompt": current.system_prompt,
    }
    response = client.post("/api/llm/config", json=test_cfg)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["success"] is True
    assert res_data["config"]["temperature"] == 0.1

    # Restore default temperature
    current.temperature = 0.0
    save_llm_config(current)


def test_api_default_prompt():
    response = client.get("/api/llm/config/default-prompt")
    assert response.status_code == 200
    data = response.json()
    assert "default_prompt" in data
    assert "교정 전문가" in data["default_prompt"]


def test_api_refine_chunk_empty():
    response = client.post("/api/llm/refine-chunk", json={"text": ""})
    assert response.status_code == 400


def test_api_refine_chunk_mocked():
    with patch(
        "backend.app.services.llm_refine_svc.llm_refine_svc.refine_chunk_text",
        new_callable=AsyncMock,
    ) as mock_refine:
        mock_refine.return_value = {
            "success": True,
            "original_text": "원문  띄어 쓰기",
            "refined_text": "원문 띄어쓰기",
            "elapsed_seconds": 0.45,
            "original_chars": 9,
            "refined_chars": 7,
        }
        response = client.post(
            "/api/llm/refine-chunk",
            json={"text": "원문  띄어 쓰기"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["refined_text"] == "원문 띄어쓰기"


def test_api_test_connection_mocked():
    with patch(
        "backend.app.services.llm_refine_svc.llm_refine_svc.test_connection",
        new_callable=AsyncMock,
    ) as mock_test:
        mock_test.return_value = {
            "success": True,
            "message": "'gemma4:12b-mlx' 모델과 성공적으로 연결되었습니다.",
            "model": "gemma4:12b-mlx",
            "latency_ms": 42.5,
        }
        response = client.post(
            "/api/llm/test",
            json={"model_name": "gemma4:12b-mlx"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["latency_ms"] == 42.5

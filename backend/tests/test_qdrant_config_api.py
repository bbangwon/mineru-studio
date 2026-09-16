import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.qdrant_config_svc import get_qdrant_config, save_qdrant_config

client = TestClient(app)


def test_api_get_qdrant_config_vector_names():
    response = client.get("/api/qdrant/config")
    assert response.status_code == 200
    data = response.json()
    assert "dense_vector_name" in data
    assert "sparse_vector_name" in data
    assert data["dense_vector_name"] == "dense"
    assert data["sparse_vector_name"] == "sparse"


def test_api_save_qdrant_config_custom_vector_names():
    orig_cfg = get_qdrant_config()
    try:
        update_data = orig_cfg.model_dump()
        update_data["dense_vector_name"] = "custom_dense_vec"
        update_data["sparse_vector_name"] = "custom_sparse_vec"

        res = client.post("/api/qdrant/config", json=update_data)
        assert res.status_code == 200
        res_data = res.json()
        assert res_data["success"] is True
        assert res_data["config"]["dense_vector_name"] == "custom_dense_vec"
        assert res_data["config"]["sparse_vector_name"] == "custom_sparse_vec"

        # Verify via GET
        get_res = client.get("/api/qdrant/config")
        assert get_res.status_code == 200
        assert get_res.json()["dense_vector_name"] == "custom_dense_vec"
        assert get_res.json()["sparse_vector_name"] == "custom_sparse_vec"
    finally:
        # Restore original config
        save_qdrant_config(orig_cfg)

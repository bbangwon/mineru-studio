import io
import json
import zipfile
from pathlib import Path
from fastapi.testclient import TestClient

from backend.app.main import app, BASE_DIR
from backend.app.services.backup_svc import backup_svc

client = TestClient(app)


def test_backup_create_and_list():
    # 1. Create a workspace backup
    create_payload = {
        "name": "테스트 자동화 백업",
        "description": "자동 테스트용 백업 생성",
        "backup_type": "workspace",
        "include_vector_db": False,
    }
    response = client.post("/api/backup/create", json=create_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    manifest = data["manifest"]
    backup_id = manifest["backup_id"]
    assert backup_id.startswith("workspace_")
    assert manifest["name"] == "테스트 자동화 백업"
    assert manifest["stats"]["pdf_count"] >= 0

    try:
        # 2. List backups
        list_res = client.get("/api/backup/list")
        assert list_res.status_code == 200
        list_data = list_res.json()
        assert list_data["success"] is True
        backups = list_data["backups"]
        found = any(b["backup_id"] == backup_id for b in backups)
        assert found is True

        # 3. Get backup details
        get_res = client.get(f"/api/backup/{backup_id}")
        assert get_res.status_code == 200
        get_data = get_res.json()
        assert get_data["manifest"]["backup_id"] == backup_id

        # 4. Download backup
        dl_res = client.get(f"/api/backup/{backup_id}/download")
        assert dl_res.status_code == 200
        assert dl_res.headers["content-type"] == "application/zip"
        assert dl_res.content.startswith(b"PK\x03\x04")

        # 5. Restore backup with safety backup enabled
        restore_res = client.post(f"/api/backup/{backup_id}/restore", json={"create_safety_backup": True})
        assert restore_res.status_code == 200
        restore_data = restore_res.json()
        assert restore_data["success"] is True
        assert restore_data["result"]["backup_id"] == backup_id
        safety_id = restore_data["result"]["safety_backup_id"]
        assert safety_id is not None
        assert safety_id.startswith("safety_")

        # Clean up safety backup
        client.delete(f"/api/backup/{safety_id}")

    finally:
        # Clean up main test backup
        del_res = client.delete(f"/api/backup/{backup_id}")
        assert del_res.status_code == 200


def test_backup_upload_and_import():
    # Create in-memory zip file
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps({
            "backup_id": "custom_mock_backup",
            "name": "외부 업로드 테스트",
            "backup_type": "workspace",
            "created_at": "2026-09-16T10:00:00",
            "timestamp": 1780000000.0,
            "stats": {"pdf_count": 1, "pdf_names": ["dummy.pdf"], "edited_docs_count": 0, "total_chunks": 0}
        }))
        zf.writestr("pdfs/dummy_test.txt", "dummy content")
    buf.seek(0)

    # Upload zip
    response = client.post(
        "/api/backup/upload",
        files={"file": ("mock_backup.zip", buf.getvalue(), "application/zip")},
        params={"restore_immediately": False},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    uploaded_id = data["backup_id"]

    try:
        # Verify it shows in list
        list_res = client.get("/api/backup/list")
        assert list_res.status_code == 200
        found = any(b["backup_id"] == uploaded_id for b in list_res.json()["backups"])
        assert found is True
    finally:
        # Clean up
        client.delete(f"/api/backup/{uploaded_id}")
        dummy_txt = BASE_DIR / "pdfs" / "dummy_test.txt"
        if dummy_txt.exists():
            dummy_txt.unlink()

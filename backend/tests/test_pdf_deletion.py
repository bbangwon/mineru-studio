import os
import shutil
from pathlib import Path
from fastapi.testclient import TestClient

from backend.app.main import app, DOCS_DIR, OUTPUT_DIR, jobs_db

client = TestClient(app)


def test_delete_pdf_document_success():
    # 1. Setup mock PDF and mock output directory
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "temp_test_to_delete.pdf"
    stem = "temp_test_to_delete"
    test_pdf_path = DOCS_DIR / test_filename
    test_pdf_path.write_bytes(b"%PDF-1.4 test dummy content")

    mock_output_dir = OUTPUT_DIR / "mineru_mock" / stem
    mock_output_dir.mkdir(parents=True, exist_ok=True)
    (mock_output_dir / "content_list.json").write_text("[]", encoding="utf-8")

    assert test_pdf_path.exists()
    assert mock_output_dir.exists()

    # 2. Call DELETE /api/pdf/{filename}
    response = client.delete(f"/api/pdf/{test_filename}?delete_vectors=false")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    # 3. Assert PDF and output directory are removed
    assert not test_pdf_path.exists()
    assert not mock_output_dir.exists()


def test_reset_etl_by_filename_success():
    # 1. Setup mock PDF and mock output directory
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "temp_test_to_reset.pdf"
    stem = "temp_test_to_reset"
    test_pdf_path = DOCS_DIR / test_filename
    test_pdf_path.write_bytes(b"%PDF-1.4 test dummy content for reset")

    mock_output_dir = OUTPUT_DIR / "mineru_mock" / stem
    mock_output_dir.mkdir(parents=True, exist_ok=True)
    (mock_output_dir / "content_list.json").write_text("[]", encoding="utf-8")

    assert test_pdf_path.exists()
    assert mock_output_dir.exists()

    # 2. Call DELETE /api/etl/{filename}
    response = client.delete(f"/api/etl/{test_filename}?delete_vectors=false")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    # 3. Assert PDF is PRESERVED, but output directory is removed
    assert test_pdf_path.exists()
    assert not mock_output_dir.exists()

    # Clean up test PDF
    test_pdf_path.unlink()


def test_delete_pdf_document_not_found():
    response = client.delete("/api/pdf/non_existent_file_xyz_123.pdf")
    assert response.status_code == 404


def test_delete_pdf_blocked_when_job_running():
    test_filename = "running_test_file.pdf"
    test_pdf_path = DOCS_DIR / test_filename
    test_pdf_path.write_bytes(b"%PDF-1.4 dummy")

    # Simulate active background job
    jobs_db["mock_running_job_1"] = {
        "task_id": "mock_running_job_1",
        "filename": test_filename,
        "status": "running",
    }

    try:
        response = client.delete(f"/api/pdf/{test_filename}")
        assert response.status_code == 400
        assert "진행 중인 문서는 삭제할 수 없습니다" in response.json()["detail"]
    finally:
        # Clean up
        jobs_db.pop("mock_running_job_1", None)
        if test_pdf_path.exists():
            test_pdf_path.unlink()


def test_korean_filename_nfd_nfc_reset_and_workspace_isolation():
    """한글 파일명 NFD/NFC 유니코드 정규화 및 산출물 초기화 시 타 문서와의 작업공간 격리 검증"""
    import unicodedata
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    
    # 1. 문서 A (한글 문서 - NFD 디렉토리 시뮬레이션)
    doc_a_name = "테스트문서_작업공간분리.pdf"
    doc_a_stem = Path(doc_a_name).stem
    doc_a_stem_nfd = unicodedata.normalize("NFD", doc_a_stem)
    doc_a_path = DOCS_DIR / doc_a_name
    doc_a_path.write_bytes(b"%PDF-1.4 mock pdf a")

    # NFD 디렉터리로 산출물 생성 (macOS APFS 실제 환경 재현)
    doc_a_output_dir = OUTPUT_DIR / "mineru_mock" / doc_a_stem_nfd
    doc_a_output_dir.mkdir(parents=True, exist_ok=True)
    (doc_a_output_dir / f"{doc_a_stem_nfd}_content_list_v2.json").write_text("[]", encoding="utf-8")

    # 2. 문서 B (다른 문서)
    doc_b_name = "다른문서_B.pdf"
    doc_b_stem = Path(doc_b_name).stem
    doc_b_path = DOCS_DIR / doc_b_name
    doc_b_path.write_bytes(b"%PDF-1.4 mock pdf b")
    doc_b_output_dir = OUTPUT_DIR / "mineru_mock" / doc_b_stem
    doc_b_output_dir.mkdir(parents=True, exist_ok=True)
    (doc_b_output_dir / f"{doc_b_stem}_content_list_v2.json").write_text("[]", encoding="utf-8")

    try:
        # 3. 문서 A의 산출물 초기화 실행 (NFC 문자열로 API 호출)
        reset_res = client.delete(f"/api/etl/{doc_a_name}?delete_vectors=false")
        assert reset_res.status_code == 200
        
        # 4. 문서 A의 산출물 폴더가 삭제되었는지 확인
        assert not doc_a_output_dir.exists()
        # 문서 B의 산출물 폴더는 온전히 보존되어야 함
        assert doc_b_output_dir.exists()

        # 5. /api/pdf/list 호출 시 문서 A의 상태가 'not_started'로 갱신되는지 확인
        list_res = client.get("/api/pdf/list")
        assert list_res.status_code == 200
        items = {it["filename"]: it for it in list_res.json().get("pdfs", [])}
        
        assert doc_a_name in items
        assert items[doc_a_name]["etl_status"] == "not_started"
        # 문서 B의 산출물이 문서 A로 잘못 매핑되지 않아야 함
        assert items[doc_a_name]["stats"] is None

        # 6. /api/etl/sample 호출 시 문서 A는 404를 반환하고, 문서 B의 산출물을 오염시켜 반환하지 않는지 검증
        sample_res = client.get(f"/api/etl/sample?filename={doc_a_name}")
        assert sample_res.status_code == 404
        assert "파싱 산출물이 없습니다" in sample_res.json()["detail"]

    finally:
        # 정리
        if doc_a_path.exists():
            doc_a_path.unlink()
        if doc_b_path.exists():
            doc_b_path.unlink()
        shutil.rmtree(doc_a_output_dir, ignore_errors=True)
        shutil.rmtree(doc_b_output_dir, ignore_errors=True)


import os
import shutil
from pathlib import Path
from fastapi.testclient import TestClient
import pytest

from backend.app.main import app
from backend.app.common import DOCS_DIR


@pytest.fixture
def client():
    return TestClient(app)


def test_nested_folders_lifecycle(client):
    """1차, 2차, 3차 폴더 생성, 트리 확인, 문서 이동, 삭제 검증"""
    # 임시 테스트 폴더 및 더미 PDF 생성
    test_pdf_name = "__test_folder_doc__.pdf"
    test_pdf_path = DOCS_DIR / test_pdf_name
    test_pdf_path.write_bytes(b"%PDF-1.4 test dummy content")

    try:
        # 1. 1차, 2차, 3차 중첩 폴더 생성
        res_create = client.post("/api/pdf/folders", json={"folder_path": "테스트분류/하위분류/3차깊이"})
        assert res_create.status_code == 200
        assert res_create.json()["success"] is True

        # 2. 폴더 트리 조회
        res_tree = client.get("/api/pdf/folders")
        assert res_tree.status_code == 200
        data = res_tree.json()
        assert data["root"]["name"] == "문서"
        assert data["root"]["path"] == ""

        # 3. 문서를 3차 깊이 폴더로 이동
        res_move = client.post("/api/pdf/folders/move", json={
            "filenames": [test_pdf_name],
            "target_folder": "테스트분류/하위분류/3차깊이"
        })
        assert res_move.status_code == 200
        assert res_move.json()["success"] is True
        assert res_move.json()["moved_count"] == 1

        # 이동된 실제 파일 확인
        moved_target = DOCS_DIR / "테스트분류" / "하위분류" / "3차깊이" / test_pdf_name
        assert moved_target.exists()

        # 4. list_pdfs에서 folder와 relative_path 확인
        res_list = client.get("/api/pdf/list")
        assert res_list.status_code == 200
        items = res_list.json()["pdfs"]
        matched = next((p for p in items if p["filename"] == test_pdf_name), None)
        assert matched is not None
        assert matched["folder"] == "테스트분류/하위분류/3차깊이"
        assert matched["relative_path"] == f"테스트분류/하위분류/3차깊이/{test_pdf_name}"

        # 5. JSONL 내보내기 검증: 서브폴더에 위치한 파일이라도 JSONL 스키마에 폴더 메타데이터가 침범하지 않음
        from backend.app.services.chunker.jsonl_exporter import export_to_jsonl
        dummy_etl = {
            "doc_id": "test_doc_001",
            "doc_title": "__test_folder_doc__",
            "child_chunks": [
                {
                    "chunk_id": "test_c01",
                    "text": "서브폴더 테스트 청크 내용",
                    "page_number": 1,
                    "metadata": {"custom_meta": "value"},
                }
            ],
            "parent_chunks": [],
            "sections": [],
        }
        jsonl_output = export_to_jsonl(dummy_etl)
        assert "서브폴더 테스트 청크 내용" in jsonl_output
        import json as pyjson
        parsed_record = pyjson.loads(jsonl_output.strip())
        # JSONL 레코드에 folder나 디렉터리 경로 필드가 들어가지 않음을 확인
        assert "folder" not in parsed_record
        assert "folder" not in parsed_record.get("metadata", {})
        assert parsed_record["doc_id"] == "test_doc_001"

        # 6. 폴더에서 빼기: 다시 루트('')로 이동
        res_move_root = client.post("/api/pdf/folders/move", json={
            "filenames": [test_pdf_name],
            "target_folder": ""
        })
        assert res_move_root.status_code == 200
        assert test_pdf_path.exists()
        assert not moved_target.exists()

        # 7. 폴더 삭제
        res_del = client.request("DELETE", "/api/pdf/folders", json={
            "folder_path": "테스트분류"
        })
        assert res_del.status_code == 200
        assert not (DOCS_DIR / "테스트분류").exists()

    finally:
        if test_pdf_path.exists():
            test_pdf_path.unlink()
        test_dir = DOCS_DIR / "테스트분류"
        if test_dir.exists():
            shutil.rmtree(test_dir, ignore_errors=True)

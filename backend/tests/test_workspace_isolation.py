import json
import shutil
from pathlib import Path
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from backend.app.main import (
    app,
    DOCS_DIR,
    OUTPUT_DIR,
    process_etl_job,
    jobs_db,
    mineru_svc,
)
import backend.app.main as main_mod

client = TestClient(app)


def test_workspace_isolation_save_and_reset():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    doc_a_name = "isolation_test_doc_a.pdf"
    doc_b_name = "isolation_test_doc_b.pdf"
    stem_a = "isolation_test_doc_a"
    stem_b = "isolation_test_doc_b"

    path_a = DOCS_DIR / doc_a_name
    path_b = DOCS_DIR / doc_b_name
    path_a.write_bytes(b"%PDF-1.4 Mock PDF A")
    path_b.write_bytes(b"%PDF-1.4 Mock PDF B")

    dir_a = OUTPUT_DIR / "mineru_mock" / stem_a
    dir_b = OUTPUT_DIR / "mineru_mock" / stem_b
    dir_a.mkdir(parents=True, exist_ok=True)
    dir_b.mkdir(parents=True, exist_ok=True)

    mock_content_list_a = [
        {"type": "text", "text": "Document A Section 1", "page_idx": 0}
    ]
    mock_content_list_b = [
        {"type": "text", "text": "Document B Section 1", "page_idx": 0}
    ]

    (dir_a / f"{stem_a}_content_list_v2.json").write_text(
        json.dumps(mock_content_list_a, ensure_ascii=False), encoding="utf-8"
    )
    (dir_b / f"{stem_b}_content_list_v2.json").write_text(
        json.dumps(mock_content_list_b, ensure_ascii=False), encoding="utf-8"
    )

    try:
        # 1. User selects Document B
        sel_res = client.post("/api/pdf/select", json={"filename": doc_b_name})
        assert sel_res.status_code == 200
        assert main_mod.current_selected_pdf_name == doc_b_name

        # 2. User edits Document B and saves it
        edited_data_b = {
            "doc_id": stem_b,
            "doc_title": stem_b,
            "active_pdf": doc_b_name,
            "child_chunks": [
                {
                    "chunk_id": f"{stem_b}_c001",
                    "text": "User edited Document B chunk",
                    "page_number": 0,
                    "parent_chunk_id": f"{stem_b}_p001",
                    "section_id": f"{stem_b}_s01",
                    "breadcrumbs": [stem_b],
                    "token_estimate": 10,
                }
            ],
            "parent_chunks": [],
            "sections": [],
        }

        save_res = client.post("/api/etl/save", json={"etl_result": edited_data_b})
        assert save_res.status_code == 200

        # Assert Document B has rag_chunks_edited.json and Document A DOES NOT
        assert (dir_b / "rag_chunks_edited.json").exists()
        assert not (dir_a / "rag_chunks_edited.json").exists()
        b_content = json.loads((dir_b / "rag_chunks_edited.json").read_text(encoding="utf-8"))
        assert b_content["child_chunks"][0]["text"] == "User edited Document B chunk"

        # 3. Meanwhile, Doc A finishes parsing in background!
        task_id = "test_task_doc_a"
        jobs_db[task_id] = {
            "task_id": task_id,
            "status": "running",
            "filename": doc_a_name,
        }

        with patch.object(mineru_svc, "parse_pdf") as mock_parse:
            mock_parse.return_value = {
                "success": True,
                "content_list": mock_content_list_a,
                "content_list_path": str(dir_a / f"{stem_a}_content_list_v2.json"),
                "elapsed_time": 1.2,
            }
            process_etl_job(task_id, {"strategy": "general"}, str(path_a))

        # Doc A finished: verify its own rag_chunks_edited.json is created
        assert (dir_a / "rag_chunks_edited.json").exists()

        # CRUCIAL ISOLATION CHECK:
        # main_mod.current_selected_pdf_name must STILL be doc_b_name! (Not hijacked by Doc A)
        assert main_mod.current_selected_pdf_name == doc_b_name

        # 4. User saves Doc B again with further edits
        edited_data_b["child_chunks"][0]["text"] = "Second edit for Document B"
        save_res2 = client.post("/api/etl/save", json={"etl_result": edited_data_b})
        assert save_res2.status_code == 200

        # Verify Doc B was updated and Doc A was NOT overwritten by Doc B
        b_content_updated = json.loads((dir_b / "rag_chunks_edited.json").read_text(encoding="utf-8"))
        assert b_content_updated["child_chunks"][0]["text"] == "Second edit for Document B"
        a_content = json.loads((dir_a / "rag_chunks_edited.json").read_text(encoding="utf-8"))
        assert a_content["doc_title"] == stem_a

        # 5. User resets Document B specifically
        reset_res = client.post("/api/etl/reset", json={"strategy": "general", "filename": doc_b_name})
        assert reset_res.status_code == 200
        # Doc B rag_chunks_edited.json should be removed
        assert not (dir_b / "rag_chunks_edited.json").exists()
        # Doc A rag_chunks_edited.json MUST still be preserved!
        assert (dir_a / "rag_chunks_edited.json").exists()

    finally:
        # Cleanup
        if path_a.exists():
            path_a.unlink()
        if path_b.exists():
            path_b.unlink()
        if dir_a.exists():
            shutil.rmtree(dir_a)
        if dir_b.exists():
            shutil.rmtree(dir_b)

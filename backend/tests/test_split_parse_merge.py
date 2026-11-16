import json
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.common import find_latest_content_list
from backend.app.main import app
from backend.app.services.hierarchical_chunker import HierarchicalChunker
from backend.app.services.mineru_svc import MineruService, find_all_parts_statuses, format_page_ranges


def _make_sample_middle_zip(zip_path: Path, page_indices: list[int], total_pages: int = 5) -> None:
    pages = []
    for idx in page_indices:
        pages.append({
            "page_idx": idx,
            "blocks": [
                {
                    "type": "text",
                    "index": 0,
                    "bbox": [0.1, 0.1, 0.5, 0.2],
                    "content": [{"type": "text", "content": f"Sample content on page {idx + 1}"}],
                }
            ],
        })
    middle_data = {
        "schema": "docvortex.middle",
        "schema_version": "2.0",
        "is_full_document": False,
        "metadata": {
            "file_suffix": "pdf",
            "producer": {"name": "mineru", "version": "4.2.2"},
            "document": {"producer_application": "pypdf", "page_count": total_pages, "page_count_kind": "physical"},
        },
        "extensions": {},
        "pages": pages,
    }
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("middle_json.json", json.dumps(middle_data, ensure_ascii=False))
        for idx in page_indices:
            zf.writestr(f"images/page_{idx}_image_0.jpg", b"fake-jpeg-bytes")


def test_format_page_ranges():
    assert format_page_ranges([]) == []
    assert format_page_ranges([0, 1, 2, 5, 6, 9]) == [[0, 2], [5, 6], [9, 9]]


def test_split_parse_and_merge_preserves_page_numbers(tmp_path: Path):
    svc = MineruService()
    pdf_path = tmp_path / "sample_doc.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n%fake\n")
    out_base = tmp_path / "output"
    out_dir = out_base / "mineru_standard_ocr_korean"

    zip1 = tmp_path / "batch1.zip"
    zip2 = tmp_path / "batch2.zip"
    _make_sample_middle_zip(zip1, [0, 1], total_pages=5)
    _make_sample_middle_zip(zip2, [3, 4], total_pages=5)

    with patch.object(svc, "_run_mineru_cli", side_effect=[(zip1, 1.2, None), (zip2, 1.5, None)]):
        res1 = svc.parse_pdf_part(
            pdf_path=pdf_path,
            output_dir=out_dir,
            start_page=0,
            end_page=1,
            backend="standard",
            method="ocr",
            total_pages=5,
        )
        assert res1["success"] is True
        assert res1["parts_status"]["parsed_pages"] == [0, 1]

        res2 = svc.parse_pdf_part(
            pdf_path=pdf_path,
            output_dir=out_dir,
            start_page=3,
            end_page=4,
            backend="standard",
            method="ocr",
            total_pages=5,
        )
        assert res2["success"] is True
        assert res2["parts_status"]["parsed_pages"] == [0, 1, 3, 4]
        assert res2["parts_status"]["parsed_ranges"] == [[0, 1], [3, 4]]

    statuses = find_all_parts_statuses(out_base, "sample_doc")
    assert len(statuses) == 1
    assert statuses[0]["parsed_count"] == 4
    assert statuses[0]["remaining_count"] == 1

    merge_res = svc.merge_pdf_parts(out_dir, "sample_doc", ocr_mode="ocr", total_pages=5)
    assert merge_res["success"] is True
    assert merge_res["merged_pages"] == 4
    assert len(merge_res["content_list"]) == 5
    # Gap page (index 2) is padded as empty list so page 4 (index 3) keeps page_number=4
    assert merge_res["content_list"][2] == []
    assert Path(merge_res["content_list_path"]).exists()
    assert Path(merge_res["markdown_path"]).exists()
    assert (out_dir / "sample_doc" / "ocr" / "images" / "page_0_image_0.jpg").exists()
    assert (out_dir / "sample_doc" / "ocr" / "images" / "page_4_image_0.jpg").exists()

    chunker = HierarchicalChunker(doc_id="sample_doc")
    etl_res = chunker.chunk_content_list(merge_res["content_list"], doc_title="sample_doc")
    assert len(etl_res["child_chunks"]) >= 1
    first_chunk = etl_res["child_chunks"][0]
    assert first_chunk["page_number"] == 1
    assert first_chunk["page_end"] == 5


def test_split_parse_api_endpoints(tmp_path: Path, monkeypatch):
    import backend.app.common as common_mod
    import backend.app.routers.etl as etl_mod
    import backend.app.services.job_manager as jm_mod

    docs_dir = tmp_path / "pdfs"
    out_dir = tmp_path / "output"
    docs_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)

    pdf_file = docs_dir / "api_split_test.pdf"
    pdf_file.write_bytes(b"%PDF-1.4\n%fake\n")

    monkeypatch.setattr(common_mod, "DOCS_DIR", docs_dir)
    monkeypatch.setattr(common_mod, "OUTPUT_DIR", out_dir)
    monkeypatch.setattr(etl_mod, "DOCS_DIR", docs_dir)
    monkeypatch.setattr(etl_mod, "OUTPUT_DIR", out_dir)
    monkeypatch.setattr(etl_mod, "BASE_DIR", tmp_path)
    monkeypatch.setattr(jm_mod, "DOCS_DIR", docs_dir)
    monkeypatch.setattr(jm_mod, "BASE_DIR", tmp_path)
    monkeypatch.setattr(common_mod, "get_pdf_page_count", lambda p: 4)
    monkeypatch.setattr(etl_mod, "get_pdf_page_count", lambda p: 4)
    monkeypatch.setattr(jm_mod, "get_pdf_page_count", lambda p: 4)

    svc = etl_mod.mineru_svc
    zip_path = tmp_path / "api_batch.zip"
    _make_sample_middle_zip(zip_path, [0, 1, 2, 3], total_pages=4)

    with patch.object(svc, "_run_mineru_cli", return_value=(zip_path, 0.5, None)):
        part_res = svc.parse_pdf_part(
            pdf_path=pdf_file,
            output_dir=out_dir / "mineru_standard_ocr_korean",
            start_page=0,
            end_page=3,
            backend="standard",
            method="ocr",
            total_pages=4,
        )
        assert part_res["success"] is True

    client = TestClient(app)

    status_resp = client.get("/api/etl/parts/status", params={"filename": "api_split_test.pdf", "backend": "standard", "method": "ocr"})
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    assert status_data["parts_status"]["parsed_count"] == 4

    merge_resp = client.post("/api/etl/parts/merge", json={
        "filename": "api_split_test.pdf",
        "backend": "standard",
        "method": "ocr",
        "strategy": "general",
    })
    assert merge_resp.status_code == 200
    merged_data = merge_resp.json()
    assert merged_data["stats"]["total_child_chunks"] >= 1

    rechunk_resp = client.post("/api/etl/rechunk", json={
        "filename": "api_split_test.pdf",
        "strategy": "legal",
    })
    assert rechunk_resp.status_code == 200
    assert rechunk_resp.json()["strategy"] == "legal"

    del_resp = client.delete("/api/etl/parts", params={"filename": "api_split_test.pdf", "backend": "standard", "method": "ocr"})
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted"] is True

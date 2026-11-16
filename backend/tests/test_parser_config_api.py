import json
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.mineru_svc import MineruService, _format_pages_arg, normalize_mineru_tier
from backend.app.services.parser_config_svc import (
    CONFIG_FILE_PATH,
    ParserConfig,
    get_parser_config,
    reset_parser_config,
    save_parser_config,
)

client = TestClient(app)


def test_normalize_mineru_tier_and_pages():
    assert normalize_mineru_tier("pipeline") == "basic"
    assert normalize_mineru_tier("hybrid-engine") == "standard"
    assert normalize_mineru_tier("vlm") == "standard"
    assert normalize_mineru_tier("flash") == "flash"
    assert normalize_mineru_tier("basic") == "basic"
    assert normalize_mineru_tier("standard") == "standard"
    assert normalize_mineru_tier("advanced") == "advanced"
    assert normalize_mineru_tier(None) == "basic"
    assert normalize_mineru_tier("unknown-tier") == "basic"

    assert _format_pages_arg(None, None) == "all"
    assert _format_pages_arg(0, 0) == "1"
    assert _format_pages_arg(0, 2) == "1-3"
    assert _format_pages_arg(2, 5) == "3-6"
    assert _format_pages_arg(1, None) == "2-r1"
    assert _format_pages_arg(None, 3) == "1-4"


def test_api_get_parser_config():
    response = client.get("/api/parser/config")
    assert response.status_code == 200
    data = response.json()
    assert "backend" in data
    assert data["backend"] in ("flash", "basic", "standard", "advanced")
    assert "method" in data
    assert "strategy" in data
    assert "formula" in data
    assert "all_pages" in data


def test_api_save_and_reset_parser_config():
    for tier in ("standard", "advanced", "flash"):
        new_cfg = {
            "backend": tier,
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
        assert data["config"]["backend"] == tier
        assert data["config"]["method"] == "ocr"
        assert data["config"]["strategy"] == "legal"
        assert data["config"]["formula"] is False
        assert data["config"]["all_pages"] is False
        assert data["config"]["start_page"] == 1
        assert data["config"]["end_page"] == 5

        get_res = client.get("/api/parser/config")
        assert get_res.status_code == 200
        get_data = get_res.json()
        assert get_data["backend"] == tier
        assert get_data["method"] == "ocr"

    # Legacy backend values are normalized automatically
    legacy_hybrid_res = client.post("/api/parser/config", json={"backend": "hybrid-engine", "method": "auto"})
    assert legacy_hybrid_res.status_code == 200
    assert legacy_hybrid_res.json()["config"]["backend"] == "standard"

    legacy_pipeline_res = client.post("/api/parser/config", json={"backend": "pipeline", "method": "auto"})
    assert legacy_pipeline_res.status_code == 200
    assert legacy_pipeline_res.json()["config"]["backend"] == "basic"

    # Loading legacy parser_config.json on disk migrates automatically
    CONFIG_FILE_PATH.write_text(json.dumps({"backend": "hybrid-engine", "method": "auto"}), encoding="utf-8")
    loaded = get_parser_config()
    assert loaded.backend == "standard"

    # Reset to default
    reset_res = client.post("/api/parser/config/reset")
    assert reset_res.status_code == 200
    reset_data = reset_res.json()
    assert reset_data["success"] is True
    assert reset_data["config"]["backend"] == "basic"
    assert reset_data["config"]["method"] == "auto"
    assert reset_data["config"]["strategy"] == "general"
    assert reset_data["config"]["all_pages"] is True


def test_mineru_service_v4_cli_and_render(tmp_path: Path):
    pdf_path = tmp_path / "샘플문서.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 mock")
    out_dir = tmp_path / "mineru_standard_ocr_korean"

    sample_middle_json = {
        "schema": "docvortex.middle",
        "schema_version": "2.0",
        "is_full_document": True,
        "metadata": {
            "file_suffix": "pdf",
            "producer": {"name": "mineru", "version": "4.2.2"},
        },
        "extensions": {},
        "pages": [
            {
                "page_idx": 0,
                "blocks": [
                    {
                        "type": "doc_title",
                        "index": 0,
                        "level": 1,
                        "bbox": [0.1, 0.1, 0.5, 0.15],
                        "content": [{"type": "text", "content": "제1장 총칙"}],
                    },
                    {
                        "type": "text",
                        "index": 1,
                        "bbox": [0.1, 0.2, 0.8, 0.3],
                        "content": [{"type": "text", "content": "본문 테스트입니다."}],
                    },
                ],
            }
        ],
    }

    captured_cmds = []

    def fake_run(cmd, **kwargs):
        captured_cmds.append(cmd)
        zip_out = Path(cmd[cmd.index("-o") + 1])
        zip_out.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_out, "w") as zf:
            zf.writestr("markdown.md", "# 제1장 총칙\n\n본문 테스트입니다.\n")
            zf.writestr("middle_json.json", json.dumps(sample_middle_json, ensure_ascii=False))
            zf.writestr("images/sample.png", b"\x89PNG\r\n\x1a\n")

        class _Proc:
            returncode = 0
            stdout = "Parsed 1 input(s)."

        return _Proc()

    svc = MineruService()
    with patch("backend.app.services.mineru_svc.subprocess.run", side_effect=fake_run):
        res = svc.parse_pdf(
            pdf_path=pdf_path,
            output_dir=out_dir,
            start_page=0,
            end_page=1,
            backend="hybrid-engine",
            method="ocr",
        )

    assert res["success"] is True
    assert len(captured_cmds) == 1
    cmd = captured_cmds[0]
    assert "parse" in cmd
    assert cmd[cmd.index("--tier") + 1] == "standard"
    assert cmd[cmd.index("--ocr-mode") + 1] == "ocr"
    assert cmd[cmd.index("--pages") + 1] == "1-2"
    assert res["markdown"] == "# 제1장 총칙\n\n본문 테스트입니다.\n"
    assert res["images"] == ["sample.png"]
    assert res["content_list_path"] is not None
    cl_path = Path(res["content_list_path"])
    assert cl_path.exists()
    assert cl_path.name == "샘플문서_content_list_v2.json"
    assert cl_path.parent.name == "ocr"
    assert cl_path.parent.parent.name == "샘플문서"
    assert isinstance(res["content_list"], list)
    assert len(res["content_list"]) == 1
    assert res["content_list"][0][0]["type"] == "title"
    assert res["content_list"][0][1]["type"] == "paragraph"

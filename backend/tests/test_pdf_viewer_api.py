import io
import os
import shutil
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.common import DOCS_DIR
from backend.app.main import app
from backend.app.services.job_manager import job_manager
from backend.app.services.pdf_render_svc import clear_pdf_render_cache

client = TestClient(app)


def _create_sample_pdf(path: Path, num_pages: int = 3) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    colors = [(220, 60, 60), (60, 180, 75), (60, 100, 220), (200, 160, 40)]
    pages = [
        Image.new("RGB", (400, 560), color=colors[i % len(colors)])
        for i in range(num_pages)
    ]
    pages[0].save(str(path), "PDF", save_all=True, append_images=pages[1:])


def test_render_pdf_page_webp_and_png():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "temp_viewer_test_render.pdf"
    test_pdf = DOCS_DIR / test_filename
    clear_pdf_render_cache()
    _create_sample_pdf(test_pdf, num_pages=3)

    try:
        res_webp = client.get(
            "/api/pdf/page-image",
            params={"filename": test_filename, "page": 1, "dpi": 150, "fmt": "webp"},
        )
        assert res_webp.status_code == 200
        assert res_webp.headers["content-type"].startswith("image/webp")
        assert res_webp.headers["x-pdf-total-pages"] == "3"
        assert res_webp.headers["x-pdf-page"] == "1"
        assert res_webp.headers["cache-control"] == "private, max-age=3600"

        with Image.open(io.BytesIO(res_webp.content)) as img_150:
            assert img_150.format == "WEBP"
            size_150 = img_150.size

        res_png = client.get(
            "/api/pdf/page-image",
            params={"filename": test_filename, "page": 2, "dpi": 220, "fmt": "png"},
        )
        assert res_png.status_code == 200
        assert res_png.headers["content-type"].startswith("image/png")
        assert res_png.headers["x-pdf-total-pages"] == "3"
        assert res_png.headers["x-pdf-page"] == "2"

        with Image.open(io.BytesIO(res_png.content)) as img_220:
            assert img_220.format == "PNG"
            assert img_220.size[0] > size_150[0]
            assert img_220.size[1] > size_150[1]
    finally:
        clear_pdf_render_cache()
        if test_pdf.exists():
            test_pdf.unlink()


def test_render_pdf_page_errors():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "temp_viewer_test_errors.pdf"
    test_pdf = DOCS_DIR / test_filename
    clear_pdf_render_cache()
    _create_sample_pdf(test_pdf, num_pages=2)

    try:
        # 페이지 범위 초과 -> 400
        res_oob = client.get(
            "/api/pdf/page-image",
            params={"filename": test_filename, "page": 4},
        )
        assert res_oob.status_code == 400

        # 미존재 파일 -> 404
        res_missing = client.get(
            "/api/pdf/page-image",
            params={"filename": "not_exist_xyz.pdf", "page": 1},
        )
        assert res_missing.status_code == 404

        # 경로 탈출 시도 -> 404
        res_traversal = client.get(
            "/api/pdf/page-image",
            params={"filename": "../../etc/passwd", "page": 1},
        )
        assert res_traversal.status_code == 404

        # 잘못된 쿼리 파라미터 -> 422
        assert client.get("/api/pdf/page-image", params={"filename": test_filename, "page": 0}).status_code == 422
        assert client.get("/api/pdf/page-image", params={"filename": test_filename, "page": 1, "dpi": 50}).status_code == 422
        assert client.get("/api/pdf/page-image", params={"filename": test_filename, "page": 1, "dpi": 400}).status_code == 422
        assert client.get("/api/pdf/page-image", params={"filename": test_filename, "page": 1, "fmt": "jpeg"}).status_code == 422
    finally:
        clear_pdf_render_cache()
        if test_pdf.exists():
            test_pdf.unlink()


def test_render_pdf_korean_nfd_nfc_and_subfolder():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    sub_dir = DOCS_DIR / "viewer_test_sub"
    nfd_name = unicodedata.normalize("NFD", "한글뷰어테스트.pdf")
    nfc_name = unicodedata.normalize("NFC", "한글뷰어테스트.pdf")
    test_pdf = sub_dir / nfd_name
    clear_pdf_render_cache()
    _create_sample_pdf(test_pdf, num_pages=2)

    try:
        res_nfc = client.get(
            "/api/pdf/page-image",
            params={"filename": nfc_name, "page": 1, "fmt": "webp"},
        )
        assert res_nfc.status_code == 200
        assert res_nfc.headers["x-pdf-total-pages"] == "2"

        res_rel = client.get(
            "/api/pdf/page-image",
            params={"filename": f"viewer_test_sub/{nfc_name}", "page": 2, "fmt": "webp"},
        )
        assert res_rel.status_code == 200
        assert res_rel.headers["x-pdf-page"] == "2"
        with Image.open(io.BytesIO(res_rel.content)) as img:
            assert img.format == "WEBP"
    finally:
        clear_pdf_render_cache()
        shutil.rmtree(sub_dir, ignore_errors=True)


def test_render_pdf_concurrent_thread_safety():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "temp_viewer_test_concurrent.pdf"
    test_pdf = DOCS_DIR / test_filename
    clear_pdf_render_cache()
    _create_sample_pdf(test_pdf, num_pages=3)

    def _fetch(idx: int):
        page = (idx % 3) + 1
        dpi = 150 if idx % 2 == 0 else 220
        return client.get(
            "/api/pdf/page-image",
            params={"filename": test_filename, "page": page, "dpi": dpi, "fmt": "webp"},
        )

    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(_fetch, range(16)))

        assert len(responses) == 16
        for res in responses:
            assert res.status_code == 200
            with Image.open(io.BytesIO(res.content)) as img:
                assert img.format == "WEBP"
    finally:
        clear_pdf_render_cache()
        if test_pdf.exists():
            test_pdf.unlink()


def test_get_original_pdf_with_filename_and_fallback():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "temp_viewer_test_original.pdf"
    test_pdf = DOCS_DIR / test_filename
    _create_sample_pdf(test_pdf, num_pages=1)
    prev_selected = job_manager.current_selected_pdf_name

    try:
        res_explicit = client.get("/api/pdf", params={"filename": test_filename})
        assert res_explicit.status_code == 200
        assert res_explicit.headers["content-type"].startswith("application/pdf")
        assert res_explicit.content.startswith(b"%PDF")

        res_missing = client.get("/api/pdf", params={"filename": "missing_999.pdf"})
        assert res_missing.status_code == 404

        job_manager.current_selected_pdf_name = test_filename
        res_fallback = client.get("/api/pdf")
        assert res_fallback.status_code == 200
        assert res_fallback.headers["content-type"].startswith("application/pdf")
        assert res_fallback.content.startswith(b"%PDF")
    finally:
        job_manager.current_selected_pdf_name = prev_selected
        if test_pdf.exists():
            test_pdf.unlink()


def test_cache_invalidation_on_mtime_change():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    test_filename = "temp_viewer_test_cache_mtime.pdf"
    test_pdf = DOCS_DIR / test_filename
    clear_pdf_render_cache()
    _create_sample_pdf(test_pdf, num_pages=2)

    try:
        res1 = client.get(
            "/api/pdf/page-image",
            params={"filename": test_filename, "page": 1, "dpi": 150, "fmt": "webp"},
        )
        assert res1.status_code == 200
        assert res1.headers["x-pdf-total-pages"] == "2"

        prev_mtime_ns = test_pdf.stat().st_mtime_ns
        _create_sample_pdf(test_pdf, num_pages=4)
        new_mtime_ns = prev_mtime_ns + 2_000_000_000
        os.utime(test_pdf, ns=(new_mtime_ns, new_mtime_ns))

        res2 = client.get(
            "/api/pdf/page-image",
            params={"filename": test_filename, "page": 1, "dpi": 150, "fmt": "webp"},
        )
        assert res2.status_code == 200
        assert res2.headers["x-pdf-total-pages"] == "4"
    finally:
        clear_pdf_render_cache()
        if test_pdf.exists():
            test_pdf.unlink()

import logging
import sys
from pathlib import Path

# pypdf 내부의 비정상 xref/포인터 경고 로그 억제
logging.getLogger("pypdf").setLevel(logging.ERROR)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.app.common import (
    BASE_DIR,
    DOCS_DIR,
    FRONTEND_DIST_DIR,
    OUTPUT_DIR,
    TEMPLATES_DIR,
    normalize_text,
    get_pdf_page_count,
    find_latest_content_list,
)
from backend.app.services.job_manager import job_manager
from backend.app.routers.pdf import router as pdf_router, clean_document_artifacts
from backend.app.routers.etl import router as etl_router
from backend.app.routers.qdrant import router as qdrant_router
from backend.app.routers.llm import router as llm_router
from backend.app.routers.parser import router as parser_router
from backend.app.routers.backup import router as backup_router

# 하위 호환성을 위한 심볼 재내보내기 (기존 테스트 및 외부 참조용)
mineru_svc = job_manager.mineru_svc
jobs_db = job_manager.jobs_db
process_etl_job = job_manager.process_etl_job


class _MainModule(sys.modules[__name__].__class__):
    @property
    def current_selected_pdf_name(self):
        return job_manager.current_selected_pdf_name

    @current_selected_pdf_name.setter
    def current_selected_pdf_name(self, value):
        job_manager.current_selected_pdf_name = value

    @property
    def latest_etl_result(self):
        return job_manager.latest_etl_result

    @latest_etl_result.setter
    def latest_etl_result(self, value):
        job_manager.latest_etl_result = value

    @property
    def latest_content_list_path(self):
        return job_manager.latest_content_list_path

    @latest_content_list_path.setter
    def latest_content_list_path(self, value):
        job_manager.latest_content_list_path = value


sys.modules[__name__].__class__ = _MainModule

app = FastAPI(title="MinerU RAG ETL Studio")


# CORS setup for frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static mount for images in output directory
if OUTPUT_DIR.exists():
    app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")

# Static mount for built frontend assets if dist exists
if (FRONTEND_DIST_DIR / "assets").exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST_DIR / "assets")),
        name="assets",
    )

# 라우터 등록
app.include_router(pdf_router)
app.include_router(etl_router)
app.include_router(qdrant_router)
app.include_router(llm_router)
app.include_router(parser_router)
app.include_router(backup_router)


@app.get("/", response_class=HTMLResponse)
async def get_index():
    react_index = FRONTEND_DIST_DIR / "index.html"
    if react_index.exists():
        with open(react_index, "r", encoding="utf-8") as f:
            return f.read()
    index_path = TEMPLATES_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Template not found")
    with open(index_path, "r", encoding="utf-8") as f:
        return f.read()


@app.get("/favicon.svg")
async def get_favicon():
    fav = FRONTEND_DIST_DIR / "favicon.svg"
    if fav.exists():
        return FileResponse(fav, media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="Favicon not found")

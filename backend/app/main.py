import json
import os
import re
import shutil
import sys
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

BASE_DIR = Path(__file__).resolve().parent.parent.parent
_PKG_ROOT = BASE_DIR / "packages" / "rag_embed_core"
if _PKG_ROOT.exists() and str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

import logging
import pypdf

# pypdf 내부의 비정상 xref/포인터 경고 로그(Ignoring wrong pointing object 등) 억제
logging.getLogger("pypdf").setLevel(logging.ERROR)

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.app.services.hierarchical_chunker import HierarchicalChunker
from backend.app.services.mineru_svc import MineruService
from backend.app.services.embedding_svc import embedding_svc, load_indexed_docs_manifest
from backend.app.services.qdrant_config_svc import get_qdrant_config, save_qdrant_config
from backend.app.services.llm_config_svc import (
    LLMConfig,
    get_llm_config,
    save_llm_config,
    get_default_system_prompt,
)
from backend.app.services.parser_config_svc import (
    ParserConfig,
    get_parser_config,
    save_parser_config,
    reset_parser_config,
)
from backend.app.services.llm_refine_svc import llm_refine_svc
from backend.app.services.backup_svc import backup_svc
from rag_embed_core.config import QdrantConfig

BASE_DIR = Path(__file__).resolve().parent.parent.parent
TEMPLATES_DIR = BASE_DIR / "backend" / "app" / "templates"
FRONTEND_DIST_DIR = BASE_DIR / "frontend" / "dist"
DOCS_DIR = BASE_DIR / "pdfs"
OUTPUT_DIR = BASE_DIR / "output"

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


mineru_svc = MineruService()

# Cache latest ETL result & current active PDF in memory
latest_etl_result: Optional[dict] = None
latest_content_list_path: Optional[Path] = None
current_selected_pdf_name: Optional[str] = None

# In-memory background jobs registry
jobs_db: Dict[str, Dict[str, Any]] = {}


class ParseRequest(BaseModel):
    filename: Optional[str] = None
    all_pages: Optional[bool] = False
    start_page: Optional[int] = 0
    end_page: Optional[int] = 2
    lang: Optional[str] = "korean"
    backend: Optional[str] = "pipeline"
    method: Optional[str] = "auto"
    formula: Optional[bool] = True
    strategy: Optional[str] = "general"


def process_etl_job(task_id: str, req_data: dict, pdf_path_str: str):
    """백그라운드에서 실행되는 MinerU 파싱 및 계층 청킹 워커"""
    global latest_etl_result, latest_content_list_path, current_selected_pdf_name
    pdf_path = Path(pdf_path_str)
    job = jobs_db.get(task_id)
    if not job:
        return

    job["status"] = "running"
    job["progress_msg"] = "MinerU 파이프라인 엔진으로 PDF 파싱 중..."
    start_time = time.time()

    all_pages = req_data.get("all_pages", False)
    start_p = None if all_pages else req_data.get("start_page", 0)
    end_p = None if all_pages else req_data.get("end_page", 2)
    method = req_data.get("method") or "auto"
    formula = True if req_data.get("formula") is None else req_data.get("formula")
    backend = req_data.get("backend") or "pipeline"
    lang = req_data.get("lang") or "korean"
    strategy = req_data.get("strategy") or "general"

    output_dir = BASE_DIR / "output" / f"mineru_{backend}_{method}_{lang}"

    try:
        parse_res = mineru_svc.parse_pdf(
            pdf_path=pdf_path,
            output_dir=output_dir,
            start_page=start_p,
            end_page=end_p,
            lang=lang,
            backend=backend,
            method=method,
            formula=formula,
        )

        if not parse_res.get("success"):
            job["status"] = "failed"
            job["error"] = parse_res.get("error", "MinerU parse failed")
            job["elapsed_time"] = round(time.time() - start_time, 1)
            return

        job["progress_msg"] = "문서 위계 구조 및 법률 조문 계층 청킹 중..."

        content_list = parse_res.get("content_list", [])
        if parse_res.get("content_list_path"):
            latest_content_list_path = Path(parse_res["content_list_path"])
        elif not content_list:
            found = find_latest_content_list(pdf_path.stem)
            if found:
                latest_content_list_path = found[0]
                content_list = found[1]

        stem_nfc = unicodedata.normalize("NFC", pdf_path.stem)
        pdf_name_nfc = unicodedata.normalize("NFC", pdf_path.name)
        chunker = HierarchicalChunker(doc_id=stem_nfc)
        etl_res = chunker.chunk_content_list(content_list, doc_title=stem_nfc, strategy=strategy)
        etl_res["elapsed_time"] = parse_res.get("elapsed_time", round(time.time() - start_time, 1))
        etl_res["active_pdf"] = pdf_name_nfc
        etl_res["total_pages"] = get_pdf_page_count(pdf_path)

        etl_res["backend"] = backend
        etl_res["method"] = method
        etl_res["strategy"] = strategy

        latest_etl_result = etl_res
        current_selected_pdf_name = pdf_name_nfc

        # 새로 파싱/청킹된 최신 산출물을 rag_chunks_edited.json에 즉시 영속화하여 이전 수정본 캐시 덮어쓰기
        if latest_content_list_path and latest_content_list_path.exists():
            edited_save_path = latest_content_list_path.parent / "rag_chunks_edited.json"
            try:
                with open(edited_save_path, "w", encoding="utf-8") as f:
                    json.dump(etl_res, f, ensure_ascii=False, indent=2)
                _doc_stats_cache.pop(str(edited_save_path), None)
            except Exception as e:
                print(f"Failed to auto-save rag_chunks_edited.json: {e}")

        job["status"] = "completed"
        job["progress_msg"] = "파싱 및 청킹 완료"
        job["backend"] = backend
        job["method"] = method
        job["strategy"] = strategy
        job["result"] = etl_res
        job["elapsed_time"] = round(time.time() - start_time, 1)

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        job["elapsed_time"] = round(time.time() - start_time, 1)


class SelectPdfRequest(BaseModel):
    filename: str


def get_pdf_page_count(path: Path) -> int:
    try:
        reader = pypdf.PdfReader(str(path))
        return len(reader.pages)
    except Exception:
        return 1


def get_active_pdf_path() -> Optional[Path]:
    global current_selected_pdf_name
    if current_selected_pdf_name:
        p1 = DOCS_DIR / current_selected_pdf_name
        if p1.exists():
            return p1
    pdf_files = list(DOCS_DIR.glob("*.pdf"))
    if pdf_files:
        current_selected_pdf_name = pdf_files[0].name
        return pdf_files[0]
    return None


def normalize_text(text: Optional[str]) -> str:
    """macOS APFS(NFD)와 일반 유니코드(NFC) 간 한글 자모 분리 불일치 해결"""
    return unicodedata.normalize("NFC", text) if text else ""


def find_latest_content_list(preferred_doc_name: Optional[str] = None) -> Optional[tuple[Path, list]]:
    """가장 최근에 생성된 MinerU content_list_v2.json 탐색 (preferred_doc_name 지정 시 해당 문서의 산출물만 엄격히 검색)"""
    v2_candidates = []
    v1_candidates = []
    if OUTPUT_DIR.exists():
        for root, _, files in os.walk(OUTPUT_DIR):
            for f in files:
                p = Path(root) / f
                if f.endswith("_content_list_v2.json"):
                    v2_candidates.append((p.stat().st_mtime, p))
                elif f.endswith("_content_list.json"):
                    v1_candidates.append((p.stat().st_mtime, p))

    candidates = v2_candidates if v2_candidates else v1_candidates
    if not candidates:
        return None

    # preferred_doc_name이 주어지면 해당 문서의 산출물만 검색 (다른 문서로의 폴백 금지)
    if preferred_doc_name:
        target_stem = normalize_text(Path(preferred_doc_name).stem)
        matched = []
        for mtime, p in candidates:
            norm_parts = [normalize_text(part) for part in p.parts]
            norm_filename = normalize_text(p.name)
            # 1) 완전 일치 검사 (폴더명 일치 또는 파일명 접두사 일치)
            is_matched = (
                target_stem in norm_parts
                or norm_filename.startswith(f"{target_stem}_content_list")
            )
            # 2) macOS NFD 자모 분리로 인한 MinerU UTF-8 200바이트 잘림(truncation) 호환 접두사 검사
            if not is_matched:
                for part in norm_parts:
                    if len(part) >= 10 and (target_stem.startswith(part) or part.startswith(target_stem)):
                        is_matched = True
                        break
                if not is_matched:
                    cand_stem = norm_filename.replace("_content_list_v2.json", "").replace("_content_list.json", "")
                    if len(cand_stem) >= 10 and (target_stem.startswith(cand_stem) or cand_stem.startswith(target_stem)):
                        is_matched = True

            if is_matched:
                matched.append((mtime, p))

        if not matched:
            # 지정된 문서의 산출물이 없으면 절대로 다른 문서 산출물을 반환하지 않고 None 반환!
            return None
        candidates = matched

    candidates.sort(key=lambda x: x[0], reverse=True)
    latest_path = candidates[0][1]
    try:
        with open(latest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return latest_path, data
    except Exception:
        return None


def extract_pipeline_meta_from_path(file_path: Path) -> tuple[Optional[str], Optional[str]]:
    """경로 문자열에서 MinerU backend 및 method 추출 (예: mineru_pipeline_ocr_korean -> pipeline, ocr)"""
    backend = None
    method = None
    for part in file_path.parts:
        m = re.match(r"^mineru_([a-zA-Z0-9-]+)_([a-zA-Z0-9-]+)_", part)
        if m:
            backend = m.group(1)
            method = m.group(2)
            break
    if not method and file_path.parent.name in ["auto", "ocr", "txt"]:
        method = file_path.parent.name
    return backend, method


_doc_stats_cache: Dict[str, tuple[float, dict, Optional[str], Optional[str], Optional[str]]] = {}
_qdrant_cache_time: float = 0
_qdrant_cached_names: set[str] = set()
_qdrant_cached_status: Dict[str, Any] = {"connected": True, "error": None}


def get_embedded_doc_status(ttl_seconds: float = 4.0, force_refresh: bool = False) -> tuple[set[str], Dict[str, Any]]:
    """Qdrant 실시간 조회 및 설정오류/연결실패 시 로컬 매니페스트 캐시 fallback을 수행합니다."""
    global _qdrant_cache_time, _qdrant_cached_names, _qdrant_cached_status
    now = time.time()
    if not force_refresh and (now - _qdrant_cache_time) < ttl_seconds and _qdrant_cached_names:
        return _qdrant_cached_names, _qdrant_cached_status

    try:
        cfg = get_qdrant_config()
        doc_names, status_info = embedding_svc.get_indexed_doc_names_with_fallback(cfg)
        norm_names = {normalize_text(n) for n in doc_names}
        _qdrant_cached_names = norm_names
        _qdrant_cached_status = status_info
        _qdrant_cache_time = now
        return norm_names, status_info
    except Exception as e:
        logger.error(f"색인 상태 확인 중 예외 발생: {e}")
        return _qdrant_cached_names, {"connected": False, "error": str(e), "used_cache": True}


def get_embedded_doc_names() -> set[str]:
    names, _ = get_embedded_doc_status()
    return names


@app.get("/api/pdf/list")
async def list_pdfs():
    """사용 가능한 모든 PDF 파일 목록과 상세 ETL/인덱싱 상태 및 통계 반환"""
    global current_selected_pdf_name
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    pdf_files = list(DOCS_DIR.glob("*.pdf"))
    extra_docs = BASE_DIR / "pdfs"
    if extra_docs.exists():
        for f in extra_docs.glob("*.pdf"):
            if not any(p.name == f.name for p in pdf_files):
                pdf_files.append(f)

    if not current_selected_pdf_name and pdf_files:
        current_selected_pdf_name = pdf_files[0].name

    embedded_names, qdrant_status = get_embedded_doc_status()

    items = []
    total_parsed_count = 0
    total_chunks_count = 0
    total_running_jobs = 0
    total_embedded_count = 0

    for p in pdf_files:
        pages = get_pdf_page_count(p)
        stem = p.stem
        size_bytes = p.stat().st_size
        mtime = p.stat().st_mtime

        # 1. 실행 중인 Job 검사
        running_job = None
        for j in jobs_db.values():
            if j.get("filename") == p.name and j.get("status") in ["pending", "running"]:
                running_job = j
                break

        doc_backend = None
        doc_method = None
        doc_strategy = None

        if running_job:
            etl_status = "running"
            total_running_jobs += 1
            doc_backend = running_job.get("backend")
            doc_method = running_job.get("method")
            doc_strategy = running_job.get("strategy")
            active_job_info = {
                "task_id": running_job.get("task_id"),
                "status": running_job.get("status"),
                "progress_msg": running_job.get("progress_msg"),
                "elapsed_time": round(time.time() - running_job.get("created_at", time.time()), 1),
            }
        else:
            active_job_info = None
            etl_status = "not_started"

        stats_info = None
        has_saved_edit = False
        last_modified = None

        # 2. 산출물 존재 여부 및 stats 탐색
        content_info = find_latest_content_list(stem)
        if content_info:
            c_path, _ = content_info
            p_dir = c_path.parent
            edited_path = p_dir / "rag_chunks_edited.json"

            b_cand, m_cand = extract_pipeline_meta_from_path(c_path)
            if b_cand:
                doc_backend = b_cand
            if m_cand:
                doc_method = m_cand

            if edited_path.exists():
                if etl_status != "running":
                    etl_status = "completed"
                has_saved_edit = True
                last_modified = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(edited_path.stat().st_mtime))
                e_mtime = edited_path.stat().st_mtime
                cached = _doc_stats_cache.get(str(edited_path))
                if cached and cached[0] == e_mtime:
                    stats_info = cached[1]
                    if cached[2]:
                        doc_backend = cached[2]
                    if cached[3]:
                        doc_method = cached[3]
                    if cached[4]:
                        doc_strategy = cached[4]
                else:
                    try:
                        with open(edited_path, "r", encoding="utf-8") as f:
                            ed_data = json.load(f)
                            childs = ed_data.get("child_chunks", [])
                            parents = ed_data.get("parent_chunks", [])
                            secs = ed_data.get("sections", ed_data.get("parent_sections", []))
                            stats_info = {
                                "total_chunks": len(childs),
                                "parent_sections": len(secs),
                                "parent_chunks": len(parents),
                                "tables_count": sum(1 for c in childs if c.get("chunk_type") == "table" or c.get("is_table")),
                                "estimated_tokens": sum(c.get("token_estimate", 0) for c in childs),
                            }
                            if ed_data.get("backend"):
                                doc_backend = ed_data.get("backend")
                            if ed_data.get("method"):
                                doc_method = ed_data.get("method")
                            if ed_data.get("strategy"):
                                doc_strategy = ed_data.get("strategy")
                            _doc_stats_cache[str(edited_path)] = (e_mtime, stats_info, doc_backend, doc_method, doc_strategy)
                    except Exception:
                        pass
            elif c_path.exists():
                if etl_status != "running":
                    etl_status = "completed"
                has_saved_edit = False
                last_modified = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(c_path.stat().st_mtime))
                if latest_etl_result and (
                    normalize_text(latest_etl_result.get("active_pdf", "")) == normalize_text(p.name)
                    or normalize_text(stem) in normalize_text(latest_etl_result.get("doc_title", ""))
                ):
                    childs = latest_etl_result.get("child_chunks", [])
                    stats_info = {
                        "total_chunks": len(childs),
                        "parent_sections": len(latest_etl_result.get("sections", [])),
                        "parent_chunks": len(latest_etl_result.get("parent_chunks", [])),
                        "tables_count": sum(1 for c in childs if c.get("chunk_type") == "table" or c.get("is_table")),
                        "estimated_tokens": sum(c.get("token_estimate", 0) for c in childs),
                    }
                    if latest_etl_result.get("backend"):
                        doc_backend = latest_etl_result.get("backend")
                    if latest_etl_result.get("method"):
                        doc_method = latest_etl_result.get("method")
                    if latest_etl_result.get("strategy"):
                        doc_strategy = latest_etl_result.get("strategy")

        if etl_status == "completed" and stats_info is None and content_info:
            c_path, _ = content_info
            try:
                c_mtime = c_path.stat().st_mtime
                cached = _doc_stats_cache.get(str(c_path))
                if cached and cached[0] == c_mtime:
                    stats_info = cached[1]
                    if cached[2]:
                        doc_backend = cached[2]
                    if cached[3]:
                        doc_method = cached[3]
                    if cached[4]:
                        doc_strategy = cached[4]
                else:
                    chunker = HierarchicalChunker(doc_id=stem)
                    with open(c_path, "r", encoding="utf-8") as f:
                        c_data = json.load(f)
                    strat_guess = "legal" if any(k in stem for k in ["규정", "지침", "기준", "법률", "조례", "훈령", "전문"]) else "general"
                    temp_res = chunker.chunk_content_list(c_data, doc_title=stem, strategy=strat_guess)
                    childs = temp_res.get("child_chunks", [])
                    parents = temp_res.get("parent_chunks", [])
                    secs = temp_res.get("sections", [])
                    stats_info = {
                        "total_chunks": len(childs),
                        "parent_sections": len(secs),
                        "parent_chunks": len(parents),
                        "tables_count": sum(1 for c in childs if c.get("chunk_type") == "table" or c.get("is_table")),
                        "estimated_tokens": sum(c.get("token_estimate", 0) for c in childs),
                    }
                    if not doc_strategy:
                        doc_strategy = temp_res.get("strategy", strat_guess)
                    _doc_stats_cache[str(c_path)] = (c_mtime, stats_info, doc_backend, doc_method, doc_strategy)
            except Exception as e:
                print(f"Failed to auto-compute chunk stats for {stem}: {e}")

        # 파싱 완료되었으나 doc_strategy가 비어 있는 경우 문서명으로 기본 판정
        if etl_status == "completed" and not doc_strategy:
            doc_strategy = "legal" if any(k in stem for k in ["규정", "지침", "기준", "법률", "조례", "훈령", "전문"]) else "general"
        if etl_status == "completed" and not doc_backend:
            doc_backend = "pipeline"
        if etl_status == "completed" and not doc_method:
            doc_method = "auto"

        if etl_status == "completed":
            total_parsed_count += 1
            if stats_info:
                total_chunks_count += stats_info.get("total_chunks", 0)

        # 3. 임베딩 여부 확인 (유니코드 정규화 및 축약/접두사 호환 비교)
        norm_embedded = {normalize_text(n) for n in embedded_names}
        norm_stem = normalize_text(stem)
        norm_p_name = normalize_text(p.name)

        # 1) 완전 일치 검사
        is_embedded = (norm_stem in norm_embedded) or (norm_p_name in norm_embedded)

        # 2) 긴 파일명 축약/접두사 호환 검사 (MinerU UTF-8 바이트 자름 등 대응)
        if not is_embedded:
            for ne in norm_embedded:
                if len(ne) >= 10 and (norm_stem.startswith(ne) or ne.startswith(norm_stem)):
                    is_embedded = True
                    break

        # 3) 산출물 디렉터리 경로/content_info 기반 확인
        if not is_embedded and content_info:
            c_path, _ = content_info
            for part in c_path.parts:
                norm_part = normalize_text(part)
                if norm_part in norm_embedded:
                    is_embedded = True
                    break
                for ne in norm_embedded:
                    if len(ne) >= 10 and (norm_part.startswith(ne) or ne.startswith(norm_part)):
                        is_embedded = True
                        break
                if is_embedded:
                    break

        if is_embedded:
            total_embedded_count += 1

        items.append(
            {
                "filename": p.name,
                "size_bytes": size_bytes,
                "total_pages": pages,
                "is_current": (p.name == current_selected_pdf_name),
                "mtime": mtime,
                "etl_status": etl_status,
                "backend": doc_backend,
                "method": doc_method,
                "strategy": doc_strategy,
                "has_saved_edit": has_saved_edit,
                "is_embedded": is_embedded,
                "active_job": active_job_info,
                "stats": stats_info,
                "last_modified": last_modified,
            }
        )

    global_stats = {
        "total_pdfs": len(pdf_files),
        "parsed_pdfs": total_parsed_count,
        "running_jobs": total_running_jobs,
        "total_chunks": total_chunks_count,
        "embedded_pdfs": total_embedded_count,
        "qdrant_connected": qdrant_status.get("connected", True),
    }

    return {
        "pdfs": items,
        "current": current_selected_pdf_name,
        "global_stats": global_stats,
        "qdrant_status": qdrant_status,
    }


@app.post("/api/pdf/select")
async def select_pdf(req: SelectPdfRequest):
    """활성 파싱 대상 PDF 변경"""
    global current_selected_pdf_name
    norm_name = unicodedata.normalize("NFC", req.filename)
    target = DOCS_DIR / norm_name
    if not target.exists():
        target = DOCS_DIR / req.filename
    if not target.exists():
        extra = BASE_DIR / "pdfs" / norm_name
        if extra.exists():
            target = extra
        elif (BASE_DIR / "pdfs" / req.filename).exists():
            target = BASE_DIR / "pdfs" / req.filename
        else:
            # macOS NFD/NFC 정규화로 한번 더 탐색
            req_norm = normalize_text(req.filename)
            matched = [p for p in DOCS_DIR.glob("*.pdf") if normalize_text(p.name) == req_norm]
            if matched:
                target = matched[0]
            else:
                raise HTTPException(status_code=404, detail="PDF file not found")
    current_selected_pdf_name = target.name
    pages = get_pdf_page_count(target)
    return {"success": True, "current": target.name, "total_pages": pages}


@app.post("/api/pdf/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """신규 PDF 파일 업로드 및 자동 활성화 (NFC 정규화 적용)"""
    global current_selected_pdf_name
    clean_filename = unicodedata.normalize("NFC", file.filename)
    if not clean_filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    save_path = DOCS_DIR / clean_filename
    with open(save_path, "wb") as f:
        content = await file.read()
        f.write(content)

    current_selected_pdf_name = clean_filename
    pages = get_pdf_page_count(save_path)
    return {
        "success": True,
        "filename": clean_filename,
        "total_pages": pages,
        "size_bytes": save_path.stat().st_size,
    }


def clean_document_artifacts(filename: str, delete_pdf: bool = True, delete_vectors: bool = True) -> Dict[str, Any]:
    """문서의 파싱 산출물 폴더, Qdrant 벡터, PDF 원본(옵션) 및 캐시를 안전하게 정리"""
    global current_selected_pdf_name, latest_etl_result, latest_content_list_path
    global _doc_stats_cache

    stem = normalize_text(Path(filename).stem)
    deleted_folders = []
    deleted_files = []

    # 1. 백그라운드 진행 중 태스크 검사
    for j in jobs_db.values():
        job_file = normalize_text(j.get("filename", ""))
        if job_file == normalize_text(filename) and j.get("status") in ["pending", "running"]:
            raise HTTPException(status_code=400, detail="현재 백그라운드 파싱이 진행 중인 문서는 삭제할 수 없습니다.")

    # 2. 파싱 산출물 디렉터리 탐색 및 삭제 (유니코드 정규화 비교 필수)
    if OUTPUT_DIR.exists():
        for root, dirs, files in os.walk(OUTPUT_DIR, topdown=False):
            for d in dirs:
                norm_d = normalize_text(d)
                if norm_d == stem or (len(norm_d) >= 10 and (stem.startswith(norm_d) or norm_d.startswith(stem))):
                    target_dir = Path(root) / d
                    try:
                        shutil.rmtree(target_dir, ignore_errors=True)
                        deleted_folders.append(str(target_dir.relative_to(BASE_DIR)))
                    except Exception as e:
                        print(f"디렉터리 삭제 실패 {target_dir}: {e}")

    # 3. Qdrant 벡터 및 매니페스트 동기화 정리
    vector_res = None
    if delete_vectors:
        try:
            vector_res = embedding_svc.delete_document_vectors(stem)
            for d_name in list(deleted_folders):
                sub_stem = Path(d_name).name
                if sub_stem and sub_stem != stem and sub_stem not in ["ocr", "auto", "txt"]:
                    embedding_svc.delete_document_vectors(sub_stem)
        except Exception as e:
            print(f"벡터 데이터 삭제 실패 ({stem}): {e}")

    # 4. 인메모리 캐시 및 활성 결과 초기화
    _qdrant_cache_time = 0
    keys_to_remove = [k for k in _doc_stats_cache if stem in normalize_text(k)]
    for k in keys_to_remove:
        _doc_stats_cache.pop(k, None)

    if latest_etl_result:
        active_pdf_norm = normalize_text(latest_etl_result.get("active_pdf", ""))
        doc_title_norm = normalize_text(latest_etl_result.get("doc_title", ""))
        if active_pdf_norm == normalize_text(filename) or stem in doc_title_norm:
            latest_etl_result = None
            latest_content_list_path = None

    # 5. 원본 PDF 파일 삭제 (완전 삭제 요청 시)
    if delete_pdf:
        targets = [DOCS_DIR / filename, BASE_DIR / "pdfs" / filename]
        # NFD 파일명 호환 검색
        fn_norm = normalize_text(filename)
        for cand in list(DOCS_DIR.glob("*.pdf")) + list((BASE_DIR / "pdfs").glob("*.pdf")):
            if normalize_text(cand.name) == fn_norm and cand not in targets:
                targets.append(cand)

        for p in targets:
            if p.exists():
                try:
                    p.unlink()
                    deleted_files.append(str(p.relative_to(BASE_DIR)))
                except Exception as e:
                    print(f"PDF 파일 삭제 실패 {p}: {e}")

        # 활성 PDF가 삭제된 경우 다음 PDF로 자동 전환
        if normalize_text(current_selected_pdf_name) == normalize_text(filename):
            remaining_pdfs = [p.name for p in DOCS_DIR.glob("*.pdf")]
            current_selected_pdf_name = remaining_pdfs[0] if remaining_pdfs else None

    return {
        "success": True,
        "filename": filename,
        "deleted_folders": deleted_folders,
        "deleted_files": deleted_files,
        "vector_result": vector_res,
        "current_selected_pdf": current_selected_pdf_name,
    }


@app.delete("/api/pdf/{filename}")
async def delete_pdf_document(filename: str, delete_vectors: bool = True):
    """PDF 파일 및 모든 파싱 산출물, Qdrant 벡터 색인을 완전히 삭제"""
    target = DOCS_DIR / filename
    extra = BASE_DIR / "pdfs" / filename
    if not target.exists() and not extra.exists():
        raise HTTPException(status_code=404, detail=f"문서 '{filename}'을 찾을 수 없습니다.")

    res = clean_document_artifacts(filename, delete_pdf=True, delete_vectors=delete_vectors)
    return {
        "success": True,
        "message": f"문서 '{filename}' 및 관련 산출물이 완전히 삭제되었습니다.",
        **res,
    }


@app.delete("/api/etl/{filename}")
async def reset_etl_by_filename(filename: str, delete_vectors: bool = True):
    """PDF 원본은 유지하고, ETL 파싱 산출물과 벡터 색인만 초기화하여 미변환 상태로 복원"""
    target = DOCS_DIR / filename
    extra = BASE_DIR / "pdfs" / filename
    if not target.exists() and not extra.exists():
        raise HTTPException(status_code=404, detail=f"문서 '{filename}'을 찾을 수 없습니다.")

    res = clean_document_artifacts(filename, delete_pdf=False, delete_vectors=delete_vectors)
    return {
        "success": True,
        "message": f"문서 '{filename}'의 ETL 파싱 산출물이 초기화되었습니다.",
        **res,
    }


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


@app.get("/api/etl/sample")
async def get_sample_etl(strategy: Optional[str] = "general", filename: Optional[str] = None):
    """기존 파싱 결과를 바탕으로 부모-자식 청크 & 표 원형 보존 ETL 결과 반환 (수정본 존재 시 우선 로드)"""
    global latest_etl_result, latest_content_list_path
    target_doc = filename or current_selected_pdf_name
    if not target_doc:
        raise HTTPException(status_code=400, detail="선택된 PDF 문서가 없습니다.")

    found = find_latest_content_list(target_doc)
    if not found:
        raise HTTPException(status_code=404, detail=f"문서 '{target_doc}'의 파싱 산출물이 없습니다.")

    file_path, content_list = found
    latest_content_list_path = file_path

    # 원본 target_doc의 stem을 최우선 doc_name으로 채택하여 MinerU의 바이트 잘림 방지 및 NFC 정규화
    raw_doc_name = Path(target_doc).stem if target_doc else file_path.parent.parent.name
    doc_name = unicodedata.normalize("NFC", raw_doc_name)
    target_doc_nfc = unicodedata.normalize("NFC", target_doc)

    # rag_chunks_edited.json 존재 시 우선 로드
    edited_path = file_path.parent / "rag_chunks_edited.json"
    if edited_path.exists():
        try:
            with open(edited_path, "r", encoding="utf-8") as f:
                edited_data = json.load(f)
                edited_data["active_pdf"] = target_doc_nfc
                old_truncated = file_path.parent.parent.name
                if not edited_data.get("doc_title") or normalize_text(edited_data.get("doc_title", "")) == normalize_text(old_truncated):
                    edited_data["doc_title"] = doc_name
                if edited_data.get("sections"):
                    root_s = edited_data["sections"][0]
                    if normalize_text(root_s.get("title", "")) == normalize_text(old_truncated) or not root_s.get("title"):
                        root_s["title"] = doc_name
                    HierarchicalChunker.recalculate_section_hierarchy(edited_data["sections"], doc_title=doc_name)
                for c in edited_data.get("child_chunks", []):
                    meta = c.get("metadata", {})
                    if normalize_text(meta.get("doc_title", "")) == normalize_text(old_truncated):
                        meta["doc_title"] = doc_name
                    if c.get("breadcrumbs") and normalize_text(c["breadcrumbs"][0]) == normalize_text(old_truncated):
                        c["breadcrumbs"][0] = doc_name
                for p in edited_data.get("parent_chunks", []):
                    if p.get("breadcrumbs") and normalize_text(p["breadcrumbs"][0]) == normalize_text(old_truncated):
                        p["breadcrumbs"][0] = doc_name
                latest_etl_result = edited_data
                return edited_data
        except Exception as e:
            print(f"Failed to load edited chunks: {e}")

    chunker = HierarchicalChunker(doc_id=doc_name)
    etl_res = chunker.chunk_content_list(content_list, doc_title=doc_name, strategy=strategy or "general")
    etl_res["active_pdf"] = target_doc_nfc

    latest_etl_result = etl_res
    return etl_res


@app.post("/api/etl/reindex")
async def reindex_etl_endpoint(req: Optional[Dict[str, Any]] = None):
    """
    현재 편집 중인 ETL 결과(또는 메모리의 latest_etl_result)의
    모든 섹션(s01~)과 청크(c001~) ID를 문서 순서대로 일괄 재정렬합니다.
    """
    global latest_etl_result
    etl_data = (req.get("etl_result") if req else None) or req or latest_etl_result
    if not etl_data or "child_chunks" not in etl_data:
        raise HTTPException(status_code=400, detail="재정렬할 유효한 ETL 결과 데이터가 없습니다.")

    if not etl_data.get("active_pdf") and current_selected_pdf_name:
        etl_data["active_pdf"] = current_selected_pdf_name

    reindexed = HierarchicalChunker.reindex_etl_result(etl_data)
    latest_etl_result = reindexed
    return reindexed


class SaveEtlRequest(BaseModel):
    etl_result: Optional[Dict[str, Any]] = None


@app.post("/api/etl/save")
async def save_etl_result(req: Dict[str, Any]):
    """사용자가 편집한 ETL 결과 전체를 백엔드에 영속 저장"""
    global latest_etl_result, latest_content_list_path

    etl_data = req.get("etl_result", req)
    if not etl_data or "child_chunks" not in etl_data:
        raise HTTPException(status_code=400, detail="유효한 ETL 결과 데이터가 아닙니다.")

    target_content_list_path = latest_content_list_path
    if not target_content_list_path or not target_content_list_path.exists():
        found = find_latest_content_list(current_selected_pdf_name)
        if found:
            target_content_list_path = found[0]
            latest_content_list_path = target_content_list_path

    if not target_content_list_path:
        raise HTTPException(status_code=404, detail="저장할 대상 파싱 결과 디렉토리를 찾을 수 없습니다.")

    save_path = target_content_list_path.parent / "rag_chunks_edited.json"
    try:
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(etl_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")

    latest_etl_result = etl_data
    total_chunks = len(etl_data.get("child_chunks", []))
    saved_time = time.time()

    return {
        "success": True,
        "message": "수정본이 성공적으로 저장되었습니다.",
        "saved_at": saved_time,
        "total_chunks": total_chunks,
    }


class ResetRequest(BaseModel):
    strategy: Optional[str] = "general"


@app.post("/api/etl/reset")
async def reset_etl_result(req: Optional[ResetRequest] = None):
    """수정본(rag_chunks_edited.json)을 제거하고 원본 파싱 결과로 리셋"""
    global latest_etl_result, latest_content_list_path

    target_content_list_path = latest_content_list_path
    if not target_content_list_path or not target_content_list_path.exists():
        found = find_latest_content_list(current_selected_pdf_name)
        if found:
            target_content_list_path = found[0]
            latest_content_list_path = target_content_list_path

    if not target_content_list_path or not target_content_list_path.exists():
        raise HTTPException(status_code=404, detail="원본 파싱 결과를 찾을 수 없습니다.")

    save_path = target_content_list_path.parent / "rag_chunks_edited.json"
    if save_path.exists():
        try:
            save_path.unlink()
        except Exception as e:
            print(f"수정본 파일 삭제 실패: {e}")

    try:
        with open(target_content_list_path, "r", encoding="utf-8") as f:
            content_list = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"원본 데이터 로드 실패: {str(e)}")

    strat = (req.strategy if req and req.strategy else None) or "general"
    preferred_name = current_selected_pdf_name or target_content_list_path.parent.parent.name
    doc_name = unicodedata.normalize("NFC", Path(preferred_name).stem)
    chunker = HierarchicalChunker(doc_id=doc_name)
    etl_res = chunker.chunk_content_list(content_list, doc_title=doc_name, strategy=strat)
    etl_res["active_pdf"] = unicodedata.normalize("NFC", preferred_name)

    latest_etl_result = etl_res
    return etl_res


@app.post("/api/etl/parse")
async def run_etl_parse(req: ParseRequest):
    """지정된 PDF(또는 활성 PDF)를 파싱하고 즉시 계층 청킹 파이프라인 수행"""
    global latest_etl_result, latest_content_list_path, current_selected_pdf_name

    pdf_path = None
    if req.filename:
        p1 = DOCS_DIR / req.filename
        pdf_path = p1 if p1.exists() else None

    if not pdf_path:
        pdf_path = get_active_pdf_path()

    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Target PDF not found")

    current_selected_pdf_name = pdf_path.name

    # 전체 페이지(all_pages) 옵션 처리
    start_p = None if req.all_pages else req.start_page
    end_p = None if req.all_pages else req.end_page

    method = req.method or "auto"
    formula = True if req.formula is None else req.formula
    output_dir = BASE_DIR / "output" / f"mineru_{req.backend}_{method}_{req.lang}"
    parse_res = mineru_svc.parse_pdf(
        pdf_path=pdf_path,
        output_dir=output_dir,
        start_page=start_p,
        end_page=end_p,
        lang=req.lang or "korean",
        backend=req.backend or "pipeline",
        method=method,
        formula=formula,
    )

    if not parse_res.get("success"):
        raise HTTPException(
            status_code=500, detail=parse_res.get("error", "MinerU parse failed")
        )

    content_list = parse_res.get("content_list", [])
    if parse_res.get("content_list_path"):
        latest_content_list_path = Path(parse_res["content_list_path"])
    elif not content_list:
        found = find_latest_content_list(pdf_path.stem)
        if found:
            latest_content_list_path = found[0]
            content_list = found[1]

    chunk_strat = req.strategy or "general"
    chunker = HierarchicalChunker(doc_id=pdf_path.stem)
    etl_res = chunker.chunk_content_list(content_list, doc_title=pdf_path.stem, strategy=chunk_strat)
    etl_res["elapsed_time"] = parse_res.get("elapsed_time", 0)
    etl_res["active_pdf"] = pdf_path.name
    etl_res["total_pages"] = get_pdf_page_count(pdf_path)
    etl_res["backend"] = req.backend or "pipeline"
    etl_res["method"] = method
    etl_res["strategy"] = chunk_strat

    latest_etl_result = etl_res

    # 새로 파싱/청킹된 최신 산출물을 rag_chunks_edited.json에 즉시 영속화하여 이전 수정본 캐시 덮어쓰기
    if latest_content_list_path and latest_content_list_path.exists():
        edited_save_path = latest_content_list_path.parent / "rag_chunks_edited.json"
        try:
            with open(edited_save_path, "w", encoding="utf-8") as f:
                json.dump(etl_res, f, ensure_ascii=False, indent=2)
            _doc_stats_cache.pop(str(edited_save_path), None)
        except Exception as e:
            print(f"Failed to auto-save rag_chunks_edited.json in run_etl_parse: {e}")

    return etl_res


@app.post("/api/etl/parse-job")
async def start_etl_job(req: ParseRequest, background_tasks: BackgroundTasks):
    """비동기 백그라운드 태스크 등록: 즉시 task_id 반환 (타임아웃 방지)"""
    global current_selected_pdf_name
    pdf_path = None
    if req.filename:
        p1 = DOCS_DIR / req.filename
        pdf_path = p1 if p1.exists() else None

    if not pdf_path:
        pdf_path = get_active_pdf_path()

    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Target PDF not found")

    current_selected_pdf_name = pdf_path.name
    task_id = f"job_{uuid.uuid4().hex[:8]}"

    jobs_db[task_id] = {
        "task_id": task_id,
        "status": "pending",
        "progress_msg": "태스크가 백그라운드 대기열에 등록되었습니다...",
        "filename": pdf_path.name,
        "backend": req.backend or "pipeline",
        "method": req.method or "auto",
        "strategy": req.strategy or "general",
        "created_at": time.time(),
        "elapsed_time": 0,
        "result": None,
        "error": None,
    }

    background_tasks.add_task(process_etl_job, task_id, req.model_dump(), str(pdf_path))
    return {
        "success": True,
        "task_id": task_id,
        "status": "pending",
        "message": "백그라운드 파싱 작업이 등록되었습니다."
    }


@app.get("/api/etl/jobs/active")
async def get_active_job():
    """현재 진행 중인 가장 최근 백그라운드 작업 반환 (새로고침 시 폴링 복구용)"""
    for task_id, job in reversed(list(jobs_db.items())):
        if job["status"] in ["pending", "running"]:
            job_copy = dict(job)
            job_copy["elapsed_time"] = round(time.time() - job["created_at"], 1)
            return job_copy
    return {"active": False}


@app.get("/api/etl/jobs/{task_id}")
async def get_job_status(task_id: str):
    """특정 백그라운드 태스크의 진행 상태 및 완료 결과 조회"""
    job = jobs_db.get(task_id)
    if not job:
        raise HTTPException(status_code=404, detail="Task not found")

    job_copy = dict(job)
    if job["status"] in ["pending", "running"]:
        job_copy["elapsed_time"] = round(time.time() - job["created_at"], 1)
    return job_copy


class MergedExportRequest(BaseModel):
    filenames: List[str]


@app.get("/api/etl/export/jsonl")
async def export_jsonl(filename: Optional[str] = None):
    """RAG 표준 JSONL 파일 다운로드 (특정 문서 지정 가능)"""
    global latest_etl_result
    target_data = None
    target_title = "rag_chunks"

    target_name = filename or current_selected_pdf_name
    if target_name:
        stem = unicodedata.normalize("NFC", Path(target_name).stem)
        found = find_latest_content_list(stem)
        if found:
            file_path, content_list = found
            p_dir = file_path.parent
            edited_path = p_dir / "rag_chunks_edited.json"
            doc_id = HierarchicalChunker.generate_doc_id(target_name)
            if edited_path.exists():
                try:
                    with open(edited_path, "r", encoding="utf-8") as f:
                        target_data = json.load(f)
                        old_truncated = file_path.parent.parent.name
                        if not target_data.get("doc_title") or normalize_text(target_data.get("doc_title", "")) == normalize_text(old_truncated):
                            target_data["doc_title"] = stem
                        if target_data.get("sections"):
                            root_s = target_data["sections"][0]
                            if normalize_text(root_s.get("title", "")) == normalize_text(old_truncated) or not root_s.get("title"):
                                root_s["title"] = stem
                            HierarchicalChunker.recalculate_section_hierarchy(target_data["sections"], doc_title=stem)
                        for c in target_data.get("child_chunks", []):
                            meta = c.get("metadata", {})
                            if normalize_text(meta.get("doc_title", "")) == normalize_text(old_truncated):
                                meta["doc_title"] = stem
                            if c.get("breadcrumbs") and normalize_text(c["breadcrumbs"][0]) == normalize_text(old_truncated):
                                c["breadcrumbs"][0] = stem
                        for p in target_data.get("parent_chunks", []):
                            if p.get("breadcrumbs") and normalize_text(p["breadcrumbs"][0]) == normalize_text(old_truncated):
                                p["breadcrumbs"][0] = stem
                except Exception:
                    pass
            if not target_data:
                doc_id = HierarchicalChunker.generate_doc_id(target_name)
                chunker = HierarchicalChunker(doc_id=doc_id)
                target_data = chunker.chunk_content_list(content_list, doc_title=stem)
            target_title = stem

    if not target_data:
        if latest_etl_result:
            target_data = latest_etl_result
        else:
            found = find_latest_content_list()
            if found:
                file_path, content_list = found
                preferred_title = current_selected_pdf_name or file_path.parent.parent.name
                doc_title = unicodedata.normalize("NFC", Path(preferred_title).stem)
                chunker = HierarchicalChunker(
                    doc_id=HierarchicalChunker.generate_doc_id(doc_title)
                )
                target_data = chunker.chunk_content_list(
                    content_list, doc_title=doc_title
                )
                target_title = doc_title
            else:
                raise HTTPException(
                    status_code=404, detail="No ETL data available to export"
                )

    doc_id = target_data.get("doc_id") or HierarchicalChunker.generate_doc_id(target_title)
    chunker = HierarchicalChunker(doc_id=doc_id)
    jsonl_content = chunker.export_to_jsonl(target_data)

    safe_target_filename = f"{target_title}_rag_chunks.jsonl"
    encoded_target_filename = quote(safe_target_filename)

    return Response(
        content=jsonl_content,
        media_type="application/x-ndjson; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="rag_chunks.jsonl"; filename*=utf-8\'\'{encoded_target_filename}',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@app.post("/api/etl/export/jsonl/merged")
async def export_jsonl_merged(req: MergedExportRequest):
    """선택된 복수 파싱 문서의 청크들을 고유 doc_id(128-bit UUID) 및 4자리 chunk_id로 병합하여 단일 JSONL로 내보내기"""
    if not req.filenames:
        raise HTTPException(
            status_code=400, detail="병합 내보내기할 파일 목록(filenames)이 비어있습니다."
        )

    all_jsonl_lines: List[str] = []
    processed_count = 0

    for fname in req.filenames:
        stem = Path(fname).stem
        found = find_latest_content_list(stem)
        if not found:
            continue
        c_path, c_list = found
        p_dir = c_path.parent
        edited_path = p_dir / "rag_chunks_edited.json"

        # 고유 doc_id 산출 (128-bit RFC 4122 UUID v5 결정론적 고유 ID)
        doc_id = HierarchicalChunker.generate_doc_id(fname)
        chunker = HierarchicalChunker(doc_id=doc_id)

        etl_data = None
        if edited_path.exists():
            try:
                with open(edited_path, "r", encoding="utf-8") as f:
                    etl_data = json.load(f)
            except Exception as e:
                logger.warning(f"수정본 로드 실패 ({edited_path}): {e}")

        if not etl_data:
            doc_id = HierarchicalChunker.generate_doc_id(fname)
            chunker = HierarchicalChunker(doc_id=doc_id)
            etl_data = chunker.chunk_content_list(c_list, doc_title=stem)

        doc_id = etl_data.get("doc_id") or HierarchicalChunker.generate_doc_id(fname)
        chunker = HierarchicalChunker(doc_id=doc_id)
        jsonl_str = chunker.export_to_jsonl(etl_data)
        for line in jsonl_str.strip().split("\n"):
            line = line.strip()
            if line:
                all_jsonl_lines.append(line)
        processed_count += 1

    if not all_jsonl_lines:
        raise HTTPException(
            status_code=404,
            detail="선택된 문서들에서 유효한 파싱 청크 데이터를 찾을 수 없습니다."
        )

    merged_content = "\n".join(all_jsonl_lines) + "\n"
    out_filename = f"merged_rag_chunks_{processed_count}docs.jsonl"
    encoded_out_filename = quote(out_filename)

    return Response(
        content=merged_content,
        media_type="application/x-ndjson; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{out_filename}"; filename*=utf-8\'\'{encoded_out_filename}',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@app.get("/api/pdf")
async def get_pdf():
    pdf_path = get_active_pdf_path()
    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(pdf_path, media_type="application/pdf")


# ==========================================
# Phase 2: Qdrant & 하이브리드 임베딩 API 엔드포인트
# ==========================================

class QdrantTestConnectionRequest(BaseModel):
    mode: Optional[str] = None
    local_path: Optional[str] = None
    url: Optional[str] = None
    api_key: Optional[str] = None


class EmbedRequest(BaseModel):
    collection_name: Optional[str] = None
    recreate_collection: Optional[bool] = None
    chunks: Optional[List[Dict[str, Any]]] = None
    parent_chunks: Optional[List[Dict[str, Any]]] = None


class SearchRequest(BaseModel):
    query: str
    limit: Optional[int] = 10
    collection_name: Optional[str] = None


# 임베딩 작업 상태 관리 객체
embed_job_state: Dict[str, Any] = {
    "status": "idle",  # idle | running | done | error
    "progress_msg": "대기 중",
    "progress_pct": 0,
    "last_result": None,
    "error": None,
    "elapsed_time": 0,
}


@app.get("/api/qdrant/config")
async def api_get_qdrant_config():
    """현재 Qdrant 설정 조회"""
    cfg = get_qdrant_config()
    return cfg.model_dump()


@app.post("/api/qdrant/config")
async def api_save_qdrant_config(req: QdrantConfig):
    """Qdrant 설정 업데이트 및 저장"""
    global _qdrant_cache_time
    _qdrant_cache_time = 0
    saved = save_qdrant_config(req)
    return {"success": True, "config": saved.model_dump()}


@app.post("/api/qdrant/sync")
async def api_sync_qdrant_manifest():
    """Qdrant 실시간 적재 상태를 로컬 매니페스트와 강제 양방향 동기화"""
    global _qdrant_cache_time
    _qdrant_cache_time = 0
    names, status_info = get_embedded_doc_status(ttl_seconds=0.0, force_refresh=True)
    manifest = load_indexed_docs_manifest()
    return {
        "success": status_info.get("connected", False),
        "status": status_info,
        "manifest": manifest,
        "indexed_doc_count": len(manifest.get("documents", {})),
    }


@app.post("/api/qdrant/test-connection")
async def api_test_qdrant_connection(req: Optional[QdrantTestConnectionRequest] = None):
    """Qdrant 연결 헬스체크 및 컬렉션 현황 테스트"""
    current_cfg = get_qdrant_config()
    test_dict = current_cfg.model_dump()

    if req:
        if req.mode is not None:
            test_dict["mode"] = req.mode
        if req.local_path is not None:
            test_dict["local_path"] = req.local_path
        if req.url is not None:
            test_dict["url"] = req.url
        if req.api_key is not None:
            test_dict["api_key"] = req.api_key

    test_cfg = QdrantConfig(**test_dict)
    res = embedding_svc.test_connection(test_cfg)
    return res


@app.get("/api/qdrant/collections")
async def api_get_qdrant_collections():
    """Qdrant 인스턴스에 존재하는 컬렉션 목록 및 현재 기본 컬렉션 반환"""
    cfg = get_qdrant_config()
    conn = embedding_svc.test_connection(cfg)
    return {
        "success": conn.get("success", False),
        "current_collection": cfg.collection_name,
        "collections": conn.get("collections", []),
        "error": conn.get("error"),
    }


def run_embedding_task(
    chunks_to_embed: List[Dict[str, Any]],
    parent_chunks_to_embed: Optional[List[Dict[str, Any]]],
    custom_col: Optional[str],
    recreate: Optional[bool],
):
    global embed_job_state
    embed_job_state["status"] = "running"
    embed_job_state["progress_msg"] = "임베딩 작업 시작..."
    embed_job_state["progress_pct"] = 5
    embed_job_state["error"] = None
    start_t = time.time()

    def progress_callback(msg: str, pct: float):
        embed_job_state["progress_msg"] = msg
        embed_job_state["progress_pct"] = pct
        embed_job_state["elapsed_time"] = round(time.time() - start_t, 1)

    try:
        cfg = get_qdrant_config()
        if recreate is not None:
            cfg.recreate_collection = recreate
        if custom_col:
            cfg.collection_name = custom_col

        res = embedding_svc.embed_and_upsert(
            child_chunks=chunks_to_embed,
            parent_chunks=parent_chunks_to_embed,
            config=cfg,
            collection_name=custom_col,
            progress_callback=progress_callback,
        )
        embed_job_state["status"] = "done"
        embed_job_state["last_result"] = res
        embed_job_state["progress_pct"] = 100
        embed_job_state["progress_msg"] = f"인덱싱 완료 ({res.get('upserted_count', 0)}개 청크 저장됨)"
        embed_job_state["elapsed_time"] = round(time.time() - start_t, 1)
        global _qdrant_cache_time
        _qdrant_cache_time = 0
    except Exception as e:
        embed_job_state["status"] = "error"
        embed_job_state["error"] = str(e)
        embed_job_state["progress_msg"] = f"임베딩 오류: {e}"
        embed_job_state["elapsed_time"] = round(time.time() - start_t, 1)


@app.post("/api/etl/embed")
async def api_embed_chunks(req: EmbedRequest, background_tasks: BackgroundTasks):
    """현재 ETL 청크를 Dense & Sparse로 인코딩하여 Qdrant에 비동기 인덱싱"""
    global latest_etl_result, embed_job_state

    # 인덱싱 대상 청크 추출
    chunks_to_embed = req.chunks
    parent_chunks_to_embed = req.parent_chunks

    if not chunks_to_embed:
        if latest_etl_result and "child_chunks" in latest_etl_result:
            chunks_to_embed = latest_etl_result["child_chunks"]
            if not parent_chunks_to_embed and "parent_chunks" in latest_etl_result:
                parent_chunks_to_embed = latest_etl_result.get("parent_chunks", [])
        else:
            found = find_latest_content_list()
            if found:
                preferred_title = current_selected_pdf_name or file_path.parent.parent.name
                doc_title = unicodedata.normalize("NFC", Path(preferred_title).stem)
                chunker = HierarchicalChunker(doc_id=HierarchicalChunker.generate_doc_id(doc_title))
                latest_etl_result = chunker.chunk_content_list(
                    content_list, doc_title=doc_title
                )
                chunks_to_embed = latest_etl_result.get("child_chunks", [])
                parent_chunks_to_embed = latest_etl_result.get("parent_chunks", [])
    elif not parent_chunks_to_embed and latest_etl_result and "parent_chunks" in latest_etl_result:
        parent_chunks_to_embed = latest_etl_result.get("parent_chunks", [])

    if not chunks_to_embed:
        raise HTTPException(
            status_code=400,
            detail="인덱싱할 청크 데이터가 존재하지 않습니다. 먼저 파싱/청킹을 수행해주세요.",
        )

    # 이미 실행 중인 경우 체크
    if embed_job_state["status"] == "running":
        return {
            "success": False,
            "message": "이미 임베딩/인덱싱 작업이 진행 중입니다.",
            "status": "running",
        }

    background_tasks.add_task(
        run_embedding_task,
        chunks_to_embed,
        parent_chunks_to_embed,
        req.collection_name,
        req.recreate_collection,
    )

    return {
        "success": True,
        "message": f"{len(chunks_to_embed)}개 청크의 인덱싱 작업이 백그라운드에서 시작되었습니다.",
        "total_chunks": len(chunks_to_embed),
        "status": "running",
    }


@app.get("/api/etl/embed/status")
async def api_embed_status():
    """임베딩 및 Qdrant 적재 진행 상태 조회"""
    return embed_job_state


@app.post("/api/etl/search/test")
async def api_search_test(req: SearchRequest):
    """자연어 질의로 Qdrant 하이브리드 RRF 검색 테스트 수행"""
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="검색 쿼리가 비어 있습니다.")

    cfg = get_qdrant_config()
    target_col = req.collection_name or cfg.collection_name

    try:
        results = embedding_svc.hybrid_search(
            query=req.query,
            limit=req.limit or 10,
            config=cfg,
            collection_name=target_col,
        )
        return {
            "success": True,
            "query": req.query,
            "collection_name": target_col,
            "total_matches": len(results),
            "results": results,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"하이브리드 검색 중 오류가 발생했습니다: {str(e)}",
        )


# ---------------------------------------------------------
# LLM 텍스트 자동 교정 및 OpenAI 호환 설정 엔드포인트
# ---------------------------------------------------------
class LLMTestRequest(BaseModel):
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    api_key: Optional[str] = None
    timeout: Optional[int] = None


class RefineChunkRequest(BaseModel):
    text: str
    custom_prompt: Optional[str] = None


@app.get("/api/llm/config")
async def api_get_llm_config():
    """현재 저장된 LLM 설정 조회"""
    return get_llm_config()


@app.post("/api/llm/config")
async def api_save_llm_config(config: LLMConfig):
    """LLM 설정 저장 및 영속화"""
    try:
        saved = save_llm_config(config)
        return {"success": True, "config": saved}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM 설정 저장 실패: {str(e)}")


@app.get("/api/llm/config/default-prompt")
async def api_get_default_prompt():
    """기본 시스템 프롬프트 텍스트 조회"""
    return {"default_prompt": get_default_system_prompt()}


@app.get("/api/llm/models")
async def api_get_llm_models(
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
):
    """지정되거나 저장된 LLM 엔드포인트에서 사용 가능한 모델 목록 조회"""
    cfg = get_llm_config()
    if base_url:
        cfg.base_url = base_url
    if api_key is not None:
        cfg.api_key = api_key
    models = await llm_refine_svc.fetch_models(cfg)
    return {"success": True, "models": models}


@app.post("/api/llm/test")
async def api_test_llm_connection(req: Optional[LLMTestRequest] = None):
    """LLM 엔드포인트 연결 테스트"""
    cfg = get_llm_config()
    if req:
        if req.base_url:
            cfg.base_url = req.base_url
        if req.model_name:
            cfg.model_name = req.model_name
        if req.temperature is not None:
            cfg.temperature = req.temperature
        if req.api_key is not None:
            cfg.api_key = req.api_key
        if req.timeout is not None:
            cfg.timeout = req.timeout

    res = await llm_refine_svc.test_connection(cfg)
    return res


@app.post("/api/llm/refine-chunk")
async def api_refine_chunk(req: RefineChunkRequest):
    """단일 청크 텍스트 LLM 자동 교정"""
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="교정할 텍스트가 비어 있습니다.")

    try:
        result = await llm_refine_svc.refine_chunk_text(
            text=req.text,
            custom_prompt=req.custom_prompt,
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"텍스트 교정 중 오류가 발생했습니다: {str(e)}",
        )


# Phase 3: 기본 파서 설정 (Parser Configuration) 영속화 엔드포인트
@app.get("/api/parser/config")
async def api_get_parser_config():
    """현재 저장된 기본 파서 설정 조회"""
    return get_parser_config()


@app.post("/api/parser/config")
async def api_save_parser_config(config: ParserConfig):
    """기본 파서 설정 저장 및 영속화"""
    try:
        saved = save_parser_config(config)
        return {"success": True, "config": saved}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파서 설정 저장 실패: {str(e)}")


@app.post("/api/parser/config/reset")
async def api_reset_parser_config():
    """기본 파서 설정을 초기 기본값으로 리셋"""
    try:
        reset_config = reset_parser_config()
        return {"success": True, "config": reset_config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파서 설정 리셋 실패: {str(e)}")


# ----------------------------------------------------
# Phase 4: 작업공간 & 작업 데이터 백업 및 원복(복원) API
# ----------------------------------------------------

class CreateBackupRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = ""
    backup_type: Optional[str] = "workspace"
    target_doc: Optional[str] = None
    include_vector_db: Optional[bool] = False


class RestoreBackupRequest(BaseModel):
    create_safety_backup: Optional[bool] = True


@app.get("/api/backup/list")
async def api_list_backups():
    """보유 중인 모든 백업 아카이브 목록 조회 (최신순)"""
    try:
        backups = backup_svc.list_backups()
        return {"success": True, "backups": backups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 목록 조회 실패: {str(e)}")


@app.post("/api/backup/create")
async def api_create_backup(req: CreateBackupRequest):
    """새로운 작업공간 또는 단일 문서 백업 아카이브 생성"""
    try:
        manifest = backup_svc.create_backup(
            name=req.name,
            description=req.description,
            backup_type=req.backup_type or "workspace",
            target_doc=req.target_doc,
            include_vector_db=bool(req.include_vector_db),
            is_safety_backup=False,
        )
        return {"success": True, "manifest": manifest, "message": "백업이 성공적으로 생성되었습니다."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 생성 실패: {str(e)}")


@app.get("/api/backup/{backup_id}")
async def api_get_backup(backup_id: str):
    """특정 백업의 메타데이터 조회"""
    data = backup_svc.get_backup(backup_id)
    if not data:
        raise HTTPException(status_code=404, detail="해당 백업을 찾을 수 없습니다.")
    return {"success": True, "manifest": data}


@app.post("/api/backup/{backup_id}/restore")
async def api_restore_backup(backup_id: str, req: Optional[RestoreBackupRequest] = None):
    """선택한 백업으로부터 작업공간 또는 문서 원복(복원)"""
    global latest_etl_result, latest_content_list_path, current_selected_pdf_name, _doc_stats_cache
    create_safety = True if req is None else bool(req.create_safety_backup)

    try:
        res = backup_svc.restore_backup(backup_id=backup_id, create_safety_backup=create_safety)
        # Reset in-memory cache
        latest_etl_result = None
        latest_content_list_path = None
        _doc_stats_cache.clear()

        # Update or verify active PDF
        pdf_files = list(DOCS_DIR.glob("*.pdf"))
        if pdf_files:
            if not current_selected_pdf_name or not any(p.name == current_selected_pdf_name for p in pdf_files):
                current_selected_pdf_name = pdf_files[0].name
        else:
            current_selected_pdf_name = None

        return {"success": True, "result": res, "message": res.get("message", "원복이 완료되었습니다.")}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 복원 중 오류 발생: {str(e)}")


@app.get("/api/backup/{backup_id}/download")
async def api_download_backup(backup_id: str):
    """백업 ZIP 아카이브 파일 다운로드"""
    zip_path = backup_svc.get_backup_path(backup_id)
    if not zip_path or not zip_path.exists():
        raise HTTPException(status_code=404, detail="백업 파일을 찾을 수 없습니다.")

    filename = quote(zip_path.name)
    return FileResponse(
        path=str(zip_path),
        filename=zip_path.name,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@app.post("/api/backup/upload")
async def api_upload_backup(file: UploadFile = File(...), restore_immediately: bool = False):
    """외부 백업 ZIP 파일을 업로드하여 등록하고, 필요 시 즉시 원복"""
    global latest_etl_result, latest_content_list_path, current_selected_pdf_name, _doc_stats_cache
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="ZIP 형식의 백업 파일만 업로드할 수 있습니다.")

    try:
        content = await file.read()
        res = backup_svc.import_backup_file(
            file_bytes=content,
            original_filename=file.filename,
            restore_immediately=restore_immediately,
        )

        if restore_immediately:
            latest_etl_result = None
            latest_content_list_path = None
            _doc_stats_cache.clear()
            pdf_files = list(DOCS_DIR.glob("*.pdf"))
            if pdf_files:
                current_selected_pdf_name = pdf_files[0].name

        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 파일 가져오기 실패: {str(e)}")


@app.delete("/api/backup/{backup_id}")
async def api_delete_backup(backup_id: str):
    """지정된 백업 파일 삭제"""
    success = backup_svc.delete_backup(backup_id)
    if not success:
        raise HTTPException(status_code=404, detail="삭제할 백업 파일을 찾을 수 없거나 실패했습니다.")
    return {"success": True, "message": "백업이 성공적으로 삭제되었습니다."}




import json
import logging
import os
import shutil
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.app.common import (
    BASE_DIR,
    DOCS_DIR,
    OUTPUT_DIR,
    _doc_stats_cache,
    extract_pipeline_meta_from_path,
    find_latest_content_list,
    get_embedded_doc_status,
    get_pdf_page_count,
    normalize_text,
)
from backend.app.services.embedding_svc import embedding_svc
from backend.app.services.hierarchical_chunker import HierarchicalChunker
from backend.app.services.job_manager import job_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pdf", tags=["pdf"])


class SelectPdfRequest(BaseModel):
    filename: str


def clean_document_artifacts(filename: str, delete_pdf: bool = True, delete_vectors: bool = True) -> Dict[str, Any]:
    """문서의 파싱 산출물 폴더, Qdrant 벡터, PDF 원본(옵션) 및 캐시를 안전하게 정리"""
    stem = normalize_text(Path(filename).stem)
    deleted_folders = []
    deleted_files = []

    # 1. 백그라운드 진행 중 태스크 검사
    for j in job_manager.jobs_db.values():
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
                        logger.error(f"디렉터리 삭제 실패 {target_dir}: {e}")

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
            logger.error(f"벡터 데이터 삭제 실패 ({stem}): {e}")

    # 4. 인메모리 캐시 및 활성 결과 초기화
    keys_to_remove = [k for k in _doc_stats_cache if stem in normalize_text(k)]
    for k in keys_to_remove:
        _doc_stats_cache.pop(k, None)

    if job_manager.latest_etl_result:
        active_pdf_norm = normalize_text(job_manager.latest_etl_result.get("active_pdf", ""))
        doc_title_norm = normalize_text(job_manager.latest_etl_result.get("doc_title", ""))
        if active_pdf_norm == normalize_text(filename) or stem in doc_title_norm:
            job_manager.latest_etl_result = None
            job_manager.latest_content_list_path = None

    # 5. 원본 PDF 파일 삭제 (완전 삭제 요청 시)
    if delete_pdf:
        targets = [DOCS_DIR / filename, BASE_DIR / "pdfs" / filename]
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
                    logger.error(f"PDF 파일 삭제 실패 {p}: {e}")

        if normalize_text(job_manager.current_selected_pdf_name) == normalize_text(filename):
            remaining_pdfs = [p.name for p in DOCS_DIR.glob("*.pdf")]
            job_manager.current_selected_pdf_name = remaining_pdfs[0] if remaining_pdfs else None

    return {
        "success": True,
        "filename": filename,
        "deleted_folders": deleted_folders,
        "deleted_files": deleted_files,
        "vector_result": vector_res,
        "current_selected_pdf": job_manager.current_selected_pdf_name,
    }


@router.get("/list")
async def list_pdfs():
    """사용 가능한 모든 PDF 파일 목록과 상세 ETL/인덱싱 상태 및 통계 반환"""
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    pdf_files = list(DOCS_DIR.glob("*.pdf"))
    extra_docs = BASE_DIR / "pdfs"
    if extra_docs.exists():
        for f in extra_docs.glob("*.pdf"):
            if not any(p.name == f.name for p in pdf_files):
                pdf_files.append(f)

    if not job_manager.current_selected_pdf_name and pdf_files:
        job_manager.current_selected_pdf_name = pdf_files[0].name

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

        running_job = None
        for j in job_manager.jobs_db.values():
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
                if job_manager.latest_etl_result and (
                    normalize_text(job_manager.latest_etl_result.get("active_pdf", "")) == normalize_text(p.name)
                    or normalize_text(stem) in normalize_text(job_manager.latest_etl_result.get("doc_title", ""))
                ):
                    childs = job_manager.latest_etl_result.get("child_chunks", [])
                    stats_info = {
                        "total_chunks": len(childs),
                        "parent_sections": len(job_manager.latest_etl_result.get("sections", [])),
                        "parent_chunks": len(job_manager.latest_etl_result.get("parent_chunks", [])),
                        "tables_count": sum(1 for c in childs if c.get("chunk_type") == "table" or c.get("is_table")),
                        "estimated_tokens": sum(c.get("token_estimate", 0) for c in childs),
                    }
                    if job_manager.latest_etl_result.get("backend"):
                        doc_backend = job_manager.latest_etl_result.get("backend")
                    if job_manager.latest_etl_result.get("method"):
                        doc_method = job_manager.latest_etl_result.get("method")
                    if job_manager.latest_etl_result.get("strategy"):
                        doc_strategy = job_manager.latest_etl_result.get("strategy")

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
                logger.error(f"Failed to auto-compute chunk stats for {stem}: {e}")

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

        norm_embedded = {normalize_text(n) for n in embedded_names}
        norm_stem = normalize_text(stem)
        norm_p_name = normalize_text(p.name)

        is_embedded = (norm_stem in norm_embedded) or (norm_p_name in norm_embedded)

        if not is_embedded:
            for ne in norm_embedded:
                if len(ne) >= 10 and (norm_stem.startswith(ne) or ne.startswith(norm_stem)):
                    is_embedded = True
                    break

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
                "is_current": (p.name == job_manager.current_selected_pdf_name),
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
        "current": job_manager.current_selected_pdf_name,
        "global_stats": global_stats,
        "qdrant_status": qdrant_status,
    }


@router.post("/select")
async def select_pdf(req: SelectPdfRequest):
    """활성 파싱 대상 PDF 변경"""
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
            req_norm = normalize_text(req.filename)
            matched = [p for p in DOCS_DIR.glob("*.pdf") if normalize_text(p.name) == req_norm]
            if matched:
                target = matched[0]
            else:
                raise HTTPException(status_code=404, detail="PDF file not found")
    job_manager.current_selected_pdf_name = target.name
    pages = get_pdf_page_count(target)
    return {"success": True, "current": target.name, "total_pages": pages}


@router.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """신규 PDF 파일 업로드 및 자동 활성화 (NFC 정규화 적용)"""
    clean_filename = unicodedata.normalize("NFC", file.filename)
    if not clean_filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    save_path = DOCS_DIR / clean_filename
    with open(save_path, "wb") as f:
        content = await file.read()
        f.write(content)

    job_manager.current_selected_pdf_name = clean_filename
    pages = get_pdf_page_count(save_path)
    return {
        "success": True,
        "filename": clean_filename,
        "total_pages": pages,
        "size_bytes": save_path.stat().st_size,
    }


@router.delete("/{filename}")
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


@router.get("")
async def get_pdf():
    """현재 활성화된 원본 PDF 파일 스트리밍 서빙"""
    pdf_path = job_manager.get_active_pdf_path()
    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(pdf_path, media_type="application/pdf")

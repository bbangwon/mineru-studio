import json
import logging
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from pydantic import BaseModel

from backend.app.common import (
    BASE_DIR,
    DOCS_DIR,
    _doc_stats_cache,
    find_latest_content_list,
    get_pdf_page_count,
    normalize_text,
)
from backend.app.routers.pdf import clean_document_artifacts
from backend.app.services.hierarchical_chunker import HierarchicalChunker
from backend.app.services.job_manager import job_manager
from backend.app.services.mineru_svc import MineruService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/etl", tags=["etl"])
mineru_svc = MineruService()


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
    preserve_newlines: Optional[bool] = True


class ResetRequest(BaseModel):
    strategy: Optional[str] = "general"
    preserve_newlines: Optional[bool] = True
    filename: Optional[str] = None


class MergedExportRequest(BaseModel):
    filenames: List[str]


@router.delete("/{filename}")
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


@router.get("/sample")
async def get_sample_etl(strategy: Optional[str] = "general", filename: Optional[str] = None):
    """기존 파싱 결과를 바탕으로 부모-자식 청크 & 표 원형 보존 ETL 결과 반환 (수정본 존재 시 우선 로드)"""
    target_doc = filename or job_manager.current_selected_pdf_name
    if not target_doc:
        raise HTTPException(status_code=400, detail="선택된 PDF 문서가 없습니다.")

    found = find_latest_content_list(target_doc)
    if not found:
        raise HTTPException(status_code=404, detail=f"문서 '{target_doc}'의 파싱 산출물이 없습니다.")

    file_path, content_list = found
    job_manager.latest_content_list_path = file_path

    raw_doc_name = Path(target_doc).stem if target_doc else file_path.parent.parent.name
    doc_name = unicodedata.normalize("NFC", raw_doc_name)
    target_doc_nfc = unicodedata.normalize("NFC", target_doc)

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
                healed = HierarchicalChunker.heal_composite_chunks(edited_data.get("child_chunks", []))
                if healed:
                    try:
                        with open(edited_path, "w", encoding="utf-8") as f_save:
                            json.dump(edited_data, f_save, ensure_ascii=False, indent=2)
                    except Exception as save_err:
                        logger.error(f"Failed to auto-save healed composite chunks: {save_err}")
                job_manager.latest_etl_result = edited_data
                return edited_data
        except Exception as e:
            logger.error(f"Failed to load edited chunks: {e}")

    chunker = HierarchicalChunker(doc_id=doc_name)
    etl_res = chunker.chunk_content_list(content_list, doc_title=doc_name, strategy=strategy or "general")
    etl_res["active_pdf"] = target_doc_nfc

    job_manager.latest_etl_result = etl_res
    return etl_res


@router.post("/reindex")
async def reindex_etl_endpoint(req: Optional[Dict[str, Any]] = None):
    """현재 편집 중인 ETL 결과의 모든 섹션(s01~)과 청크(c001~) ID를 일괄 재정렬"""
    etl_data = (req.get("etl_result") if req else None) or req or job_manager.latest_etl_result
    if not etl_data or "child_chunks" not in etl_data:
        raise HTTPException(status_code=400, detail="재정렬할 유효한 ETL 결과 데이터가 없습니다.")

    if not etl_data.get("active_pdf") and job_manager.current_selected_pdf_name:
        etl_data["active_pdf"] = job_manager.current_selected_pdf_name

    reindexed = HierarchicalChunker.reindex_etl_result(etl_data)
    job_manager.latest_etl_result = reindexed
    return reindexed


@router.post("/save")
async def save_etl_result(req: Dict[str, Any]):
    """사용자가 편집한 ETL 결과 전체를 백엔드에 영속 저장"""
    etl_data = req.get("etl_result", req)
    if not etl_data or "child_chunks" not in etl_data:
        raise HTTPException(status_code=400, detail="유효한 ETL 결과 데이터가 아닙니다.")

    target_doc = (
        etl_data.get("active_pdf")
        or etl_data.get("doc_title")
        or req.get("filename")
        or job_manager.current_selected_pdf_name
    )

    found = find_latest_content_list(target_doc) if target_doc else None
    if not found:
        if job_manager.latest_content_list_path and job_manager.latest_content_list_path.exists():
            target_content_list_path = job_manager.latest_content_list_path
        else:
            raise HTTPException(
                status_code=404,
                detail=f"저장할 대상 파싱 결과 디렉토리를 찾을 수 없습니다. (대상: {target_doc or '알 수 없음'})",
            )
    else:
        target_content_list_path = found[0]

    save_path = target_content_list_path.parent / "rag_chunks_edited.json"
    try:
        HierarchicalChunker.heal_composite_chunks(etl_data.get("child_chunks", []))
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(etl_data, f, ensure_ascii=False, indent=2)
        _doc_stats_cache.pop(str(save_path), None)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 실패: {str(e)}")

    if target_doc and job_manager.current_selected_pdf_name and normalize_text(job_manager.current_selected_pdf_name) == normalize_text(Path(target_doc).name):
        job_manager.latest_content_list_path = target_content_list_path
        job_manager.latest_etl_result = etl_data
    elif not job_manager.current_selected_pdf_name:
        job_manager.latest_content_list_path = target_content_list_path
        job_manager.latest_etl_result = etl_data

    total_chunks = len(etl_data.get("child_chunks", []))
    saved_time = time.time()

    return {
        "success": True,
        "message": "수정본이 성공적으로 저장되었습니다.",
        "saved_at": saved_time,
        "total_chunks": total_chunks,
    }


@router.post("/reset")
async def reset_etl_result(req: Optional[ResetRequest] = None):
    """수정본(rag_chunks_edited.json)을 제거하고 원본 파싱 결과로 리셋"""
    target_doc = (req.filename if req and req.filename else None) or job_manager.current_selected_pdf_name
    found = find_latest_content_list(target_doc) if target_doc else None
    if not found:
        if job_manager.latest_content_list_path and job_manager.latest_content_list_path.exists():
            target_content_list_path = job_manager.latest_content_list_path
        else:
            raise HTTPException(
                status_code=404,
                detail=f"원본 파싱 결과를 찾을 수 없습니다. (대상: {target_doc or '알 수 없음'})",
            )
    else:
        target_content_list_path = found[0]

    save_path = target_content_list_path.parent / "rag_chunks_edited.json"
    if save_path.exists():
        try:
            save_path.unlink()
            _doc_stats_cache.pop(str(save_path), None)
        except Exception as e:
            logger.error(f"수정본 파일 삭제 실패: {e}")

    try:
        with open(target_content_list_path, "r", encoding="utf-8") as f:
            content_list = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"원본 데이터 로드 실패: {str(e)}")

    strat = (req.strategy if req and req.strategy else None) or "general"
    preserve_newlines = True if (req and req.preserve_newlines is None) else (req.preserve_newlines if req else True)
    preferred_name = target_doc or job_manager.current_selected_pdf_name or target_content_list_path.parent.parent.name
    doc_name = unicodedata.normalize("NFC", Path(preferred_name).stem)
    chunker = HierarchicalChunker(doc_id=doc_name, preserve_newlines=preserve_newlines)
    etl_res = chunker.chunk_content_list(content_list, doc_title=doc_name, strategy=strat, preserve_newlines=preserve_newlines)
    etl_res["active_pdf"] = unicodedata.normalize("NFC", preferred_name)
    etl_res["preserve_newlines"] = preserve_newlines

    if target_doc and job_manager.current_selected_pdf_name and normalize_text(job_manager.current_selected_pdf_name) == normalize_text(Path(target_doc).name):
        job_manager.latest_content_list_path = target_content_list_path
        job_manager.latest_etl_result = etl_res
    elif not job_manager.current_selected_pdf_name:
        job_manager.latest_content_list_path = target_content_list_path
        job_manager.latest_etl_result = etl_res

    return etl_res


@router.post("/parse")
async def run_etl_parse(req: ParseRequest):
    """지정된 PDF(또는 활성 PDF)를 파싱하고 즉시 계층 청킹 파이프라인 수행"""
    pdf_path = None
    if req.filename:
        p1 = DOCS_DIR / req.filename
        pdf_path = p1 if p1.exists() else None

    if not pdf_path:
        pdf_path = job_manager.get_active_pdf_path()

    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Target PDF not found")

    job_manager.current_selected_pdf_name = pdf_path.name

    start_p = None if req.all_pages else req.start_page
    end_p = None if req.all_pages else req.end_page

    method = req.method or "auto"
    formula = True if req.formula is None else req.formula
    preserve_newlines = True if req.preserve_newlines is None else req.preserve_newlines
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
        job_manager.latest_content_list_path = Path(parse_res["content_list_path"])
    elif not content_list:
        found = find_latest_content_list(pdf_path.stem)
        if found:
            job_manager.latest_content_list_path = found[0]
            content_list = found[1]

    chunk_strat = req.strategy or "general"
    chunker = HierarchicalChunker(doc_id=pdf_path.stem, preserve_newlines=preserve_newlines)
    etl_res = chunker.chunk_content_list(content_list, doc_title=pdf_path.stem, strategy=chunk_strat, preserve_newlines=preserve_newlines)
    etl_res["elapsed_time"] = parse_res.get("elapsed_time", 0)
    etl_res["active_pdf"] = pdf_path.name
    etl_res["total_pages"] = get_pdf_page_count(pdf_path)
    etl_res["backend"] = req.backend or "pipeline"
    etl_res["method"] = method
    etl_res["strategy"] = chunk_strat
    etl_res["preserve_newlines"] = preserve_newlines

    job_manager.latest_etl_result = etl_res

    if job_manager.latest_content_list_path and job_manager.latest_content_list_path.exists():
        edited_save_path = job_manager.latest_content_list_path.parent / "rag_chunks_edited.json"
        try:
            with open(edited_save_path, "w", encoding="utf-8") as f:
                json.dump(etl_res, f, ensure_ascii=False, indent=2)
            _doc_stats_cache.pop(str(edited_save_path), None)
        except Exception as e:
            logger.error(f"Failed to auto-save rag_chunks_edited.json in run_etl_parse: {e}")

    return etl_res


@router.post("/parse-job")
async def start_etl_job(req: ParseRequest, background_tasks: BackgroundTasks):
    """비동기 백그라운드 태스크 등록: 즉시 task_id 반환"""
    pdf_path = None
    if req.filename:
        p1 = DOCS_DIR / req.filename
        pdf_path = p1 if p1.exists() else None

    if not pdf_path:
        pdf_path = job_manager.get_active_pdf_path()

    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Target PDF not found")

    job_manager.current_selected_pdf_name = pdf_path.name
    task_id = f"job_{uuid.uuid4().hex[:8]}"

    job_manager.jobs_db[task_id] = {
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

    background_tasks.add_task(job_manager.process_etl_job, task_id, req.model_dump(), str(pdf_path))
    return {
        "success": True,
        "task_id": task_id,
        "status": "pending",
        "message": "백그라운드 파싱 작업이 등록되었습니다."
    }


@router.get("/jobs/active")
async def get_active_job():
    """현재 진행 중인 가장 최근 백그라운드 작업 반환 (새로고침 시 폴링 복구용)"""
    for task_id, job in reversed(list(job_manager.jobs_db.items())):
        if job["status"] in ["pending", "running"]:
            job_copy = dict(job)
            job_copy["elapsed_time"] = round(time.time() - job["created_at"], 1)
            return job_copy
    return {"active": False}


@router.get("/jobs/{task_id}")
async def get_job_status(task_id: str):
    """특정 백그라운드 태스크의 진행 상태 및 완료 결과 조회"""
    job = job_manager.jobs_db.get(task_id)
    if not job:
        raise HTTPException(status_code=404, detail="Task not found")

    job_copy = dict(job)
    if job["status"] in ["pending", "running"]:
        job_copy["elapsed_time"] = round(time.time() - job["created_at"], 1)
    return job_copy


@router.get("/export/jsonl")
async def export_jsonl(filename: Optional[str] = None):
    """RAG 표준 JSONL 파일 다운로드 (특정 문서 지정 가능)"""
    target_data = None
    target_title = "rag_chunks"

    target_name = filename or job_manager.current_selected_pdf_name
    if target_name:
        stem = unicodedata.normalize("NFC", Path(target_name).stem)
        found = find_latest_content_list(stem)
        if found:
            file_path, content_list = found
            p_dir = file_path.parent
            edited_path = p_dir / "rag_chunks_edited.json"
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
        if job_manager.latest_etl_result:
            target_data = job_manager.latest_etl_result
        else:
            found = find_latest_content_list()
            if found:
                file_path, content_list = found
                preferred_title = job_manager.current_selected_pdf_name or file_path.parent.parent.name
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


@router.post("/export/jsonl/merged")
async def export_jsonl_merged(req: MergedExportRequest):
    """선택된 복수 파싱 문서의 청크들을 병합하여 단일 JSONL로 내보내기"""
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

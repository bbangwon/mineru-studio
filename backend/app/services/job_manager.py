import json
import logging
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from backend.app.common import (
    BASE_DIR,
    DOCS_DIR,
    _doc_stats_cache,
    find_latest_content_list,
    find_pdf_path,
    get_pdf_page_count,
    normalize_text,
)
from backend.app.services.hierarchical_chunker import HierarchicalChunker
from backend.app.services.mineru_svc import MineruService, normalize_mineru_tier

logger = logging.getLogger(__name__)


class JobManager:
    """백그라운드 ETL 작업 및 전역 세션 상태 관리자"""

    def __init__(self):
        self.mineru_svc = MineruService()
        self.latest_etl_result: Optional[dict] = None
        self.latest_content_list_path: Optional[Path] = None
        self.current_selected_pdf_name: Optional[str] = None
        self.jobs_db: Dict[str, Dict[str, Any]] = {}

    def get_active_pdf_path(self) -> Optional[Path]:
        if self.current_selected_pdf_name:
            p1 = find_pdf_path(self.current_selected_pdf_name)
            if p1 and p1.exists():
                return p1
        pdf_files = list(DOCS_DIR.rglob("*.pdf"))
        if pdf_files:
            self.current_selected_pdf_name = pdf_files[0].name
            return pdf_files[0]
        return None

    def create_job(self, task_id: str, filename: str) -> Dict[str, Any]:
        job_info = {
            "task_id": task_id,
            "filename": filename,
            "status": "pending",
            "progress_msg": "작업 큐에 등록되었습니다.",
            "elapsed_time": 0.0,
            "created_at": time.time(),
            "result": None,
            "error": None,
        }
        self.jobs_db[task_id] = job_info
        return job_info

    def get_job(self, task_id: str) -> Optional[Dict[str, Any]]:
        return self.jobs_db.get(task_id)

    def get_active_job(self) -> Optional[Dict[str, Any]]:
        for job in self.jobs_db.values():
            if job.get("status") in ("pending", "running"):
                return job
        return None

    def _chunk_and_persist(
        self,
        pdf_path: Path,
        content_list: list,
        target_content_list_path: Optional[Path],
        backend: str,
        method: str,
        strategy: str,
        preserve_newlines: bool,
        elapsed_time: float,
    ) -> Dict[str, Any]:
        """content_list를 계층 청킹하고 rag_chunks_edited.json 및 활성 상태를 갱신합니다."""
        stem_nfc = unicodedata.normalize("NFC", pdf_path.stem)
        pdf_name_nfc = unicodedata.normalize("NFC", pdf_path.name)
        chunker = HierarchicalChunker(doc_id=stem_nfc, preserve_newlines=preserve_newlines)
        etl_res = chunker.chunk_content_list(
            content_list, doc_title=stem_nfc, strategy=strategy, preserve_newlines=preserve_newlines
        )
        etl_res["elapsed_time"] = elapsed_time
        etl_res["active_pdf"] = pdf_name_nfc
        etl_res["total_pages"] = get_pdf_page_count(pdf_path)
        etl_res["backend"] = backend
        etl_res["method"] = method
        etl_res["strategy"] = strategy
        etl_res["preserve_newlines"] = preserve_newlines

        if target_content_list_path and target_content_list_path.exists():
            edited_save_path = target_content_list_path.parent / "rag_chunks_edited.json"
            try:
                with open(edited_save_path, "w", encoding="utf-8") as f:
                    json.dump(etl_res, f, ensure_ascii=False, indent=2)
                _doc_stats_cache.pop(str(edited_save_path), None)
            except Exception as e:
                logger.error(f"Failed to auto-save rag_chunks_edited.json: {e}")

        if (
            self.current_selected_pdf_name is None
            or normalize_text(self.current_selected_pdf_name) == normalize_text(pdf_name_nfc)
        ):
            self.latest_etl_result = etl_res
            self.current_selected_pdf_name = pdf_name_nfc
            if target_content_list_path:
                self.latest_content_list_path = target_content_list_path

        return etl_res

    def process_etl_job(self, task_id: str, req_data: dict, pdf_path_str: str):
        """백그라운드에서 실행되는 MinerU 파싱(전체/분할/병합) 및 계층 청킹 워커"""
        pdf_path = Path(pdf_path_str)
        job = self.jobs_db.get(task_id)
        if not job:
            return

        mode = (req_data.get("mode") or "full").strip().lower()
        job["status"] = "running"
        job["mode"] = mode
        start_time = time.time()

        all_pages = req_data.get("all_pages", False)
        start_p = None if all_pages else req_data.get("start_page", 0)
        end_p = None if all_pages else req_data.get("end_page", 2)
        method = req_data.get("method") or "auto"
        formula = True if req_data.get("formula") is None else req_data.get("formula")
        backend = normalize_mineru_tier(req_data.get("backend"))
        lang = req_data.get("lang") or "korean"
        strategy = req_data.get("strategy") or "general"
        preserve_newlines = True if req_data.get("preserve_newlines") is None else req_data.get("preserve_newlines")

        output_dir = BASE_DIR / "output" / f"mineru_{backend}_{method}_{lang}"
        pdf_name_nfc = unicodedata.normalize("NFC", pdf_path.name)
        stem_nfc = unicodedata.normalize("NFC", pdf_path.stem)

        try:
            if mode == "part":
                p_range_label = "전체" if all_pages else f"{start_p}~{end_p}p"
                job["progress_msg"] = f"MinerU 분할 파싱 중 ({p_range_label})..."
                total_pages = get_pdf_page_count(pdf_path)
                parse_res = self.mineru_svc.parse_pdf_part(
                    pdf_path=pdf_path,
                    output_dir=output_dir,
                    start_page=start_p,
                    end_page=end_p,
                    lang=lang,
                    backend=backend,
                    method=method,
                    formula=formula,
                    total_pages=total_pages,
                )
                if not parse_res.get("success"):
                    job["status"] = "failed"
                    job["error"] = parse_res.get("error", "MinerU part parse failed")
                    job["elapsed_time"] = round(time.time() - start_time, 1)
                    return

                job["status"] = "completed"
                job["progress_msg"] = f"분할 파싱 완료 ({p_range_label})"
                job["backend"] = backend
                job["method"] = method
                job["strategy"] = strategy
                job["result"] = {
                    "mode": "part",
                    "active_pdf": pdf_name_nfc,
                    "batch_pages": parse_res.get("batch_pages", []),
                    "parts_status": parse_res.get("parts_status"),
                    "elapsed_time": parse_res.get("elapsed_time", round(time.time() - start_time, 1)),
                }
                job["elapsed_time"] = round(time.time() - start_time, 1)
                return

            if mode == "merge_chunk":
                job["progress_msg"] = "분할 파싱 결과 병합 및 렌더링 중..."
                total_pages = get_pdf_page_count(pdf_path)
                merge_res = self.mineru_svc.merge_pdf_parts(
                    output_dir=output_dir,
                    pdf_name=stem_nfc,
                    ocr_mode=method,
                    total_pages=total_pages,
                )
                if not merge_res.get("success"):
                    job["status"] = "failed"
                    job["error"] = merge_res.get("error", "Merge failed")
                    job["elapsed_time"] = round(time.time() - start_time, 1)
                    return

                job["progress_msg"] = "병합된 문서 계층 청킹 중..."
                content_list = merge_res.get("content_list", [])
                target_content_list_path = Path(merge_res["content_list_path"])
                etl_res = self._chunk_and_persist(
                    pdf_path=pdf_path,
                    content_list=content_list,
                    target_content_list_path=target_content_list_path,
                    backend=backend,
                    method=method,
                    strategy=strategy,
                    preserve_newlines=preserve_newlines,
                    elapsed_time=round(time.time() - start_time, 2),
                )
                etl_res["merged_pages"] = merge_res.get("merged_pages")
                job["status"] = "completed"
                job["progress_msg"] = "병합 및 청킹 완료"
                job["backend"] = backend
                job["method"] = method
                job["strategy"] = strategy
                job["result"] = etl_res
                job["elapsed_time"] = round(time.time() - start_time, 1)
                return

            # Default: mode == "full"
            job["progress_msg"] = "MinerU 파이프라인 엔진으로 PDF 파싱 중..."
            parse_res = self.mineru_svc.parse_pdf(
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
            target_content_list_path = None
            if parse_res.get("content_list_path"):
                target_content_list_path = Path(parse_res["content_list_path"])
            elif not content_list:
                found = find_latest_content_list(pdf_path.stem)
                if found:
                    target_content_list_path = found[0]
                    content_list = found[1]

            etl_res = self._chunk_and_persist(
                pdf_path=pdf_path,
                content_list=content_list,
                target_content_list_path=target_content_list_path,
                backend=backend,
                method=method,
                strategy=strategy,
                preserve_newlines=preserve_newlines,
                elapsed_time=parse_res.get("elapsed_time", round(time.time() - start_time, 1)),
            )

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


job_manager = JobManager()

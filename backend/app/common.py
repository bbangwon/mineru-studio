import json
import logging
import os
import re
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pypdf

from backend.app.services.embedding_svc import embedding_svc
from backend.app.services.qdrant_config_svc import get_qdrant_config

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
TEMPLATES_DIR = BASE_DIR / "backend" / "app" / "templates"
FRONTEND_DIST_DIR = BASE_DIR / "frontend" / "dist"
DOCS_DIR = BASE_DIR / "pdfs"
OUTPUT_DIR = BASE_DIR / "output"


def normalize_text(text: Optional[str]) -> str:
    """macOS APFS(NFD)와 일반 유니코드(NFC) 간 한글 자모 분리 불일치 해결"""
    return unicodedata.normalize("NFC", text) if text else ""


def get_pdf_page_count(path: Path) -> int:
    try:
        reader = pypdf.PdfReader(str(path))
        return len(reader.pages)
    except Exception:
        return 1


def find_latest_content_list(preferred_doc_name: Optional[str] = None) -> Optional[Tuple[Path, list]]:
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

    if preferred_doc_name:
        target_stem = normalize_text(Path(preferred_doc_name).stem)
        matched = []
        for mtime, p in candidates:
            norm_parts = [normalize_text(part) for part in p.parts]
            norm_filename = normalize_text(p.name)
            is_matched = (
                target_stem in norm_parts
                or norm_filename.startswith(f"{target_stem}_content_list")
            )
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


def extract_pipeline_meta_from_path(file_path: Path) -> Tuple[Optional[str], Optional[str]]:
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


_doc_stats_cache: Dict[str, Tuple[float, dict, Optional[str], Optional[str], Optional[str]]] = {}
_qdrant_cache_time: float = 0
_qdrant_cached_names: set[str] = set()
_qdrant_cached_status: Dict[str, Any] = {"connected": True, "error": None}


def get_embedded_doc_status(ttl_seconds: float = 4.0, force_refresh: bool = False) -> Tuple[set[str], Dict[str, Any]]:
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

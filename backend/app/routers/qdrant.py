import logging
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from backend.app.common import (
    _qdrant_cache_time,
    find_latest_content_list,
    get_embedded_doc_status,
)
from backend.app.services.embedding_svc import (
    embedding_svc,
    load_indexed_docs_manifest,
)
from backend.app.services.hierarchical_chunker import HierarchicalChunker
from backend.app.services.job_manager import job_manager
from backend.app.services.qdrant_config_svc import (
    get_qdrant_config,
    save_qdrant_config,
)
from rag_embed_core.config import QdrantConfig

logger = logging.getLogger(__name__)

router = APIRouter(tags=["qdrant"])


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


embed_job_state: Dict[str, Any] = {
    "status": "idle",
    "progress_msg": "대기 중",
    "progress_pct": 0,
    "last_result": None,
    "error": None,
    "elapsed_time": 0,
}


@router.get("/api/qdrant/config")
async def api_get_qdrant_config():
    """현재 Qdrant 설정 조회"""
    cfg = get_qdrant_config()
    return cfg.model_dump()


@router.post("/api/qdrant/config")
async def api_save_qdrant_config(req: QdrantConfig):
    """Qdrant 설정 업데이트 및 저장"""
    import backend.app.common as common
    common._qdrant_cache_time = 0
    saved = save_qdrant_config(req)
    return {"success": True, "config": saved.model_dump()}


@router.post("/api/qdrant/sync")
async def api_sync_qdrant_manifest():
    """Qdrant 실시간 적재 상태를 로컬 매니페스트와 강제 양방향 동기화"""
    import backend.app.common as common
    common._qdrant_cache_time = 0
    names, status_info = get_embedded_doc_status(ttl_seconds=0.0, force_refresh=True)
    manifest = load_indexed_docs_manifest()
    return {
        "success": status_info.get("connected", False),
        "status": status_info,
        "manifest": manifest,
        "indexed_doc_count": len(manifest.get("documents", {})),
    }


@router.post("/api/qdrant/test-connection")
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


@router.get("/api/qdrant/collections")
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
        import backend.app.common as common
        common._qdrant_cache_time = 0
    except Exception as e:
        embed_job_state["status"] = "error"
        embed_job_state["error"] = str(e)
        embed_job_state["progress_msg"] = f"임베딩 오류: {e}"
        embed_job_state["elapsed_time"] = round(time.time() - start_t, 1)


@router.post("/api/etl/embed")
async def api_embed_chunks(req: EmbedRequest, background_tasks: BackgroundTasks):
    """현재 ETL 청크를 Dense & Sparse로 인코딩하여 Qdrant에 비동기 인덱싱"""
    chunks_to_embed = req.chunks
    parent_chunks_to_embed = req.parent_chunks

    if not chunks_to_embed:
        if job_manager.latest_etl_result and "child_chunks" in job_manager.latest_etl_result:
            chunks_to_embed = job_manager.latest_etl_result["child_chunks"]
            if not parent_chunks_to_embed and "parent_chunks" in job_manager.latest_etl_result:
                parent_chunks_to_embed = job_manager.latest_etl_result.get("parent_chunks", [])
        else:
            found = find_latest_content_list()
            if found:
                file_path, content_list = found
                preferred_title = job_manager.current_selected_pdf_name or file_path.parent.parent.name
                doc_title = unicodedata.normalize("NFC", Path(preferred_title).stem)
                chunker = HierarchicalChunker(doc_id=HierarchicalChunker.generate_doc_id(doc_title))
                job_manager.latest_etl_result = chunker.chunk_content_list(
                    content_list, doc_title=doc_title
                )
                chunks_to_embed = job_manager.latest_etl_result.get("child_chunks", [])
                parent_chunks_to_embed = job_manager.latest_etl_result.get("parent_chunks", [])
    elif not parent_chunks_to_embed and job_manager.latest_etl_result and "parent_chunks" in job_manager.latest_etl_result:
        parent_chunks_to_embed = job_manager.latest_etl_result.get("parent_chunks", [])

    if not chunks_to_embed:
        raise HTTPException(
            status_code=400,
            detail="인덱싱할 청크 데이터가 존재하지 않습니다. 먼저 파싱/청킹을 수행해주세요.",
        )

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


@router.get("/api/etl/embed/status")
async def api_embed_status():
    """임베딩 및 Qdrant 적재 진행 상태 조회"""
    return embed_job_state


@router.post("/api/etl/search/test")
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

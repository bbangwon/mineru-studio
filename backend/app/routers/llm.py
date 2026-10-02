import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.app.services.llm_config_svc import (
    LLMConfig,
    get_default_system_prompt,
    get_llm_config,
    save_llm_config,
)
from backend.app.services.llm_refine_svc import llm_refine_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/llm", tags=["llm"])


class LLMTestRequest(BaseModel):
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    api_key: Optional[str] = None
    timeout: Optional[int] = None


class RefineChunkRequest(BaseModel):
    text: str
    custom_prompt: Optional[str] = None


@router.get("/config")
async def api_get_llm_config():
    """현재 저장된 LLM 설정 조회"""
    return get_llm_config()


@router.post("/config")
async def api_save_llm_config(config: LLMConfig):
    """LLM 설정 저장 및 영속화"""
    try:
        saved = save_llm_config(config)
        return {"success": True, "config": saved}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM 설정 저장 실패: {str(e)}")


@router.get("/config/default-prompt")
async def api_get_default_prompt():
    """기본 시스템 프롬프트 텍스트 조회"""
    return {"default_prompt": get_default_system_prompt()}


@router.get("/models")
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


@router.post("/test")
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


@router.post("/refine-chunk")
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


class RAGStreamRequest(BaseModel):
    query: str
    collection_name: Optional[str] = None
    limit: Optional[int] = 5
    use_parent_context: Optional[bool] = True
    system_prompt: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None


@router.get("/rag-query/default-prompt")
async def api_get_default_rag_prompt():
    """RAG 기본 시스템 프롬프트 조회"""
    from backend.app.services.llm_refine_svc import get_default_rag_prompt
    return {"default_prompt": get_default_rag_prompt()}


@router.post("/rag-query/stream")
async def api_stream_rag_query(req: RAGStreamRequest):
    """자연어 질문에 대한 하이브리드 검색 후 LLM 스트리밍 답변 생성 (SSE)"""
    import json
    import time
    from fastapi.responses import StreamingResponse

    from backend.app.services.embedding_svc import embedding_svc
    from backend.app.services.qdrant_config_svc import get_qdrant_config

    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="질문(Query)이 비어 있습니다.")

    qdrant_cfg = get_qdrant_config()
    target_col = req.collection_name or qdrant_cfg.collection_name
    llm_cfg = get_llm_config()

    # 1. 하이브리드 검색 실행 및 지연시간 측정
    search_t0 = time.perf_counter()
    try:
        retrieved_chunks = embedding_svc.hybrid_search(
            query=req.query,
            limit=req.limit or 5,
            config=qdrant_cfg,
            collection_name=target_col,
        )
    except Exception as search_err:
        logger.warning(f"RAG 하이브리드 검색 실패: {search_err}")
        retrieved_chunks = []

    search_elapsed = round(time.perf_counter() - search_t0, 3)

    async def sse_generator():
        use_parent = True if req.use_parent_context is None else req.use_parent_context
        used_context = llm_refine_svc.build_rag_context(
            retrieved_chunks,
            use_parent_context=use_parent,
        )

        # 1. 검색 메타데이터 및 청크 목록 전송
        start_payload = {
            "event": "start",
            "collection_name": target_col,
            "search_elapsed_seconds": search_elapsed,
            "retrieved_chunks": retrieved_chunks,
            "used_context": used_context,
            "model_name": llm_cfg.model_name,
        }
        yield f"event: start\ndata: {json.dumps(start_payload, ensure_ascii=False)}\n\n"

        # 2. LLM 스트리밍 토큰 생성
        llm_t0 = time.perf_counter()
        try:
            async for token in llm_refine_svc.stream_rag_answer(
                query=req.query,
                retrieved_chunks=retrieved_chunks,
                use_parent_context=use_parent,
                custom_system_prompt=req.system_prompt,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            ):
                token_payload = {"event": "token", "token": token}
                yield f"event: token\ndata: {json.dumps(token_payload, ensure_ascii=False)}\n\n"

            llm_elapsed = round(time.perf_counter() - llm_t0, 3)
            total_elapsed = round(search_elapsed + llm_elapsed, 3)
            done_payload = {
                "event": "done",
                "llm_elapsed_seconds": llm_elapsed,
                "total_elapsed_seconds": total_elapsed,
            }
            yield f"event: done\ndata: {json.dumps(done_payload, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"RAG LLM 스트리밍 실패: {e}")
            err_payload = {"event": "error", "message": str(e)}
            yield f"event: error\ndata: {json.dumps(err_payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

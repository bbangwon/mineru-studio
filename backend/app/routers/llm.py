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

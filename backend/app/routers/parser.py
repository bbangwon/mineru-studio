import logging

from fastapi import APIRouter, HTTPException

from backend.app.services.parser_config_svc import (
    ParserConfig,
    get_parser_config,
    reset_parser_config,
    save_parser_config,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/parser", tags=["parser"])


@router.get("/config")
async def api_get_parser_config():
    """현재 저장된 기본 파서 설정 조회"""
    return get_parser_config()


@router.post("/config")
async def api_save_parser_config(config: ParserConfig):
    """기본 파서 설정 저장 및 영속화"""
    try:
        saved = save_parser_config(config)
        return {"success": True, "config": saved}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파서 설정 저장 실패: {str(e)}")


@router.post("/config/reset")
async def api_reset_parser_config():
    """기본 파서 설정을 초기 기본값으로 리셋"""
    try:
        reset_config = reset_parser_config()
        return {"success": True, "config": reset_config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파서 설정 리셋 실패: {str(e)}")

import logging
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.app.common import DOCS_DIR, _doc_stats_cache
from backend.app.services.backup_svc import backup_svc
from backend.app.services.job_manager import job_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backup", tags=["backup"])


class CreateBackupRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = ""
    backup_type: Optional[str] = "workspace"
    target_doc: Optional[str] = None
    include_vector_db: Optional[bool] = False


class RestoreBackupRequest(BaseModel):
    create_safety_backup: Optional[bool] = True


@router.get("/list")
async def api_list_backups():
    """보유 중인 모든 백업 아카이브 목록 조회 (최신순)"""
    try:
        backups = backup_svc.list_backups()
        return {"success": True, "backups": backups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 목록 조회 실패: {str(e)}")


@router.post("/create")
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


@router.get("/{backup_id}")
async def api_get_backup(backup_id: str):
    """특정 백업의 메타데이터 조회"""
    data = backup_svc.get_backup(backup_id)
    if not data:
        raise HTTPException(status_code=404, detail="해당 백업을 찾을 수 없습니다.")
    return {"success": True, "manifest": data}


@router.post("/{backup_id}/restore")
async def api_restore_backup(backup_id: str, req: Optional[RestoreBackupRequest] = None):
    """선택한 백업으로부터 작업공간 또는 문서 원복(복원)"""
    create_safety = True if req is None else bool(req.create_safety_backup)

    try:
        res = backup_svc.restore_backup(backup_id=backup_id, create_safety_backup=create_safety)
        # Reset in-memory cache
        job_manager.latest_etl_result = None
        job_manager.latest_content_list_path = None
        _doc_stats_cache.clear()

        # Update or verify active PDF
        pdf_files = list(DOCS_DIR.glob("*.pdf"))
        if pdf_files:
            if not job_manager.current_selected_pdf_name or not any(p.name == job_manager.current_selected_pdf_name for p in pdf_files):
                job_manager.current_selected_pdf_name = pdf_files[0].name
        else:
            job_manager.current_selected_pdf_name = None

        return {"success": True, "result": res, "message": res.get("message", "원복이 완료되었습니다.")}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 복원 중 오류 발생: {str(e)}")


@router.get("/{backup_id}/download")
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


@router.post("/upload")
async def api_upload_backup(file: UploadFile = File(...), restore_immediately: bool = False):
    """외부 백업 ZIP 파일을 업로드하여 등록하고, 필요 시 즉시 원복"""
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
            job_manager.latest_etl_result = None
            job_manager.latest_content_list_path = None
            _doc_stats_cache.clear()
            pdf_files = list(DOCS_DIR.glob("*.pdf"))
            if pdf_files:
                job_manager.current_selected_pdf_name = pdf_files[0].name

        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 파일 가져오기 실패: {str(e)}")


@router.delete("/{backup_id}")
async def api_delete_backup(backup_id: str):
    """지정된 백업 파일 삭제"""
    success = backup_svc.delete_backup(backup_id)
    if not success:
        raise HTTPException(status_code=404, detail="삭제할 백업 파일을 찾을 수 없거나 실패했습니다.")
    return {"success": True, "message": "백업이 성공적으로 삭제되었습니다."}

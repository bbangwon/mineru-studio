import logging
import os
import shutil
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.common import DOCS_DIR, find_pdf_path, normalize_text
from backend.app.services.job_manager import job_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pdf/folders", tags=["folders"])


class CreateFolderRequest(BaseModel):
    folder_path: str = Field(..., description="생성할 폴더 상대 경로 (예: '산업재해/법령')")


class DeleteFolderRequest(BaseModel):
    folder_path: str = Field(..., description="삭제할 폴더 상대 경로")
    evacuate_to: Optional[str] = Field(
        "", description="내부 문서 대피 대상 폴더 (기본: 루트 '')"
    )


class MoveFilesRequest(BaseModel):
    filenames: List[str] = Field(..., description="이동할 파일 목록 (relative_path 또는 filename)")
    target_folder: str = Field(..., description="목적지 폴더 상대 경로 (루트는 '')")


def _sanitize_folder_path(folder_path: str) -> Path:
    """Path traversal 방지 및 DOCS_DIR 하위 검증"""
    norm = normalize_text(folder_path).strip().strip("/")
    if not norm:
        return DOCS_DIR
    target = (DOCS_DIR / norm).resolve()
    docs_resolved = DOCS_DIR.resolve()
    if not (target == docs_resolved or str(target).startswith(str(docs_resolved) + os.sep)):
        raise HTTPException(status_code=400, detail="유효하지 않은 경로입니다 (경로 탈출 시도 감지).")
    return target


def _build_folder_tree(root_dir: Path) -> Dict[str, Any]:
    """DOCS_DIR 하위의 모든 서브폴더와 문서를 스캔하여 중첩 트리 구축"""
    root_dir.mkdir(parents=True, exist_ok=True)
    all_pdfs = list(root_dir.rglob("*.pdf"))

    # 폴더별 직속 pdf 개수 맵
    folder_doc_counts: Dict[str, int] = {}
    # 발견된 모든 서브폴더 상대 경로 집합
    all_folder_paths: set[str] = set()

    for p in root_dir.rglob("*"):
        if p.is_dir():
            try:
                rel = str(p.relative_to(root_dir))
                if rel and rel != ".":
                    all_folder_paths.add(normalize_text(rel))
            except ValueError:
                pass

    for pdf in all_pdfs:
        try:
            rel_parent = str(pdf.parent.relative_to(root_dir))
            norm_parent = "" if rel_parent == "." else normalize_text(rel_parent)
            folder_doc_counts[norm_parent] = folder_doc_counts.get(norm_parent, 0) + 1
            if norm_parent:
                all_folder_paths.add(norm_parent)
        except ValueError:
            pass

    # 계층 트리 딕셔너리 구조 구성
    tree_dict: Dict[str, Any] = {}

    def ensure_node(path_str: str) -> Dict[str, Any]:
        parts = [p for p in path_str.split("/") if p]
        curr = tree_dict
        curr_path = ""
        for i, part in enumerate(parts):
            curr_path = f"{curr_path}/{part}" if curr_path else part
            if part not in curr:
                curr[part] = {
                    "name": part,
                    "path": curr_path,
                    "depth": i + 1,
                    "children": {},
                    "doc_count": 0,
                    "total_doc_count": 0,
                }
            curr = curr[part]["children"]

    for fpath in sorted(all_folder_paths):
        ensure_node(fpath)

    # 누적 total_doc_count 계산 함수
    def convert_node(name: str, node: Dict[str, Any]) -> Dict[str, Any]:
        sub_list = []
        child_total = 0
        for child_name, child_data in sorted(node["children"].items(), key=lambda x: x[0]):
            converted = convert_node(child_name, child_data)
            sub_list.append(converted)
            child_total += converted["total_doc_count"]

        direct_count = folder_doc_counts.get(node["path"], 0)
        return {
            "name": node["name"],
            "path": node["path"],
            "depth": node["depth"],
            "doc_count": direct_count,
            "total_doc_count": direct_count + child_total,
            "subfolders": sub_list,
        }

    top_level_subfolders = []
    top_total = 0
    for top_name, top_data in sorted(tree_dict.items(), key=lambda x: x[0]):
        converted = convert_node(top_name, top_data)
        top_level_subfolders.append(converted)
        top_total += converted["total_doc_count"]

    root_direct_count = folder_doc_counts.get("", 0)
    root_total = root_direct_count + top_total

    return {
        "root": {
            "name": "문서",
            "path": "",
            "depth": 0,
            "doc_count": root_direct_count,
            "total_doc_count": root_total,
            "subfolders": top_level_subfolders,
        },
        "total_documents": len(all_pdfs),
    }


@router.get("")
async def get_folder_tree():
    """DOCS_DIR 하위 전체 폴더 계층 트리와 문서 수 반환 (루트는 '문서')"""
    return _build_folder_tree(DOCS_DIR)


@router.post("")
async def create_folder(req: CreateFolderRequest):
    """신규 서브폴더 생성 (N-depth 지원, parents 자동 생성)"""
    target = _sanitize_folder_path(req.folder_path)
    if target == DOCS_DIR:
        raise HTTPException(status_code=400, detail="루트 '문서' 폴더는 이미 존재합니다.")

    if target.exists() and target.is_dir():
        return {
            "success": True,
            "message": f"폴더 '{req.folder_path}'가 이미 존재합니다.",
            "path": normalize_text(str(target.relative_to(DOCS_DIR))),
        }

    try:
        target.mkdir(parents=True, exist_ok=True)
        return {
            "success": True,
            "message": f"폴더 '{req.folder_path}'가 성공적으로 생성되었습니다.",
            "path": normalize_text(str(target.relative_to(DOCS_DIR))),
        }
    except Exception as e:
        logger.error(f"폴더 생성 실패: {e}")
        raise HTTPException(status_code=500, detail=f"폴더 생성 실패: {str(e)}")


@router.delete("")
@router.delete("/{folder_path:path}")
async def delete_folder(
    folder_path: Optional[str] = None,
    req: Optional[DeleteFolderRequest] = None,
    evacuate_to: Optional[str] = "",
):
    """서브폴더 삭제 (내부 문서가 있을 경우 evacuate_to 폴더로 자동 대피 후 삭제)"""
    target_path_str = (req.folder_path if req else None) or folder_path
    if not target_path_str:
        raise HTTPException(status_code=400, detail="삭제할 폴더 경로가 제공되지 않았습니다.")

    evac_str = (req.evacuate_to if req else None) or evacuate_to or ""

    target = _sanitize_folder_path(target_path_str)
    if target == DOCS_DIR:
        raise HTTPException(status_code=400, detail="최상위 루트 '문서'는 삭제할 수 없습니다.")

    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=404, detail="삭제할 폴더가 존재하지 않습니다.")

    evacuate_target = _sanitize_folder_path(evac_str)
    evacuate_target.mkdir(parents=True, exist_ok=True)

    # 폴더 내 및 하위 서브폴더 내의 모든 pdf 문서 대피
    evacuated_files = []
    for pdf_file in list(target.rglob("*.pdf")):
        dest = evacuate_target / pdf_file.name
        # 이름 충돌 시 회피
        if dest.exists() and dest != pdf_file:
            stem = pdf_file.stem
            dest = evacuate_target / f"{stem}_{int(dest.stat().st_mtime)}.pdf"
        shutil.move(str(pdf_file), str(dest))
        evacuated_files.append(pdf_file.name)

    try:
        shutil.rmtree(target)
        return {
            "success": True,
            "message": f"폴더 '{target_path_str}'가 삭제되었습니다.",
            "evacuated_count": len(evacuated_files),
            "evacuated_files": evacuated_files,
        }
    except Exception as e:
        logger.error(f"폴더 삭제 실패: {e}")
        raise HTTPException(status_code=500, detail=f"폴더 삭제 실패: {str(e)}")


@router.post("/move")
async def move_files(req: MoveFilesRequest):
    """단일 또는 복수 문서 파일 이동 (폴더 넣기/빼기 드래그 앤 드롭 지원)"""
    if not req.filenames:
        raise HTTPException(status_code=400, detail="이동할 파일 목록이 비어있습니다.")

    target_dir = _sanitize_folder_path(req.target_folder)
    target_dir.mkdir(parents=True, exist_ok=True)

    moved = []
    errors = []

    for item_name in req.filenames:
        src = find_pdf_path(item_name)
        if not src or not src.exists():
            errors.append(f"{item_name}: 파일을 찾을 수 없습니다.")
            continue

        dest = target_dir / src.name
        if src.resolve() == dest.resolve():
            # 이미 동일한 위치
            continue

        try:
            shutil.move(str(src), str(dest))
            moved.append({
                "filename": src.name,
                "from": normalize_text(str(src.parent.relative_to(DOCS_DIR))) if src.parent != DOCS_DIR else "",
                "to": normalize_text(str(target_dir.relative_to(DOCS_DIR))) if target_dir != DOCS_DIR else "",
                "relative_path": normalize_text(str(dest.relative_to(DOCS_DIR))),
            })
        except Exception as e:
            logger.error(f"파일 이동 실패 ({src} -> {dest}): {e}")
            errors.append(f"{src.name}: 이동 실패 ({str(e)})")

    return {
        "success": len(errors) == 0,
        "moved_count": len(moved),
        "moved": moved,
        "errors": errors,
    }

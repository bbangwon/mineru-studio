import io
import json
import logging
import os
import shutil
import time
import unicodedata
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
DOCS_DIR = BASE_DIR / "pdfs"
OUTPUT_DIR = BASE_DIR / "output"
BACKUPS_DIR = BASE_DIR / "backups"

BACKUP_VERSION = "1.0.0"


class BackupService:
    def __init__(self, base_dir: Path = BASE_DIR, backups_dir: Path = BACKUPS_DIR):
        self.base_dir = base_dir
        self.docs_dir = base_dir / "pdfs"
        self.output_dir = base_dir / "output"
        self.backups_dir = backups_dir
        self.backups_dir.mkdir(parents=True, exist_ok=True)

    def _normalize_name(self, name: str) -> str:
        return unicodedata.normalize("NFC", name)

    def _collect_workspace_stats(self, target_doc: Optional[str] = None) -> Dict[str, Any]:
        """현재 작업공간 또는 대상 문서의 요약 통계 수집"""
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        pdf_files = list(self.docs_dir.glob("*.pdf"))
        if target_doc:
            target_norm = self._normalize_name(target_doc)
            pdf_files = [p for p in pdf_files if self._normalize_name(p.name) == target_norm]

        pdf_names = [self._normalize_name(p.name) for p in pdf_files]

        edited_docs_count = 0
        total_chunks = 0

        # Scan edited chunks in output directory
        for edited_file in self.output_dir.glob("**/rag_chunks_edited.json"):
            if target_doc:
                # Check if this edited file belongs to target_doc
                stem = self._normalize_name(Path(target_doc).stem)
                path_str = self._normalize_name(str(edited_file))
                if stem not in path_str:
                    continue

            edited_docs_count += 1
            try:
                with open(edited_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    total_chunks += len(data.get("child_chunks", []))
            except Exception as e:
                logger.warning(f"청크 통계 집계 실패 ({edited_file}): {e}")

        has_configs = any(
            (self.output_dir / cfg).exists()
            for cfg in ["llm_config.json", "parser_config.json", "qdrant_config.json"]
        )

        return {
            "pdf_count": len(pdf_files),
            "pdf_names": pdf_names,
            "edited_docs_count": edited_docs_count,
            "total_chunks": total_chunks,
            "has_configs": has_configs,
        }

    def create_backup(
        self,
        name: Optional[str] = None,
        description: Optional[str] = "",
        backup_type: str = "workspace",
        target_doc: Optional[str] = None,
        include_vector_db: bool = False,
        is_safety_backup: bool = False,
    ) -> Dict[str, Any]:
        """
        작업공간 또는 단일 문서에 대한 백업 ZIP 아카이브 생성
        """
        self.backups_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.now()
        timestamp = time.time()
        time_str = now.strftime("%Y%m%d_%H%M%S")
        rand_suffix = uuid.uuid4().hex[:6]

        prefix = "safety" if is_safety_backup else ("doc" if backup_type == "document" else "workspace")
        backup_id = f"{prefix}_{time_str}_{rand_suffix}"
        zip_filename = f"{backup_id}.zip"
        zip_path = self.backups_dir / zip_filename

        if not name:
            if is_safety_backup:
                name = f"원복 전 자동 안전 백업 ({now.strftime('%Y-%m-%d %H:%M:%S')})"
            elif backup_type == "document" and target_doc:
                name = f"문서 백업: {Path(target_doc).stem} ({now.strftime('%Y-%m-%d %H:%M:%S')})"
            else:
                name = f"작업공간 전체 백업 ({now.strftime('%Y-%m-%d %H:%M:%S')})"

        stats = self._collect_workspace_stats(target_doc=target_doc if backup_type == "document" else None)
        stats["includes_vector_db"] = include_vector_db

        manifest = {
            "version": BACKUP_VERSION,
            "backup_id": backup_id,
            "filename": zip_filename,
            "name": name,
            "description": description or "",
            "backup_type": backup_type,
            "target_doc": target_doc,
            "created_at": now.isoformat(),
            "timestamp": timestamp,
            "is_safety_backup": is_safety_backup,
            "includes_vector_db": include_vector_db,
            "stats": stats,
        }

        # Ignore patterns for zip creation
        ignore_names = {".DS_Store", "__pycache__", "desktop.ini", "Thumbs.db"}

        def should_include(rel_path: Path) -> bool:
            # Check ignored filenames
            for part in rel_path.parts:
                if part in ignore_names or part.endswith(".tmp"):
                    return False
            # Check vector db inclusion
            if not include_vector_db:
                if "qdrant_db" in rel_path.parts or "test_qdrant_db" in rel_path.parts:
                    return False
            # Check target document filtering if single document backup
            if backup_type == "document" and target_doc:
                target_stem = self._normalize_name(Path(target_doc).stem)
                target_filename = self._normalize_name(Path(target_doc).name)
                str_rel = self._normalize_name(str(rel_path))

                if rel_path.parts[0] == "pdfs":
                    return rel_path.name == target_filename
                elif rel_path.parts[0] == "output":
                    # Keep config files
                    if len(rel_path.parts) == 2 and rel_path.suffix == ".json":
                        return True
                    # Keep pipeline dirs matching target_stem
                    return target_stem in str_rel
            return True

        # Create ZIP archive
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            # 1. Archive pdfs/
            if self.docs_dir.exists():
                for root, _, files in os.walk(self.docs_dir):
                    root_path = Path(root)
                    for file in files:
                        full_path = root_path / file
                        rel_path = full_path.relative_to(self.base_dir)
                        if should_include(rel_path):
                            zf.write(full_path, arcname=str(rel_path))

            # 2. Archive output/
            if self.output_dir.exists():
                for root, _, files in os.walk(self.output_dir):
                    root_path = Path(root)
                    for file in files:
                        full_path = root_path / file
                        rel_path = full_path.relative_to(self.base_dir)
                        if should_include(rel_path):
                            zf.write(full_path, arcname=str(rel_path))

            # 3. Write manifest.json once
            manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
            zf.writestr("manifest.json", manifest_bytes)

        size_bytes = zip_path.stat().st_size
        manifest["size_bytes"] = size_bytes

        logger.info(f"백업 생성 완료: {backup_id} ({size_bytes} bytes)")
        return manifest

    def list_backups(self) -> List[Dict[str, Any]]:
        """보유 중인 모든 백업 목록 조회 (최신순 정렬)"""
        self.backups_dir.mkdir(parents=True, exist_ok=True)
        backups: List[Dict[str, Any]] = []

        for zip_file in self.backups_dir.glob("*.zip"):
            try:
                with zipfile.ZipFile(zip_file, "r") as zf:
                    if "manifest.json" in zf.namelist():
                        manifest_data = json.loads(zf.read("manifest.json").decode("utf-8"))
                        manifest_data["size_bytes"] = zip_file.stat().st_size
                        manifest_data["filename"] = zip_file.name
                        backups.append(manifest_data)
                    else:
                        # Fallback for generic zip files
                        mtime = zip_file.stat().st_mtime
                        backups.append({
                            "backup_id": zip_file.stem,
                            "filename": zip_file.name,
                            "name": zip_file.stem,
                            "description": "외부 가져온 아카이브",
                            "backup_type": "workspace",
                            "created_at": datetime.fromtimestamp(mtime).isoformat(),
                            "timestamp": mtime,
                            "size_bytes": zip_file.stat().st_size,
                            "is_safety_backup": False,
                            "stats": {
                                "pdf_count": 0,
                                "pdf_names": [],
                                "edited_docs_count": 0,
                                "total_chunks": 0,
                                "has_configs": False,
                                "includes_vector_db": False,
                            },
                        })
            except Exception as e:
                logger.warning(f"백업 파일 파싱 실패 ({zip_file.name}): {e}")

        # Sort descending by timestamp
        backups.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return backups

    def get_backup(self, backup_id: str) -> Optional[Dict[str, Any]]:
        """특정 백업의 메타데이터 조회"""
        zip_path = self.backups_dir / f"{backup_id}.zip"
        if not zip_path.exists():
            # Try finding by filename directly
            zip_path = self.backups_dir / backup_id
            if not zip_path.exists():
                return None

        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                if "manifest.json" in zf.namelist():
                    data = json.loads(zf.read("manifest.json").decode("utf-8"))
                    data["size_bytes"] = zip_path.stat().st_size
                    return data
        except Exception as e:
            logger.error(f"백업 메타데이터 로드 실패 ({backup_id}): {e}")
        return None

    def get_backup_path(self, backup_id: str) -> Optional[Path]:
        """특정 백업의 파일 경로 반환"""
        zip_path = self.backups_dir / f"{backup_id}.zip"
        if zip_path.exists():
            return zip_path
        alt_path = self.backups_dir / backup_id
        if alt_path.exists():
            return alt_path
        return None

    def delete_backup(self, backup_id: str) -> bool:
        """특정 백업 파일 삭제"""
        zip_path = self.get_backup_path(backup_id)
        if not zip_path or not zip_path.exists():
            return False
        try:
            zip_path.unlink()
            logger.info(f"백업 삭제 완료: {backup_id}")
            return True
        except Exception as e:
            logger.error(f"백업 삭제 실패 ({backup_id}): {e}")
            return False

    def restore_backup(
        self,
        backup_id: str,
        create_safety_backup: bool = True,
    ) -> Dict[str, Any]:
        """
        선택한 백업으로부터 작업공간 또는 문서 상태 원복(복원)
        """
        zip_path = self.get_backup_path(backup_id)
        if not zip_path or not zip_path.exists():
            raise FileNotFoundError(f"백업 파일을 찾을 수 없습니다: {backup_id}")

        # 1. Manifest 검증
        manifest: Optional[Dict[str, Any]] = None
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                if "manifest.json" in zf.namelist():
                    manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        except Exception as e:
            raise ValueError(f"유효하지 않은 백업 ZIP 파일입니다: {e}")

        # 2. 원복 전 안전 백업 자동 생성
        safety_manifest = None
        if create_safety_backup:
            try:
                safety_manifest = self.create_backup(
                    name=f"원복 전 자동 안전 백업 (복원 대상: {manifest.get('name') if manifest else backup_id})",
                    description=f"백업 '{backup_id}' 복원 실행 직전 생성된 안전 스냅샷",
                    backup_type="workspace",
                    include_vector_db=False,
                    is_safety_backup=True,
                )
            except Exception as e:
                logger.warning(f"안전 백업 생성 중 경고 발생 (원복은 계속 진행): {e}")

        # 3. 파일 압축 해제 및 복원
        restored_files_count = 0
        base_dir_resolved = self.base_dir.resolve()

        with zipfile.ZipFile(zip_path, "r") as zf:
            namelist = zf.namelist()
            for member in namelist:
                if member == "manifest.json" or member.endswith("/"):
                    continue

                # Zip Slip 방지 검사
                target_file_path = (self.base_dir / member).resolve()
                if not str(target_file_path).startswith(str(base_dir_resolved)):
                    raise SecurityError(f"비정상적인 파일 경로 감지: {member}")

                # Ensure parent directory exists
                target_file_path.parent.mkdir(parents=True, exist_ok=True)

                # Extract and overwrite
                with zf.open(member) as source, open(target_file_path, "wb") as target:
                    shutil.copyfileobj(source, target)
                restored_files_count += 1

        logger.info(f"백업 복원 완료: {backup_id} (복원된 파일: {restored_files_count}개)")

        return {
            "success": True,
            "backup_id": backup_id,
            "restored_files_count": restored_files_count,
            "safety_backup_id": safety_manifest.get("backup_id") if safety_manifest else None,
            "manifest": manifest,
            "message": f"성공적으로 복원되었습니다. (복원 파일: {restored_files_count}개)",
        }

    def import_backup_file(
        self,
        file_bytes: bytes,
        original_filename: str,
        restore_immediately: bool = False,
    ) -> Dict[str, Any]:
        """
        외부에서 업로드된 백업 ZIP 파일을 저장하고 필요시 즉시 복원
        """
        # Validate that it's a valid ZIP
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as zf:
                namelist = zf.namelist()
                has_manifest = "manifest.json" in namelist
                if has_manifest:
                    manifest_data = json.loads(zf.read("manifest.json").decode("utf-8"))
                else:
                    manifest_data = None
        except Exception as e:
            raise ValueError(f"올바른 ZIP 파일이 아닙니다: {e}")

        self.backups_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.now()
        time_str = now.strftime("%Y%m%d_%H%M%S")
        rand_suffix = uuid.uuid4().hex[:6]

        if manifest_data and manifest_data.get("backup_id"):
            candidate_id = manifest_data["backup_id"]
            if (self.backups_dir / f"{candidate_id}.zip").exists():
                backup_id = f"{candidate_id}_{rand_suffix}"
            else:
                backup_id = candidate_id
        else:
            backup_id = f"imported_{time_str}_{rand_suffix}"

        dest_filename = f"{backup_id}.zip"
        dest_path = self.backups_dir / dest_filename

        if not manifest_data:
            manifest_data = {
                "version": BACKUP_VERSION,
                "backup_id": backup_id,
                "filename": dest_filename,
                "name": f"가져온 백업: {Path(original_filename).stem}",
                "description": f"외부 파일({original_filename})에서 가져옴",
                "backup_type": "workspace",
                "created_at": now.isoformat(),
                "timestamp": time.time(),
                "is_safety_backup": False,
                "includes_vector_db": False,
                "size_bytes": len(file_bytes),
                "stats": {
                    "pdf_count": 0,
                    "pdf_names": [],
                    "edited_docs_count": 0,
                    "total_chunks": 0,
                    "has_configs": False,
                },
            }
        else:
            manifest_data["backup_id"] = backup_id
            manifest_data["filename"] = dest_filename
            manifest_data["size_bytes"] = len(file_bytes)

        # Write clean zip without duplicate manifest
        with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as source_zf, zipfile.ZipFile(dest_path, "w", compression=zipfile.ZIP_DEFLATED) as target_zf:
            for item in source_zf.infolist():
                if item.filename != "manifest.json":
                    target_zf.writestr(item, source_zf.read(item.filename))
            target_zf.writestr("manifest.json", json.dumps(manifest_data, ensure_ascii=False, indent=2).encode("utf-8"))

        restore_result = None
        if restore_immediately:
            restore_result = self.restore_backup(backup_id, create_safety_backup=True)

        return {
            "success": True,
            "backup_id": backup_id,
            "manifest": manifest_data,
            "restored": restore_immediately,
            "restore_result": restore_result,
            "message": "백업 파일을 성공적으로 가져왔습니다." + (" (즉시 복원 완료)" if restore_immediately else ""),
        }


backup_svc = BackupService()

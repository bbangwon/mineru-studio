import json
import logging
import shutil
import subprocess
import sys
import time
import unicodedata
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

VALID_MINERU_TIERS = ("flash", "basic", "standard", "advanced")
LEGACY_TIER_MAP = {
    "pipeline": "basic",
    "hybrid-engine": "standard",
    "vlm": "standard",
}


def normalize_mineru_tier(backend: Optional[str]) -> str:
    """레거시 backend 명칭('pipeline', 'hybrid-engine')과 MinerU 4.x 티어를 정규화합니다."""
    if not backend:
        return "basic"
    val = str(backend).strip().lower()
    if val in LEGACY_TIER_MAP:
        return LEGACY_TIER_MAP[val]
    if val in VALID_MINERU_TIERS:
        return val
    return "basic"


def _format_pages_arg(start_page: Optional[int], end_page: Optional[int]) -> str:
    """0-indexed 페이지 범위를 MinerU 4.x CLI의 1-indexed --pages 문자열로 변환합니다."""
    if start_page is None and end_page is None:
        return "all"
    if start_page is not None and end_page is not None:
        s_1 = max(1, int(start_page) + 1)
        e_1 = max(s_1, int(end_page) + 1)
        return str(s_1) if s_1 == e_1 else f"{s_1}-{e_1}"
    if start_page is not None:
        return f"{max(1, int(start_page) + 1)}-r1"
    return f"1-{max(1, int(end_page) + 1)}"


class MineruService:
    def __init__(self, venv_bin: Optional[Path] = None):
        if venv_bin is None:
            self.venv_bin = Path(sys.executable).parent
        else:
            self.venv_bin = venv_bin
        self.mineru_kit_cmd = str(self.venv_bin / "mineru-kit")
        self.mineru_cmd = str(self.venv_bin / "mineru")

    def _safe_extract_zip(self, zip_path: Path, dest_dir: Path) -> None:
        """경로 탈출(Zip Slip)을 방지하며 ZIP 아카이브를 안전하게 압축 해제합니다."""
        dest_root = dest_dir.resolve()
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.infolist():
                if member.is_dir():
                    continue
                target_path = (dest_root / member.filename).resolve()
                if not target_path.is_relative_to(dest_root):
                    raise ValueError(f"Unsafe zip member path detected: {member.filename}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member, "r") as src, open(target_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)

    def _extract_and_render_outputs(
        self,
        zip_path: Path,
        doc_dir: Path,
        parse_dir: Path,
        pdf_name: str,
    ) -> Dict[str, Any]:
        """MinerU 4.x ZIP 산출물을 기존 스튜디오 디렉토리 구조 및 content_list_v2.json으로 변환합니다."""
        from mineru.render import RenderFormat, render
        from mineru.types import MiddleJson

        parse_dir.mkdir(parents=True, exist_ok=True)
        self._safe_extract_zip(zip_path, parse_dir)

        md_file_path: Optional[Path] = None
        raw_md = parse_dir / "markdown.md"
        named_md = parse_dir / f"{pdf_name}.md"
        if raw_md.exists():
            raw_md.replace(named_md)
            md_file_path = named_md
        elif named_md.exists():
            md_file_path = named_md
        else:
            md_candidates = sorted(parse_dir.glob("*.md"))
            if md_candidates:
                md_file_path = md_candidates[0]

        md_content = ""
        if md_file_path and md_file_path.exists():
            with open(md_file_path, "r", encoding="utf-8") as f:
                md_content = f.read()

        content_list: Any = []
        content_list_path: Optional[Path] = None
        middle_json_path = parse_dir / "middle_json.json"
        if middle_json_path.exists():
            with open(middle_json_path, "r", encoding="utf-8") as mf:
                middle_data = json.load(mf)
            middle_json = MiddleJson.from_dict(middle_data)
            content_list = render(middle_json, RenderFormat.CONTENT_LIST_V2)
            content_list_path = parse_dir / f"{pdf_name}_content_list_v2.json"
            with open(content_list_path, "w", encoding="utf-8") as cf:
                json.dump(content_list, cf, ensure_ascii=False, indent=2)
        else:
            existing_v2 = sorted(parse_dir.glob("*_content_list_v2.json"))
            if existing_v2:
                content_list_path = existing_v2[0]
                with open(content_list_path, "r", encoding="utf-8") as cf:
                    content_list = json.load(cf)

        images_list = []
        images_dir = parse_dir / "images"
        if not images_dir.exists():
            for p in doc_dir.glob("**/images"):
                if p.is_dir():
                    images_dir = p
                    break
        if images_dir.exists():
            images_list = [
                img.name
                for img in sorted(images_dir.iterdir())
                if img.is_file() and img.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
            ]

        layout_pdf_path: Optional[Path] = None
        for p in doc_dir.glob("**/*_layout.pdf"):
            layout_pdf_path = p
            break

        return {
            "markdown": md_content,
            "markdown_path": str(md_file_path) if md_file_path else None,
            "layout_pdf_path": str(layout_pdf_path) if layout_pdf_path else None,
            "content_list": content_list,
            "content_list_path": str(content_list_path) if content_list_path else None,
            "images": images_list,
        }

    def parse_pdf(
        self,
        pdf_path: Path,
        output_dir: Path,
        start_page: Optional[int] = None,
        end_page: Optional[int] = None,
        lang: str = "korean",
        backend: str = "basic",
        method: str = "auto",
        formula: bool = True,
    ) -> Dict[str, Any]:
        # macOS NFD 자모 분리로 인한 파일명 불일치 방지를 위해 NFC로 정규화
        if not unicodedata.is_normalized("NFC", pdf_path.name):
            try:
                nfc_name = unicodedata.normalize("NFC", pdf_path.name)
                temp_path = pdf_path.with_name(f"_tmp_norm_{pdf_path.stem}.pdf")
                pdf_path.rename(temp_path)
                target_nfc_path = pdf_path.with_name(nfc_name)
                temp_path.rename(target_nfc_path)
                pdf_path = target_nfc_path
                logger.info(f"Normalized PDF filename from NFD to NFC: {nfc_name}")
            except Exception as e:
                logger.warning(f"Could not rename PDF to NFC: {e}")

        output_dir.mkdir(parents=True, exist_ok=True)
        pdf_name = unicodedata.normalize("NFC", pdf_path.stem)
        tier = normalize_mineru_tier(backend)
        ocr_mode = (method or "auto").strip().lower()
        if ocr_mode not in {"auto", "txt", "ocr"}:
            ocr_mode = "auto"
        pages_arg = _format_pages_arg(start_page, end_page)

        tmp_zip_path = output_dir / f".tmp_{uuid.uuid4().hex[:10]}.zip"
        cmd = [
            self.mineru_kit_cmd,
            "parse",
            str(pdf_path),
            "-o", str(tmp_zip_path),
            "-f", "zip",
            "--tier", tier,
            "--ocr-mode", ocr_mode,
            "--pages", pages_arg,
        ]

        logger.info(f"Executing MinerU 4.x command: {' '.join(cmd)}")
        start_time = time.time()

        try:
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                check=False,
            )
            elapsed_time = round(time.time() - start_time, 2)
            logger.info(f"MinerU execution finished in {elapsed_time}s with exit code {proc.returncode}")

            if proc.returncode != 0:
                logger.error(f"MinerU error output:\n{proc.stdout}")
                return {
                    "success": False,
                    "error": proc.stdout[-1500:] if proc.stdout else "Unknown error",
                    "elapsed_time": elapsed_time,
                }

            if not tmp_zip_path.exists():
                return {
                    "success": False,
                    "error": f"MinerU output zip was not generated: {tmp_zip_path}",
                    "elapsed_time": elapsed_time,
                }

            doc_dir = output_dir / pdf_name
            parse_dir = doc_dir / ocr_mode
            rendered = self._extract_and_render_outputs(
                zip_path=tmp_zip_path,
                doc_dir=doc_dir,
                parse_dir=parse_dir,
                pdf_name=pdf_name,
            )
            return {
                "success": True,
                "elapsed_time": elapsed_time,
                **rendered,
                "output_dir": str(doc_dir),
            }
        except Exception as exc:
            elapsed_time = round(time.time() - start_time, 2)
            logger.error(f"MinerU execution failed with exception: {exc}")
            return {
                "success": False,
                "error": str(exc),
                "elapsed_time": elapsed_time,
            }
        finally:
            if tmp_zip_path.exists():
                try:
                    tmp_zip_path.unlink()
                except OSError:
                    pass

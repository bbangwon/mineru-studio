import os
import sys
import time
import json
import logging
import subprocess
import unicodedata
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class MineruService:
    def __init__(self, venv_bin: Optional[Path] = None):
        if venv_bin is None:
            self.venv_bin = Path(sys.executable).parent
        else:
            self.venv_bin = venv_bin
        self.mineru_cmd = str(self.venv_bin / "mineru")
        self._ensure_patched()

    def _ensure_patched(self):
        """MinerU CLI 고부하 시 소켓 단절(httpx.TransportError/ReadError) 자동 재시도 패치 점검 및 적용"""
        try:
            site_packages = list(self.venv_bin.parent.glob("lib/python*/site-packages/mineru/cli/api_client.py"))
            if not site_packages:
                return
            target_file = site_packages[0]
            with open(target_file, "r", encoding="utf-8") as f:
                content = f.read()

            if "except httpx.ReadTimeout:" in content and "except httpx.TransportError" not in content:
                patched = content.replace(
                    "except httpx.ReadTimeout:",
                    "except httpx.TransportError as exc:"
                )
                with open(target_file, "w", encoding="utf-8") as f:
                    f.write(patched)
                logger.info(f"Successfully applied transient network error patch to {target_file}")
        except Exception as e:
            logger.warning(f"Could not auto-patch mineru api_client: {e}")

    def parse_pdf(
        self,
        pdf_path: Path,
        output_dir: Path,
        start_page: Optional[int] = None,
        end_page: Optional[int] = None,
        lang: str = "korean",
        backend: str = "pipeline",
        method: str = "auto",
        formula: bool = True,
    ) -> Dict[str, Any]:
        # macOS NFD 자모 분리로 인한 MinerU 파일명 바이트 초과(MAX_TASK_STEM_BYTES 200) 및 잘림 방지를 위해 NFC로 정규화
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

        cmd = [
            self.mineru_cmd,
            "-p", str(pdf_path),
            "-o", str(output_dir),
            "-b", backend,
            "-m", method,
            "-l", lang,
            "-f", str(formula),
        ]

        if start_page is not None:
            cmd.extend(["-s", str(start_page)])
        if end_page is not None:
            cmd.extend(["-e", str(end_page)])

        logger.info(f"Executing MinerU command: {' '.join(cmd)}")
        start_time = time.time()

        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=False
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

        # Find output results
        # MinerU usually outputs to: output_dir / pdf_name / <backend> / ...
        doc_dir = output_dir / pdf_name
        if not doc_dir.exists() and output_dir.exists():
            norm_target = unicodedata.normalize("NFC", pdf_name)
            for sub in output_dir.iterdir():
                if sub.is_dir():
                    norm_sub = unicodedata.normalize("NFC", sub.name)
                    if (
                        norm_sub == norm_target
                        or (len(norm_sub) >= 10 and (norm_target.startswith(norm_sub) or norm_sub.startswith(norm_target)))
                    ):
                        doc_dir = sub
                        break

        md_content = ""
        content_list = []
        md_file_path = None
        layout_pdf_path = None
        images_list = []

        if doc_dir.exists():
            for root, _, files in os.walk(doc_dir):
                root_p = Path(root)
                for f in files:
                    if f.endswith(".md"):
                        md_file_path = root_p / f
                    elif f.endswith("_content_list_v2.json"):
                        try:
                            content_list_file_path = root_p / f
                            with open(root_p / f, "r", encoding="utf-8") as jf:
                                content_list_v2 = json.load(jf)
                        except Exception:
                            pass
                    elif f.endswith("_content_list.json"):
                        try:
                            if 'content_list_file_path' not in locals():
                                content_list_file_path = root_p / f
                            with open(root_p / f, "r", encoding="utf-8") as jf:
                                content_list_v1 = json.load(jf)
                        except Exception:
                            pass
                    elif f.endswith("_layout.pdf"):
                        layout_pdf_path = root_p / f

            # Prefer v2 if available, otherwise v1
            content_list = content_list_v2 if 'content_list_v2' in locals() and content_list_v2 else (content_list_v1 if 'content_list_v1' in locals() else [])
            final_content_list_path = content_list_file_path if 'content_list_file_path' in locals() else None

            # Check images
            images_dir = None
            for p in doc_dir.glob("**/images"):
                if p.is_dir():
                    images_dir = p
                    break
            if images_dir and images_dir.exists():
                images_list = [img.name for img in images_dir.iterdir() if img.suffix.lower() in [".png", ".jpg", ".jpeg"]]

        if md_file_path and md_file_path.exists():
            with open(md_file_path, "r", encoding="utf-8") as f:
                md_content = f.read()

        return {
            "success": True,
            "elapsed_time": elapsed_time,
            "markdown": md_content,
            "markdown_path": str(md_file_path) if md_file_path else None,
            "layout_pdf_path": str(layout_pdf_path) if layout_pdf_path else None,
            "content_list": content_list,
            "content_list_path": str(final_content_list_path) if 'final_content_list_path' in locals() and final_content_list_path else None,
            "images": images_list,
            "output_dir": str(doc_dir),
        }

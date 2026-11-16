import json
import logging
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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


_SINGLE_FORM_CM_RE = re.compile(
    rb"([0-9.+-]+)\s+0\s+0\s+([0-9.+-]+)\s+([0-9.+-]+)\s+([0-9.+-]+)\s+cm\s+/(\S+)\s+Do"
)


def _normalize_tiny_form_xobject_scales(pdf_path: Path, dest_path: Path) -> Optional[Path]:
    """한컴오피스(rhwp) 등에서 생성된 PDF의 미세 축소 Form XObject /Matrix를 정규화합니다.

    페이지 스트림이 `sx 0 0 sy tx ty cm /Name Do` 형태이고 참조하는 Form XObject의
    `/Matrix`가 미세 스케일(< 0.05)로 축소된 경우, PDFium이 반각 숫자·특수문자를
    노이즈(width < 0.01)로 필터링해 누락시키는 문제를 방지하기 위해
    페이지 스케일을 Form `/Matrix`로 병합한 임시 PDF를 생성합니다.
    정규화가 필요한 페이지가 없으면 None을 반환합니다.
    """
    try:
        import pypdf
        from pypdf.generic import (
            ArrayObject,
            DecodedStreamObject,
            DictionaryObject,
            FloatObject,
            NameObject,
        )
    except ImportError:
        return None

    try:
        reader = pypdf.PdfReader(str(pdf_path))
        writer = pypdf.PdfWriter()
        for page in reader.pages:
            writer.add_page(page)

        modified_pages = 0
        for page in writer.pages:
            contents = page.get_contents()
            if contents is None:
                continue
            raw_c = contents.get_data().strip()
            match = _SINGLE_FORM_CM_RE.fullmatch(raw_c)
            if not match:
                continue

            sx = float(match.group(1))
            sy = float(match.group(2))
            tx = float(match.group(3))
            ty = float(match.group(4))
            xobj_name = match.group(5).decode("latin1")
            xobj_key = f"/{xobj_name}"

            res = page.get("/Resources")
            xobjs = res.get("/XObject") if res else None
            if not xobjs or xobj_key not in xobjs:
                continue

            xobj = xobjs[xobj_key].get_object()
            if xobj.get("/Subtype") != "/Form":
                continue

            mat = xobj.get("/Matrix")
            if not mat or len(mat) != 6:
                continue

            m0, m1, m2, m3, m4, m5 = [float(v) for v in mat]
            if not (
                0 < abs(m0) < 0.05
                and 0 < abs(m3) < 0.05
                and abs(m0 * sx) >= 0.1
                and abs(m3 * sy) >= 0.1
            ):
                continue

            cloned_xobj = xobj.clone(writer)
            cloned_xobj[NameObject("/Matrix")] = ArrayObject([
                FloatObject(m0 * sx),
                FloatObject(m1 * sy),
                FloatObject(m2 * sx),
                FloatObject(m3 * sy),
                FloatObject(m4 * sx + tx),
                FloatObject(m5 * sy + ty),
            ])

            new_xobjs = DictionaryObject(xobjs)
            new_xobjs[NameObject(xobj_key)] = cloned_xobj.indirect_reference
            new_res = DictionaryObject(res)
            new_res[NameObject("/XObject")] = new_xobjs
            page[NameObject("/Resources")] = new_res

            new_stream = DecodedStreamObject()
            new_stream.set_data(f"/{xobj_name} Do".encode("latin1"))
            page[NameObject("/Contents")] = writer._add_object(new_stream)
            modified_pages += 1

        if modified_pages == 0:
            return None

        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f_out:
            writer.write(f_out)

        logger.info(
            f"Normalized tiny Form XObject scales for {modified_pages}/{len(writer.pages)} "
            f"page(s) in {pdf_path.name}"
        )
        return dest_path
    except Exception as exc:
        logger.warning(f"Failed to normalize Form XObject scales for {pdf_path.name}, using original: {exc}")
        return None


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


def format_page_ranges(pages: List[int]) -> List[List[int]]:
    """정렬된 0-indexed 페이지 번호 목록을 연속 구간 [[start, end], ...]으로 묶습니다."""
    if not pages:
        return []
    sorted_pages = sorted(set(pages))
    ranges: List[List[int]] = [[sorted_pages[0], sorted_pages[0]]]
    for p in sorted_pages[1:]:
        if p == ranges[-1][1] + 1:
            ranges[-1][1] = p
        else:
            ranges.append([p, p])
    return ranges


def find_all_parts_statuses(output_base_dir: Path, pdf_name: str) -> List[Dict[str, Any]]:
    """지정된 문서의 모든 분할 파싱(_parts/manifest.json) 진행 상태를 탐색해 최신순으로 반환합니다."""
    if not output_base_dir.exists():
        return []
    target_stem = unicodedata.normalize("NFC", Path(pdf_name).stem).strip().lower()
    results: List[Dict[str, Any]] = []
    for manifest_path in output_base_dir.glob("mineru_*/*/*/_parts/manifest.json"):
        try:
            parts_dir = manifest_path.parent
            parse_dir = parts_dir.parent
            doc_dir = parse_dir.parent
            doc_stem = unicodedata.normalize("NFC", doc_dir.name).strip().lower()
            if doc_stem != target_stem and not (
                len(doc_stem) >= 10 and (target_stem.startswith(doc_stem) or doc_stem.startswith(target_stem))
            ):
                continue
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            pages_dir = parts_dir / "pages"
            parsed_pages = sorted(
                int(p.stem.replace("page_", ""))
                for p in pages_dir.glob("page_*.json")
                if p.stem.replace("page_", "").isdigit()
            ) if pages_dir.exists() else manifest.get("parsed_pages", [])
            total_pages = manifest.get("total_pages") or 0
            has_merged = any(parse_dir.glob("*_content_list_v2.json"))
            results.append({
                "tier": manifest.get("tier"),
                "method": manifest.get("method"),
                "lang": manifest.get("lang", "korean"),
                "total_pages": total_pages,
                "parsed_pages": parsed_pages,
                "parsed_count": len(parsed_pages),
                "remaining_count": max(0, total_pages - len(parsed_pages)) if total_pages else 0,
                "parsed_ranges": format_page_ranges(parsed_pages),
                "batches": manifest.get("batches", []),
                "has_merged_output": has_merged,
                "last_updated": manifest.get("last_updated", manifest_path.stat().st_mtime),
            })
        except Exception as exc:
            logger.warning(f"Failed to read parts manifest {manifest_path}: {exc}")
    results.sort(key=lambda x: x.get("last_updated", 0), reverse=True)
    return results


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

    def _ensure_nfc_pdf(self, pdf_path: Path) -> Path:
        """macOS NFD 자모 분리로 인한 파일명 불일치 방지를 위해 NFC로 정규화합니다."""
        if not unicodedata.is_normalized("NFC", pdf_path.name):
            try:
                nfc_name = unicodedata.normalize("NFC", pdf_path.name)
                temp_path = pdf_path.with_name(f"_tmp_norm_{pdf_path.stem}.pdf")
                pdf_path.rename(temp_path)
                target_nfc_path = pdf_path.with_name(nfc_name)
                temp_path.rename(target_nfc_path)
                logger.info(f"Normalized PDF filename from NFD to NFC: {nfc_name}")
                return target_nfc_path
            except Exception as e:
                logger.warning(f"Could not rename PDF to NFC: {e}")
        return pdf_path

    def _run_mineru_cli(
        self,
        pdf_path: Path,
        output_dir: Path,
        start_page: Optional[int],
        end_page: Optional[int],
        tier: str,
        ocr_mode: str,
    ) -> Tuple[Optional[Path], float, Optional[str]]:
        """MinerU 4.x CLI를 실행해 임시 ZIP 경로, 소요 시간, 오류 메시지를 반환합니다."""
        pages_arg = _format_pages_arg(start_page, end_page)
        tmp_zip_path = output_dir / f".tmp_{uuid.uuid4().hex[:10]}.zip"
        tmp_norm_pdf_path = output_dir / f".tmp_norm_{uuid.uuid4().hex[:10]}.pdf"
        normalized_pdf_path = _normalize_tiny_form_xobject_scales(pdf_path, tmp_norm_pdf_path)
        parse_input_path = normalized_pdf_path if normalized_pdf_path is not None else pdf_path

        cmd = [
            self.mineru_kit_cmd,
            "parse",
            str(parse_input_path),
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
                if tmp_zip_path.exists():
                    tmp_zip_path.unlink(missing_ok=True)
                return None, elapsed_time, (proc.stdout[-1500:] if proc.stdout else "Unknown error")

            if not tmp_zip_path.exists():
                return None, elapsed_time, f"MinerU output zip was not generated: {tmp_zip_path}"

            return tmp_zip_path, elapsed_time, None
        except Exception as exc:
            elapsed_time = round(time.time() - start_time, 2)
            logger.error(f"MinerU execution failed with exception: {exc}")
            if tmp_zip_path.exists():
                tmp_zip_path.unlink(missing_ok=True)
            return None, elapsed_time, str(exc)
        finally:
            if tmp_norm_pdf_path.exists():
                try:
                    tmp_norm_pdf_path.unlink()
                except OSError:
                    pass

    def _safe_extract_images(self, zip_path: Path, parse_dir: Path) -> None:
        """ZIP 아카이브에서 images/ 하위 파일만 안전하게 추출합니다."""
        dest_root = parse_dir.resolve()
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.infolist():
                if member.is_dir():
                    continue
                if not member.filename.startswith("images/") and "/images/" not in member.filename:
                    continue
                target_path = (dest_root / member.filename).resolve()
                if not target_path.is_relative_to(dest_root):
                    raise ValueError(f"Unsafe zip member path detected: {member.filename}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member, "r") as src, open(target_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)

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
        pdf_path = self._ensure_nfc_pdf(pdf_path)
        output_dir.mkdir(parents=True, exist_ok=True)
        pdf_name = unicodedata.normalize("NFC", pdf_path.stem)
        tier = normalize_mineru_tier(backend)
        ocr_mode = (method or "auto").strip().lower()
        if ocr_mode not in {"auto", "txt", "ocr"}:
            ocr_mode = "auto"

        tmp_zip_path, elapsed_time, err = self._run_mineru_cli(
            pdf_path=pdf_path,
            output_dir=output_dir,
            start_page=start_page,
            end_page=end_page,
            tier=tier,
            ocr_mode=ocr_mode,
        )
        if err or tmp_zip_path is None:
            return {
                "success": False,
                "error": err or "MinerU parse failed",
                "elapsed_time": elapsed_time,
            }

        try:
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
            logger.error(f"MinerU output extraction failed: {exc}")
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

    def parse_pdf_part(
        self,
        pdf_path: Path,
        output_dir: Path,
        start_page: Optional[int] = None,
        end_page: Optional[int] = None,
        lang: str = "korean",
        backend: str = "basic",
        method: str = "auto",
        formula: bool = True,
        total_pages: Optional[int] = None,
    ) -> Dict[str, Any]:
        """지정 페이지 구간만 MinerU로 파싱하여 _parts/pages/page_XXXX.json에 분할 저장합니다."""
        pdf_path = self._ensure_nfc_pdf(pdf_path)
        output_dir.mkdir(parents=True, exist_ok=True)
        pdf_name = unicodedata.normalize("NFC", pdf_path.stem)
        tier = normalize_mineru_tier(backend)
        ocr_mode = (method or "auto").strip().lower()
        if ocr_mode not in {"auto", "txt", "ocr"}:
            ocr_mode = "auto"

        tmp_zip_path, elapsed_time, err = self._run_mineru_cli(
            pdf_path=pdf_path,
            output_dir=output_dir,
            start_page=start_page,
            end_page=end_page,
            tier=tier,
            ocr_mode=ocr_mode,
        )
        if err or tmp_zip_path is None:
            return {
                "success": False,
                "error": err or "MinerU part parse failed",
                "elapsed_time": elapsed_time,
            }

        try:
            doc_dir = output_dir / pdf_name
            parse_dir = doc_dir / ocr_mode
            parts_dir = parse_dir / "_parts"
            pages_dir = parts_dir / "pages"
            pages_dir.mkdir(parents=True, exist_ok=True)

            self._safe_extract_images(tmp_zip_path, parse_dir)

            with zipfile.ZipFile(tmp_zip_path, "r") as zf:
                if "middle_json.json" not in zf.namelist():
                    return {
                        "success": False,
                        "error": "middle_json.json not found in MinerU output zip",
                        "elapsed_time": elapsed_time,
                    }
                middle_data = json.loads(zf.read("middle_json.json").decode("utf-8"))

            doc_meta_count = (
                middle_data.get("metadata", {}).get("document", {}).get("page_count")
            )
            resolved_total = total_pages or doc_meta_count or 0

            saved_page_indices: List[int] = []
            for page_obj in middle_data.get("pages", []):
                p_idx = int(page_obj.get("page_idx", 0))
                page_file = pages_dir / f"page_{p_idx:04d}.json"
                with open(page_file, "w", encoding="utf-8") as pf:
                    json.dump(page_obj, pf, ensure_ascii=False, indent=2)
                saved_page_indices.append(p_idx)

            # 빈 페이지 등으로 middle_json.pages에 누락된 요청 구간 페이지도 완료 처리
            if start_page is not None and end_page is not None:
                upper = min(end_page, resolved_total - 1) if resolved_total else end_page
                for p_idx in range(max(0, start_page), upper + 1):
                    if p_idx not in saved_page_indices:
                        page_file = pages_dir / f"page_{p_idx:04d}.json"
                        if not page_file.exists():
                            with open(page_file, "w", encoding="utf-8") as pf:
                                json.dump({"page_idx": p_idx, "blocks": []}, pf, ensure_ascii=False, indent=2)
                        saved_page_indices.append(p_idx)

            manifest_path = parts_dir / "manifest.json"
            manifest: Dict[str, Any] = {}
            if manifest_path.exists():
                try:
                    with open(manifest_path, "r", encoding="utf-8") as mf:
                        manifest = json.load(mf)
                except Exception:
                    manifest = {}

            all_parsed_pages = sorted(
                int(p.stem.replace("page_", ""))
                for p in pages_dir.glob("page_*.json")
                if p.stem.replace("page_", "").isdigit()
            )
            batches = manifest.get("batches", [])
            batches.append({
                "start_page": start_page if start_page is not None else 0,
                "end_page": end_page if end_page is not None else (resolved_total - 1 if resolved_total else max(saved_page_indices or [0])),
                "pages_count": len(saved_page_indices),
                "elapsed_time": elapsed_time,
                "parsed_at": time.time(),
            })

            manifest.update({
                "pdf_name": pdf_name,
                "tier": tier,
                "method": ocr_mode,
                "lang": lang,
                "total_pages": resolved_total or manifest.get("total_pages", 0),
                "schema": middle_data.get("schema", "docvortex.middle"),
                "schema_version": middle_data.get("schema_version", "2.0"),
                "metadata": middle_data.get("metadata", manifest.get("metadata", {})),
                "extensions": middle_data.get("extensions", manifest.get("extensions", {})),
                "parsed_pages": all_parsed_pages,
                "batches": batches,
                "last_updated": time.time(),
            })
            with open(manifest_path, "w", encoding="utf-8") as mf:
                json.dump(manifest, mf, ensure_ascii=False, indent=2)

            parts_status = self.get_parts_status(output_dir, pdf_name, ocr_mode)
            return {
                "success": True,
                "elapsed_time": elapsed_time,
                "batch_pages": sorted(saved_page_indices),
                "parts_status": parts_status,
                "output_dir": str(doc_dir),
            }
        except Exception as exc:
            logger.error(f"MinerU part extraction failed: {exc}")
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

    def get_parts_status(
        self,
        output_dir: Path,
        pdf_name: str,
        ocr_mode: str = "auto",
    ) -> Optional[Dict[str, Any]]:
        """특정 파이프라인 디렉토리의 분할 파싱 진행 상태를 반환합니다."""
        norm_name = unicodedata.normalize("NFC", pdf_name)
        parse_dir = output_dir / norm_name / (ocr_mode or "auto").strip().lower()
        parts_dir = parse_dir / "_parts"
        manifest_path = parts_dir / "manifest.json"
        if not manifest_path.exists():
            return None
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            pages_dir = parts_dir / "pages"
            parsed_pages = sorted(
                int(p.stem.replace("page_", ""))
                for p in pages_dir.glob("page_*.json")
                if p.stem.replace("page_", "").isdigit()
            ) if pages_dir.exists() else manifest.get("parsed_pages", [])
            total_pages = manifest.get("total_pages") or 0
            has_merged = any(parse_dir.glob("*_content_list_v2.json"))
            return {
                "tier": manifest.get("tier"),
                "method": manifest.get("method"),
                "lang": manifest.get("lang", "korean"),
                "total_pages": total_pages,
                "parsed_pages": parsed_pages,
                "parsed_count": len(parsed_pages),
                "remaining_count": max(0, total_pages - len(parsed_pages)) if total_pages else 0,
                "parsed_ranges": format_page_ranges(parsed_pages),
                "batches": manifest.get("batches", []),
                "has_merged_output": has_merged,
                "last_updated": manifest.get("last_updated", manifest_path.stat().st_mtime),
            }
        except Exception as exc:
            logger.warning(f"Failed to read parts status from {manifest_path}: {exc}")
            return None

    def merge_pdf_parts(
        self,
        output_dir: Path,
        pdf_name: str,
        ocr_mode: str = "auto",
        total_pages: Optional[int] = None,
    ) -> Dict[str, Any]:
        """분할 저장된 _parts/pages/page_*.json들을 단일 middle_json 및 content_list_v2로 병합합니다."""
        from mineru.render import RenderFormat, render
        from mineru.types import MiddleJson

        norm_name = unicodedata.normalize("NFC", pdf_name)
        mode = (ocr_mode or "auto").strip().lower()
        doc_dir = output_dir / norm_name
        parse_dir = doc_dir / mode
        parts_dir = parse_dir / "_parts"
        pages_dir = parts_dir / "pages"
        manifest_path = parts_dir / "manifest.json"

        if not pages_dir.exists() or not manifest_path.exists():
            return {"success": False, "error": "병합할 분할 파싱 데이터가 없습니다."}

        page_files = sorted(
            (p for p in pages_dir.glob("page_*.json") if p.stem.replace("page_", "").isdigit()),
            key=lambda p: int(p.stem.replace("page_", "")),
        )
        if not page_files:
            return {"success": False, "error": "병합할 페이지 파싱 결과가 비어 있습니다."}

        with open(manifest_path, "r", encoding="utf-8") as mf:
            manifest = json.load(mf)

        pages_list: List[Dict[str, Any]] = []
        for pf in page_files:
            with open(pf, "r", encoding="utf-8") as f:
                pages_list.append(json.load(f))

        resolved_total = total_pages or manifest.get("total_pages") or 0
        is_full = bool(resolved_total and len(pages_list) >= resolved_total)

        merged_middle = {
            "schema": manifest.get("schema", "docvortex.middle"),
            "schema_version": manifest.get("schema_version", "2.0"),
            "metadata": manifest.get("metadata", {}),
            "extensions": manifest.get("extensions", {}),
            "pages": pages_list,
            "is_full_document": is_full,
        }

        parse_dir.mkdir(parents=True, exist_ok=True)
        middle_json_path = parse_dir / "middle_json.json"
        with open(middle_json_path, "w", encoding="utf-8") as mf_out:
            json.dump(merged_middle, mf_out, ensure_ascii=False, indent=2)

        middle_json = MiddleJson.from_dict(merged_middle)
        rendered_content_list = render(middle_json, RenderFormat.CONTENT_LIST_V2)

        # 비연속 구간 병합 시에도 페이지 번호(page_idx + 1)가 밀리지 않도록 누락 페이지는 빈 리스트로 패딩
        max_page_idx = max(int(p.get("page_idx", 0)) for p in pages_list)
        padded_content_list: List[List[Any]] = [[] for _ in range(max_page_idx + 1)]
        for p_obj, p_blocks in zip(pages_list, rendered_content_list):
            p_idx = int(p_obj.get("page_idx", 0))
            if 0 <= p_idx <= max_page_idx:
                padded_content_list[p_idx] = p_blocks

        content_list_path = parse_dir / f"{norm_name}_content_list_v2.json"
        with open(content_list_path, "w", encoding="utf-8") as cf:
            json.dump(padded_content_list, cf, ensure_ascii=False, indent=2)

        md_content = render(middle_json, RenderFormat.MARKDOWN)
        md_path = parse_dir / f"{norm_name}.md"
        with open(md_path, "w", encoding="utf-8") as mdf:
            mdf.write(md_content if isinstance(md_content, str) else str(md_content))

        return {
            "success": True,
            "content_list": padded_content_list,
            "content_list_path": str(content_list_path),
            "markdown": md_content,
            "markdown_path": str(md_path),
            "merged_pages": len(pages_list),
            "total_pages": resolved_total,
            "is_full_document": is_full,
            "output_dir": str(doc_dir),
        }

    def clear_pdf_parts(
        self,
        output_dir: Path,
        pdf_name: str,
        ocr_mode: str = "auto",
    ) -> bool:
        """지정된 파이프라인 디렉토리의 분할 파싱 임시 데이터(_parts)를 삭제합니다."""
        norm_name = unicodedata.normalize("NFC", pdf_name)
        parts_dir = output_dir / norm_name / (ocr_mode or "auto").strip().lower() / "_parts"
        if parts_dir.exists():
            shutil.rmtree(parts_dir, ignore_errors=True)
            return True
        return False

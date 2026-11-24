import io
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import pypdfium2 as pdfium
from PIL import Image


class PdfPageOutOfRangeError(ValueError):
    """요청한 페이지 번호가 PDF 전체 페이지 범위를 벗어났을 때 발생하는 예외."""

    def __init__(self, page: int, total_pages: int):
        self.page = page
        self.total_pages = total_pages
        super().__init__(f"요청한 페이지({page})가 문서 전체 페이지 수(1~{total_pages})를 벗어났습니다.")


class PdfRenderError(RuntimeError):
    """PDF 열기, 렌더링 또는 이미지 인코딩 중 실패 시 발생하는 예외."""


@dataclass(frozen=True)
class PdfRenderResult:
    image_bytes: bytes
    media_type: str
    page: int
    total_pages: int
    width: int
    height: int


MAX_CACHE_ITEMS = 48

_PDFIUM_LOCK = threading.Lock()
_CACHE_LOCK = threading.Lock()
_PAGE_CACHE: OrderedDict[tuple[str, int, int, int, str], PdfRenderResult] = OrderedDict()


def clear_pdf_render_cache() -> None:
    """인메모리 PDF 페이지 렌더 LRU 캐시를 모두 비웁니다."""
    with _CACHE_LOCK:
        _PAGE_CACHE.clear()


def render_pdf_page(
    pdf_path: Path,
    page: int,
    dpi: int = 150,
    fmt: Literal["webp", "png"] = "webp",
) -> PdfRenderResult:
    """
    PDF 파일의 단일 페이지(1-based)를 지정한 DPI와 포맷(webp/png)으로 렌더링합니다.
    pypdfium2 스레드 안전성을 위해 _PDFIUM_LOCK으로 보호하고 LRU 캐시를 활용합니다.
    """
    if not pdf_path.exists() or not pdf_path.is_file():
        raise FileNotFoundError(str(pdf_path))

    resolved_path = pdf_path.resolve()
    mtime_ns = resolved_path.stat().st_mtime_ns
    cache_key = (str(resolved_path), mtime_ns, page, dpi, fmt)

    with _CACHE_LOCK:
        cached = _PAGE_CACHE.get(cache_key)
        if cached is not None:
            _PAGE_CACHE.move_to_end(cache_key)
            return cached

    pil_image: Image.Image | None = None
    total_pages = 0

    with _PDFIUM_LOCK:
        doc = None
        page_obj = None
        bitmap = None
        try:
            doc = pdfium.PdfDocument(str(resolved_path))
            total_pages = len(doc)
            if total_pages <= 0 or page < 1 or page > total_pages:
                raise PdfPageOutOfRangeError(page=page, total_pages=total_pages)

            page_obj = doc[page - 1]
            bitmap = page_obj.render(scale=dpi / 72.0)
            pil_image = bitmap.to_pil().copy()
        except PdfPageOutOfRangeError:
            raise
        except Exception as exc:
            raise PdfRenderError(f"PDF 페이지 렌더링 실패: {exc}") from exc
        finally:
            if bitmap is not None:
                try:
                    bitmap.close()
                except Exception:
                    pass
            if page_obj is not None:
                try:
                    page_obj.close()
                except Exception:
                    pass
            if doc is not None:
                try:
                    doc.close()
                except Exception:
                    pass

    assert pil_image is not None
    try:
        if pil_image.mode not in ("RGB", "RGBA"):
            converted = pil_image.convert("RGB")
            pil_image.close()
            pil_image = converted

        width, height = pil_image.size
        buf = io.BytesIO()
        if fmt == "webp":
            pil_image.save(buf, format="WEBP", quality=85, method=4)
            media_type = "image/webp"
        elif fmt == "png":
            pil_image.save(buf, format="PNG")
            media_type = "image/png"
        else:
            raise PdfRenderError(f"지원하지 않는 이미지 포맷입니다: {fmt}")

        result = PdfRenderResult(
            image_bytes=buf.getvalue(),
            media_type=media_type,
            page=page,
            total_pages=total_pages,
            width=width,
            height=height,
        )
    except PdfRenderError:
        raise
    except Exception as exc:
        raise PdfRenderError(f"PDF 이미지 인코딩 실패: {exc}") from exc
    finally:
        try:
            pil_image.close()
        except Exception:
            pass

    with _CACHE_LOCK:
        _PAGE_CACHE[cache_key] = result
        _PAGE_CACHE.move_to_end(cache_key)
        while len(_PAGE_CACHE) > MAX_CACHE_ITEMS:
            _PAGE_CACHE.popitem(last=False)

    return result

import html
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional

from backend.app.services.chunker.constants import (
    RE_TABLE_FOOTNOTE_TEXT,
    RE_TABLE_TITLE_TEXT,
)


class _HTMLTableExtractor(HTMLParser):
    """표 HTML에서 컬럼 헤더와 상위 행 데이터를 검색 친화적 요약 텍스트로 추출하는 파서"""

    def __init__(self):
        super().__init__()
        self.rows: List[List[str]] = []
        self.current_row: List[str] = []
        self.current_cell: List[str] = []
        self.in_cell = False
        self.in_tfoot = False
        self.in_caption = False

    def handle_starttag(self, tag: str, attrs: Any):
        if tag == "tfoot":
            self.in_tfoot = True
        elif tag == "caption":
            self.in_caption = True
        elif not self.in_tfoot and not self.in_caption:
            if tag in ("td", "th"):
                self.in_cell = True
                self.current_cell = []
            elif tag == "tr":
                self.current_row = []

    def handle_endtag(self, tag: str):
        if tag == "tfoot":
            self.in_tfoot = False
        elif tag == "caption":
            self.in_caption = False
        elif not self.in_tfoot and not self.in_caption:
            if tag in ("td", "th"):
                self.in_cell = False
                cell_text = " ".join("".join(self.current_cell).split())
                self.current_row.append(cell_text)
            elif tag == "tr":
                if self.current_row:
                    self.rows.append(self.current_row)

    def handle_data(self, data: str):
        if self.in_cell and not self.in_tfoot and not self.in_caption:
            self.current_cell.append(data)


def format_table_title(caption: str) -> str:
    clean = (caption or "").strip()
    if not clean:
        return ""
    m = re.match(r"^\*\*\[표\s*(?:제목)?:\s*(.+?)\]\*\*$", clean)
    val = m.group(1).strip() if m else clean
    return f"**[표 제목: {val}]**"


def format_table_footnote(footnote: str) -> str:
    clean = (footnote or "").strip()
    if not clean:
        return ""
    m = re.match(r"^\*\*\[표\s*각주:\s*(.+?)\]\*\*$", clean)
    val = m.group(1).strip() if m else clean
    return f"**[표 각주: {val}]**"


def html_table_to_markdown(
    raw_html: str,
    caption: Optional[str] = None,
    footnote: Optional[str] = None,
) -> str:
    """
    소형 표, 대형 표 및 복합 청크를 위해 HTML 테이블을 Markdown 테이블 문자열로 변환합니다.
    """
    if not raw_html or not raw_html.strip():
        return ""
    parser = _HTMLTableExtractor()
    try:
        parser.feed(raw_html)
        rows = parser.rows
        if not rows:
            clean = re.sub(r'<[^>]+>', ' ', raw_html).strip()
            return clean

        max_cols = max(len(r) for r in rows)
        if max_cols == 0:
            return ""

        lines: List[str] = []
        if caption and caption.strip():
            lines.append(format_table_title(caption))

        header_row = [c.replace("|", "/") for c in rows[0]] + [""] * (max_cols - len(rows[0]))
        lines.append("| " + " | ".join(header_row) + " |")
        lines.append("| " + " | ".join(["---"] * max_cols) + " |")

        for r in rows[1:]:
            clean_row = [c.replace("|", "/") for c in r] + [""] * (max_cols - len(r))
            lines.append("| " + " | ".join(clean_row) + " |")

        if footnote and footnote.strip():
            lines.append(format_table_footnote(footnote))

        return "\n".join(lines)
    except Exception:
        clean = re.sub(r'<[^>]+>', ' ', raw_html).strip()
        return clean


def generate_table_search_text(
    raw_html: str,
    caption: str = "",
    footnote: str = "",
    max_tokens: int = 512,
) -> str:
    """
    원형 표와 복합 청크의 일관성을 위해 Markdown Table 형식으로 표 검색 요약 텍스트를 생성합니다.
    """
    md_table = html_table_to_markdown(raw_html, caption=caption, footnote=footnote)
    if md_table:
        return md_table

    lines = []
    if caption and caption.strip():
        lines.append(format_table_title(caption))
    if raw_html:
        clean_html = re.sub(r'<[^>]+>', ' ', raw_html)
        clean_html = " ".join(clean_html.split())
        if clean_html:
            lines.append(clean_html)
    if footnote and footnote.strip():
        lines.append(format_table_footnote(footnote))
    return "\n".join(lines).strip()


def format_text_unit_as_html(text: str) -> str:
    """문단 텍스트를 HTML 단락 태그로 래핑하고 특수문자를 이스케이프합니다."""
    if not text or not text.strip():
        return ""
    escaped = html.escape(text.strip())
    escaped = escaped.replace("\n", "<br/>")
    return f"<p>{escaped}</p>"


def strip_table_meta_tags(html_str: str) -> str:
    """table HTML에서 <caption> 및 <tfoot>/<footnote> 태그를 제거하여 순수 테이블 본체만 반환합니다."""
    if not html_str or not re.search(r"<table\b", html_str, re.I):
        return html_str or ""
    res = html_str
    if re.search(r"<caption\b", res, re.I):
        res = re.sub(r"\s*<caption\b[\s\S]*?</caption>\s*", "", res, flags=re.I)
    if re.search(r"<(?:tfoot|footnote)\b", res, re.I):
        res = re.sub(r"\s*<tfoot\b[\s\S]*?</tfoot>\s*", "", res, flags=re.I)
        res = re.sub(r"\s*<footnote\b[\s\S]*?</footnote>\s*", "", res, flags=re.I)
    return res


def build_outer_table_html(raw_html: str, caption: str = "", footnote: str = "") -> str:
    """
    순수 table HTML에 HTML5 표준인 <caption>과 <tfoot> 태그를 주입하여 완성형 table HTML을 생성합니다.
    """
    if not raw_html or not re.search(r"<table\b", raw_html, re.I):
        return raw_html or ""

    res = strip_table_meta_tags(raw_html)
    cap_text = (caption or "").strip()
    fn_text = (footnote or "").strip()

    if cap_text:
        escaped_cap = html.escape(cap_text)
        caption_tag = f"<caption>{escaped_cap}</caption>"
        m = re.search(r"<table\b[^>]*>", res, re.I)
        if m:
            idx = m.end()
            res = res[:idx] + caption_tag + res[idx:]

    if fn_text:
        escaped_fn = html.escape(fn_text)
        tfoot_tag = f"<tfoot><tr><td colspan=\"100%\">{escaped_fn}</td></tr></tfoot>"
        m = list(re.finditer(r"</table>", res, re.I))
        if m:
            idx = m[-1].start()
            res = res[:idx] + tfoot_tag + res[idx:]

    return res.strip()


def reconstruct_composite_raw_html(chunk: Dict[str, Any], force: bool = False) -> str:
    """
    복합(composite) 청크의 raw_html에 문단 태그가 누락된 경우,
    chunk['text'](마크다운 본문)와 표 정보를 결합하여 복원된 완성형 HTML을 반환합니다.
    """
    raw_html = chunk.get("raw_html") or ""
    if not force and raw_html and re.search(r"<(?:p|div|span)\b", raw_html, re.I):
        return raw_html

    tables = chunk.get("tables") or (chunk.get("metadata", {}).get("tables") if isinstance(chunk.get("metadata"), dict) else []) or []
    table_htmls = [
        build_outer_table_html(t.get("raw_html", ""), t.get("caption", ""), t.get("footnote", ""))
        for t in tables if t.get("raw_html")
    ]
    if not table_htmls and raw_html:
        table_htmls = re.findall(r"(<table\b[\s\S]*?</table>)", raw_html, re.I)

    text = chunk.get("text") or ""
    if not text:
        return ("\n\n".join(table_htmls) if table_htmls else raw_html) or "<p>내용 없음</p>"

    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    reconstructed_parts: List[str] = []
    tbl_idx = 0

    for b in blocks:
        lines = b.split("\n")
        is_md_table = any(line.strip().startswith("|") for line in lines) and any("---" in line for line in lines)
        is_table_placeholder = (b == "[표]" or bool(re.match(r"^\[표\s*\d*\]$", b))) and not is_md_table

        if is_md_table or is_table_placeholder:
            if tbl_idx < len(table_htmls) and table_htmls[tbl_idx]:
                reconstructed_parts.append(table_htmls[tbl_idx])
                tbl_idx += 1
            else:
                reconstructed_parts.append(f"<pre>{html.escape(b)}</pre>")
        else:
            html_u = format_text_unit_as_html(b)
            if html_u:
                reconstructed_parts.append(html_u)

    while tbl_idx < len(table_htmls):
        if table_htmls[tbl_idx]:
            reconstructed_parts.append(table_htmls[tbl_idx])
        tbl_idx += 1

    return "\n\n".join(reconstructed_parts) or raw_html


def get_chunk_kind(chunk: Dict[str, Any]) -> str:
    """
    청크의 실제 데이터(tables, text, metadata)를 기반으로 UI 및 통계용 종류를 동적 계산합니다.
    """
    meta = chunk.get("metadata") or {}
    if meta.get("article_no") or meta.get("article_number") or chunk.get("chunk_type") in ("article", "article_clause"):
        return "article"
    breadcrumbs = chunk.get("breadcrumbs") or []
    if any(re.match(r"^제\s*\d+\s*조", str(b).strip()) for b in breadcrumbs):
        return "article"

    tables = chunk.get("tables") or meta.get("tables") or []
    raw_html = str(chunk.get("raw_html") or "")
    has_html_table = "<table" in raw_html.lower()
    has_tables = bool(tables or has_html_table or chunk.get("chunk_type") == "table" or chunk.get("is_table"))

    if not has_tables:
        return "paragraph"

    if len(tables) > 1:
        return "composite"

    text = (chunk.get("text") or "").strip()
    caption = str(chunk.get("table_caption") or (tables[0].get("caption") if tables else "") or "").strip()
    footnote = str(chunk.get("table_footnote") or (tables[0].get("footnote") if tables else "") or "").strip()

    non_table_lines = []
    for line in text.split("\n"):
        line_str = line.strip()
        if not line_str:
            continue
        if line_str.startswith("|"):
            continue
        if line_str.startswith("[표") or (caption and caption in line_str) or RE_TABLE_TITLE_TEXT.search(line_str):
            continue
        if line_str.startswith(("*", "※", "출처:")) or (footnote and footnote in line_str) or RE_TABLE_FOOTNOTE_TEXT.search(line_str):
            continue
        non_table_lines.append(line_str)

    has_body_text = len(non_table_lines) > 0
    if has_body_text:
        return "composite"
    return "table"


def heal_composite_chunks(child_chunks: List[Dict[str, Any]]) -> bool:
    """
    child_chunks 목록 중 표와 본문이 함께 있는 복합 청크의 raw_html에 문단 태그가 누락된 항목을 자동 복원합니다.
    """
    changed = False
    for c in child_chunks:
        tables = c.get("tables") or (c.get("metadata") or {}).get("tables") or []
        kind = get_chunk_kind(c)
        if kind == "composite":
            current_raw = c.get("raw_html") or ""
            if not re.search(r"<(?:p|div|span)\b", current_raw, re.I):
                reconstructed = reconstruct_composite_raw_html(c)
                if reconstructed and reconstructed != current_raw:
                    c["raw_html"] = reconstructed
                    changed = True
        elif kind == "table" and tables:
            current_raw = c.get("raw_html") or ""
            clean_table_html = tables[0].get("raw_html") or ""
            if clean_table_html and re.search(r"<(?:p|div|span)\b", current_raw, re.I):
                c["raw_html"] = clean_table_html
                changed = True
    return changed

from typing import Any, Dict, List, Optional, Tuple

from backend.app.services.chunker.constants import (
    RE_ADDENDUM,
    RE_APPENDIX,
    RE_ARTICLE,
    RE_CHAPTER,
    RE_PART,
    RE_SECTION,
    RE_SUBSECTION,
)
from backend.app.services.chunker.strategies.base import BaseChunkingStrategy
from backend.app.services.chunker.text_normalizer import (
    extract_text_from_content,
    extract_text_from_list_block,
)


class LegalChunkingStrategy(BaseChunkingStrategy):
    """
    법률/규정 문서용 3단계 계층 청킹 전략:
    - Section: 편, 장, 절, 관, 부칙, 별표 등 헤딩 트리
    - Parent: 조문(제N조 및 제목) 또는 섹션 서두 문맥
    - Child: 조문 내 항(①, ②), 호(1., 2.), 목(가.), 원자적 표
    """

    def chunk(
        self,
        normalized_pages: List[List[Dict[str, Any]]],
        doc_title: str,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, List[Dict[str, Any]]]]:
        sections: List[Dict[str, Any]] = []
        root_section_id = f"{self.doc_id}_s00"
        root_section = {
            "id": root_section_id,
            "title": doc_title,
            "level": 0,
            "breadcrumbs": [doc_title],
            "parent_chunk_ids": [],
            "child_chunk_ids": [],
            "full_text": "",
            "page_range": [1, 1],
        }
        sections.append(root_section)
        hierarchy_stack = [(0, doc_title, root_section_id)]

        section_counter = 0
        current_sec_id = root_section_id
        section_items: Dict[str, List[Dict[str, Any]]] = {root_section_id: []}

        for page_idx, page_blocks in enumerate(normalized_pages, start=1):
            if not isinstance(page_blocks, list):
                continue

            for block in page_blocks:
                b_type = block.get("type", "").lower()
                b_content = block.get("content", {})

                if self.filter_headers_footers and b_type in ["page_header", "page_footer", "header", "footer", "page_number"]:
                    continue

                if b_type == "title":
                    raw_text = extract_text_from_content(b_content.get("title_content", []))
                elif b_type in ["paragraph", "text"]:
                    raw_text = extract_text_from_content(b_content.get("paragraph_content", []))
                    if not raw_text.strip():
                        if isinstance(b_content, str):
                            raw_text = b_content
                        elif isinstance(b_content.get("content"), str):
                            raw_text = b_content.get("content")
                elif b_type in ["index", "list"]:
                    raw_text = extract_text_from_list_block(b_content, block)
                elif b_type in ["equation", "equation_interline"]:
                    raw_text = b_content.get("math_content", "") or b_content.get("text", "") or block.get("text", "")
                elif b_type == "table":
                    raw_text = ""
                else:
                    raw_text = ""

                clean_text = raw_text.strip()

                if b_type == "table":
                    html_table = b_content.get("html", "")
                    caption = extract_text_from_content(b_content.get("table_caption", []))
                    footnote = extract_text_from_content(b_content.get("table_footnote", []))
                    img_path = b_content.get("image_source", {}).get("path", "")
                    table_type = b_content.get("table_type", "simple_table")

                    current_breadcrumbs = [h[1] for h in hierarchy_stack]
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "table",
                        "raw_html": html_table,
                        "caption": caption,
                        "footnote": footnote,
                        "image_path": img_path,
                        "table_type": table_type,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })
                    continue

                if not clean_text:
                    continue

                level: Optional[int] = None
                matched_title: Optional[str] = None

                m_part = RE_PART.match(clean_text)
                m_chap = RE_CHAPTER.match(clean_text)
                m_sec = RE_SECTION.match(clean_text)
                m_subsec = RE_SUBSECTION.match(clean_text)
                m_addendum = RE_ADDENDUM.match(clean_text)
                m_appendix = RE_APPENDIX.match(clean_text)

                if m_part:
                    level = 1
                    matched_title = clean_text.split("\n")[0]
                elif m_chap or m_addendum:
                    level = 2
                    matched_title = clean_text.split("\n")[0]
                elif m_sec or m_appendix:
                    level = 3
                    matched_title = clean_text.split("\n")[0]
                elif m_subsec:
                    level = 4
                    matched_title = clean_text.split("\n")[0]

                if level is not None and matched_title:
                    section_counter += 1
                    sec_id = f"{self.doc_id}_s{section_counter:02d}"

                    while hierarchy_stack and hierarchy_stack[-1][0] >= level:
                        hierarchy_stack.pop()

                    parent_sec_id = hierarchy_stack[-1][2] if hierarchy_stack else root_section_id
                    breadcrumbs = [h[1] for h in hierarchy_stack] + [matched_title]
                    hierarchy_stack.append((level, matched_title, sec_id))

                    new_section = {
                        "id": sec_id,
                        "title": matched_title,
                        "level": level,
                        "parent_section_id": parent_sec_id,
                        "breadcrumbs": breadcrumbs,
                        "parent_chunk_ids": [],
                        "child_chunk_ids": [],
                        "full_text": f"[{matched_title}]\n",
                        "page_range": [page_idx, page_idx],
                    }
                    sections.append(new_section)
                    current_sec_id = sec_id
                    section_items[current_sec_id] = []
                    continue

                m_art = RE_ARTICLE.match(clean_text)
                current_breadcrumbs = [h[1] for h in hierarchy_stack]

                if m_art:
                    art_label = m_art.group(1).replace(" ", "")
                    art_title = m_art.group(2).strip() if m_art.group(2) else ""
                    art_display = f"{art_label}({art_title})" if art_title else art_label

                    section_items.setdefault(current_sec_id, []).append({
                        "type": "article_start",
                        "article_no": art_label,
                        "article_title": art_title,
                        "article_display": art_display,
                        "text": clean_text,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })
                else:
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "text",
                        "text": clean_text,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })

        return sections, section_items

from typing import Any, Dict, List, Tuple

from backend.app.services.chunker.constants import (
    RE_ARABIC_NUM,
    RE_ARABIC_SUB_NUM,
    RE_ARTICLE,
    RE_CHAPTER,
    RE_KOREAN_CHAR,
    RE_PAREN_NUM,
    RE_PART,
    RE_ROMAN_NUM,
    RE_SECTION,
)
from backend.app.services.chunker.strategies.base import BaseChunkingStrategy
from backend.app.services.chunker.text_normalizer import (
    extract_text_from_content,
    extract_text_from_list_block,
)


class GeneralChunkingStrategy(BaseChunkingStrategy):
    """일반 문서용 헤딩(H1~H2 Section, H3/문단군 Parent, 문장/표 Child) 계층 청킹 전략"""

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
        heading_stack = [(0, doc_title, root_section_id)]

        section_counter = 0
        current_sec_id = root_section_id
        section_items: Dict[str, List[Dict[str, Any]]] = {root_section_id: []}

        for page_idx, page_blocks in enumerate(normalized_pages, start=1):
            if not isinstance(page_blocks, list):
                continue

            for block in page_blocks:
                b_type = block.get("type", "").lower()
                b_content = block.get("content", {})

                if self.filter_headers_footers and b_type in ["page_header", "page_footer", "header", "footer"]:
                    continue

                if b_type == "title":
                    title_text = extract_text_from_content(b_content.get("title_content", []))
                    if not title_text.strip():
                        continue
                    level = b_content.get("level", 1)

                    clean_title = title_text.strip()
                    if RE_ROMAN_NUM.match(clean_title) or RE_PART.match(clean_title) or RE_CHAPTER.match(clean_title):
                        level = 1
                    elif RE_ARABIC_SUB_NUM.match(clean_title):
                        level = 3
                    elif RE_KOREAN_CHAR.match(clean_title) or RE_PAREN_NUM.match(clean_title) or RE_ARTICLE.match(clean_title):
                        level = 3
                    elif RE_ARABIC_NUM.match(clean_title) or RE_SECTION.match(clean_title):
                        has_roman_in_stack = any(h[0] == 1 for h in heading_stack)
                        level = 2 if has_roman_in_stack else min(level, 2)

                    if level <= 2:
                        section_counter += 1
                        sec_id = f"{self.doc_id}_s{section_counter:02d}"

                        while heading_stack and heading_stack[-1][0] >= level:
                            heading_stack.pop()

                        parent_sec_id = heading_stack[-1][2] if heading_stack else root_section_id
                        breadcrumbs = [h[1] for h in heading_stack] + [title_text]
                        heading_stack.append((level, title_text, sec_id))

                        new_sec = {
                            "id": sec_id,
                            "title": title_text,
                            "level": level,
                            "parent_section_id": parent_sec_id,
                            "breadcrumbs": breadcrumbs,
                            "parent_chunk_ids": [],
                            "child_chunk_ids": [],
                            "full_text": f"[{title_text}]\n",
                            "page_range": [page_idx, page_idx],
                        }
                        sections.append(new_sec)
                        current_sec_id = sec_id
                        section_items[current_sec_id] = []
                    else:
                        current_breadcrumbs = [h[1] for h in heading_stack]
                        section_items.setdefault(current_sec_id, []).append({
                            "type": "heading_h3",
                            "title": title_text,
                            "page": page_idx,
                            "breadcrumbs": current_breadcrumbs,
                        })

                elif b_type in ["paragraph", "text", "index", "list", "equation", "equation_interline"]:
                    if b_type in ["index", "list"]:
                        para_text = extract_text_from_list_block(b_content, block)
                    elif b_type in ["equation", "equation_interline"]:
                        para_text = b_content.get("math_content", "") or b_content.get("text", "") or block.get("text", "")
                    else:
                        para_text = extract_text_from_content(b_content.get("paragraph_content", []))
                        if not para_text.strip():
                            if isinstance(b_content, str):
                                para_text = b_content
                            elif isinstance(b_content.get("content"), str):
                                para_text = b_content.get("content")
                    if not para_text.strip():
                        continue

                    current_breadcrumbs = [h[1] for h in heading_stack]
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "text",
                        "text": para_text.strip(),
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })

                elif b_type == "table":
                    html_table = b_content.get("html", "")
                    caption = extract_text_from_content(b_content.get("table_caption", []))
                    footnote = extract_text_from_content(b_content.get("table_footnote", []))
                    img_path = b_content.get("image_source", {}).get("path", "")
                    table_type = b_content.get("table_type", "simple_table")

                    current_breadcrumbs = [h[1] for h in heading_stack]
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

        return sections, section_items

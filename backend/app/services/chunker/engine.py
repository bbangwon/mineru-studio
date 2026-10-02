import html
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from backend.app.services.chunker.constants import (
    RE_ADDENDUM,
    RE_APPENDIX,
    RE_ARABIC_NUM,
    RE_ARABIC_SUB_NUM,
    RE_ARTICLE,
    RE_CHAPTER,
    RE_GENERAL_SENTENCE_END,
    RE_KOREAN_CHAR,
    RE_KOREAN_SENTENCE_END,
    RE_LEGAL_SPLIT,
    RE_PAREN_NUM,
    RE_PART,
    RE_ROMAN_NUM,
    RE_SECTION,
    RE_SUBSECTION,
    RE_TABLE_FOOTNOTE_TEXT,
    RE_TABLE_TITLE_TEXT,
)
from backend.app.services.chunker.jsonl_exporter import export_to_jsonl
from backend.app.services.chunker.reindexer import (
    calculate_stats,
    generate_doc_id,
    recalculate_section_hierarchy,
    reconcile_hierarchy_integrity,
    reindex_etl_result,
    sync_section_page_ranges,
)
from backend.app.services.chunker.strategies.general import GeneralChunkingStrategy
from backend.app.services.chunker.strategies.legal import LegalChunkingStrategy
from backend.app.services.chunker.table_extractor import (
    _HTMLTableExtractor,
    build_outer_table_html,
    format_table_footnote,
    format_table_title,
    format_text_unit_as_html,
    generate_table_search_text,
    get_chunk_kind,
    heal_composite_chunks,
    html_table_to_markdown,
    reconstruct_composite_raw_html,
    strip_table_meta_tags,
)
from backend.app.services.chunker.text_normalizer import (
    _force_split_large_sentence,
    estimate_korean_tokens,
    extract_text_from_content,
    extract_text_from_list_block,
    normalize_parent_text,
    normalize_text_for_embedding,
    repair_soft_wraps,
    split_text_into_units,
)

logger = logging.getLogger(__name__)


class HierarchicalChunker:
    """
    MinerU 파싱 결과를 입력받아 3단계 계층 구조(Section - Parent - Child)로
    RAG 검색 및 LLM 생성에 최적화된 청크를 생성하는 엔진.
    """

    # 정규식 상수 하위 호환성 바인딩
    RE_PART = RE_PART
    RE_CHAPTER = RE_CHAPTER
    RE_SECTION = RE_SECTION
    RE_SUBSECTION = RE_SUBSECTION
    RE_ADDENDUM = RE_ADDENDUM
    RE_ARTICLE = RE_ARTICLE
    RE_APPENDIX = RE_APPENDIX
    RE_ROMAN_NUM = RE_ROMAN_NUM
    RE_ARABIC_SUB_NUM = RE_ARABIC_SUB_NUM
    RE_ARABIC_NUM = RE_ARABIC_NUM
    RE_KOREAN_CHAR = RE_KOREAN_CHAR
    RE_PAREN_NUM = RE_PAREN_NUM
    RE_LEGAL_SPLIT = RE_LEGAL_SPLIT
    RE_KOREAN_SENTENCE_END = RE_KOREAN_SENTENCE_END
    RE_GENERAL_SENTENCE_END = RE_GENERAL_SENTENCE_END
    RE_TABLE_TITLE_TEXT = RE_TABLE_TITLE_TEXT
    RE_TABLE_FOOTNOTE_TEXT = RE_TABLE_FOOTNOTE_TEXT

    # 정적 / 클래스 메서드 하위 호환성 바인딩
    format_table_title = staticmethod(format_table_title)
    format_table_footnote = staticmethod(format_table_footnote)
    generate_doc_id = staticmethod(generate_doc_id)
    normalize_text_for_embedding = staticmethod(normalize_text_for_embedding)
    repair_soft_wraps = classmethod(lambda cls, text: repair_soft_wraps(text))
    normalize_parent_text = classmethod(lambda cls, text, preserve_newlines=False: normalize_parent_text(text, preserve_newlines))
    estimate_korean_tokens = staticmethod(estimate_korean_tokens)
    split_text_into_units = classmethod(lambda cls, text, is_legal=False, max_tokens=512: split_text_into_units(text, is_legal, max_tokens))
    _force_split_large_sentence = classmethod(lambda cls, sentence, max_tokens=512: _force_split_large_sentence(sentence, max_tokens))
    generate_table_search_text = classmethod(lambda cls, raw_html, caption="", footnote="", max_tokens=512: generate_table_search_text(raw_html, caption, footnote, max_tokens))
    html_table_to_markdown = classmethod(lambda cls, raw_html, caption=None, footnote=None: html_table_to_markdown(raw_html, caption, footnote))
    _format_text_unit_as_html = staticmethod(format_text_unit_as_html)
    strip_table_meta_tags = classmethod(lambda cls, html_str: strip_table_meta_tags(html_str))
    build_outer_table_html = classmethod(lambda cls, raw_html, caption="", footnote="": build_outer_table_html(raw_html, caption, footnote))
    reconstruct_composite_raw_html = classmethod(lambda cls, chunk, force=False: reconstruct_composite_raw_html(chunk, force))
    get_chunk_kind = classmethod(lambda cls, chunk: get_chunk_kind(chunk))
    heal_composite_chunks = classmethod(lambda cls, child_chunks: heal_composite_chunks(child_chunks))
    recalculate_section_hierarchy = classmethod(lambda cls, sections, doc_title="": recalculate_section_hierarchy(sections, doc_title))
    sync_section_page_ranges = classmethod(lambda cls, sections, child_chunks: sync_section_page_ranges(sections, child_chunks))
    reconcile_hierarchy_integrity = classmethod(lambda cls, sections, parents, children, doc_title="": reconcile_hierarchy_integrity(sections, parents, children, doc_title))
    reindex_etl_result = classmethod(lambda cls, etl_result: reindex_etl_result(etl_result))
    _calculate_stats = classmethod(lambda cls, sections, parents, children: calculate_stats(sections, parents, children))

    def __init__(self, doc_id: Optional[str] = None, filter_headers_footers: bool = True, preserve_newlines: bool = False):
        self.doc_id = self.generate_doc_id(doc_id)
        self.filter_headers_footers = filter_headers_footers
        self.preserve_newlines = preserve_newlines

    def export_to_jsonl(self, etl_result: Dict[str, Any]) -> str:
        return export_to_jsonl(etl_result, default_doc_id=self.doc_id)

    def _extract_text_from_content(self, content_items: Any) -> str:
        return extract_text_from_content(content_items)

    def _extract_text_from_list_block(self, b_content: Any, block: Optional[Dict[str, Any]] = None) -> str:
        return extract_text_from_list_block(b_content, block)

    def chunk_content_list(
        self,
        content_list: List[Any],
        doc_title: str = "Document",
        strategy: str = "general",
        preserve_newlines: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        MinerU의 content_list를 순회하여 정규 3단계 계층 구조
        (Section - Parent Chunk - Child Chunk)를 생성합니다.
        """
        if preserve_newlines is not None:
            self.preserve_newlines = preserve_newlines
        if not content_list:
            return {
                "doc_id": self.doc_id,
                "doc_title": doc_title,
                "strategy": strategy,
                "stats": {
                    "total_sections": 0,
                    "total_parent_sections": 0,
                    "total_parent_chunks": 0,
                    "total_child_chunks": 0,
                    "paragraph_chunks": 0,
                    "table_chunks": 0,
                    "total_words": 0,
                },
                "sections": [],
                "parent_sections": [],
                "parent_chunks": [],
                "child_chunks": [],
            }

        normalized_pages = self._normalize_content_list(content_list)
        if strategy == "legal":
            strat_impl = LegalChunkingStrategy(self.doc_id, self.filter_headers_footers)
            is_legal = True
        else:
            strat_impl = GeneralChunkingStrategy(self.doc_id, self.filter_headers_footers)
            is_legal = False

        sections, section_items = strat_impl.chunk(normalized_pages, doc_title)

        all_parent_chunks: List[Dict[str, Any]] = []
        all_child_chunks: List[Dict[str, Any]] = []

        child_counter = 0
        parent_counter = 0

        for sec in sections:
            sec_id = sec["id"]
            items = section_items.get(sec_id, [])
            if not items:
                continue

            sec_children, child_counter = self._pack_to_child_chunks(
                items=items,
                sec_id=sec_id,
                child_counter=child_counter,
                doc_title=doc_title,
                is_legal=is_legal,
            )

            sec_parents, parent_counter = self._pack_to_parent_chunks(
                child_chunks=sec_children,
                sec_id=sec_id,
                sec_title=sec["title"],
                parent_counter=parent_counter,
            )

            all_child_chunks.extend(sec_children)
            all_parent_chunks.extend(sec_parents)

            sec["parent_chunk_ids"] = [p["parent_chunk_id"] for p in sec_parents]
            sec["child_chunk_ids"] = [c["chunk_id"] for c in sec_children]
            if sec_children:
                sec["page_range"] = [
                    min(c["page_number"] for c in sec_children),
                    max(c.get("page_end", c["page_number"]) for c in sec_children),
                ]
                sec["full_text"] = "\n\n".join(p["text"] for p in sec_parents)

        self.recalculate_section_hierarchy(sections, doc_title=doc_title)
        stats = self._calculate_stats(sections, all_parent_chunks, all_child_chunks)

        return {
            "doc_id": self.doc_id,
            "doc_title": doc_title,
            "strategy": strategy,
            "stats": stats,
            "sections": sections,
            "parent_sections": sections,
            "parent_chunks": all_parent_chunks,
            "child_chunks": all_child_chunks,
        }

    def _normalize_content_list(self, content_list: List[Any]) -> List[List[Dict[str, Any]]]:
        """v1 및 v2 구조를 표준 2차원 리스트(페이지별 블록 목록)로 정규화"""
        if not content_list:
            return []

        if isinstance(content_list[0], list):
            return content_list

        if isinstance(content_list[0], dict):
            max_page = max((b.get("page_idx", 0) for b in content_list if isinstance(b, dict)), default=0)
            pages_dict: Dict[int, List[Dict[str, Any]]] = {p: [] for p in range(max_page + 1)}
            for item in content_list:
                if not isinstance(item, dict):
                    continue
                p_idx = item.get("page_idx", 0)

                if "content" in item and isinstance(item["content"], dict):
                    pages_dict.setdefault(p_idx, []).append(item)
                    continue

                b_type = item.get("type", "text")
                text_val = item.get("text", "")
                level = item.get("text_level")

                if b_type == "text" and level is not None:
                    block = {
                        "type": "title",
                        "content": {"title_content": [{"type": "text", "content": text_val}], "level": int(level)},
                        "bbox": item.get("bbox", []),
                    }
                elif b_type == "table":
                    caption_val = item.get("table_caption", "")
                    if isinstance(caption_val, list):
                        cap_list = caption_val
                    elif isinstance(caption_val, str) and caption_val:
                        cap_list = [{"type": "text", "content": caption_val}]
                    else:
                        cap_list = []

                    footnote_val = item.get("table_footnote", "")
                    if isinstance(footnote_val, list):
                        fn_list = footnote_val
                    elif isinstance(footnote_val, str) and footnote_val:
                        fn_list = [{"type": "text", "content": footnote_val}]
                    else:
                        fn_list = []

                    block = {
                        "type": "table",
                        "content": {
                            "html": item.get("table_body", "") or item.get("html", ""),
                            "table_caption": cap_list,
                            "table_footnote": fn_list,
                            "image_source": {"path": item.get("img_path", "")},
                        },
                        "bbox": item.get("bbox", []),
                    }
                elif b_type in ["index", "list"]:
                    list_text = item.get("text", "")
                    if not list_text and "list_items" in item:
                        list_text = "\n".join(str(it) for it in item["list_items"] if str(it).strip())
                    block = {
                        "type": b_type,
                        "content": {"list_items": item.get("list_items", []), "text": list_text},
                        "bbox": item.get("bbox", []),
                    }
                else:
                    block = {
                        "type": b_type,
                        "content": {"paragraph_content": [{"type": "text", "content": text_val}]},
                        "bbox": item.get("bbox", []),
                    }
                pages_dict.setdefault(p_idx, []).append(block)
            return [pages_dict[p] for p in sorted(pages_dict.keys())]
        return content_list

    def _pack_to_child_chunks(
        self,
        items: List[Dict[str, Any]],
        sec_id: str,
        child_counter: int,
        doc_title: str,
        is_legal: bool = False
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        수집된 원시 블록들을 문장/조항 분할 후 512 토큰 한도 내로 Child Chunk로 패킹합니다.
        표(Table) 블록은 원자성을 보존하여 단독 Child Chunk로 생성합니다.
        """
        child_chunks: List[Dict[str, Any]] = []

        MICRO_TABLE_MAX_TOKENS = 180
        MICRO_TABLE_MAX_ROWS = 6

        current_text_units: List[str] = []
        current_html_units: List[str] = []
        current_tables: List[Dict[str, Any]] = []
        current_tokens = 0
        current_start_page: Optional[int] = None
        current_end_page: Optional[int] = None
        current_breadcrumbs: List[str] = []
        current_meta: Dict[str, Any] = {}
        current_chunk_type = "paragraph"
        current_heading_title: Optional[str] = None

        def flush_child_chunk():
            nonlocal child_counter, current_text_units, current_html_units, current_tables, current_tokens, current_start_page, current_end_page
            if not current_text_units:
                return

            cleaned_units = [u.strip() for u in current_text_units if u.strip()]
            if not cleaned_units:
                current_text_units = []
                current_html_units = []
                current_tables = []
                current_tokens = 0
                current_start_page = None
                current_end_page = None
                return

            is_heading_chunk = bool(
                cleaned_units and (
                    (current_heading_title and (
                        cleaned_units[0] == current_heading_title
                        or cleaned_units[0] == f"{current_heading_title} (계속)"
                    ))
                    or cleaned_units[0].startswith("### ")
                )
            )

            if current_tables or self.preserve_newlines:
                full_child_text = "\n\n".join(u for u in cleaned_units if u)
            else:
                if is_heading_chunk:
                    h_unit = cleaned_units[0]
                    body_units = cleaned_units[1:]
                    if body_units:
                        full_child_text = f"{h_unit}\n\n" + self.normalize_text_for_embedding(" ".join(body_units))
                    else:
                        full_child_text = h_unit
                else:
                    full_child_text = self.normalize_text_for_embedding(" ".join(cleaned_units))

            if not full_child_text:
                current_text_units = []
                current_html_units = []
                current_tables = []
                current_tokens = 0
                current_start_page = None
                current_end_page = None
                return

            child_counter += 1
            cid = f"{self.doc_id}_c{child_counter:04d}"
            start_p = current_start_page if current_start_page is not None else 1
            end_p = current_end_page if current_end_page is not None else start_p
            if end_p < start_p:
                end_p = start_p
            pages_list = list(range(start_p, end_p + 1))

            meta = dict(current_meta)
            meta["doc_title"] = doc_title
            meta["page"] = start_p
            meta["page_start"] = start_p
            meta["page_end"] = end_p
            meta["pages"] = pages_list
            if is_heading_chunk:
                heading_val = current_heading_title or (
                    cleaned_units[0][4:].strip() if cleaned_units[0].startswith("### ") else cleaned_units[0]
                )
                meta["heading_title"] = heading_val

            if current_tables:
                # 1개의 표만 존재할 때, 함께 있는 텍스트 유닛들이 표 제목/각주에 해당하는지 검사
                is_pure_table = False
                extracted_caption = None
                extracted_footnote = None

                if len(current_tables) == 1:
                    single_t = current_tables[0]
                    if len(cleaned_units) == 1:
                        is_pure_table = True
                        extracted_caption = single_t.get("caption") or None
                        extracted_footnote = single_t.get("footnote") or None
                    else:
                        # 표 자체 마크다운(| ... |\n| --- |)을 제외한 나머지 유닛 검사
                        non_table_units = []
                        for u in cleaned_units:
                            u_str = u.strip()
                            if ("| ---" in u_str or "|---" in u_str) and "\n|" in u_str:
                                continue
                            non_table_units.append(u_str)

                        title_cands = []
                        fn_cands = []
                        other_cands = []
                        for u in non_table_units:
                            if self.RE_TABLE_TITLE_TEXT.search(u):
                                title_cands.append(u)
                            elif self.RE_TABLE_FOOTNOTE_TEXT.search(u):
                                fn_cands.append(u)
                            else:
                                other_cands.append(u)

                        # 일반 본문 문단이 전혀 없고 오직 표 제목/각주만 존재하는 경우 -> 순수 표 청크로 확정
                        if not other_cands:
                            is_pure_table = True
                            cap_parts = []
                            if single_t.get("caption"):
                                cap_parts.append(single_t.get("caption"))
                            for t in title_cands:
                                m = re.search(r"\*\*\[표\s*(?:제목)?:\s*(.+?)\]\*\*", t)
                                if m:
                                    cap_parts.append(m.group(1).strip())
                                else:
                                    clean_t = self.RE_TABLE_TITLE_TEXT.sub("", t).strip(" :-_[]()【】*")
                                    cap_parts.append(clean_t or t)
                            extracted_caption = " / ".join(p for p in cap_parts if p) or None

                            fn_parts = []
                            if single_t.get("footnote"):
                                fn_parts.append(single_t.get("footnote"))
                            for f in fn_cands:
                                m = re.search(r"\*\*\[표\s*각주:\s*(.+?)\]\*\*", f)
                                if m:
                                    fn_parts.append(m.group(1).strip())
                                else:
                                    clean_f = self.RE_TABLE_FOOTNOTE_TEXT.sub("", f).strip(" :-_[]()【】*")
                                    fn_parts.append(clean_f or f)
                            extracted_footnote = " / ".join(p for p in fn_parts if p) or None

                if is_pure_table:
                    chunk_type = "table"
                    is_table = True
                    is_atomic_table = True
                    single_t = current_tables[0]
                    tbl_caption = extracted_caption
                    tbl_footnote = extracted_footnote
                    single_t["caption"] = tbl_caption or ""
                    single_t["footnote"] = tbl_footnote or ""
                    combined_raw_html = self.build_outer_table_html(single_t.get("raw_html", ""), tbl_caption or "", tbl_footnote or "")
                    meta["type"] = "table"
                    meta["has_tables"] = True
                    meta["table_count"] = 1
                    full_child_text = self.generate_table_search_text(combined_raw_html, tbl_caption or "", tbl_footnote or "")
                else:
                    # 복합 청크: 문단(<p>)과 표(<table>)가 문서 순서대로 결합된 완성형 HTML
                    combined_raw_html = "\n\n".join(u for u in current_html_units if u.strip())
                    if not combined_raw_html:
                        combined_raw_html = "\n<hr class=\"table-sep my-2\"/>\n".join(
                            t["raw_html"] for t in current_tables if t.get("raw_html")
                        )
                    chunk_type = "composite"
                    is_table = True
                    is_atomic_table = False
                    meta["type"] = "composite"
                    meta["has_tables"] = True
                    meta["table_count"] = len(current_tables)
                    tbl_caption = None
                    tbl_footnote = None
            else:
                combined_raw_html = ""
                chunk_type = current_chunk_type
                is_table = False
                is_atomic_table = False
                tbl_caption = None
                tbl_footnote = None
                if "type" not in meta:
                    meta["type"] = chunk_type

            child_tokens = self.estimate_korean_tokens(full_child_text)
            if "doc_id" not in meta and self.doc_id:
                meta["doc_id"] = self.doc_id

            child_chunks.append({
                "chunk_id": cid,
                "doc_id": self.doc_id,
                "parent_chunk_id": "",  # Parent 패킹 시 주입
                "parent_id": "",        # 하위 호환성 별칭
                "section_id": sec_id,
                "chunk_type": chunk_type,
                "text": full_child_text,
                "raw_html": combined_raw_html,
                "table_caption": tbl_caption,
                "table_footnote": tbl_footnote,
                "tables": list(current_tables) if current_tables else [],
                "token_estimate": child_tokens,
                "page_number": start_p,
                "page_end": end_p,
                "breadcrumbs": list(current_breadcrumbs),
                "is_table": is_table,
                "is_atomic_table": is_atomic_table,
                "metadata": meta,
            })

            current_text_units = []
            current_html_units = []
            current_tables = []
            current_tokens = 0
            current_start_page = None
            current_end_page = None

        for item in items:
            i_type = item.get("type", "text")
            page_num = item.get("page", 1)
            breadcrumbs = item.get("breadcrumbs", [])

            if i_type == "table":
                raw_html = item.get("raw_html", "")
                caption = item.get("caption", "")
                footnote = item.get("footnote", "")
                table_type = item.get("table_type", "simple_table")
                tbl_start_p = item.get("page", 1)
                tbl_end_p = item.get("page_end", tbl_start_p)
                if tbl_end_p < tbl_start_p:
                    tbl_end_p = tbl_start_p
                tbl_pages = list(range(tbl_start_p, tbl_end_p + 1))

                search_text = self.generate_table_search_text(raw_html, caption, footnote)
                tbl_tokens = self.estimate_korean_tokens(search_text)
                raw_html_tokens = self.estimate_korean_tokens(raw_html) if raw_html else tbl_tokens

                # 행 수 계산
                row_count = 0
                if raw_html:
                    try:
                        parser = _HTMLTableExtractor()
                        parser.feed(raw_html)
                        row_count = len(parser.rows)
                    except Exception:
                        row_count = 0

                # 1) 이전 누적 텍스트와 합쳤을 때 512 토큰 초과 시 이전 텍스트 먼저 flush
                if tbl_tokens <= MICRO_TABLE_MAX_TOKENS and (current_tokens + tbl_tokens > 512) and current_text_units:
                    flush_child_chunk()

                # 2) 소형 표 판별 (법률 문서는 원자성 보존, 일반 문서에서 180 토큰 이하 & 6행 이하인 경우 인라인 병합)
                is_micro_table = (
                    not is_legal
                    and (
                        (0 < row_count <= MICRO_TABLE_MAX_ROWS and tbl_tokens <= MICRO_TABLE_MAX_TOKENS)
                        or (row_count == 0 and raw_html_tokens <= MICRO_TABLE_MAX_TOKENS)
                    )
                    and (current_tokens + tbl_tokens <= 512)
                )

                if is_micro_table:
                    md_table = self.html_table_to_markdown(raw_html, caption=caption, footnote=footnote)
                    if not md_table:
                        md_table = search_text

                    if current_start_page is None:
                        current_start_page = tbl_start_p
                    current_end_page = max(current_end_page or tbl_start_p, tbl_end_p)
                    if not current_breadcrumbs:
                        current_breadcrumbs = list(breadcrumbs)

                    current_text_units.append(md_table)
                    current_html_units.append(self.build_outer_table_html(raw_html, caption, footnote))
                    current_tokens += tbl_tokens
                    current_tables.append({
                        "table_index": len(current_tables),
                        "caption": caption,
                        "footnote": footnote,
                        "raw_html": raw_html,
                        "table_type": table_type,
                        "page_number": tbl_start_p,
                        "page_end": tbl_end_p,
                        "row_count": row_count,
                        "token_estimate": tbl_tokens,
                    })
                    continue

                # 3) 대형 표 또는 법률 문서 표인 경우: 이전 텍스트 유닛 중 단독 표 제목 패턴이 있으면 흡수 후 flush
                if len(current_text_units) == 1 and current_heading_title and current_text_units[0] in (current_heading_title, f"### {current_heading_title}"):
                    if not caption:
                        caption = current_heading_title
                    current_text_units = []
                    current_html_units = []
                    current_tokens = 0
                elif len(current_text_units) == 1 and self.RE_TABLE_TITLE_TEXT.search(current_text_units[0]):
                    if not caption:
                        m = re.search(r"\*\*\[표\s*(?:제목)?:\s*(.+?)\]\*\*", current_text_units[0])
                        if m:
                            caption = m.group(1).strip()
                        else:
                            clean_t = self.RE_TABLE_TITLE_TEXT.sub("", current_text_units[0]).strip(" :-_[]()【】*")
                            caption = clean_t or current_text_units[0]
                    current_text_units = []
                    current_html_units = []
                    current_tokens = 0
                else:
                    flush_child_chunk()

                child_counter += 1
                cid = f"{self.doc_id}_c{child_counter:04d}"

                effective_breadcrumbs = list(current_breadcrumbs) if current_breadcrumbs else list(breadcrumbs)

                tbl_meta = {
                    "doc_title": doc_title,
                    "type": "table",
                    "has_tables": True,
                    "table_count": 1,
                    "page": tbl_start_p,
                    "page_start": tbl_start_p,
                    "page_end": tbl_end_p,
                    "pages": tbl_pages,
                }

                if current_meta.get("article_display"):
                    tbl_meta["article_no"] = current_meta.get("article_no", "")
                    tbl_meta["article_title"] = current_meta.get("article_title", "")
                    tbl_meta["article_display"] = current_meta.get("article_display", "")

                if "doc_id" not in tbl_meta and self.doc_id:
                    tbl_meta["doc_id"] = self.doc_id

                child_chunks.append({
                    "chunk_id": cid,
                    "doc_id": self.doc_id,
                    "parent_chunk_id": "",
                    "parent_id": "",
                    "section_id": sec_id,
                    "chunk_type": "table",
                    "text": search_text,
                    "raw_html": self.build_outer_table_html(raw_html, caption, footnote),
                    "table_caption": caption,
                    "table_footnote": footnote,
                    "table_type": table_type,
                    "tables": [{
                        "table_index": 0,
                        "caption": caption,
                        "footnote": footnote,
                        "raw_html": raw_html,
                        "table_type": table_type,
                        "page_number": tbl_start_p,
                        "page_end": tbl_end_p,
                        "row_count": row_count,
                        "token_estimate": tbl_tokens,
                    }],
                    "token_estimate": tbl_tokens,
                    "page_number": tbl_start_p,
                    "page_end": tbl_end_p,
                    "breadcrumbs": effective_breadcrumbs,
                    "is_table": True,
                    "is_atomic_table": True,
                    "metadata": tbl_meta,
                })
                continue

            if i_type == "article_start":
                flush_child_chunk()
                current_breadcrumbs = breadcrumbs
                current_chunk_type = "article"
                current_meta = {
                    "type": "article",
                    "article_no": item.get("article_no", ""),
                    "article_title": item.get("article_title", ""),
                    "article_display": item.get("article_display", ""),
                }

                raw_art_text = item.get("text", "")
                units = self.split_text_into_units(raw_art_text, is_legal=True, max_tokens=512)
                for u in units:
                    u_tokens = self.estimate_korean_tokens(u)
                    if current_tokens + u_tokens > 512 and current_text_units:
                        flush_child_chunk()
                    if current_start_page is None:
                        current_start_page = page_num
                    current_end_page = page_num
                    current_text_units.append(u)
                    html_u = self._format_text_unit_as_html(u)
                    if html_u:
                        current_html_units.append(html_u)
                    current_tokens += u_tokens
                continue

            if i_type == "heading_h3":
                flush_child_chunk()
                title_text = item.get("title", "").strip()
                current_breadcrumbs = list(breadcrumbs)
                current_chunk_type = "paragraph"
                current_meta = {}
                current_heading_title = title_text
                if title_text:
                    heading_unit = title_text
                    current_text_units.append(heading_unit)
                    html_u = self._format_text_unit_as_html(heading_unit)
                    if html_u:
                        current_html_units.append(html_u)
                    current_tokens += self.estimate_korean_tokens(heading_unit)
                    if current_start_page is None:
                        current_start_page = page_num
                    current_end_page = page_num
                continue

            raw_text = item.get("text", "")
            if not current_breadcrumbs:
                current_breadcrumbs = breadcrumbs

            units = self.split_text_into_units(raw_text, is_legal=is_legal, max_tokens=512)
            for u in units:
                u_tokens = self.estimate_korean_tokens(u)
                if current_tokens + u_tokens > 512 and current_text_units:
                    flush_child_chunk()
                    if current_heading_title and not is_legal:
                        cont_heading = f"{current_heading_title} (계속)"
                        current_text_units.append(cont_heading)
                        html_u = self._format_text_unit_as_html(cont_heading)
                        if html_u:
                            current_html_units.append(html_u)
                        current_tokens += self.estimate_korean_tokens(cont_heading)
                if current_start_page is None:
                    current_start_page = page_num
                current_end_page = page_num
                current_text_units.append(u)
                html_u = self._format_text_unit_as_html(u)
                if html_u:
                    current_html_units.append(html_u)
                current_tokens += u_tokens

        flush_child_chunk()
        return child_chunks, child_counter


    def _pack_to_parent_chunks(
        self,
        child_chunks: List[Dict[str, Any]],
        sec_id: str,
        sec_title: str,
        parent_counter: int
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        Child Chunk들을 2048 토큰 한도 내로 결합하여 완성도 높은 LLM 문맥용 Parent Chunk를 생성합니다.
        2048 토큰을 초과하는 초대형 표는 독립 Parent Chunk로 단독 승격합니다.
        """
        parent_chunks: List[Dict[str, Any]] = []
        if not child_chunks:
            return parent_chunks, parent_counter

        current_children: List[Dict[str, Any]] = []
        current_tokens = 0
        current_parent_title: Optional[str] = None

        def _get_child_heading(c_node: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
            art = c_node.get("metadata", {}).get("article_display")
            if art:
                return art, art
            h_meta = c_node.get("metadata", {}).get("heading_title")
            if h_meta:
                clean_h = re.sub(r"\s*\(계속\)$", "", h_meta.strip())
                return clean_h, None
            h_match = re.match(r"^###\s+([^\n]+)", c_node.get("text", ""))
            if h_match:
                clean_h = re.sub(r"\s*\(계속\)$", "", h_match.group(1).strip())
                return clean_h, None
            return None, None

        def flush_parent():
            nonlocal parent_counter, current_children, current_tokens, current_parent_title
            if not current_children:
                return

            parent_counter += 1
            pid = f"{self.doc_id}_p{parent_counter:04d}"

            body_parts = []
            for c in current_children:
                if c.get("chunk_type") == "table":
                    cap = c.get("table_caption")
                    cap_prefix = f"[표: {cap}]\n" if cap else "[표]\n"
                    table_content = c.get("raw_html") or c.get("text", "")
                    c_text = f"{cap_prefix}{table_content}".strip()
                else:
                    c_text = c.get("text", "")

                if not c_text:
                    continue

                if not body_parts:
                    body_parts.append(c_text)
                else:
                    h_title = c.get("metadata", {}).get("heading_title")
                    is_h = bool(h_title and (c_text.startswith(h_title) or c_text.startswith(f"### {h_title}")))
                    if not is_h and not c.get("metadata", {}).get("article_display"):
                        is_h = bool(re.match(r"^###\s+", c_text))

                    if is_h:
                        # 소제목 앞은 빈 줄 2개(\n\n\n)로 여백 구분
                        body_parts.append("\n\n\n" + c_text)
                    else:
                        # 일반 문단 간격은 빈 줄 1개(\n\n)
                        body_parts.append("\n\n" + c_text)

            body_text = "".join(body_parts).strip()

            first_c = current_children[0]
            sec_bcs = first_c.get("breadcrumbs") or [sec_title]
            bc_str = " > ".join(sec_bcs)

            distinct_headings = []
            for c in current_children:
                h_name, _ = _get_child_heading(c)
                effective_h = h_name or sec_title
                if effective_h and effective_h not in distinct_headings:
                    distinct_headings.append(effective_h)

            if len(distinct_headings) > 1 and not first_c.get("metadata", {}).get("article_display"):
                title_val = sec_title
            else:
                title_val = current_parent_title or first_c.get("metadata", {}).get("article_display") or sec_title

            if current_parent_title and current_parent_title.endswith(" (계속)"):
                context_header = f"[{bc_str} (계속)]"
            else:
                context_header = f"[{bc_str}]"
            raw_parent_text = f"{context_header}\n\n{body_text}".strip()
            parent_full_text = self.normalize_parent_text(raw_parent_text, preserve_newlines=self.preserve_newlines)

            p_tokens = self.estimate_korean_tokens(parent_full_text)
            p_chunk = {
                "parent_chunk_id": pid,
                "doc_id": self.doc_id,
                "id": pid,  # 호환성 별칭
                "section_id": sec_id,
                "title": title_val,
                "breadcrumbs": list(sec_bcs),
                "text": parent_full_text,
                "token_estimate": p_tokens,
                "child_chunk_ids": [c["chunk_id"] for c in current_children],
                "page_range": [
                    min(c["page_number"] for c in current_children),
                    max(c.get("page_end", c["page_number"]) for c in current_children),
                ],
            }
            parent_chunks.append(p_chunk)

            for c in current_children:
                c["parent_chunk_id"] = pid
                c["parent_id"] = pid

            current_children = []
            current_tokens = 0
            current_parent_title = None

        for child in child_chunks:
            # 1. 2048 토큰을 초과하는 초대형 표 단독 승격 규칙
            raw_html_len = len(child.get("raw_html", "")) if child.get("raw_html") else 0
            raw_table_tokens = self.estimate_korean_tokens(child.get("raw_html", "")) if raw_html_len > 0 else child["token_estimate"]

            if child.get("chunk_type") == "table" and raw_table_tokens > 2048:
                flush_parent()
                current_children.append(child)
                current_tokens = raw_table_tokens
                current_parent_title = child.get("table_caption") or f"{sec_title} - 대형 표"
                flush_parent()
                continue

            # 2. 제목 식별: 법률 조문(article_display) 또는 일반 문서 Heading(metadata heading_title / 텍스트 헤딩)
            h_name, art_disp = _get_child_heading(child)
            target_heading = h_name or sec_title

            # 제목 변경 감지 시 독립 Parent 생성 (단, '(계속)' 접미사가 붙은 현재 제목의 베이스 타이틀과 비교)
            base_parent_title = current_parent_title.replace(" (계속)", "") if current_parent_title else None
            if art_disp:
                # [법률 문서] 조문(제N조) 변경 감지 시 토큰 수와 무관하게 즉시 분할 (1조문 = 1부모 원칙 보존)
                if base_parent_title and target_heading and base_parent_title != target_heading:
                    flush_parent()
            else:
                # [일반 문서] 소제목 변경 감지 시 누적 토큰이 MIN_PARENT_TOKENS(1600) 이상일 때만 분할하여 풍부한 문맥 보장
                MIN_PARENT_TOKENS = 1600
                if base_parent_title and target_heading and base_parent_title != target_heading:
                    if current_tokens >= MIN_PARENT_TOKENS:
                        flush_parent()

            if not current_parent_title and target_heading:
                current_parent_title = target_heading

            # 3. 2048 토큰 초과 검사
            c_tokens = child.get("token_estimate", 0)
            if current_tokens + c_tokens > 2048 and current_children:
                flush_parent()
                if target_heading:
                    current_parent_title = f"{target_heading} (계속)"

            current_children.append(child)
            current_tokens += c_tokens

        flush_parent()
        return parent_chunks, parent_counter


import json
from typing import Any, Dict, List, Optional

from backend.app.services.chunker.reindexer import generate_doc_id
from backend.app.services.chunker.table_extractor import (
    build_outer_table_html,
    get_chunk_kind,
    reconstruct_composite_raw_html,
    strip_table_meta_tags,
)
from backend.app.services.chunker.text_normalizer import estimate_korean_tokens


def export_to_jsonl(etl_result: Dict[str, Any], default_doc_id: Optional[str] = None) -> str:
    """
    RAG Vector DB 및 하이브리드 검색 엔진 적재를 위한 표준 JSONL을 생성합니다.
    - 검색/임베딩 대상: text
    - LLM 프롬프트 생성 문맥: parent_context_text (Small-to-Big Retrieval 100% 지원)
    - Qdrant 및 메타데이터 필터링 지원: 최상위 및 metadata 내 doc_id, doc_title 주입
    """
    lines: List[str] = []
    etl_doc_id = (
        etl_result.get("doc_id")
        or default_doc_id
        or (generate_doc_id(etl_result.get("doc_title")) if etl_result.get("doc_title") else None)
    )
    global_doc_title = etl_result.get("doc_title", "")

    parent_map = {
        p.get("parent_chunk_id", p.get("id", "")): p
        for p in etl_result.get("parent_chunks", [])
    }
    sec_list = etl_result.get("sections") or etl_result.get("parent_sections") or []
    section_map = {s["id"]: s for s in sec_list}

    for chunk in etl_result.get("child_chunks", []):
        if chunk.get("is_ignored"):
            continue

        pid = chunk.get("parent_chunk_id") or chunk.get("parent_id", "")
        parent = parent_map.get(pid, {})
        sec_id = chunk.get("section_id") or parent.get("section_id", "")
        section = section_map.get(sec_id, {})

        breadcrumbs = chunk.get("breadcrumbs") or section.get("breadcrumbs") or []
        breadcrumbs_str = " > ".join(breadcrumbs) if breadcrumbs else ""

        cid = chunk.get("chunk_id", "")
        chunk_doc_id = (
            chunk.get("doc_id")
            or (chunk.get("metadata") or {}).get("doc_id")
            or etl_doc_id
            or (cid.rsplit("_c", 1)[0] if "_c" in cid else "doc")
        )
        chunk_doc_title = (
            chunk.get("doc_title")
            or (chunk.get("metadata") or {}).get("doc_title")
            or global_doc_title
            or (breadcrumbs[0] if breadcrumbs else "")
        )

        start_page = chunk.get("page_number", 1)
        end_page = chunk.get("page_end", start_page)
        if end_page < start_page:
            end_page = start_page
        pages_list = list(range(start_page, end_page + 1))

        meta = dict(chunk.get("metadata") or {})
        c_type = get_chunk_kind(chunk)

        chunk_tables = chunk.get("tables") or meta.get("tables") or []
        has_tables = bool(chunk_tables or c_type in ("table", "composite"))
        table_count = len(chunk_tables) if chunk_tables else (1 if c_type == "table" else 0)

        meta.pop("tables", None)
        meta.pop("is_table", None)
        meta.pop("is_atomic_table", None)
        meta.pop("table_caption", None)
        meta.pop("table_footnote", None)
        meta.pop("has_image", None)
        meta.pop("image_path", None)
        meta.pop("image_url", None)

        meta["doc_id"] = chunk_doc_id
        meta["doc_title"] = chunk_doc_title
        meta["type"] = c_type
        meta["section"] = section.get("title", "")
        meta["page"] = start_page
        meta["page_start"] = start_page
        meta["page_end"] = end_page
        meta["pages"] = pages_list
        meta["has_tables"] = has_tables
        meta["table_count"] = table_count

        clean_tables = []
        for idx, t in enumerate(chunk_tables):
            clean_tables.append({
                "table_id": t.get("table_id") or f"{cid}_t{idx + 1}",
                "caption": t.get("caption") or chunk.get("table_caption") or "",
                "footnote": t.get("footnote") or chunk.get("table_footnote") or "",
                "raw_html": strip_table_meta_tags(t.get("raw_html") or chunk.get("raw_html") or ""),
            })

        if c_type == "table" and not clean_tables and chunk.get("raw_html"):
            clean_tables.append({
                "table_id": f"{cid}_t1",
                "caption": chunk.get("table_caption") or "",
                "footnote": chunk.get("table_footnote") or "",
                "raw_html": strip_table_meta_tags(chunk.get("raw_html") or ""),
            })

        parent_text = parent.get("text", "")
        if breadcrumbs_str and not parent_text.startswith("["):
            parent_context_text = f"[{breadcrumbs_str}]\n{parent_text}".strip()
        else:
            parent_context_text = parent_text.strip()

        record = {
            "id": cid,
            "doc_id": chunk_doc_id,
            "doc_title": chunk_doc_title,
            "parent_chunk_id": pid,
            "section_id": sec_id,
            "section_title": section.get("title", ""),
            "breadcrumbs": breadcrumbs,
            "breadcrumbs_str": breadcrumbs_str,
            "text": chunk.get("text", ""),
            "parent_context_text": parent_context_text,
            "page": start_page,
            "pages": pages_list,
            "token_estimate": chunk.get("token_estimate", estimate_korean_tokens(chunk.get("text", ""))),
            "parent_token_estimate": parent.get("token_estimate", estimate_korean_tokens(parent_text)),
            "metadata": meta,
        }

        if end_page > start_page:
            record["page_end"] = end_page
        if has_tables and clean_tables:
            record["tables"] = clean_tables

        if c_type == "composite":
            raw_val = reconstruct_composite_raw_html(chunk, force=True) or chunk.get("raw_html", "")
        elif c_type == "table":
            cap = chunk.get("table_caption") or (clean_tables[0].get("caption") if clean_tables else "")
            fn = chunk.get("table_footnote") or (clean_tables[0].get("footnote") if clean_tables else "")
            table_base_html = (clean_tables[0].get("raw_html") if clean_tables else "") or chunk.get("raw_html", "")
            raw_val = build_outer_table_html(table_base_html, cap, fn)
        else:
            raw_val = chunk.get("raw_html", "")

        if raw_val:
            record["raw_html"] = raw_val

        lines.append(json.dumps(record, ensure_ascii=False))

    return "\n".join(lines)

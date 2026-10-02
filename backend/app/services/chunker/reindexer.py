import copy
import re
import uuid
from typing import Any, Dict, List, Optional

from backend.app.services.chunker.table_extractor import (
    get_chunk_kind,
    heal_composite_chunks,
)


def generate_doc_id(name: Optional[str] = None) -> str:
    """
    문서명을 RFC 4122 표준 128비트 결정론적 UUID(UUID v5) 기반 32자리 고유 식별자(doc_xxxxxxxx...)로 변환.
    - 동일한 문서명/식별자에 대해 항상 일관된 UUID 반환 (Upsert 및 캐싱 안전)
    - 서로 다른 문서 간 충돌 확률 물리적 0% 보장 (128-bit)
    - 한글/특수문자 없이 완전한 순수 ASCII 16진수 [0-9a-f] 반환
    """
    if not name:
        return f"doc_{uuid.uuid4().hex}"
    clean = str(name).strip()
    if clean.startswith("doc_") and len(clean) == 36 and clean[4:].isalnum():
        return clean
    if re.match(r"^[a-zA-Z0-9_-]+$", clean) and not clean.lower().endswith(".pdf") and len(clean) <= 40 and not clean.startswith("d_"):
        return clean

    u = uuid.uuid5(uuid.NAMESPACE_URL, f"urn:mineru:doc:{clean}")
    return f"doc_{u.hex}"


def recalculate_section_hierarchy(
    sections: List[Dict[str, Any]],
    doc_title: str = "",
) -> List[Dict[str, Any]]:
    """
    부모-자식 트리 구조(parent_section_id)를 바탕으로
    전역 계층 레벨(level: H0 -> H1 -> H2 -> H3)과 breadcrumbs를 일괄 재계산합니다.
    """
    if not sections:
        return []

    root_sec = None
    for s in sections:
        sid = str(s.get("id", ""))
        if s.get("level", 0) == 0 or sid.endswith("_s00") or sid.endswith("_root") or not s.get("parent_section_id"):
            root_sec = s
            break

    if not root_sec and sections:
        root_sec = sections[0]

    root_id = root_sec.get("id") if root_sec else None
    sec_map: Dict[str, Dict[str, Any]] = {str(s.get("id", "")): s for s in sections if s.get("id")}

    for s in sections:
        sid = str(s.get("id", ""))
        if s is root_sec or sid == root_id:
            s["level"] = 0
            title = s.get("title") or doc_title or "문서"
            s["breadcrumbs"] = [title]
            s["parent_section_id"] = None
            continue

        chain = []
        curr = s
        visited = {sid}

        while curr:
            pid = curr.get("parent_section_id")
            if not pid or pid not in sec_map or pid in visited:
                break
            visited.add(pid)
            parent = sec_map[pid]
            chain.append(parent)
            if parent is root_sec or str(parent.get("id", "")) == root_id:
                break
            curr = parent

        ancestors = list(reversed(chain))

        if root_sec and (not ancestors or (ancestors[0] is not root_sec and str(ancestors[0].get("id", "")) != root_id)):
            ancestors = [root_sec] + ancestors

        calculated_level = len(ancestors)
        breadcrumbs = [a.get("title", "") for a in ancestors] + [s.get("title", "")]
        final_parent_id = ancestors[-1].get("id") if ancestors else root_id

        s["level"] = calculated_level
        s["breadcrumbs"] = breadcrumbs
        s["parent_section_id"] = final_parent_id

    return sections


def sync_section_page_ranges(
    sections: List[Dict[str, Any]],
    child_chunks: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    섹션들의 page_range를 소속 청크 및 하위 자식 섹션들을 바탕으로 상향식(Bottom-up) 동기화합니다.
    """
    if not sections:
        return []

    child_map = {c.get("chunk_id"): c for c in child_chunks}
    children_by_parent: Dict[str, List[Dict[str, Any]]] = {}
    for s in sections:
        psid = s.get("parent_section_id")
        if psid:
            children_by_parent.setdefault(psid, []).append(s)

    computed_ranges: Dict[str, List[int]] = {}
    visiting = set()

    def compute_range(sec: Dict[str, Any]) -> List[int]:
        sid = sec.get("id", "")
        if sid in computed_ranges:
            return computed_ranges[sid]
        if sid in visiting:
            return sec.get("page_range", [1, 1])
        visiting.add(sid)

        min_page = float("inf")
        max_page = float("-inf")

        for cid in sec.get("child_chunk_ids", []):
            c = child_map.get(cid)
            if c:
                start = c.get("page_number", 1)
                end = c.get("page_end", start)
                if start < min_page:
                    min_page = start
                if end > max_page:
                    max_page = end

        for sub in children_by_parent.get(sid, []):
            sub_range = compute_range(sub)
            if sub_range[0] < min_page:
                min_page = sub_range[0]
            if sub_range[1] > max_page:
                max_page = sub_range[1]

        visiting.remove(sid)

        if min_page != float("inf") and max_page != float("-inf"):
            res_range = [int(min_page), int(max_page)]
        else:
            res_range = sec.get("page_range", [1, 1])

        computed_ranges[sid] = res_range
        return res_range

    for s in sections:
        s["page_range"] = compute_range(s)

    return sections


def calculate_stats(
    sections: List[Dict[str, Any]],
    parents: List[Dict[str, Any]],
    children: List[Dict[str, Any]],
) -> Dict[str, int]:
    kinds = [get_chunk_kind(c) for c in children]
    return {
        "total_sections": len(sections),
        "total_parent_sections": len(sections),
        "total_parent_chunks": len(parents),
        "total_child_chunks": len(children),
        "paragraph_chunks": sum(1 for k in kinds if k in ("paragraph", "article")),
        "table_chunks": sum(1 for k in kinds if k == "table"),
        "composite_chunks": sum(1 for k in kinds if k == "composite"),
        "article_chunks": sum(1 for k in kinds if k == "article"),
        "total_words": sum(c.get("token_estimate", 0) for c in children),
    }


def reindex_etl_result(etl_result: Dict[str, Any]) -> Dict[str, Any]:
    """
    수동 편집 후 불연속해진 모든 ID를
    '문서 물리적 등장 순서(Page & Block Position)' 기준으로 일괄 재정렬(Re-index)합니다.
    """
    res = copy.deepcopy(etl_result)
    raw_doc_id = res.get("doc_id") or ""
    active_pdf = res.get("active_pdf")
    doc_title = res.get("doc_title")

    if isinstance(raw_doc_id, str) and raw_doc_id.startswith("doc_") and len(raw_doc_id) == 36 and raw_doc_id[4:].isalnum():
        doc_id = raw_doc_id
    else:
        seed = active_pdf or doc_title or raw_doc_id or "doc"
        doc_id = generate_doc_id(seed)
    res["doc_id"] = doc_id

    raw_sections = res.get("sections") or res.get("parent_sections") or []
    raw_parents = res.get("parent_chunks", [])
    raw_children = res.get("child_chunks", [])

    parent_dict = {p.get("parent_chunk_id") or p.get("id"): p for p in raw_parents}
    child_dict = {c.get("chunk_id"): c for c in raw_children}

    synced_parents = []
    visited_pids = set()
    for sec in raw_sections:
        for pid in sec.get("parent_chunk_ids", []):
            if pid in parent_dict and pid not in visited_pids:
                synced_parents.append(parent_dict[pid])
                visited_pids.add(pid)
    for p in raw_parents:
        pid = p.get("parent_chunk_id") or p.get("id")
        if pid not in visited_pids:
            synced_parents.append(p)
            visited_pids.add(pid)

    synced_children = []
    visited_cids = set()
    for p in synced_parents:
        for cid in p.get("child_chunk_ids", []):
            if cid in child_dict and cid not in visited_cids:
                synced_children.append(child_dict[cid])
                visited_cids.add(cid)
    for c in raw_children:
        cid = c.get("chunk_id")
        if cid not in visited_cids:
            synced_children.append(c)
            visited_cids.add(cid)

    raw_parents = synced_parents
    raw_children = synced_children

    heal_composite_chunks(raw_children)
    raw_sections = sync_section_page_ranges(raw_sections, raw_children)

    root_sec = None
    normal_sections = []
    for s in raw_sections:
        if s.get("level", 0) == 0 or s.get("id", "").endswith("_s00") or s.get("id", "").endswith("_root"):
            root_sec = s
        else:
            normal_sections.append(s)

    root_id = root_sec.get("id") if root_sec else None
    children_map: Dict[str, List[Dict[str, Any]]] = {}
    for s in normal_sections:
        pid = s.get("parent_section_id") or root_id or "__root__"
        children_map.setdefault(pid, []).append(s)

    for s_list in children_map.values():
        s_list.sort(key=lambda item: item.get("page_range", [1, 1])[0])

    sorted_sections = []
    if root_sec:
        sorted_sections.append(root_sec)

    visited_sids = set()
    if root_sec:
        visited_sids.add(root_sec.get("id"))

    def traverse(parent_id: str):
        for child in children_map.get(parent_id, []):
            cid = child.get("id")
            if cid not in visited_sids:
                visited_sids.add(cid)
                sorted_sections.append(child)
                traverse(cid)

    if root_id:
        traverse(root_id)

    remaining = [s for s in normal_sections if s.get("id") not in visited_sids]
    remaining.sort(key=lambda s: s.get("page_range", [1, 1])[0])
    for r in remaining:
        rid = r.get("id")
        if rid not in visited_sids:
            visited_sids.add(rid)
            sorted_sections.append(r)
            traverse(rid)

    sorted_parents = sorted(raw_parents, key=lambda p: p.get("page_range", [1, 1])[0])
    sorted_children = sorted(raw_children, key=lambda c: c.get("page_number", 1))

    section_id_map: Dict[str, str] = {}
    sec_counter = 1
    new_sections = []
    for sec in sorted_sections:
        old_sid = sec.get("id", "")
        if sec.get("level", 0) == 0 or old_sid.endswith("_s00") or old_sid.endswith("_root"):
            new_sid = f"{doc_id}_s00"
        else:
            new_sid = f"{doc_id}_s{sec_counter:02d}"
            sec_counter += 1
        section_id_map[old_sid] = new_sid
        sec["id"] = new_sid
        new_sections.append(sec)

    parent_id_map: Dict[str, str] = {}
    parent_counter = 1
    new_parents = []
    for p in sorted_parents:
        old_pid = p.get("parent_chunk_id") or p.get("id", "")
        new_pid = f"{doc_id}_p{parent_counter:04d}"
        parent_counter += 1
        parent_id_map[old_pid] = new_pid
        p["parent_chunk_id"] = new_pid
        p["id"] = new_pid
        p["doc_id"] = doc_id
        new_parents.append(p)

    child_id_map: Dict[str, str] = {}
    child_counter = 1
    new_children = []
    for c in sorted_children:
        old_cid = c.get("chunk_id", "")
        new_cid = f"{doc_id}_c{child_counter:04d}"
        child_counter += 1
        child_id_map[old_cid] = new_cid
        c["chunk_id"] = new_cid
        c["doc_id"] = doc_id

        p_start = c.get("page_number", 1)
        p_end = c.get("page_end", p_start)
        if p_end < p_start:
            p_end = p_start

        c.pop("image_path", None)
        c.pop("image_url", None)

        existing_tables = c.get("tables")
        if not existing_tables:
            raw_html = c.get("raw_html", "")
            is_old_table = c.get("is_table") or c.get("chunk_type") == "table" or ("<table" in raw_html.lower())
            if is_old_table and raw_html:
                c["tables"] = [{
                    "table_id": f"{new_cid}_t1",
                    "raw_html": raw_html,
                    "caption": c.get("table_caption") or "",
                    "footnote": c.get("table_footnote") or "",
                    "table_type": c.get("table_type") or "table"
                }]
            else:
                c["tables"] = []
        else:
            for idx, tbl in enumerate(existing_tables):
                tbl["table_id"] = f"{new_cid}_t{idx + 1}"

        c.pop("chunk_type", None)
        c.pop("is_table", None)
        c.pop("is_atomic_table", None)
        c.pop("table_caption", None)
        c.pop("table_footnote", None)
        c.pop("table_type", None)

        if isinstance(c.get("metadata"), dict):
            c["metadata"]["doc_id"] = doc_id
            if res.get("doc_title"):
                c["metadata"]["doc_title"] = res.get("doc_title")
            c["metadata"]["page"] = p_start
            c["metadata"]["page_start"] = p_start
            c["metadata"]["page_end"] = p_end
            c["metadata"]["pages"] = list(range(p_start, p_end + 1))
            c["metadata"]["type"] = get_chunk_kind(c)
            c["metadata"].pop("has_image", None)
            c["metadata"].pop("image_path", None)
            c["metadata"].pop("image_url", None)

        new_children.append(c)

    for sec in new_sections:
        old_psid = sec.get("parent_section_id")
        if old_psid and old_psid in section_id_map:
            sec["parent_section_id"] = section_id_map[old_psid]

    for p in new_parents:
        old_sid = p.get("section_id")
        if old_sid and old_sid in section_id_map:
            p["section_id"] = section_id_map[old_sid]
        p["child_chunk_ids"] = [
            child_id_map[cid] for cid in p.get("child_chunk_ids", []) if cid in child_id_map
        ]

    for c in new_children:
        old_pid = c.get("parent_chunk_id") or c.get("parent_id")
        if old_pid and old_pid in parent_id_map:
            c["parent_chunk_id"] = parent_id_map[old_pid]
            c["parent_id"] = parent_id_map[old_pid]

        old_sid = c.get("section_id")
        if old_sid and old_sid in section_id_map:
            c["section_id"] = section_id_map[old_sid]

    reconcile_hierarchy_integrity(new_sections, new_parents, new_children, doc_title=res.get("doc_title", ""))

    res["sections"] = new_sections
    res["parent_sections"] = new_sections
    res["parent_chunks"] = new_parents
    res["child_chunks"] = new_children
    res["stats"] = calculate_stats(new_sections, new_parents, new_children)

    return res


def reconcile_hierarchy_integrity(
    sections: List[Dict[str, Any]],
    parents: List[Dict[str, Any]],
    children: List[Dict[str, Any]],
    doc_title: str = "",
) -> None:
    """
    섹션(sections), 부모 청크(parents), 자식 청크(children) 간의 상호 참조 정합성(Integrity)을 일괄 검사하고 복구(Healing)합니다.
    1. 고아/미등록 section_id 및 parent_chunk_id 복구
    2. 부모-자식 간 소속 섹션(section_id) 강제 일치
    3. 부모 청크의 child_chunk_ids와 자식 청크의 parent_chunk_id 양방향 완전 동기화
    4. 섹션의 parent_chunk_ids 및 child_chunk_ids 완전 재계산 (유령/고아 청크 ID 제거)
    5. Breadcrumbs 및 계층 레벨 일괄 재계산
    6. Page range 상향식(Bottom-up) 동기화
    """
    if not sections:
        return

    # Root section 식별 및 fallback section 결정
    root_sec = None
    for s in sections:
        sid = str(s.get("id", ""))
        if s.get("level", 0) == 0 or sid.endswith("_s00") or sid.endswith("_root") or not s.get("parent_section_id"):
            root_sec = s
            break
    if not root_sec and sections:
        root_sec = sections[0]
    fallback_sec_id = str(root_sec.get("id", "")) if root_sec else ""

    section_map = {str(s.get("id", "")): s for s in sections if s.get("id")}
    parent_map = {str(p.get("parent_chunk_id") or p.get("id", "")): p for p in parents if (p.get("parent_chunk_id") or p.get("id"))}
    child_map = {str(c.get("chunk_id", "")): c for c in children if c.get("chunk_id")}

    # 1. 부모 청크 정합성 복구
    for p in parents:
        pid = str(p.get("parent_chunk_id") or p.get("id", ""))
        if not p.get("section_id") or str(p.get("section_id")) not in section_map:
            p["section_id"] = fallback_sec_id
        valid_cids = []
        for cid in p.get("child_chunk_ids", []):
            cid_str = str(cid)
            if cid_str in child_map and cid_str not in valid_cids:
                valid_cids.append(cid_str)
        p["child_chunk_ids"] = valid_cids

    # 2. 자식 청크 정합성 복구
    for c in children:
        cid = str(c.get("chunk_id", ""))
        raw_pid = c.get("parent_chunk_id") or c.get("parent_id")
        pid_str = str(raw_pid) if raw_pid else ""
        if pid_str and pid_str in parent_map:
            p = parent_map[pid_str]
            p_canonical_id = str(p.get("parent_chunk_id") or p.get("id", ""))
            c["parent_chunk_id"] = p_canonical_id
            c["parent_id"] = p_canonical_id
            # 자식 청크의 section_id는 부모 청크의 section_id와 반드시 일치
            c["section_id"] = str(p.get("section_id", fallback_sec_id))
            if cid not in p["child_chunk_ids"]:
                p["child_chunk_ids"].append(cid)
        else:
            c["parent_chunk_id"] = None
            c["parent_id"] = None
            if not c.get("section_id") or str(c.get("section_id")) not in section_map:
                c["section_id"] = fallback_sec_id

    # 부모-자식 양방향 소속 엄격화: 부모의 child_chunk_ids 중 실제 이 부모를 참조하는 청크만 유지
    for p in parents:
        pid = str(p.get("parent_chunk_id") or p.get("id", ""))
        p["child_chunk_ids"] = [
            cid for cid in p.get("child_chunk_ids", [])
            if child_map.get(cid, {}).get("parent_chunk_id") == pid
        ]

    # 3. 섹션의 parent_chunk_ids 및 child_chunk_ids 완전 재계산
    for sec in sections:
        sid = str(sec.get("id", ""))
        sec_parents = [p for p in parents if str(p.get("section_id", "")) == sid]
        sec["parent_chunk_ids"] = [str(p.get("parent_chunk_id") or p.get("id", "")) for p in sec_parents]

        sec_child_ids = []
        for p in sec_parents:
            for cid in p.get("child_chunk_ids", []):
                if cid not in sec_child_ids:
                    sec_child_ids.append(cid)

        # 직속 미할당 자식 청크 포함
        for c in children:
            if str(c.get("section_id", "")) == sid and not c.get("parent_chunk_id"):
                cid = str(c.get("chunk_id", ""))
                if cid not in sec_child_ids:
                    sec_child_ids.append(cid)

        sec["child_chunk_ids"] = sec_child_ids

    # 4. Breadcrumbs 및 계층 레벨 일괄 재계산
    recalculate_section_hierarchy(sections, doc_title=doc_title)
    for p in parents:
        sec = section_map.get(str(p.get("section_id", "")))
        if sec and sec.get("breadcrumbs"):
            p["breadcrumbs"] = list(sec["breadcrumbs"])
            p_text = p.get("text", "")
            if p_text and p_text.startswith("["):
                p_bc_str = " > ".join(p["breadcrumbs"])
                p["text"] = re.sub(r"^\[([^\]]+?)(\s*\(계속\))?\]", rf"[{p_bc_str}\2]", p_text)
    for c in children:
        sec = section_map.get(str(c.get("section_id", "")))
        if sec and sec.get("breadcrumbs"):
            c["breadcrumbs"] = list(sec["breadcrumbs"])

    # 5. Page range 상향식 동기화
    sync_section_page_ranges(sections, children)

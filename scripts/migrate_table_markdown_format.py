#!/usr/bin/env python3
"""
기존 rag_chunks_edited.json 파일들의 표 검색 요약 텍스트를 최신 표준 Markdown Table 형식으로
일괄 마이그레이션하고, 대형 표 경고 메타데이터를 부여하는 스크립트.

주요 마이그레이션 작업:
1. 파일별 안전 백업 (.table_bak) 생성
2. 단독 표(table) 청크:
   - raw_html, caption, footnote를 바탕으로 최신 generate_table_search_text() 호출
   - **[표 제목: ...]**, Markdown Table, **[표 각주: ...]** 표준 태그 적용
   - 토큰 수(token_estimate) 재계산
   - 512 토큰 초과 시 metadata.token_overflow = True 및 warning 메시지 주입
3. 복합 청크(composite):
   - 표 1개와 표 제목/각주로만 이루어진 구버전 복합 청크를 단독 표(table)로 승격
   - 512 토큰 초과 시 warning 메타데이터 주입
4. stats (문단/표/복합/조문) 재계산 및 JSON 저장
"""

import glob
import json
import os
import re
import shutil
import sys
from typing import Any, Dict, List

# 루트 디렉터리 경로 등록
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.app.services.hierarchical_chunker import HierarchicalChunker


def is_pure_table_units(text: str, tables: List[Dict[str, Any]]) -> bool:
    """텍스트 내에 일반 설명 본문 없이 표 제목/각주만 존재하는지 검사"""
    if len(tables) != 1:
        return False
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    for p in paragraphs:
        # 마크다운 표 본문
        if ("| ---" in p or "|---" in p) and "\n|" in p:
            continue
        # 표 제목 또는 각주 패턴
        if HierarchicalChunker.RE_TABLE_TITLE_TEXT.search(p) or HierarchicalChunker.RE_TABLE_FOOTNOTE_TEXT.search(p):
            continue
        # 그 외 일반 본문이 존재함
        return False
    return True


def migrate_file(file_path: str) -> Dict[str, Any]:
    print(f"\n==========================================")
    print(f"[*] Processing: {file_path}")

    backup_path = file_path + ".table_bak"
    if not os.path.exists(backup_path):
        shutil.copy2(file_path, backup_path)
        print(f"  -> Backup created: {backup_path}")
    else:
        print(f"  -> Backup already exists: {backup_path}")

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    children = data.get("child_chunks", [])
    sections = data.get("sections") or data.get("parent_sections") or []
    parents = data.get("parent_chunks", [])

    table_updated_count = 0
    promoted_to_table_count = 0
    overflow_warning_count = 0

    for c in children:
        meta = c.setdefault("metadata", {})
        kind = HierarchicalChunker.get_chunk_kind(c)
        tables = c.get("tables", [])

        # 1. 단독 표 승격 검사 (과거 composite 청크 중 순수 표+제목/각주만 있는 경우)
        if kind == "composite" and is_pure_table_units(c.get("text", ""), tables):
            kind = "table"
            meta["type"] = "table"
            c["chunk_type"] = "table"
            c["is_table"] = True
            c["is_atomic_table"] = True
            promoted_to_table_count += 1

        # 2. 단독 표 청크 텍스트 갱신
        if kind == "table" or (not kind and tables and len(tables) == 1):
            single_t = tables[0] if tables else {}
            raw_html = single_t.get("raw_html") or c.get("raw_html") or ""
            caption = single_t.get("caption") or c.get("table_caption") or ""
            footnote = single_t.get("footnote") or c.get("table_footnote") or ""

            if raw_html:
                new_text = HierarchicalChunker.generate_table_search_text(
                    raw_html=raw_html,
                    caption=caption,
                    footnote=footnote
                )
                normalized_text = HierarchicalChunker.normalize_text_for_embedding(new_text)
                new_tokens = HierarchicalChunker.estimate_korean_tokens(normalized_text)

                c["text"] = normalized_text
                c["token_estimate"] = new_tokens
                single_t["caption"] = caption
                single_t["footnote"] = footnote
                table_updated_count += 1

                # 대형 표 경고 메타데이터
                if new_tokens > 512:
                    meta["token_overflow"] = True
                    meta["warning"] = f"대형 표 (~{new_tokens}T) - 512 토큰 한도 초과 (분할 또는 정제 권장)"
                    overflow_warning_count += 1
                else:
                    meta.pop("token_overflow", None)
                    meta.pop("warning", None)

        # 3. 복합 청크(composite) 토큰 및 경고 갱신
        elif kind == "composite":
            comp_text = c.get("text", "")
            comp_tokens = HierarchicalChunker.estimate_korean_tokens(comp_text)
            c["token_estimate"] = comp_tokens
            if comp_tokens > 512:
                meta["token_overflow"] = True
                meta["warning"] = f"대형 표 (~{comp_tokens}T) - 512 토큰 한도 초과 (분할 또는 정제 권장)"
                overflow_warning_count += 1
            else:
                meta.pop("token_overflow", None)
                meta.pop("warning", None)

    # 4. stats 재계산
    new_stats = HierarchicalChunker._calculate_stats(sections, parents, children)
    data["stats"] = new_stats

    # 5. 저장
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  [v] Successfully migrated:")
    print(f"      - Table chunks updated: {table_updated_count}")
    print(f"      - Composite promoted to atomic table: {promoted_to_table_count}")
    print(f"      - Large table warnings applied: {overflow_warning_count}")
    print(f"      - Updated Stats: {new_stats}")

    return {
        "file": file_path,
        "table_updated": table_updated_count,
        "promoted_to_table": promoted_to_table_count,
        "overflow_warning": overflow_warning_count,
        "stats": new_stats
    }


def main():
    pattern = os.path.join(ROOT_DIR, "output", "**", "rag_chunks_edited.json")
    files = glob.glob(pattern, recursive=True)

    if not files:
        print("No rag_chunks_edited.json files found.")
        return

    print(f"Found {len(files)} rag_chunks_edited.json files to migrate.")
    results = []
    for file_path in sorted(files):
        res = migrate_file(file_path)
        results.append(res)

    print("\n==========================================")
    total_tables = sum(r["table_updated"] for r in results)
    total_promoted = sum(r["promoted_to_table"] for r in results)
    total_warnings = sum(r["overflow_warning"] for r in results)
    print(f"Migration completed for {len(results)} files!")
    print(f"  - Total table chunks updated: {total_tables}")
    print(f"  - Total promoted to atomic table: {total_promoted}")
    print(f"  - Total large table warnings assigned: {total_warnings}")


if __name__ == "__main__":
    main()

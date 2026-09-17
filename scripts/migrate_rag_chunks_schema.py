#!/usr/bin/env python3
"""
기존 rag_chunks_edited.json 파일들을 단일 복합 청크(Unified Composite Chunk) 모델로 일괄 마이그레이션하는 스크립트.

주요 마이그레이션 작업:
1. 파일별 백업 (.bak) 생성
2. 단독 표(table) 청크 중 tables 배열이 누락된 항목을 tables: [EmbeddedTableItem] 구조로 변환
3. 최상위 레거시 필드 삭제 (chunk_type, is_table, is_atomic_table, table_caption, table_footnote, table_type)
4. heal_composite_chunks를 통한 복합 청크 HTML 정합성 보정
5. metadata.type을 get_chunk_kind() 결과로 일원화
6. stats (문단/표/복합/조문) 최신 기준으로 재계산 및 저장
"""

import glob
import json
import os
import shutil
import sys

# MinerU-Studio 루트 디렉터리 경로 등록
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.app.services.hierarchical_chunker import HierarchicalChunker


def migrate_file(file_path: str) -> dict:
    print(f"\n==========================================")
    print(f"[*] Processing: {file_path}")

    backup_path = file_path + ".bak"
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

    tables_created_count = 0
    legacy_keys_removed_count = 0

    legacy_keys = ["chunk_type", "is_table", "is_atomic_table", "table_caption", "table_footnote", "table_type", "has_image", "image_path", "image_url"]

    for c in children:
        cid = c.get("chunk_id", "")

        # 1. tables 배열 마이그레이션
        existing_tables = c.get("tables")
        if not existing_tables:
            raw_html = c.get("raw_html", "")
            is_old_table = c.get("is_table") or c.get("chunk_type") == "table" or ("<table" in raw_html.lower())
            if is_old_table and raw_html:
                c["tables"] = [{
                    "table_id": f"{cid}_t1",
                    "raw_html": raw_html,
                    "caption": c.get("table_caption") or "",
                    "footnote": c.get("table_footnote") or ""
                }]
                tables_created_count += 1
            else:
                c["tables"] = []
        else:
            # 이미 tables 배열이 있는 경우 내부 table_id 정규화 및 table_type 제거
            for idx, tbl in enumerate(existing_tables):
                if not tbl.get("table_id"):
                    tbl["table_id"] = f"{cid}_t{idx + 1}"
                tbl.pop("table_type", None)

        # 2. 최상위 레거시 키 삭제 (Clean Drop)
        removed_any = False
        for k in legacy_keys:
            if k in c:
                c.pop(k, None)
                removed_any = True
        if removed_any:
            legacy_keys_removed_count += 1

        # 3. metadata 표준화 및 정제 (tables 등 복합 객체 제거, type/has_tables/table_count 정규화)
        kind = HierarchicalChunker.get_chunk_kind(c)
        if isinstance(c.get("metadata"), dict):
            meta = c["metadata"]
            tbls = c.get("tables") or []
            has_tables = bool(tbls or kind in ("table", "composite"))
            table_count = len(tbls) if tbls else (1 if kind == "table" else 0)

            # 불필요/레거시 키 제거
            meta.pop("tables", None)
            meta.pop("is_table", None)
            meta.pop("is_atomic_table", None)
            meta.pop("table_caption", None)
            meta.pop("table_footnote", None)
            meta.pop("has_image", None)
            meta.pop("image_path", None)
            meta.pop("image_url", None)

            # 표준 메타데이터 스칼라 필드 주입
            meta["type"] = kind
            meta["has_tables"] = has_tables
            meta["table_count"] = table_count

    # 4. 복합 청크 누락 HTML 복원
    healed_count = HierarchicalChunker.heal_composite_chunks(children)

    # 5. stats 재계산
    new_stats = HierarchicalChunker._calculate_stats(sections, parents, children)
    data["stats"] = new_stats

    # 6. 저장
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  [v] Migrated successfully:")
    print(f"      - Total Child Chunks: {len(children)}")
    print(f"      - Tables created from raw_html: {tables_created_count}")
    print(f"      - Chunks cleaned of legacy fields: {legacy_keys_removed_count}")
    print(f"      - Composite chunks healed: {healed_count}")
    print(f"      - Recalculated Stats: {new_stats}")

    return {
        "file": file_path,
        "total_children": len(children),
        "tables_created": tables_created_count,
        "legacy_cleaned": legacy_keys_removed_count,
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
    print(f"All {len(results)} files migrated successfully!")


if __name__ == "__main__":
    main()

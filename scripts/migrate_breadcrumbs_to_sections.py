#!/usr/bin/env python3
"""
기존 rag_chunks_edited.json 파일들의 브레드크럼(breadcrumbs)을
'섹션(Section) 계층'으로 100% 일원화 마이그레이션하는 스크립트.

주요 작업:
1. 원본 파일 백업 (.bak) 생성
2. HierarchicalChunker.reindex_etl_result를 통한:
   - 섹션 트리 위계 및 breadcrumbs 재계산
   - Parent 청크 breadcrumbs 및 본문 상단 헤더([문서 > 섹션]) 동기화
   - Child 청크 breadcrumbs를 소속 섹션의 breadcrumbs로 일괄 통일
   - 메타데이터 및 통계 재계산
3. 마이그레이션 전/후 정합성 검증 및 저장
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

    children_before = data.get("child_chunks", [])
    sec_map_before = {s["id"]: s for s in data.get("sections", [])}
    diff_before = sum(1 for c in children_before if c.get("breadcrumbs") != (sec_map_before.get(c.get("section_id"), {}).get("breadcrumbs") or []))

    print(f"  [i] Before migration: {diff_before} / {len(children_before)} children had divergent breadcrumbs")

    # Reindex & Migrate breadcrumbs to section-only
    migrated_data = HierarchicalChunker.reindex_etl_result(data)

    children_after = migrated_data.get("child_chunks", [])
    sec_map_after = {s["id"]: s for s in migrated_data.get("sections", [])}
    diff_after = sum(1 for c in children_after if c.get("breadcrumbs") != (sec_map_after.get(c.get("section_id"), {}).get("breadcrumbs") or []))

    assert diff_after == 0, f"Integrity check failed: {diff_after} chunks still divergent!"

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(migrated_data, f, ensure_ascii=False, indent=2)

    print(f"  [v] Successfully migrated to section-only breadcrumbs:")
    print(f"      - Total Sections: {len(migrated_data.get('sections', []))}")
    print(f"      - Total Parents: {len(migrated_data.get('parent_chunks', []))}")
    print(f"      - Total Children: {len(children_after)}")
    print(f"      - Divergent breadcrumbs: {diff_after} (100% matched to section)")

    return {
        "file": file_path,
        "total_children": len(children_after),
        "divergent_before": diff_before,
        "divergent_after": diff_after,
    }


def main():
    pattern = os.path.join(ROOT_DIR, "output", "**", "rag_chunks_edited.json")
    files = sorted(glob.glob(pattern, recursive=True))

    if not files:
        print("No rag_chunks_edited.json files found.")
        return

    print(f"Found {len(files)} rag_chunks_edited.json files to migrate.")

    results = []
    for f in files:
        results.append(migrate_file(f))

    print("\n==========================================")
    print("[*] Migration Summary:")
    for r in results:
        doc_dir = r["file"].split(os.sep)[-3]
        print(f"  - {doc_dir}: {r['divergent_before']} divergent -> 0 divergent (Total {r['total_children']} chunks)")
    print("\n[SUCCESS] All datasets have been migrated to section-only breadcrumbs!")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
작업공간 내 기존 rag_chunks_edited.json 파일들의 child_chunks 및 parent_chunks에
doc_id 및 doc_title(최상위 및 metadata 내부)을 일괄 주입하는 1회성 마이그레이션 스크립트.
"""

import glob
import json
import os
import shutil
import sys
from pathlib import Path

# MinerU-Studio 루트 디렉터리 경로 등록
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.services.hierarchical_chunker import HierarchicalChunker


def migrate_doc_id():
    pattern = str(ROOT_DIR / "output" / "mineru_pipeline_auto_korean" / "*" / "auto" / "rag_chunks_edited.json")
    files = glob.glob(pattern)

    print(f"[*] 총 {len(files)}개의 rag_chunks_edited.json 대상 파일을 찾았습니다.")
    if not files:
        print("[!] 대상 파일이 없습니다.")
        return

    total_children = 0
    total_parents = 0

    for fpath in files:
        p = Path(fpath)
        doc_folder_name = p.parent.parent.name
        print(f"\n[*] 처리 중: {doc_folder_name}")

        # 백업 생성
        bak_path = p.with_suffix(".json.bak_doc_id")
        if not bak_path.exists():
            shutil.copy2(p, bak_path)
            print(f"  -> 백업 완료: {bak_path.name}")

        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)

        doc_title = data.get("doc_title") or doc_folder_name
        doc_id = data.get("doc_id") or HierarchicalChunker.generate_doc_id(doc_title)

        data["doc_id"] = doc_id
        data["doc_title"] = doc_title

        child_count = 0
        for c in data.get("child_chunks", []):
            c["doc_id"] = doc_id
            if not isinstance(c.get("metadata"), dict):
                c["metadata"] = {}
            c["metadata"]["doc_id"] = doc_id
            c["metadata"]["doc_title"] = doc_title
            child_count += 1

        parent_count = 0
        for parent in data.get("parent_chunks", []):
            parent["doc_id"] = doc_id
            parent_count += 1

        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"  -> 완료: doc_id={doc_id}, 자식 청크 {child_count}개, 부모 청크 {parent_count}개 갱신")
        total_children += child_count
        total_parents += parent_count

    print(f"\n==========================================")
    print(f"[✓] 마이그레이션 성공! 총 {len(files)}개 파일 (자식 {total_children}개, 부모 {total_parents}개) 갱신 완료")


if __name__ == "__main__":
    migrate_doc_id()

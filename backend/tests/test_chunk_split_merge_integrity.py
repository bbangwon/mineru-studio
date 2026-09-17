import pytest
from backend.app.services.hierarchical_chunker import HierarchicalChunker


def test_composite_chunk_healing_and_preservation():
    """복합(composite) 청크의 raw_html 복원 및 표 HTML 보존 검증"""
    table_html = "<table><tr><th>항목</th><th>내용</th></tr><tr><td>1</td><td>데이터</td></tr></table>"
    chunk_data = {
        "chunk_id": "doc_1_c001",
        "chunk_type": "composite",
        "is_table": True,
        "is_atomic_table": False,
        "text": "이것은 표 위의 설명 문단입니다.\n\n| 항목 | 내용 |\n| --- | --- |\n| 1 | 데이터 |\n\n이것은 표 아래의 설명 문단입니다.",
        "raw_html": "",  # 누락된 상태
        "tables": [
            {
                "table_index": 0,
                "caption": "테스트 표",
                "raw_html": table_html,
            }
        ],
    }

    chunks = [chunk_data]
    changed = HierarchicalChunker.heal_composite_chunks(chunks)

    assert changed is True
    healed_html = chunk_data["raw_html"]
    # <p> 태그와 <table> 태그가 모두 존재해야 함
    assert "<p>" in healed_html
    assert "이것은 표 위의 설명 문단입니다." in healed_html
    assert "<table>" in healed_html
    assert "이것은 표 아래의 설명 문단입니다." in healed_html


def test_split_composite_separation_logic():
    """복합 청크에서 분할 후 순수 문단과 단독 표로 나뉘었을 때의 모델 정합성 검증"""
    table_html = "<table><tr><th>구분</th><th>값</th></tr><tr><td>A</td><td>100</td></tr></table>"
    original_composite = {
        "chunk_id": "doc_1_c010",
        "chunk_type": "composite",
        "is_table": True,
        "is_atomic_table": False,
        "text": "앞부분 설명 안내 문단입니다.\n\n| 구분 | 값 |\n| --- | --- |\n| A | 100 |",
        "raw_html": f"<p>앞부분 설명 안내 문단입니다.</p>\n\n{table_html}",
        "tables": [{"table_index": 0, "caption": "값 목록", "raw_html": table_html}],
    }

    # 분할 1: 앞부분 문단만 분리된 청크
    part1_chunk = {
        "chunk_id": "doc_1_c010",
        "chunk_type": "paragraph",
        "is_table": False,
        "is_atomic_table": False,
        "text": "앞부분 설명 안내 문단입니다.",
        "raw_html": None,
        "tables": [],
    }

    # 분할 2: 표만 남은 청크 (단독 표로 승격)
    part2_chunk = {
        "chunk_id": "doc_1_c011",
        "chunk_type": "table",
        "is_table": True,
        "is_atomic_table": True,
        "text": "| 구분 | 값 |\n| --- | --- |\n| A | 100 |",
        "raw_html": table_html,
        "tables": original_composite["tables"],
    }

    # 백엔드 치유 로직 통과 시 변경이 없어야 함 (이미 온전하므로)
    chunks = [part1_chunk, part2_chunk]
    changed = HierarchicalChunker.heal_composite_chunks(chunks)
    assert changed is False
    assert part1_chunk["chunk_type"] == "paragraph"
    assert part2_chunk["chunk_type"] == "table"
    assert part2_chunk["is_atomic_table"] is True

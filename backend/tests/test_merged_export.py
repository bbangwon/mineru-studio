import json
import uuid
import pytest
from starlette.testclient import TestClient
from backend.app.main import app
from backend.app.services.hierarchical_chunker import HierarchicalChunker


client = TestClient(app)


def test_generate_doc_id_deterministic_and_unique():
    """한글 및 영문 파일명에 대해 128비트 UUID v5 기반 32자리 고유 ID가 결정론적으로 생성되는지 검증"""
    # 1. 한글 파일명 동일 입력 -> 항상 동일한 고유 ID 생성 (재현성)
    id1 = HierarchicalChunker.generate_doc_id("소방안전_가이드_2024.pdf")
    id2 = HierarchicalChunker.generate_doc_id("소방안전_가이드_2024.pdf")
    assert id1 == id2
    assert id1.startswith("doc_")
    assert len(id1) == 36  # "doc_" (4) + 32자리 hex
    assert id1[4:].isalnum()

    # 2. 서로 다른 파일명 -> 물리적으로 충돌 없는 다른 고유 ID
    id3 = HierarchicalChunker.generate_doc_id("2024_경영계획서.pdf")
    assert id1 != id3

    # 3. 빈 입력 시 128-bit 난수 UUID v4 반환
    id_random = HierarchicalChunker.generate_doc_id()
    assert id_random.startswith("doc_")
    assert len(id_random) == 36


def test_chunk_ids_four_digit_padding():
    """청크 ID가 4자리 패딩 (_c0001, _p0001)으로 고유하게 부여되는지 검증"""
    doc_id = HierarchicalChunker.generate_doc_id("테스트_규정.pdf")
    chunker = HierarchicalChunker(doc_id=doc_id)

    raw_data = {
        "doc_id": doc_id,
        "sections": [{"id": f"{doc_id}_s00", "title": "루트", "level": 0, "parent_chunk_ids": [], "breadcrumbs": []}],
        "parent_chunks": [
            {
                "parent_chunk_id": "old_p",
                "id": "old_p",
                "section_id": f"{doc_id}_s00",
                "title": "루트",
                "text": "부모 문맥 텍스트",
                "child_chunk_ids": ["old_c1", "old_c2"],
            }
        ],
        "child_chunks": [
            {
                "chunk_id": "old_c1",
                "parent_chunk_id": "old_p",
                "section_id": f"{doc_id}_s00",
                "chunk_type": "paragraph",
                "text": "첫 번째 문단입니다.",
                "page_number": 1,
            },
            {
                "chunk_id": "old_c2",
                "parent_chunk_id": "old_p",
                "section_id": f"{doc_id}_s00",
                "chunk_type": "paragraph",
                "text": "두 번째 문단입니다.",
                "page_number": 1,
            },
        ],
    }

    reindexed = HierarchicalChunker.reindex_etl_result(raw_data)
    assert reindexed["parent_chunks"][0]["parent_chunk_id"] == f"{doc_id}_p0001"
    assert reindexed["child_chunks"][0]["chunk_id"] == f"{doc_id}_c0001"
    assert reindexed["child_chunks"][1]["chunk_id"] == f"{doc_id}_c0002"

    # JSONL 변환 시 id 확인
    jsonl_str = chunker.export_to_jsonl(reindexed)
    lines = [json.loads(line) for line in jsonl_str.strip().split("\n") if line.strip()]
    assert len(lines) == 2
    assert lines[0]["id"] == f"{doc_id}_c0001"
    assert lines[1]["id"] == f"{doc_id}_c0002"
    assert lines[0]["parent_chunk_id"] == f"{doc_id}_p0001"


def test_api_export_jsonl_merged_empty_validation():
    """filenames가 비어있을 때 400 Bad Request 에러 반환 검증"""
    res = client.post("/api/etl/export/jsonl/merged", json={"filenames": []})
    assert res.status_code == 400
    assert "비어있습니다" in res.json()["detail"]


def test_api_export_jsonl_merged_not_found():
    """존재하지 않는 문서 전달 시 404 반환 검증"""
    res = client.post(
        "/api/etl/export/jsonl/merged",
        json={"filenames": ["non_existent_doc_1.pdf", "non_existent_doc_2.pdf"]},
    )
    assert res.status_code == 404


def test_korean_filename_content_disposition_header():
    """한글 파일명이 전달되어도 latin-1 인코딩 오류 없이 RFC 5987 헤더로 안전하게 반환되는지 검증"""
    import backend.app.main as main_mod

    # 가상 etl result 설정
    main_mod.latest_etl_result = {
        "doc_id": "doc_test_korean",
        "doc_title": "소방안전_가이드_2024",
        "sections": [{"id": "doc_test_korean_s00", "title": "총칙"}],
        "parent_chunks": [{"parent_chunk_id": "doc_test_korean_p0001", "text": "부모", "section_id": "doc_test_korean_s00"}],
        "child_chunks": [
            {
                "chunk_id": "doc_test_korean_c0001",
                "parent_chunk_id": "doc_test_korean_p0001",
                "text": "테스트",
                "section_id": "doc_test_korean_s00",
                "page_number": 1,
            }
        ],
    }

    res = client.get("/api/etl/export/jsonl?filename=소방안전_가이드_2024.pdf")
    # latin-1 인코딩 에러가 발생하지 않아야 함 (500 에러 아님)
    assert res.status_code == 200
    cd_header = res.headers.get("content-disposition", "")
    assert "filename*=utf-8''" in cd_header


def test_reindex_auto_upgrades_legacy_id_to_128bit_uuid():
    """과거 6자리 해시(d_xxxxxx)로 저장되었던 구버전 문서도 재정렬 시 128-bit UUID v5로 자동 업그레이드되는지 검증"""
    legacy_data = {
        "doc_id": "d_1a2b3c",  # 과거 6자리 해시
        "active_pdf": "소방안전_가이드_2024.pdf",
        "doc_title": "소방안전_가이드_2024",
        "sections": [{"id": "d_1a2b3c_s00", "title": "총칙"}],
        "parent_chunks": [
            {
                "parent_chunk_id": "d_1a2b3c_p001",
                "id": "d_1a2b3c_p001",
                "text": "부모",
                "section_id": "d_1a2b3c_s00",
                "child_chunk_ids": ["d_1a2b3c_c001"],
            }
        ],
        "child_chunks": [
            {
                "chunk_id": "d_1a2b3c_c001",
                "parent_chunk_id": "d_1a2b3c_p001",
                "text": "테스트 문단",
                "section_id": "d_1a2b3c_s00",
                "page_number": 1,
            }
        ],
    }

    reindexed = HierarchicalChunker.reindex_etl_result(legacy_data)

    # 1. doc_id가 128-bit 결정론적 UUID v5 (doc_ + 32hex)로 자동 업그레이드되었는지 확인
    assert reindexed["doc_id"].startswith("doc_")
    assert len(reindexed["doc_id"]) == 36
    assert reindexed["doc_id"] != "d_1a2b3c"

    # 2. 청크 ID 및 부모/섹션 ID도 일관되게 128-bit UUID + 4자리 패딩으로 정렬되었는지 확인
    expected_doc_id = reindexed["doc_id"]
    assert reindexed["sections"][0]["id"] == f"{expected_doc_id}_s00"
    assert reindexed["parent_chunks"][0]["parent_chunk_id"] == f"{expected_doc_id}_p0001"
    assert reindexed["child_chunks"][0]["chunk_id"] == f"{expected_doc_id}_c0001"
    assert reindexed["child_chunks"][0]["parent_chunk_id"] == f"{expected_doc_id}_p0001"


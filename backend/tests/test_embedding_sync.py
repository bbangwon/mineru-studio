import pytest
from unittest.mock import MagicMock, patch
from rag_embed_core.config import QdrantConfig
from backend.app.services.embedding_svc import (
    load_indexed_docs_manifest,
    save_indexed_docs_manifest,
    embedding_svc,
)


def test_get_indexed_doc_names_prunes_and_syncs(tmp_path, monkeypatch):
    test_manifest_path = tmp_path / "qdrant_indexed_docs.json"
    monkeypatch.setattr("backend.app.services.embedding_svc.INDEXED_DOCS_MANIFEST_PATH", test_manifest_path)
    monkeypatch.setattr("backend.app.services.embedding_svc.OUTPUT_DIR", tmp_path)

    # 1. 초기 매니페스트에 오래된(삭제된) 문서와 기존 문서 설정
    save_indexed_docs_manifest({
        "collection_name": "test_col",
        "documents": {
            "삭제된_문서": {"doc_id": "삭제된_문서", "chunks_count": 10, "indexed_at": "2026-01-01"},
            "남아있는_문서": {"doc_id": "남아있는_문서", "chunks_count": 5, "indexed_at": "2026-01-01"},
        },
        "last_synced_at": "2026-01-01",
    })

    # 2. QdrantManager mock: Qdrant에는 "남아있는_문서"와 "새로운_문서"만 존재
    mock_manager = MagicMock()
    mock_manager.get_indexed_docs_summary.return_value = (
        {
            "남아있는_문서": {"doc_id": "남아있는_문서", "chunks_count": 7},
            "새로운_문서": {"doc_id": "새로운_문서", "chunks_count": 3},
        },
        ["남아있는_문서", "새로운_문서"],
    )

    test_cfg = QdrantConfig(collection_name="test_col")

    with patch.object(embedding_svc, "get_manager", return_value=mock_manager):
        names, status = embedding_svc.get_indexed_doc_names_with_fallback(test_cfg)

    # 검증:
    # 1) 반환된 이름에 "삭제된_문서"가 없어야 함
    assert "남아있는_문서" in names
    assert "새로운_문서" in names
    assert "삭제된_문서" not in names

    # 2) 파일(매니페스트)에서도 "삭제된_문서"가 Prune되고 새 정보가 반영되었는지 검증
    saved = load_indexed_docs_manifest()
    assert "남아있는_문서" in saved["documents"]
    assert "새로운_문서" in saved["documents"]
    assert "삭제된_문서" not in saved["documents"]
    assert saved["documents"]["남아있는_문서"]["chunks_count"] == 7
    assert saved["documents"]["새로운_문서"]["chunks_count"] == 3
    assert saved["collection_name"] == "test_col"


def test_get_indexed_doc_names_collection_change_isolation(tmp_path, monkeypatch):
    test_manifest_path = tmp_path / "qdrant_indexed_docs.json"
    monkeypatch.setattr("backend.app.services.embedding_svc.INDEXED_DOCS_MANIFEST_PATH", test_manifest_path)
    monkeypatch.setattr("backend.app.services.embedding_svc.OUTPUT_DIR", tmp_path)

    # 기존 매니페스트: 이전 컬렉션 'old_col' 데이터
    save_indexed_docs_manifest({
        "collection_name": "old_col",
        "documents": {
            "구_문서": {"doc_id": "구_문서", "chunks_count": 10},
        },
        "last_synced_at": "2026-01-01",
    })

    # 새 컬렉션 'new_col'로 조회
    mock_manager = MagicMock()
    mock_manager.get_indexed_docs_summary.return_value = (
        {
            "신규_문서": {"doc_id": "신규_문서", "chunks_count": 4},
        },
        ["신규_문서"],
    )

    new_cfg = QdrantConfig(collection_name="new_col")

    with patch.object(embedding_svc, "get_manager", return_value=mock_manager):
        names, status = embedding_svc.get_indexed_doc_names_with_fallback(new_cfg)

    # 검증: 구 컬렉션의 문서가 새 컬렉션 매니페스트에 섞이지 않아야 함
    assert "신규_문서" in names
    assert "구_문서" not in names

    saved = load_indexed_docs_manifest()
    assert saved["collection_name"] == "new_col"
    assert "신규_문서" in saved["documents"]
    assert "구_문서" not in saved["documents"]


def test_embed_and_upsert_doc_id_in_payload_and_metadata(tmp_path, monkeypatch):
    test_manifest_path = tmp_path / "qdrant_indexed_docs.json"
    monkeypatch.setattr("backend.app.services.embedding_svc.INDEXED_DOCS_MANIFEST_PATH", test_manifest_path)
    monkeypatch.setattr("backend.app.services.embedding_svc.OUTPUT_DIR", tmp_path)

    mock_sparse = MagicMock()
    mock_sparse.encode_documents.return_value = [{"indices": [1], "values": [0.5]}]

    mock_dense = MagicMock()
    mock_dense.encode_texts.return_value = [[0.1, 0.2, 0.3]]

    mock_manager = MagicMock()
    mock_manager.upsert_points.return_value = 1

    sample_child = {
        "chunk_id": "doc_93b2d5c7c6085f47a9650346e7607db0_c0001",
        "text": "테스트 본문 내용",
        "breadcrumbs": ["산업재해보상보험법", "제1장 총칙"],
        "metadata": {"type": "article", "custom_tag": "legal_tag"},
    }

    test_cfg = QdrantConfig(collection_name="test_col")

    with patch("backend.app.services.embedding_svc.get_sparse_encoder", return_value=mock_sparse), \
         patch("backend.app.services.embedding_svc.get_dense_encoder", return_value=mock_dense), \
         patch.object(embedding_svc, "get_manager", return_value=mock_manager):
        res = embedding_svc.embed_and_upsert(
            child_chunks=[sample_child],
            config=test_cfg,
        )

    assert res["success"] is True
    assert mock_manager.upsert_points.called
    call_args = mock_manager.upsert_points.call_args
    points = call_args[1].get("points") or call_args[0][0]
    assert len(points) == 1

    p = points[0]
    payload = p["payload"]
    expected_doc_id = "doc_93b2d5c7c6085f47a9650346e7607db0"

    # 1. Qdrant payload 최상위 doc_id 및 doc_title 검증
    assert payload["doc_id"] == expected_doc_id
    assert payload["doc_title"] == "산업재해보상보험법"

    # 2. payload.metadata 내부 doc_id 및 doc_title 중첩 필터링 호환성 검증
    assert payload["metadata"]["doc_id"] == expected_doc_id
    assert payload["metadata"]["doc_title"] == "산업재해보상보험법"
    assert payload["metadata"]["custom_tag"] == "legal_tag"

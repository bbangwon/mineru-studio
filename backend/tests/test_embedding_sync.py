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

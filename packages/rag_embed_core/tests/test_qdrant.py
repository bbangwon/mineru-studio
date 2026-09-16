import pytest
from qdrant_client import QdrantClient

from rag_embed_core.config import QdrantConfig
from rag_embed_core.models import SparseVector
from rag_embed_core.qdrant_ops import QdrantManager
from rag_embed_core.sparse import KiwiSparseEncoder


def test_qdrant_manager_in_memory_hybrid():
    # In-memory 클라이언트로 QdrantManager 테스트
    mem_client = QdrantClient(":memory:")
    config = QdrantConfig(collection_name="test_hybrid_col", dense_dim=4)
    manager = QdrantManager(config=config, client=mem_client)

    # 1. 컬렉션 생성
    created = manager.init_collection(collection_name="test_hybrid_col", recreate=True)
    assert created is True

    # 2. 데이터 업서트
    sparse_encoder = KiwiSparseEncoder()
    doc1 = "석면 해체 제거 작업 절차 안내"
    doc2 = "건설 현장 안전 보호구 착용 의무화 규정"

    sp1 = sparse_encoder.encode_document(doc1)
    sp2 = sparse_encoder.encode_document(doc2)

    points = [
        {
            "id": "chunk_001",
            "dense_vector": [0.1, 0.2, 0.3, 0.4],
            "sparse_vector": sp1,
            "payload": {"text": doc1, "doc_id": "doc_1"},
        },
        {
            "id": "chunk_002",
            "dense_vector": [0.4, 0.3, 0.2, 0.1],
            "sparse_vector": sp2,
            "payload": {"text": doc2, "doc_id": "doc_2"},
        },
    ]

    upsert_count = manager.upsert_points(points, collection_name="test_hybrid_col")
    assert upsert_count == 2

    # 3. 하이브리드 검색 (Fusion.RRF)
    query_text = "석면 해체 절차"
    query_sparse = sparse_encoder.encode_query(query_text)
    query_dense = [0.12, 0.22, 0.28, 0.38]  # doc1에 가까운 벡터

    results = manager.search_hybrid(
        query_dense=query_dense,
        query_sparse=query_sparse,
        limit=5,
        collection_name="test_hybrid_col",
    )

    assert len(results) > 0
    # doc1이 상위에 랭크되어야 함
    assert results[0].payload.get("chunk_id") == "chunk_001" or results[0].id == "chunk_001"


def test_qdrant_manager_custom_vector_names():
    mem_client = QdrantClient(":memory:")
    config = QdrantConfig(
        collection_name="test_custom_vec_col",
        dense_dim=4,
        dense_vector_name="text_dense",
        sparse_vector_name="text_sparse",
    )
    manager = QdrantManager(config=config, client=mem_client)

    # 1. 커스텀 벡터 이름으로 컬렉션 생성
    created = manager.init_collection(collection_name="test_custom_vec_col", recreate=True)
    assert created is True

    # 컬렉션 스키마 검증
    col_info = mem_client.get_collection("test_custom_vec_col")
    assert "text_dense" in col_info.config.params.vectors
    assert "text_sparse" in col_info.config.params.sparse_vectors

    # 2. 데이터 업서트
    sparse_encoder = KiwiSparseEncoder()
    doc1 = "석면 해체 제거 작업 절차 안내"
    sp1 = sparse_encoder.encode_document(doc1)

    points = [
        {
            "id": "chunk_001",
            "dense_vector": [0.1, 0.2, 0.3, 0.4],
            "sparse_vector": sp1,
            "payload": {"text": doc1, "doc_id": "doc_1"},
        }
    ]
    upsert_count = manager.upsert_points(points, collection_name="test_custom_vec_col")
    assert upsert_count == 1

    # 3. 커스텀 벡터 이름으로 하이브리드 검색
    query_sparse = sparse_encoder.encode_query("석면 해체")
    results = manager.search_hybrid(
        query_dense=[0.1, 0.2, 0.3, 0.4],
        query_sparse=query_sparse,
        limit=2,
        collection_name="test_custom_vec_col",
    )
    assert len(results) == 1
    assert results[0].id == "chunk_001"


def test_get_indexed_docs_summary():
    mem_client = QdrantClient(":memory:")
    config = QdrantConfig(collection_name="test_summary_col", dense_dim=4)
    manager = QdrantManager(config=config, client=mem_client)
    manager.init_collection(collection_name="test_summary_col", recreate=True)

    points = [
        {
            "id": "c_1",
            "dense_vector": [0.1, 0.2, 0.3, 0.4],
            "sparse_vector": SparseVector(indices=[1], values=[1.0]),
            "payload": {
                "doc_title": "산업재해보상보험법",
                "doc_id": "doc_1",
                "chunk_id": "doc_1_c001",
            },
        },
        {
            "id": "c_2",
            "dense_vector": [0.2, 0.3, 0.4, 0.5],
            "sparse_vector": SparseVector(indices=[2], values=[1.0]),
            "payload": {
                "doc_title": "산업재해보상보험법",
                "doc_id": "doc_1",
                "chunk_id": "doc_1_c002",
            },
        },
        {
            "id": "c_3",
            "dense_vector": [0.3, 0.4, 0.5, 0.6],
            "sparse_vector": SparseVector(indices=[3], values=[1.0]),
            "payload": {
                "breadcrumbs": ["요양업무처리규정", "제1조"],
                "doc_id": "doc_2",
                "chunk_id": "doc_2_c001",
            },
        },
    ]

    manager.upsert_points(points, collection_name="test_summary_col")

    summary, doc_names = manager.get_indexed_docs_summary(collection_name="test_summary_col")

    assert "산업재해보상보험법" in summary
    assert summary["산업재해보상보험법"]["chunks_count"] == 2
    assert "요양업무처리규정" in summary
    assert summary["요양업무처리규정"]["chunks_count"] == 1

    assert "산업재해보상보험법" in doc_names
    assert "요양업무처리규정" in doc_names
    assert "doc_1" in doc_names
    assert "doc_2" in doc_names


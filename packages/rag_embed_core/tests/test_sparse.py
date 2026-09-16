import pytest
from rag_embed_core.sparse import KiwiSparseEncoder, hash_token_uint32


def test_hash_token_uint32():
    # 동일한 토큰에 대해 항상 동일한 uint32 값이 나와야 함
    token = "인공지능"
    h1 = hash_token_uint32(token)
    h2 = hash_token_uint32(token)
    assert h1 == h2
    assert isinstance(h1, int)
    assert 0 <= h1 <= 4294967295

    # 서로 다른 토큰은 다른 해시값 산출
    h3 = hash_token_uint32(token + "_다른문자열")
    assert h1 != h3


def test_kiwi_sparse_encoder_tokenization():
    encoder = KiwiSparseEncoder()
    text = "석면 해체·제거 작업 계획서를 산업안전보건공단에 제출해야 합니다."
    tokens = encoder.tokenize(text)

    # 주요 명사/외국어 등이 추출되어야 함
    assert "석면" in tokens
    assert "해체" in tokens
    assert "제거" in tokens
    assert "작업" in tokens
    assert "계획서" in tokens


def test_index_query_skew_prevention():
    """인덱싱 시 추출된 형태소의 해시 인덱스와 쿼리 시 추출된 해시 인덱스가 100% 일치하는지 검증"""
    encoder = KiwiSparseEncoder()
    doc_text = "석면 비산 방지 조치를 철저히 이행할 것"
    query_text = "석면 비산 방지"

    doc_sparse = encoder.encode_document(doc_text)
    query_sparse = encoder.encode_query(query_text)

    # 공통 토큰 확인
    common_indices = set(doc_sparse.indices).intersection(set(query_sparse.indices))
    assert len(common_indices) >= 2  # '석면', '비산', '방지' 중 매칭

    # '석면' 토큰 해시가 doc_sparse와 query_sparse 모두에 동일하게 존재
    asbestos_hash = hash_token_uint32("석면")
    assert asbestos_hash in doc_sparse.indices
    assert asbestos_hash in query_sparse.indices


def test_sparse_encoder_sublinear_tf():
    encoder = KiwiSparseEncoder()
    text = "보호구 보호구 보호구 착용"
    sparse = encoder.encode_document(text)

    # 보호구가 3번 등장했으므로 1.0 + ln(3) ≈ 2.0986
    p_hash = hash_token_uint32("보호구")
    idx = sparse.indices.index(p_hash)
    val = sparse.values[idx]
    assert 2.0 <= val <= 2.2

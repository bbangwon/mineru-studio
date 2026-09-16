from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class SparseVector(BaseModel):
    """Qdrant 및 Milvus 호환 희소 벡터 모델"""
    indices: List[int] = Field(
        default_factory=list,
        description="uint32 해시 인덱스 리스트 (0 ~ 4,294,967,295)"
    )
    values: List[float] = Field(
        default_factory=list,
        description="단어 빈도(TF) 또는 가중치 리스트"
    )


class HybridSearchResult(BaseModel):
    """하이브리드 검색 결과 항목"""
    id: str = Field(..., description="청크 또는 포인트 ID")
    score: float = Field(..., description="RRF 융합 점수 또는 검색 점수")
    dense_score: Optional[float] = Field(default=None, description="Dense 검색 개별 점수")
    sparse_score: Optional[float] = Field(default=None, description="Sparse 검색 개별 점수")
    payload: Dict[str, Any] = Field(default_factory=dict, description="메타데이터 및 원문 텍스트")


class EmbeddedChunk(BaseModel):
    """Dense 및 Sparse 벡터가 결합된 청크 표현"""
    chunk_id: str
    dense_vector: List[float]
    sparse_vector: SparseVector
    payload: Dict[str, Any] = Field(default_factory=dict)

from typing import Literal, Optional
from pydantic import BaseModel, Field


class QdrantConfig(BaseModel):
    """Qdrant 연결 및 컬렉션 설정 모델"""
    mode: Literal["embedded", "remote"] = Field(
        default="embedded",
        description="Qdrant 실행 모드: embedded(로컬 디렉토리 파일 DB) 또는 remote(원격/Docker 서버)"
    )
    local_path: str = Field(
        default="output/qdrant_db",
        description="로컬 embedded 모드 사용 시 데이터 저장 디렉토리 경로"
    )
    url: Optional[str] = Field(
        default="http://localhost:6333",
        description="원격 Qdrant 서버 URL (remote 모드)"
    )
    api_key: Optional[str] = Field(
        default=None,
        description="원격 Qdrant API Key (remote 모드 / Qdrant Cloud)"
    )
    collection_name: str = Field(
        default="mineru_chunks",
        description="기본 컬렉션 이름"
    )
    recreate_collection: bool = Field(
        default=False,
        description="인덱싱 시 기존 컬렉션 삭제 후 재생성 여부"
    )
    dense_model_name: str = Field(
        default="dragonkue/BGE-m3-ko",
        description="HuggingFace Dense 임베딩 모델 이름"
    )
    dense_dim: int = Field(
        default=1024,
        description="Dense 임베딩 벡터 차원 수"
    )
    batch_size: int = Field(
        default=16,
        description="임베딩 및 업서트 배치 크기"
    )
    device: Optional[str] = Field(
        default=None,
        description="임베딩 연산 디바이스 (mps, cuda, cpu 또는 None으로 자동 감지)"
    )
    dense_vector_name: str = Field(
        default="dense",
        description="Qdrant 컬렉션의 Dense 벡터 이름 (기본값: dense)"
    )
    sparse_vector_name: str = Field(
        default="sparse",
        description="Qdrant 컬렉션의 Sparse 벡터 이름 (기본값: sparse)"
    )

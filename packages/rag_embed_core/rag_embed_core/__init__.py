"""rag_embed_core: 한국어 하이브리드(Dense & Sparse) 임베딩 및 Qdrant 통합 엔진"""

from rag_embed_core.config import QdrantConfig
from rag_embed_core.dense import DenseEncoder, detect_optimal_device
from rag_embed_core.models import EmbeddedChunk, HybridSearchResult, SparseVector
from rag_embed_core.qdrant_ops import QdrantManager, to_valid_qdrant_id
from rag_embed_core.sparse import KiwiSparseEncoder, hash_token_uint32

__version__ = "0.1.0"

__all__ = [
    "QdrantConfig",
    "DenseEncoder",
    "detect_optimal_device",
    "SparseVector",
    "HybridSearchResult",
    "EmbeddedChunk",
    "QdrantManager",
    "to_valid_qdrant_id",
    "KiwiSparseEncoder",
    "hash_token_uint32",
]

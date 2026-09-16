import logging
from typing import List, Optional

import torch
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


def detect_optimal_device() -> str:
    """하드웨어 환경에 최적화된 토치 가속 디바이스를 탐지합니다."""
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class DenseEncoder:
    """한국어 Dense 벡터 인코더 (기본: dragonkue/BGE-m3-ko, 1024차원).
    Apple Silicon Metal(MPS) 및 CUDA 하드웨어 가속을 자동으로 지원합니다.
    """

    def __init__(
        self,
        model_name: str = "dragonkue/BGE-m3-ko",
        device: Optional[str] = None,
        lazy_load: bool = False,
    ):
        self.model_name = model_name
        self.device = device or detect_optimal_device()
        self._model: Optional[SentenceTransformer] = None
        self._dim: Optional[int] = None

        if not lazy_load:
            self._load_model()

    def _load_model(self) -> SentenceTransformer:
        if self._model is None:
            logger.info(
                f"DenseEncoder 모델 로딩 시작: {self.model_name} (디바이스: {self.device})"
            )
            self._model = SentenceTransformer(self.model_name, device=self.device)
            # 임베딩 차원 확인 (최신 sentence-transformers 호환)
            if hasattr(self._model, "get_embedding_dimension"):
                self._dim = self._model.get_embedding_dimension()
            elif hasattr(self._model, "get_sentence_embedding_dimension"):
                self._dim = self._model.get_sentence_embedding_dimension()
            else:
                self._dim = 1024
            logger.info(f"DenseEncoder 로딩 완료 (차원: {self._dim})")
        return self._model

    @property
    def model(self) -> SentenceTransformer:
        return self._load_model()

    @property
    def dimension(self) -> int:
        if self._dim is None:
            self._load_model()
        return self._dim or 1024

    def encode_text(self, text: str) -> List[float]:
        """단일 텍스트를 1024차원 L2 정규화 Dense 벡터로 변환합니다."""
        if not text or not text.strip():
            return [0.0] * self.dimension

        vec = self.model.encode(
            text,
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return vec.tolist()

    def encode_texts(
        self,
        texts: List[str],
        batch_size: int = 16,
        show_progress_bar: bool = False,
    ) -> List[List[float]]:
        """복수 텍스트를 배치 처리하여 Dense 벡터 리스트로 반환합니다."""
        if not texts:
            return []

        # 공백 텍스트 예외 처리
        cleaned_texts = [t if (t and t.strip()) else " " for t in texts]
        vecs = self.model.encode(
            cleaned_texts,
            batch_size=batch_size,
            normalize_embeddings=True,
            show_progress_bar=show_progress_bar,
            convert_to_numpy=True,
        )
        return vecs.tolist()

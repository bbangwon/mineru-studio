import pytest
import torch
from unittest.mock import MagicMock, patch
from rag_embed_core.dense import DenseEncoder, detect_optimal_device


def test_detect_optimal_device():
    dev = detect_optimal_device()
    assert dev in ("mps", "cuda", "cpu")
    if torch.backends.mps.is_available():
        assert dev == "mps"


def test_dense_encoder_lazy_loading():
    # lazy_load=True일 때는 생성 시 모델을 로드하지 않아야 함
    encoder = DenseEncoder(model_name="dragonkue/BGE-m3-ko", lazy_load=True)
    assert encoder._model is None


@patch("rag_embed_core.dense.SentenceTransformer")
def test_dense_encoder_mocked(mock_st_class):
    mock_model = MagicMock()
    mock_model.get_embedding_dimension.return_value = 1024
    mock_model.get_sentence_embedding_dimension.return_value = 1024
    # 모의 임베딩 벡터 (1024차원)
    dummy_vec = [0.01] * 1024
    mock_model.encode.return_value = MagicMock(tolist=lambda: dummy_vec)
    mock_st_class.return_value = mock_model

    encoder = DenseEncoder(model_name="test-model", lazy_load=False)
    assert encoder.dimension == 1024

    vec = encoder.encode_text("테스트 문장")
    assert len(vec) == 1024
    assert mock_model.encode.called

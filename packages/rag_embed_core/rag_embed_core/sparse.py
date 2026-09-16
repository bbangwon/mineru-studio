import hashlib
import math
from collections import Counter
from typing import Dict, Iterable, List, Optional, Set

from kiwipiepy import Kiwi

from rag_embed_core.models import SparseVector

# 기본 대상 품사: 일반명사, 고유명사, 수사, 대명사, 외국어, 숫자, 어근
DEFAULT_ALLOWED_POS: Set[str] = {
    "NNG",  # 일반 명사
    "NNP",  # 고유 명사
    "NR",   # 수사
    "NP",   # 대명사
    "SL",   # 외국어
    "SN",   # 숫자
    "XR",   # 어근
}


def hash_token_uint32(token: str) -> int:
    """토큰을 결정론적인 uint32 (0 ~ 4,294,967,295) 정수 해시로 변환.
    SHA256 해시의 앞 8자리 16진수를 파싱하여 100% 동일한 인덱스를 보장합니다.
    """
    return int(hashlib.sha256(token.encode("utf-8")).hexdigest()[:8], 16)


class KiwiSparseEncoder:
    """한국어 형태소 분석기 Kiwi 기반 결정론적 Sparse 벡터 인코더.

    Qdrant Modifier.IDF 환경에 맞추어 클라이언트 측에서는 단어 빈도(TF)와 해시 인덱스만 산출하며,
    전역 IDF는 Qdrant 서버가 실시간으로 처리합니다.
    """

    def __init__(
        self,
        allowed_pos: Optional[Set[str]] = None,
        stopwords: Optional[Iterable[str]] = None,
        kiwi: Optional[Kiwi] = None,
    ):
        self.allowed_pos = allowed_pos or DEFAULT_ALLOWED_POS
        self.stopwords: Set[str] = set(stopwords) if stopwords else set()
        self.kiwi = kiwi or Kiwi()

    def tokenize(self, text: str) -> List[str]:
        """텍스트에서 유효 형태소 토큰 목록을 추출합니다."""
        if not text or not text.strip():
            return []

        tokens: List[str] = []
        parsed = self.kiwi.tokenize(text)
        for token in parsed:
            if token.tag in self.allowed_pos:
                form = token.form.strip()
                if form and form not in self.stopwords:
                    # 영문 등은 소문자 정규화
                    tokens.append(form.lower())
        return tokens

    def encode_document(self, text: str) -> SparseVector:
        """문서 텍스트를 인코딩하여 TF 가중치가 부여된 SparseVector를 생성합니다.
        가중치 공식: TF = 1.0 + ln(count) (Sublinear Scaling)
        동일 해시 충돌 발생 시 max(가중치)로 병합합니다.
        """
        tokens = self.tokenize(text)
        if not tokens:
            return SparseVector(indices=[], values=[])

        token_counts = Counter(tokens)
        index_to_val: Dict[int, float] = {}

        for token, count in token_counts.items():
            idx = hash_token_uint32(token)
            val = 1.0 + math.log(count)
            if idx not in index_to_val or val > index_to_val[idx]:
                index_to_val[idx] = round(val, 4)

        # Qdrant 권장: index 오름차순 정렬
        sorted_items = sorted(index_to_val.items(), key=lambda x: x[0])
        return SparseVector(
            indices=[item[0] for item in sorted_items],
            values=[item[1] for item in sorted_items],
        )

    def encode_query(self, text: str) -> SparseVector:
        """검색 쿼리 텍스트를 인코딩합니다.
        질의에서는 모든 검색 키워드의 기본 가중치를 1.0으로 부여합니다.
        """
        tokens = self.tokenize(text)
        if not tokens:
            return SparseVector(indices=[], values=[])

        index_to_val: Dict[int, float] = {}
        for token in tokens:
            idx = hash_token_uint32(token)
            # 쿼리는 기본 TF 1.0 (동일 토큰 반복 시에도 1.0 유지 또는 필요 시 증가)
            index_to_val[idx] = 1.0

        sorted_items = sorted(index_to_val.items(), key=lambda x: x[0])
        return SparseVector(
            indices=[item[0] for item in sorted_items],
            values=[item[1] for item in sorted_items],
        )

    def encode_documents(self, texts: List[str]) -> List[SparseVector]:
        """여러 문서를 배치로 SparseVector 리스트로 변환합니다."""
        return [self.encode_document(t) for t in texts]

    def encode_queries(self, texts: List[str]) -> List[SparseVector]:
        """여러 질의를 배치로 SparseVector 리스트로 변환합니다."""
        return [self.encode_query(t) for t in texts]

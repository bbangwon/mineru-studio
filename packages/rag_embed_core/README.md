# rag-embed-core

독립형 한국어 하이브리드(Dense & Sparse) 임베딩 및 Qdrant 통합 코어 라이브러리입니다.

## Features
- **Dense Vector**: `dragonkue/BGE-m3-ko` 기반 한국어 고밀도 벡터 임베딩 (1024 차원, Mac MPS / CUDA / CPU 자동 감지)
- **Sparse Vector**: Kiwi 형태소 분석기 기반 키워드 추출 + 결정론적 SHA256 uint32 해싱 + TF 가중치
- **Qdrant Native Hybrid Search**: Qdrant `Modifier.IDF` 지원 (서버사이드 실시간 IDF 연산) 및 `Fusion.RRF` 융합 검색
- **Zero Training-Serving Skew**: 인덱싱(ETL)과 질의(Serving) 시 동일한 토큰화 및 해시 알고리즘 보장

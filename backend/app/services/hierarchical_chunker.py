"""
MinerU 계층 청커 모듈 (하위 호환성 유지용 진입점).
실제 구현체는 backend.app.services.chunker 패키지로 모듈화되었습니다.
"""

from backend.app.services.chunker.engine import HierarchicalChunker
from backend.app.services.chunker.table_extractor import _HTMLTableExtractor

__all__ = ["HierarchicalChunker", "_HTMLTableExtractor"]

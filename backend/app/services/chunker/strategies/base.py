from abc import ABC, abstractmethod
from typing import Any, Dict, List, Tuple


class BaseChunkingStrategy(ABC):
    """문서 유형별 계층 청킹 전략 베이스 클래스"""

    def __init__(self, doc_id: str, filter_headers_footers: bool = True):
        self.doc_id = doc_id
        self.filter_headers_footers = filter_headers_footers

    @abstractmethod
    def chunk(
        self,
        normalized_pages: List[List[Dict[str, Any]]],
        doc_title: str,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, List[Dict[str, Any]]]]:
        """
        페이지별 정규화된 블록 리스트를 받아 섹션 목록과 섹션별 콘텐츠 항목 매핑을 반환합니다.
        Returns:
            Tuple[List[Dict[str, Any]], Dict[str, List[Dict[str, Any]]]]
            (sections, section_items)
        """
        pass

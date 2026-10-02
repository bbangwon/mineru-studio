import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.llm_refine_svc import (
    DEFAULT_RAG_SYSTEM_PROMPT,
    get_default_rag_prompt,
    llm_refine_svc,
)


def test_get_default_rag_prompt():
    prompt = get_default_rag_prompt()
    assert "참고 문서" in prompt
    assert "[참조 #1]" in prompt
    assert prompt == DEFAULT_RAG_SYSTEM_PROMPT


def test_build_rag_context():
    mock_chunks = [
        {
            "chunk_id": "chunk_0001",
            "title": "산재보험 요양급여 가이드",
            "breadcrumbs": ["제2장 자문의사", "제27조 자격 요건"],
            "page_number": 12,
            "text": "자문의사는 전문의 자격을 취득한 후 3년 이상 경과한 자로 한다.",
            "parent_text": "제27조(자문의사의 자격 및 위촉) ① 공단은 다음 각 호의 어느 하나에 해당하는 전문의를 자문의사로 위촉할 수 있다. 전문의 자격을 취득한 후 3년 이상 경과한 자...",
        }
    ]

    # 1. 부모 문맥 포함
    ctx_with_parent = llm_refine_svc.build_rag_context(mock_chunks, use_parent_context=True)
    assert "[참조 #1] 청크 ID: chunk_0001" in ctx_with_parent
    assert "산재보험 요양급여 가이드 | 제2장 자문의사 > 제27조 자격 요건 | p.12" in ctx_with_parent
    assert "--- [검색된 자식 청크 본문] ---" in ctx_with_parent
    assert "--- [연계된 상위 부모 청크 문맥 (Parent Context)] ---" in ctx_with_parent
    assert "자문의사는 전문의 자격을 취득한 후" in ctx_with_parent
    assert "제27조(자문의사의 자격 및 위촉)" in ctx_with_parent

    # 2. 부모 문맥 제외
    ctx_without_parent = llm_refine_svc.build_rag_context(mock_chunks, use_parent_context=False)
    assert "--- [검색된 자식 청크 본문] ---" in ctx_without_parent
    assert "--- [연계된 상위 부모 청크 문맥 (Parent Context)] ---" not in ctx_without_parent


def test_api_get_default_rag_prompt():
    client = TestClient(app)
    res = client.get("/api/llm/rag-query/default-prompt")
    assert res.status_code == 200
    data = res.json()
    assert "default_prompt" in data
    assert "AI 어시스턴트" in data["default_prompt"]


def test_api_stream_rag_empty_query():
    client = TestClient(app)
    res = client.post("/api/llm/rag-query/stream", json={"query": ""})
    assert res.status_code == 400


def test_api_stream_rag_success():
    client = TestClient(app)

    mock_search_results = [
        {
            "chunk_id": "test_chunk_01",
            "title": "테스트 가이드",
            "breadcrumbs": ["1장", "1조"],
            "page_number": 3,
            "text": "테스트 자식 내용",
            "parent_text": "테스트 부모 전체 내용",
            "score": 0.85,
        }
    ]

    async def mock_token_generator(*args, **kwargs):
        tokens = ["안녕", "하세요. ", "테스트", " 답변입니다."]
        for t in tokens:
            yield t

    with patch("backend.app.services.embedding_svc.embedding_svc.hybrid_search", return_value=mock_search_results), \
         patch.object(llm_refine_svc, "stream_rag_answer", side_effect=mock_token_generator):
        
        response = client.post(
            "/api/llm/rag-query/stream",
            json={
                "query": "자문의사 자격 요건은 무엇인가요?",
                "limit": 3,
                "use_parent_context": True,
            },
        )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        body_text = response.text
        assert "event: start" in body_text
        assert "event: token" in body_text
        assert "event: done" in body_text

        # 이벤트 데이터 검증
        assert "test_chunk_01" in body_text
        assert "안녕" in body_text
        assert "답변입니다." in body_text
        assert "llm_elapsed_seconds" in body_text

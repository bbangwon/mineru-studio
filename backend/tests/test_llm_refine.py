import pytest
from unittest.mock import AsyncMock, patch
import httpx

from backend.app.services.llm_config_svc import (
    LLMConfig,
    get_llm_config,
    save_llm_config,
    get_default_system_prompt,
    get_default_summary_prompt,
    get_default_parent_summary_prompt,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_SUMMARY_PROMPT,
    DEFAULT_PARENT_SUMMARY_PROMPT,
)
from backend.app.services.llm_refine_svc import (
    LLMRefineService,
    _clean_markdown_fence,
    get_adaptive_summary_params,
)


def test_llm_config_defaults():
    cfg = LLMConfig()
    assert cfg.base_url == "http://localhost:11434/v1"
    assert cfg.model_name == "gemma4:12b-mlx"
    assert cfg.temperature == 0.0
    assert cfg.max_tokens == 2048
    assert cfg.system_prompt == DEFAULT_SYSTEM_PROMPT
    assert get_default_system_prompt() == DEFAULT_SYSTEM_PROMPT
    assert cfg.summary_prompt == DEFAULT_SUMMARY_PROMPT
    assert get_default_summary_prompt() == DEFAULT_SUMMARY_PROMPT


def test_clean_markdown_fence():
    assert _clean_markdown_fence("hello world") == "hello world"
    raw1 = "```markdown\n교정된 본문입니다.\n```"
    assert _clean_markdown_fence(raw1) == "교정된 본문입니다."
    raw2 = "```text\n교정된 본문입니다.\n```"
    assert _clean_markdown_fence(raw2) == "교정된 본문입니다."
    raw3 = "```\n교정된 본문입니다.\n```"
    assert _clean_markdown_fence(raw3) == "교정된 본문입니다."


@pytest.mark.anyio
async def test_llm_refine_service_mocked():
    svc = LLMRefineService()
    cfg = LLMConfig(base_url="http://mock-llm/v1", model_name="gemma4:12b-mlx", temperature=0.0)

    mock_response = httpx.Response(
        status_code=200,
        json={
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "이것은 정상적으로 교정된 본문입니다.",
                    }
                }
            ]
        },
        request=httpx.Request("POST", "http://mock-llm/v1/chat/completions"),
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        res = await svc.refine_chunk_text(
            text="이것 은  비정상 적인\n\n줄 바꿈 이다.",
            config=cfg,
        )
        assert res["success"] is True
        assert res["refined_text"] == "이것은 정상적으로 교정된 본문입니다."
        assert res["original_chars"] > 0
        assert res["refined_chars"] > 0


@pytest.mark.anyio
async def test_llm_refine_service_empty_response_guard():
    svc = LLMRefineService()
    cfg = LLMConfig(base_url="http://mock-llm/v1", model_name="gemma4:12b-mlx")

    mock_response = httpx.Response(
        status_code=200,
        json={
            "choices": [
                {
                    "message": {"role": "assistant", "content": ""},
                    "finish_reason": "length",
                }
            ]
        },
        request=httpx.Request("POST", "http://mock-llm/v1/chat/completions"),
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        with pytest.raises(RuntimeError) as exc_info:
            await svc.refine_chunk_text(
                text="정상적인 원문 텍스트가 있습니다.",
                config=cfg,
            )
        assert "추론 토큰(max_tokens) 한도 초과" in str(exc_info.value)


@pytest.mark.anyio
async def test_llm_summarize_service_mocked():
    svc = LLMRefineService()
    cfg = LLMConfig(base_url="http://mock-llm/v1", model_name="gemma4:12b-mlx", temperature=0.0)

    mock_response = httpx.Response(
        status_code=200,
        json={
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "이 청크는 근골격계 질병의 조사 및 판정 지침을 요약한 내용입니다.",
                    }
                }
            ]
        },
        request=httpx.Request("POST", "http://mock-llm/v1/chat/completions"),
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        res = await svc.summarize_chunk_text(
            text="제1장 총칙 본 지침은 산업재해보상보험법에 따른 근골격계 질병의 신속 공정한 처리를 목적으로 한다.",
            config=cfg,
        )
        assert res["success"] is True
        assert res["summary_text"] == "이 청크는 근골격계 질병의 조사 및 판정 지침을 요약한 내용입니다."
        assert res["original_chars"] > 0
        assert res["summary_chars"] > 0


@pytest.mark.anyio
async def test_test_connection_mocked():
    svc = LLMRefineService()
    cfg = LLMConfig(base_url="http://mock-llm/v1", model_name="gemma4:12b-mlx")

    mock_response = httpx.Response(
        status_code=200,
        json={"choices": [{"message": {"role": "assistant", "content": "pong"}}]},
        request=httpx.Request("POST", "http://mock-llm/v1/chat/completions"),
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        res = await svc.test_connection(cfg)
        assert res["success"] is True
        assert "성공적" in res["message"]
        assert res["model"] == "gemma4:12b-mlx"
        assert res["latency_ms"] >= 0


def test_adaptive_summary_params():
    p1 = get_adaptive_summary_params(300)
    assert p1["tier"] == 1
    assert p1["target_sentences"] == "2~3문장"
    assert p1["max_tokens"] == 256

    p2 = get_adaptive_summary_params(800)
    assert p2["tier"] == 2
    assert p2["target_sentences"] == "3~5문장"
    assert p2["max_tokens"] == 512

    p3 = get_adaptive_summary_params(1800)
    assert p3["tier"] == 3
    assert p3["target_sentences"] == "5~7문장"
    assert p3["max_tokens"] == 768

    p4 = get_adaptive_summary_params(3200)
    assert p4["tier"] == 4
    assert p4["target_sentences"] == "7~10문장"
    assert p4["max_tokens"] == 1024


@pytest.mark.anyio
async def test_parent_summary_adaptive_execution():
    svc = LLMRefineService()
    cfg = LLMConfig(base_url="http://mock-llm/v1", model_name="gemma4:12b-mlx")

    mock_response = httpx.Response(
        status_code=200,
        json={
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "이 부모 청크는 상병 판단 기준과 절차를 포괄적으로 설명하는 핵심 문맥입니다.",
                    }
                }
            ]
        },
        request=httpx.Request("POST", "http://mock-llm/v1/chat/completions"),
    )

    long_text = "제1조(목적) 본 규정은 ... " * 200  # 약 1000자 이상
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        res = await svc.summarize_chunk_text(
            text=long_text,
            config=cfg,
            is_parent=True,
        )
        assert res["success"] is True
        assert res["is_parent"] is True
        assert res["token_estimate"] > 0
        assert "target_sentences" in res
        assert "tier" in res
        assert res["summary_text"].startswith("이 부모 청크는")

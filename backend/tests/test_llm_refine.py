import pytest
from unittest.mock import AsyncMock, patch
import httpx

from backend.app.services.llm_config_svc import (
    LLMConfig,
    get_llm_config,
    save_llm_config,
    get_default_system_prompt,
    DEFAULT_SYSTEM_PROMPT,
)
from backend.app.services.llm_refine_svc import (
    LLMRefineService,
    _clean_markdown_fence,
)


def test_llm_config_defaults():
    cfg = LLMConfig()
    assert cfg.base_url == "http://localhost:11434/v1"
    assert cfg.model_name == "gemma4:12b-mlx"
    assert cfg.temperature == 0.0
    assert cfg.max_tokens == 2048
    assert cfg.system_prompt == DEFAULT_SYSTEM_PROMPT
    assert get_default_system_prompt() == DEFAULT_SYSTEM_PROMPT


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

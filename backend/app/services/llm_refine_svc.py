import logging
import re
import time
from typing import Any, Dict, List, Optional

import httpx

from backend.app.services.llm_config_svc import LLMConfig, get_llm_config

logger = logging.getLogger(__name__)


def _clean_markdown_fence(text: str) -> str:
    """모델이 규칙을 어기고 전체 출력을 마크다운 코드블록으로 감싼 경우 안전하게 제거합니다."""
    trimmed = text.strip()
    # ```markdown ... ``` 또는 ```text ... ``` 또는 ``` ... ```
    pattern = r"^```(?:markdown|text)?\s*\n([\s\S]*?)\n```$"
    match = re.match(pattern, trimmed)
    if match:
        return match.group(1).strip()
    return trimmed


class LLMRefineService:
    """OpenAI 호환 API 기반 텍스트 정제 및 모델 통신 서비스"""

    @staticmethod
    def _build_headers(api_key: Optional[str]) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if api_key and api_key.strip():
            headers["Authorization"] = f"Bearer {api_key.strip()}"
        return headers

    async def test_connection(self, config: Optional[LLMConfig] = None) -> Dict[str, Any]:
        """지정된 LLM 엔드포인트 및 모델과의 연결 테스트 및 핑 지연시간을 측정합니다."""
        cfg = config or get_llm_config()
        base_url = cfg.base_url.rstrip("/")
        headers = self._build_headers(cfg.api_key)

        test_payload = {
            "model": cfg.model_name,
            "messages": [
                {"role": "user", "content": "ping"}
            ],
            "max_tokens": 5,
            "temperature": 0.0,
        }

        start_time = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=min(cfg.timeout, 15)) as client:
                res = await client.post(
                    f"{base_url}/chat/completions",
                    json=test_payload,
                    headers=headers,
                )
                latency_ms = (time.perf_counter() - start_time) * 1000

                if res.status_code == 200:
                    return {
                        "success": True,
                        "message": f"'{cfg.model_name}' 모델과 성공적으로 연결되었습니다.",
                        "model": cfg.model_name,
                        "latency_ms": round(latency_ms, 1),
                    }
                else:
                    error_detail = res.text
                    try:
                        err_json = res.json()
                        if "error" in err_json:
                            error_detail = str(err_json["error"])
                    except Exception:
                        pass
                    return {
                        "success": False,
                        "message": f"HTTP {res.status_code}: {error_detail}",
                        "model": cfg.model_name,
                        "latency_ms": round(latency_ms, 1),
                        "error": error_detail,
                    }
        except httpx.ConnectError:
            return {
                "success": False,
                "message": f"서버 연결 실패: {base_url} 에 접속할 수 없습니다. 로컬 서버(Ollama, LM Studio 등) 실행 여부를 확인하세요.",
                "model": cfg.model_name,
                "error": "Connection refused",
            }
        except httpx.TimeoutException:
            return {
                "success": False,
                "message": f"요청 시간 초과 ({min(cfg.timeout, 15)}s 초과)",
                "model": cfg.model_name,
                "error": "Timeout",
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"연결 테스트 오류: {str(e)}",
                "model": cfg.model_name,
                "error": str(e),
            }

    async def fetch_models(self, config: Optional[LLMConfig] = None) -> List[str]:
        """/v1/models 엔드포인트를 호출하여 사용 가능한 모델 목록을 조회합니다."""
        cfg = config or get_llm_config()
        base_url = cfg.base_url.rstrip("/")
        headers = self._build_headers(cfg.api_key)

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.get(f"{base_url}/models", headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    models_data = data.get("data", [])
                    models = []
                    for item in models_data:
                        if isinstance(item, dict) and "id" in item:
                            models.append(item["id"])
                        elif isinstance(item, str):
                            models.append(item)
                    return sorted(models)
                else:
                    logger.warning(f"모델 목록 조회 실패 HTTP {res.status_code}: {res.text}")
                    return []
        except Exception as e:
            logger.warning(f"모델 목록 조회 중 오류 발생: {e}")
            return []

    async def refine_chunk_text(
        self,
        text: str,
        custom_prompt: Optional[str] = None,
        config: Optional[LLMConfig] = None,
    ) -> Dict[str, Any]:
        """시스템 프롬프트 주입 후 청크 텍스트를 OpenAI 호환 LLM으로 교정합니다."""
        cfg = config or get_llm_config()
        base_url = cfg.base_url.rstrip("/")
        headers = self._build_headers(cfg.api_key)

        system_prompt = (
            custom_prompt.strip()
            if (custom_prompt and custom_prompt.strip())
            else cfg.system_prompt
        )

        payload = {
            "model": cfg.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            "temperature": cfg.temperature,
            "max_tokens": cfg.max_tokens,
        }

        start_time = time.perf_counter()
        async with httpx.AsyncClient(timeout=cfg.timeout) as client:
            res = await client.post(
                f"{base_url}/chat/completions",
                json=payload,
                headers=headers,
            )

            if res.status_code != 200:
                err_msg = res.text
                try:
                    err_data = res.json()
                    if "error" in err_data:
                        err_msg = str(err_data["error"])
                except Exception:
                    pass
                raise RuntimeError(
                    f"LLM 텍스트 교정 실패 (HTTP {res.status_code}): {err_msg}"
                )

            data = res.json()
            elapsed_sec = time.perf_counter() - start_time

            choices = data.get("choices", [])
            if not choices or "message" not in choices[0]:
                raise RuntimeError(f"LLM 응답에 텍스트가 없습니다: {data}")

            raw_content = choices[0]["message"].get("content", "")
            refined = _clean_markdown_fence(raw_content)

            return {
                "success": True,
                "original_text": text,
                "refined_text": refined,
                "elapsed_seconds": round(elapsed_sec, 2),
                "original_chars": len(text),
                "refined_chars": len(refined),
            }


llm_refine_svc = LLMRefineService()

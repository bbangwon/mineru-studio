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


DEFAULT_RAG_SYSTEM_PROMPT = """당신은 주어진 참고 문서를 바탕으로 질문에 정확하고 충실하게 답변하는 전문 AI 어시스턴트입니다.

[답변 원칙]
1. 반드시 아래 제공된 [참고 문서]의 내용만을 근거로 삼아 답변하세요.
2. 문서에서 명시적으로 확인할 수 없는 사실은 추측하여 지어내지 말고, "제공된 문서에서 관련 내용을 찾을 수 없습니다"라고 솔직하게 답변하세요.
3. 답변 시 참고한 문서 번호(예: [참조 #1], [참조 #2])를 내용 중간이나 끝에 인용 표기하세요.
4. 부모 청크 문맥(상위 맥락)이 함께 제공된 경우, 해당 섹션의 전체적인 배경과 목적을 충분히 고려하여 답변의 정확성을 높이세요.
5. 한국어로 친절하고 일목요연하게 마크다운(Markdown) 형식으로 작성하세요."""


def get_default_rag_prompt() -> str:
    """기본 RAG 시스템 프롬프트 텍스트 반환"""
    return DEFAULT_RAG_SYSTEM_PROMPT


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

    @staticmethod
    def build_rag_context(
        chunks: List[Dict[str, Any]],
        use_parent_context: bool = True,
    ) -> str:
        """검색된 청크 목록을 LLM에 주입하기 좋은 구조화된 마크다운 컨텍스트 블록으로 조립합니다."""
        if not chunks:
            return "검색된 관련 문서가 없습니다."

        context_blocks: List[str] = []
        for idx, chunk in enumerate(chunks, start=1):
            chunk_id = chunk.get("chunk_id") or chunk.get("id") or f"chunk_{idx}"
            breadcrumbs = chunk.get("breadcrumbs") or chunk.get("heading_hierarchy") or []
            hierarchy_path = " > ".join(str(b) for b in breadcrumbs) if breadcrumbs else "기타"
            doc_title = chunk.get("title") or chunk.get("doc_title") or ""
            page_start = chunk.get("page_number") or ((chunk.get("page_idx") or 0) + 1)
            page_end = chunk.get("page_end") or page_start
            page_str = f"p.{page_start}~{page_end}" if page_end > page_start else f"p.{page_start}"

            location_parts = []
            if doc_title:
                location_parts.append(doc_title)
            if hierarchy_path and hierarchy_path != doc_title:
                location_parts.append(hierarchy_path)
            location_parts.append(page_str)
            location_info = " | ".join(location_parts)

            child_text = (chunk.get("text") or "").strip()
            parent_text = (chunk.get("parent_text") or "").strip()

            block_lines = [
                f"[참조 #{idx}] 청크 ID: {chunk_id} ({location_info})",
                "--- [검색된 자식 청크 본문] ---",
                child_text,
            ]

            if use_parent_context and parent_text and parent_text != child_text:
                block_lines.extend([
                    "--- [연계된 상위 부모 청크 문맥 (Parent Context)] ---",
                    parent_text,
                ])

            context_blocks.append("\n".join(block_lines))

        return "\n\n" + ("=" * 48) + "\n\n".join([""] + context_blocks) + "\n" + ("=" * 48)

    async def stream_rag_answer(
        self,
        query: str,
        retrieved_chunks: List[Dict[str, Any]],
        use_parent_context: bool = True,
        custom_system_prompt: Optional[str] = None,
        config: Optional[LLMConfig] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ):
        """참조 문서를 바탕으로 질문에 대한 답변을 OpenAI 호환 SSE 스트리밍으로 생성합니다."""
        import json

        cfg = config or get_llm_config()
        base_url = cfg.base_url.rstrip("/")
        headers = self._build_headers(cfg.api_key)

        system_prompt = (
            custom_system_prompt.strip()
            if (custom_system_prompt and custom_system_prompt.strip())
            else get_default_rag_prompt()
        )

        context_str = self.build_rag_context(retrieved_chunks, use_parent_context=use_parent_context)

        user_content = (
            f"[참고 문서]\n{context_str}\n\n"
            f"[사용자 질문]\n{query.strip()}\n\n"
            f"[답변 지침]\n위 [참고 문서]의 내용을 기반으로 질문에 신뢰성 있게 답변하세요. 인용 가능한 [참조 #N] 번호를 함께 표기하세요."
        )

        payload = {
            "model": cfg.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": temperature if temperature is not None else cfg.temperature,
            "max_tokens": max_tokens if max_tokens is not None else cfg.max_tokens,
            "stream": True,
        }

        async with httpx.AsyncClient(timeout=cfg.timeout) as client:
            async with client.stream(
                "POST",
                f"{base_url}/chat/completions",
                json=payload,
                headers=headers,
            ) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    err_msg = error_text.decode("utf-8", errors="replace")
                    try:
                        err_json = json.loads(err_msg)
                        if "error" in err_json:
                            err_msg = str(err_json["error"])
                    except Exception:
                        pass
                    raise RuntimeError(f"LLM 스트리밍 호출 실패 (HTTP {response.status_code}): {err_msg}")

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    line = line.strip()
                    if line.startswith("data: "):
                        data_str = line[6:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            data_json = json.loads(data_str)
                            choices = data_json.get("choices", [])
                            if choices:
                                delta = choices[0].get("delta", {})
                                content = delta.get("content")
                                if content:
                                    yield content
                        except Exception:
                            continue


llm_refine_svc = LLMRefineService()

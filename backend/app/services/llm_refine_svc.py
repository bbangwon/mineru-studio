import logging
import re
import time
from typing import Any, Dict, List, Optional

import httpx

from backend.app.services.chunker.text_normalizer import estimate_korean_tokens
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


def get_adaptive_summary_params(token_count: int) -> Dict[str, Any]:
    """
    청크(Child/Parent)의 추정 토큰 수에 비례하여 권장 문장 수, 글자 수, 생성 max_tokens 및 Ollama num_ctx를 동적으로 산출합니다.
    - Tier 1 (~512 tokens): 2~3문장, 120~200자, max_tokens=256, num_ctx=4096
    - Tier 2 (513~1500 tokens): 3~5문장, 200~350자, max_tokens=512, num_ctx=4096
    - Tier 3 (1501~2500 tokens): 5~7문장, 350~550자, max_tokens=768, num_ctx=max(4096, token_count + 1024)
    - Tier 4 (2501+ tokens): 7~10문장, 500~800자, max_tokens=1024, num_ctx=max(8192, token_count + 2048)
    """
    if token_count <= 512:
        return {
            "tier": 1,
            "target_sentences": "2~3문장",
            "target_chars": "120~200자",
            "max_tokens": 256,
            "num_ctx": 4096,
        }
    elif token_count <= 1500:
        return {
            "tier": 2,
            "target_sentences": "3~5문장",
            "target_chars": "200~350자",
            "max_tokens": 512,
            "num_ctx": 4096,
        }
    elif token_count <= 2500:
        return {
            "tier": 3,
            "target_sentences": "5~7문장",
            "target_chars": "350~550자",
            "max_tokens": 768,
            "num_ctx": max(4096, token_count + 1024),
        }
    else:
        return {
            "tier": 4,
            "target_sentences": "7~10문장",
            "target_chars": "500~800자",
            "max_tokens": 1024,
            "num_ctx": max(8192, token_count + 2048),
        }


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

    async def _post_chat(
        self,
        cfg: LLMConfig,
        messages: List[Dict[str, str]],
        max_tokens_override: Optional[int] = None,
        num_ctx_override: Optional[int] = None,
    ) -> str:
        """Ollama의 think=False 최적화 및 OpenAI 호환 API를 지원하는 공통 챗 호출 헬퍼"""
        base_url = cfg.base_url.rstrip("/")
        headers = self._build_headers(cfg.api_key)
        gen_tokens = max_tokens_override or cfg.max_tokens

        # 1. Ollama 네이티브 엔드포인트 지원 (Thinking 모델의 무한 생각 루프 방지: think=False 적용)
        if "11434" in base_url or "ollama" in base_url.lower():
            ollama_url = re.sub(r"/v1/?$", "", base_url) + "/api/chat"
            ollama_options: Dict[str, Any] = {
                "temperature": cfg.temperature,
                "num_predict": gen_tokens,
            }
            if num_ctx_override:
                ollama_options["num_ctx"] = num_ctx_override

            ollama_payload = {
                "model": cfg.model_name,
                "messages": messages,
                "stream": False,
                "think": False,
                "options": ollama_options,
            }
            try:
                async with httpx.AsyncClient(timeout=cfg.timeout) as client:
                    res = await client.post(ollama_url, json=ollama_payload, headers=headers)
                    if res.status_code == 200:
                        data = res.json()
                        raw = data.get("message", {}).get("content", "")
                        if raw:
                            return raw
            except Exception as e:
                logger.debug(f"Ollama 네이티브 /api/chat 호출 실패, OpenAI 호환 엔드포인트로 폴백: {e}")

        # 2. 표준 OpenAI 호환 엔드포인트 호출 (/v1/chat/completions)
        openai_url = f"{base_url}/chat/completions" if not base_url.endswith("/chat/completions") else base_url
        payload = {
            "model": cfg.model_name,
            "messages": messages,
            "temperature": cfg.temperature,
            "max_tokens": gen_tokens,
            "think": False,
        }

        async with httpx.AsyncClient(timeout=cfg.timeout) as client:
            res = await client.post(openai_url, json=payload, headers=headers)
            if res.status_code != 200:
                err_msg = res.text
                try:
                    err_data = res.json()
                    if "error" in err_data:
                        err_msg = str(err_data["error"])
                except Exception:
                    pass
                raise RuntimeError(f"LLM API 호출 실패 (HTTP {res.status_code}): {err_msg}")

            data = res.json()
            choices = data.get("choices", [])
            if not choices or "message" not in choices[0]:
                raise RuntimeError(f"LLM 응답에 텍스트가 없습니다: {data}")

            finish_reason = choices[0].get("finish_reason")
            raw_content = choices[0]["message"].get("content", "")

            if not raw_content and finish_reason == "length":
                raise RuntimeError(
                    "LLM 추론 토큰(max_tokens) 한도 초과로 인해 텍스트가 생성되지 못했습니다. "
                    "max_tokens를 늘리거나 비-추론 모델을 사용해 주세요."
                )

            return raw_content

    async def refine_chunk_text(
        self,
        text: str,
        custom_prompt: Optional[str] = None,
        config: Optional[LLMConfig] = None,
    ) -> Dict[str, Any]:
        """시스템 프롬프트 주입 후 청크 텍스트를 OpenAI 호환 LLM으로 교정합니다."""
        cfg = config or get_llm_config()

        system_prompt = (
            custom_prompt.strip()
            if (custom_prompt and custom_prompt.strip())
            else cfg.system_prompt
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ]

        start_time = time.perf_counter()
        raw_content = await self._post_chat(cfg, messages)
        elapsed_sec = time.perf_counter() - start_time

        refined = _clean_markdown_fence(raw_content)

        # 안전 가드: 원문이 존재하는데 교정 결과가 빈 문자열인 경우 본문 전체 삭제 방지
        if text.strip() and not refined.strip():
            raise RuntimeError(
                "LLM이 빈 교정 결과를 반환했습니다. 원문 유실(전체 삭제) 방지를 위해 교정을 중단했습니다."
            )

        return {
            "success": True,
            "original_text": text,
            "refined_text": refined,
            "elapsed_seconds": round(elapsed_sec, 2),
            "original_chars": len(text),
            "refined_chars": len(refined),
        }

    async def summarize_chunk_text(
        self,
        text: str,
        custom_prompt: Optional[str] = None,
        config: Optional[LLMConfig] = None,
        is_parent: bool = False,
    ) -> Dict[str, Any]:
        """토큰 적응형 시스템 프롬프트 주입 후 청크(Child/Parent) 텍스트의 핵심 요약을 생성합니다."""
        cfg = config or get_llm_config()

        token_estimate = estimate_korean_tokens(text)
        params = get_adaptive_summary_params(token_estimate)

        if custom_prompt and custom_prompt.strip():
            raw_prompt = custom_prompt.strip()
        elif is_parent and cfg.parent_summary_prompt and cfg.parent_summary_prompt.strip():
            raw_prompt = cfg.parent_summary_prompt.strip()
        else:
            raw_prompt = cfg.summary_prompt

        # 템플릿 치환: {target_sentences}, {target_chars}
        if "{target_sentences}" in raw_prompt or "{target_chars}" in raw_prompt:
            summary_prompt = raw_prompt.replace(
                "{target_sentences}", params["target_sentences"]
            ).replace("{target_chars}", params["target_chars"])
        else:
            # 구버전 프롬프트 호환: '2~3문장(100~200자 내외)' 패턴이 있으면 스마트 치환
            summary_prompt = re.sub(
                r'2~3\s*문장\s*\(\s*100~200\s*자\s*내외\s*\)',
                f'{params["target_sentences"]}({params["target_chars"]} 내외)',
                raw_prompt,
            )

        messages = [
            {"role": "system", "content": summary_prompt},
            {"role": "user", "content": text},
        ]

        start_time = time.perf_counter()
        raw_content = await self._post_chat(
            cfg,
            messages,
            max_tokens_override=params["max_tokens"],
            num_ctx_override=params["num_ctx"],
        )
        elapsed_sec = time.perf_counter() - start_time

        summary = _clean_markdown_fence(raw_content)

        if text.strip() and not summary.strip():
            raise RuntimeError("LLM이 빈 요약 결과를 반환했습니다.")

        return {
            "success": True,
            "original_text": text,
            "summary_text": summary,
            "elapsed_seconds": round(elapsed_sec, 2),
            "original_chars": len(text),
            "summary_chars": len(summary),
            "token_estimate": token_estimate,
            "target_sentences": params["target_sentences"],
            "target_chars": params["target_chars"],
            "tier": params["tier"],
            "is_parent": is_parent,
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
            parent_summary = (chunk.get("parent_summary") or "").strip()
            chunk_summary = (chunk.get("summary") or "").strip()

            block_lines = [
                f"[참조 #{idx}] 청크 ID: {chunk_id} ({location_info})",
            ]
            if chunk_summary:
                block_lines.append(f"--- [자식 청크 요약] ---\n{chunk_summary}")

            block_lines.extend([
                "--- [검색된 자식 청크 본문] ---",
                child_text,
            ])

            if use_parent_context and parent_summary:
                block_lines.extend([
                    "--- [상위 부모 핵심 요약] ---",
                    parent_summary,
                ])

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

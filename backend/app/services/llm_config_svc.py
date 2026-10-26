import json
import logging
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
CONFIG_FILE_PATH = BASE_DIR / "output" / "llm_config.json"

DEFAULT_SYSTEM_PROMPT = """당신은 학술/기술 문서 및 법률/비즈니스 문서의 OCR/텍스트 추출 결과를 원문 훼손 없이 완벽하게 정제하는 교정 전문가입니다.
입력으로 주어지는 청크 텍스트의 가독성과 형태소 분석 품질을 개선하기 위해 아래 규칙을 엄격히 준수하여 교정하십시오.

[교정 규칙]
1. 원문의 모든 내용, 단어, 어휘, 기술 용어, 고유명사, 숫자, 어순을 100% 그대로 보존하십시오. 절대로 내용을 요약, 부연 설명, 해석, 삭제, 추가하지 마십시오.
2. PDF 레이아웃으로 인해 단어 중간이나 문장 중간에서 부자연스럽게 잘린 비정상적인 줄바꿈(하이픈 개행 포함)을 찾아 자연스러운 한 줄 문단으로 병합하십시오.
3. 의미상 문단 구분이 명확한 경우에만 적절한 빈 줄(Paragraph Break)을 유지하십시오.
4. 국립국어원 표준 맞춤법 및 띄어쓰기 규정에 맞추어 비정상적인 띄어쓰기(붙여 쓰인 조사, 띄어 쓰인 복합명사 등)를 교정하십시오. 단, 원문에 누락된 쉼표(,) 등의 문장부호는 임의로 추가하지 말고 원형을 유지하십시오.
5. 표(Markdown Table / HTML Table), 코드 블록, 수식(LaTeX), 특수 기호는 서식을 깨뜨리지 말고 원형 그대로 유지하십시오.
6. 중간 초안 작성(Drafting)이나 재검토를 반복하지 말고, 즉시 1회의 교정으로 최종 텍스트만 출력하십시오.
7. 출력은 어떠한 인사말, 설명, 마크다운 코드블록 따옴표(``` 등)도 포함하지 말고, 오직 교정된 순수 텍스트만 출력하십시오."""

DEFAULT_SUMMARY_PROMPT = """당신은 학술/기술 및 법률/비즈니스 문서 청크의 핵심 내용을 집약적으로 압축 요약하는 전문 AI 어시스턴트입니다.
주어진 청크 텍스트를 분석하여 검색 증강 생성(RAG) 및 빠른 내용 파악을 위한 완성도 높은 핵심 요약을 작성하십시오.

[요약 규칙]
1. 원문의 핵심 주제, 주요 규정/수치, 적용 대상을 정확히 포함하되, 원문을 그대로 재나열하지 말고 핵심 위주로 집약하여 서술하십시오.
2. 분량은 반드시 {target_sentences} ({target_chars} 내외)로 간결하고 완성도 높은 줄글 문단으로 작성하십시오.
3. 마크다운 제목(#, **굵은글씨 제목**)이나 불필요한 번호 매기기를 지양하고, 읽기 쉬운 완성된 줄글(문단)로 출력하십시오.
4. 원문에 없는 사실을 지어내거나 추측하지 마십시오."""

DEFAULT_PARENT_SUMMARY_PROMPT = """당신은 학술/기술 및 법률/비즈니스 문서의 거시적 문맥(Parent Chunk)을 총괄 요약하는 전문 AI 어시스턴트입니다.
하위 자식 청크들을 아우르는 전체 부모 문맥 텍스트를 분석하여, 핵심 취지와 주요 규정 내용을 균형 있게 요약하십시오.

[요약 규칙]
1. 세부 사항의 단순 나열을 지양하고, 전체 흐름과 핵심 규정/데이터의 결론을 명확히 압축하십시오.
2. 분량은 반드시 {target_sentences} ({target_chars} 내외)로 완성도 높은 문단 형태로 작성하십시오.
3. 마크다운 제목(#, **굵은글씨 제목**)이나 불필요한 번호 매기기를 지양하고 읽기 편한 줄글로 출력하십시오.
4. 원문에 없는 사실을 지어내거나 왜곡하지 마십시오."""


class LLMConfig(BaseModel):
    base_url: str = Field(
        default="http://localhost:11434/v1",
        description="OpenAI 호환 엔드포인트 기본 URL (Ollama, LM Studio, vLLM 등)",
    )
    model_name: str = Field(
        default="gemma4:12b-mlx",
        description="텍스트 정제에 사용할 LLM 모델 식별자 (기본: gemma4:12b-mlx)",
    )
    temperature: float = Field(
        default=0.0,
        ge=0.0,
        le=2.0,
        description="생성 온도 (결정론적 정제를 위해 0.0 기본)",
    )
    api_key: Optional[str] = Field(
        default="",
        description="OpenAI 호환 API 인증 키 (로컬 서버 구동 시 생략 가능)",
    )
    max_tokens: int = Field(
        default=2048,
        description="최대 생성 토큰 수",
    )
    timeout: int = Field(
        default=60,
        description="API 호출 타임아웃(초)",
    )
    system_prompt: str = Field(
        default=DEFAULT_SYSTEM_PROMPT,
        description="텍스트 교정 전용 시스템 프롬프트",
    )
    summary_prompt: str = Field(
        default=DEFAULT_SUMMARY_PROMPT,
        description="청크 요약 전용 시스템 프롬프트",
    )
    parent_summary_prompt: Optional[str] = Field(
        default=None,
        description="부모 청크(Parent Chunk) 전용 요약 시스템 프롬프트 (미지정 시 summary_prompt 기반 작동)",
    )


def get_default_system_prompt() -> str:
    """기본 권장 시스템 프롬프트를 반환합니다."""
    return DEFAULT_SYSTEM_PROMPT


def get_default_summary_prompt() -> str:
    """기본 권장 청크 요약 시스템 프롬프트를 반환합니다."""
    return DEFAULT_SUMMARY_PROMPT


def get_default_parent_summary_prompt() -> str:
    """기본 권장 부모 청크 요약 시스템 프롬프트를 반환합니다."""
    return DEFAULT_PARENT_SUMMARY_PROMPT


def get_llm_config() -> LLMConfig:
    """저장된 LLM 설정을 불러오거나 기본 설정을 생성 후 반환합니다."""
    if CONFIG_FILE_PATH.exists():
        try:
            with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return LLMConfig(**data)
        except Exception as e:
            logger.warning(f"LLM 설정 파일 로딩 실패, 기본값 사용: {e}")

    # 기본 설정 반환 및 파일 영속화
    default_config = LLMConfig()
    save_llm_config(default_config)
    return default_config


def save_llm_config(config: LLMConfig) -> LLMConfig:
    """LLM 설정을 output/llm_config.json 파일에 영속화합니다."""
    CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(config.model_dump(), f, ensure_ascii=False, indent=2)
    return config

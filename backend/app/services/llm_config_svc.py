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
4. 국립국어원 표준 맞춤법 및 띄어쓰기 규정에 맞추어 비정상적인 띄어쓰기(붙여 쓰인 조사, 띄어 쓰인 복합명사 등)를 교정하십시오.
5. 표(Markdown Table / HTML Table), 코드 블록, 수식(LaTeX), 특수 기호는 서식을 깨뜨리지 말고 원형 그대로 유지하십시오.
6. 출력은 어떠한 인사말, 설명, 마크다운 코드블록 따옴표(``` 등)도 포함하지 말고, 오직 교정된 순수 텍스트만 출력하십시오."""


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


def get_default_system_prompt() -> str:
    """기본 권장 시스템 프롬프트를 반환합니다."""
    return DEFAULT_SYSTEM_PROMPT


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

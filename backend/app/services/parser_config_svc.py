import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
CONFIG_FILE_PATH = BASE_DIR / "output" / "parser_config.json"


class ParserConfig(BaseModel):
    backend: str = Field(
        default="pipeline",
        description="MinerU 파싱 엔진 ('pipeline' | 'hybrid-engine')",
    )
    method: str = Field(
        default="auto",
        description="텍스트 추출 방식 ('auto' | 'ocr' | 'txt')",
    )
    formula: bool = Field(
        default=True,
        description="LaTeX 수식 인식 활성화 여부",
    )
    strategy: str = Field(
        default="general",
        description="청킹 전략 ('general' | 'legal' | 'report')",
    )
    all_pages: bool = Field(
        default=True,
        description="문서 전체 페이지 파싱 여부",
    )
    start_page: int = Field(
        default=0,
        ge=0,
        description="시작 페이지 번호 (0-indexed)",
    )
    end_page: int = Field(
        default=2,
        ge=0,
        description="종료 페이지 번호 (0-indexed)",
    )


def get_default_parser_config() -> ParserConfig:
    """기본 권장 파서 설정을 생성하여 반환합니다."""
    return ParserConfig(
        backend="pipeline",
        method="auto",
        formula=True,
        strategy="general",
        all_pages=True,
        start_page=0,
        end_page=2,
    )


def get_parser_config() -> ParserConfig:
    """저장된 기본 파서 설정을 불러오거나 기본 설정을 반환합니다."""
    if CONFIG_FILE_PATH.exists():
        try:
            with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return ParserConfig(**data)
        except Exception as e:
            logger.warning(f"파서 설정 파일 로딩 실패, 기본값 사용: {e}")

    # 기본 설정 반환 및 파일 생성
    default_config = get_default_parser_config()
    save_parser_config(default_config)
    return default_config


def save_parser_config(config: ParserConfig) -> ParserConfig:
    """기본 파서 설정을 output/parser_config.json 파일에 영속화합니다."""
    CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(config.model_dump(), f, ensure_ascii=False, indent=2)
    return config


def reset_parser_config() -> ParserConfig:
    """기본 파서 설정을 초기 권장값으로 재설정하고 영속화합니다."""
    default_config = get_default_parser_config()
    return save_parser_config(default_config)

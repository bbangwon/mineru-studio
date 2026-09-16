import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict

_PKG_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "packages" / "rag_embed_core"
if _PKG_ROOT.exists() and str(_PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(_PKG_ROOT))

from rag_embed_core.config import QdrantConfig

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
CONFIG_FILE_PATH = BASE_DIR / "output" / "qdrant_config.json"


def get_qdrant_config() -> QdrantConfig:
    """저장된 Qdrant 설정을 불러오거나 기본 설정을 반환합니다."""
    if CONFIG_FILE_PATH.exists():
        try:
            with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return QdrantConfig(**data)
        except Exception as e:
            logger.warning(f"설정 파일 로딩 실패, 기본값 사용: {e}")

    # 기본 설정 반환 및 생성
    default_config = QdrantConfig(
        mode="embedded",
        local_path=str(BASE_DIR / "output" / "qdrant_db"),
        url="http://localhost:6333",
        api_key=None,
        collection_name="mineru_chunks",
        recreate_collection=False,
    )
    save_qdrant_config(default_config)
    return default_config


def save_qdrant_config(config: QdrantConfig) -> QdrantConfig:
    """Qdrant 설정을 output/qdrant_config.json 파일에 영속화합니다."""
    CONFIG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(config.model_dump(), f, ensure_ascii=False, indent=2)
    return config

import pytest
from backend.app.services.hierarchical_chunker import HierarchicalChunker
from backend.app.services.parser_config_svc import ParserConfig, get_default_parser_config


def test_repair_soft_wraps_hyphen():
    raw = "This is a multi-\nlingual test case."
    repaired = HierarchicalChunker.repair_soft_wraps(raw)
    assert "multilingual" in repaired


def test_repair_soft_wraps_korean_word_split():
    raw = (
        "법 시행규칙에서 위임된 사항과 산재근로자의 요양급여의 지급 및 요\n"
        "양서비스의 제공에 필요한 사항을 규정함을 목적으로 한다.<개정 2022.6.9.>\n"
        "제2조(정의) 이 규정에서 사용하는 용어의 뜻은 다음 각 호와 같다.\n"
        "1. “산재근로자”란 법 제37조에 따른 업무상의 재해를 입은 근로자를 말한다."
    )
    repaired = HierarchicalChunker.repair_soft_wraps(raw)
    lines = repaired.splitlines()
    # '요'와 '양서비스의' 사이 soft-wrap이 공백으로 연결되어 1문장이 됨
    assert any("요 양서비스의" in l or "요양서비스의" in l for l in lines)
    # 문장 종결 및 조문/호 앞은 줄바꿈으로 나뉨
    assert any(l.startswith("제2조(정의)") for l in lines)
    assert any(l.startswith("1. “산재근로자”란") for l in lines)


def test_preserve_newlines_child_chunk():
    # 샘플 content_list 블록
    sample_content_list = [
        [
            {
                "type": "title",
                "content": {
                    "title_content": [{"type": "text", "content": "제1장 총칙"}],
                    "level": 1,
                },
                "bbox": [0, 0, 100, 20],
            },
            {
                "type": "paragraph",
                "content": {
                    "paragraph_content": [
                        {
                            "type": "text",
                            "content": (
                                "제1조(목적) 이 규정은 노동자의 복지를 증진함을 목적으로 한다.\n"
                                "제2조(정의) 이 규정에서 사용하는 용어의 뜻은 다음과 같다.\n"
                                "1. 근로자란 직업의 종류와 관계없이 임금을 목적으로 근로를 제공하는 자를 말한다."
                            ),
                        }
                    ]
                },
                "bbox": [0, 30, 100, 100],
            },
        ]
    ]

    # 1. preserve_newlines = True
    chunker_preserved = HierarchicalChunker(doc_id="test_doc", preserve_newlines=True)
    res_preserved = chunker_preserved.chunk_content_list(sample_content_list, doc_title="Test Doc", strategy="legal")
    children_preserved = res_preserved["child_chunks"]
    assert len(children_preserved) > 0
    # 줄바꿈이 청크 텍스트 내에 보존되어야 함
    first_child_text = children_preserved[0]["text"]
    assert "\n" in first_child_text

    # 2. preserve_newlines = False
    chunker_flattened = HierarchicalChunker(doc_id="test_doc", preserve_newlines=False)
    res_flattened = chunker_flattened.chunk_content_list(sample_content_list, doc_title="Test Doc", strategy="legal")
    children_flattened = res_flattened["child_chunks"]
    assert len(children_flattened) > 0
    first_child_flattened = children_flattened[0]["text"]
    assert "\n" not in first_child_flattened


def test_parser_config_preserve_newlines():
    cfg = get_default_parser_config()
    assert hasattr(cfg, "preserve_newlines")
    assert cfg.preserve_newlines is True

    dumped = cfg.model_dump()
    assert dumped["preserve_newlines"] is True

    reloaded = ParserConfig(**dumped)
    assert reloaded.preserve_newlines is True

import re
from typing import Any, Dict, List, Optional

from backend.app.services.chunker.constants import (
    RE_GENERAL_SENTENCE_END,
    RE_KOREAN_SENTENCE_END,
    RE_LEGAL_SPLIT,
)


def normalize_text_for_embedding(text: str) -> str:
    """
    임베딩 및 키워드 검색(Child Chunk) 대상 텍스트 정규화.
    줄바꿈과 연속 공백을 모두 단일 공백으로 치환하여 단어 잘림과 검색 왜곡을 방지합니다.
    1. 영문/숫자 하이픈 줄바꿈 복원: word-\\nbreak -> wordbreak
    2. 모든 줄바꿈(\\r, \\n) 및 연속 공백을 단일 공백(' ')으로 치환
    """
    if not text:
        return ""
    text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def repair_soft_wraps(text: str) -> str:
    """
    PDF 너비 한계(Column Width) 및 OCR 레이아웃으로 인해 발생한
    단순 줄바꿈(Soft-wrap)을 단일 공백으로 치환하여 문장을 복원하고,
    의미 있는 구조적 경계(조항, 항·호, 번호 목록, 문장 종결)의 줄바꿈은 보존합니다.
    """
    if not text:
        return ""

    # 1. 영문 하이픈 줄바꿈 복원
    text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', text)

    # 2. 줄 단위로 분할
    raw_lines = [l.strip() for l in text.splitlines()]
    lines = [l for l in raw_lines if l]
    if not lines:
        return ""

    re_struct_start = re.compile(
        r'^(?:'
        r'제\s*\d+\s*조(?:\s*\([^)]+\))?|'   # 제1조, 제1조(목적)
        r'부\s*칙|별\s*[표지]|'             # 부칙, 별표
        r'[①-⑳]|'                         # ① ~ ⑳
        r'\d+\.\s*|'                       # 1. 2.
        r'[가-하]\.\s*|'                   # 가. 나.
        r'\(\d+\)|'                        # (1) (2)
        r'\([가-하]\)|'                    # (가) (나)
        r'[-*•※■▶◆○●]\s*|'               # 불릿 기호
        r'#{1,6}\s*|'                      # 마크다운 헤딩
        r'<table|\|'                       # 표 시작
        r')'
    )

    re_sentence_end = re.compile(
        r'(?:'
        r'(?:다|음|함|임|됨|시오|세|요|까|냐)\.|'  # 한국어 종결어미 + 마침표
        r'[.!?]|'                                 # 일반 종결 기호
        r'<개정\s*[^>]+>|'                         # <개정 2022.6.9.>
        r'\[본조신설\s*[^\]]+\]|'                  # [본조신설 ...]
        r':$'                                     # 콜론
        r')[)\]"\'”’]*$'
    )

    result_lines: List[str] = []
    curr_line = lines[0]

    for next_line in lines[1:]:
        is_b_struct = bool(re_struct_start.match(next_line))
        is_a_end = bool(re_sentence_end.search(curr_line))

        if is_b_struct or is_a_end:
            result_lines.append(curr_line)
            curr_line = next_line
        else:
            curr_line = f"{curr_line} {next_line}"
            curr_line = re.sub(r'[ \t]+', ' ', curr_line)

    result_lines.append(curr_line)
    return "\n".join(result_lines)


def normalize_parent_text(text: str, preserve_newlines: bool = False) -> str:
    """
    LLM 답변 생성용(Parent Chunk) 문맥 텍스트 정규화.
    - 문단 간 구분(\\n\\n) 및 목록 번호/조항 앞 개행은 보존
    - 문장 중간에 너비 한계로 인해 들어간 단순 줄바꿈은 단일 공백으로 연결
    - preserve_newlines=True인 경우 soft-wrap을 보정하고 문장/구조적 줄바꿈은 보존
    """
    if not text:
        return ""
    major_blocks = [b.strip() for b in re.split(r'\n{3,}', text) if b.strip()]
    if len(major_blocks) > 1:
        return '\n\n\n'.join(normalize_parent_text(b, preserve_newlines=preserve_newlines) for b in major_blocks).strip()

    text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', text)

    if preserve_newlines:
        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
        cleaned_paragraphs = [repair_soft_wraps(para) for para in paragraphs if para]
        return '\n\n'.join(cleaned_paragraphs).strip()

    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    cleaned_paragraphs = []

    for para in paragraphs:
        lines = [l.strip() for l in para.split('\n') if l.strip()]
        if not lines:
            continue

        para_parts = []
        for line in lines:
            is_structural_line = bool(re.match(r'^(?:[①-⑳]|\d+\.|\(\d+\)|\[[^\]]+\]|제\s*\d+\s*조|[-*•※#])\s*', line))
            if is_structural_line and para_parts:
                para_parts.append('\n' + line)
            else:
                if para_parts and not para_parts[-1].endswith('\n'):
                    para_parts.append(' ' + line)
                else:
                    para_parts.append(line)

        cleaned_paragraphs.append(''.join(para_parts).strip())

    return '\n\n'.join(cleaned_paragraphs).strip()


def estimate_korean_tokens(text: str) -> int:
    """
    한국어 서브워드/BPE 특성을 반영한 표준 토큰 추정 공식:
    token_estimate = max(floor(len(text) / 2.0), floor(len(text.split()) * 2.2))
    """
    if not text:
        return 0
    char_tokens = int(len(text) / 2.0)
    word_tokens = int(len(text.split()) * 2.2)
    return max(char_tokens, word_tokens)


def _force_split_large_sentence(sentence: str, max_tokens: int = 512) -> List[str]:
    """512 토큰을 초과하는 단일 초장문 문장을 쉼표, 세미콜론, 공백 단위로 안전 분할"""
    parts = re.split(r'(?<=[;,])\s+', sentence)
    result: List[str] = []
    curr = ""
    for p in parts:
        p_strip = p.strip()
        if not p_strip:
            continue
        cand = f"{curr} {p_strip}".strip() if curr else p_strip
        if estimate_korean_tokens(cand) <= max_tokens:
            curr = cand
        else:
            if curr:
                result.append(curr)
            if estimate_korean_tokens(p_strip) > max_tokens:
                words = p_strip.split()
                w_curr = ""
                for w in words:
                    w_cand = f"{w_curr} {w}".strip() if w_curr else w
                    if estimate_korean_tokens(w_cand) <= max_tokens:
                        w_curr = w_cand
                    else:
                        if w_curr:
                            result.append(w_curr)
                        w_curr = w
                if w_curr:
                    curr = w_curr
                else:
                    curr = ""
            else:
                curr = p_strip
    if curr:
        result.append(curr)
    return result


def split_text_into_units(text: str, is_legal: bool = False, max_tokens: int = 512) -> List[str]:
    """
    텍스트를 문맥 손상 없이 최소 분할 단위(조항, 단락, 문장)로 정밀 분할합니다.
    """
    clean_text = text.strip()
    if not clean_text:
        return []

    clean_text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', clean_text)
    clean_text = repair_soft_wraps(clean_text)

    if is_legal:
        preliminary_parts = [p.strip() for p in RE_LEGAL_SPLIT.split(clean_text) if p.strip()]
    else:
        preliminary_parts = [clean_text]

    units: List[str] = []
    for part in preliminary_parts:
        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', part) if p.strip()]
        for para in paragraphs:
            lines = [l.strip() for l in para.split('\n') if l.strip()]
            for line in lines:
                korean_split = RE_KOREAN_SENTENCE_END.split(line)
                sentences: List[str] = []
                for k_sent in korean_split:
                    k_clean = k_sent.strip()
                    if not k_clean:
                        continue
                    sub_sents = RE_GENERAL_SENTENCE_END.split(k_clean)
                    sentences.extend(s.strip() for s in sub_sents if s.strip())

                for sent in sentences:
                    if estimate_korean_tokens(sent) > max_tokens:
                        sub_chunks = _force_split_large_sentence(sent, max_tokens)
                        units.extend(sub_chunks)
                    else:
                        units.append(sent)

    return units if units else [clean_text]


def extract_text_from_content(content_items: Any) -> str:
    if isinstance(content_items, str):
        return content_items
    if not isinstance(content_items, list):
        return ""

    parts = []
    for item in content_items:
        if isinstance(item, dict):
            text = item.get("content", "")
            if text:
                parts.append(str(text))
        elif isinstance(item, str):
            parts.append(item)
    return " ".join(parts).strip()


def extract_text_from_list_block(b_content: Any, block: Optional[Dict[str, Any]] = None) -> str:
    """index 또는 list 블록에서 텍스트 항목들을 추출하여 줄바꿈으로 연결"""
    list_items = []
    if isinstance(b_content, dict):
        list_items = b_content.get("list_items", [])
    if not list_items and isinstance(block, dict):
        list_items = block.get("list_items", [])

    if not list_items:
        if isinstance(b_content, str):
            return b_content
        if isinstance(b_content, dict):
            return b_content.get("text", "") or b_content.get("content", "")
        return ""

    lines: List[str] = []
    for item in list_items:
        if isinstance(item, str):
            if item.strip():
                lines.append(item.strip())
        elif isinstance(item, dict):
            item_content = item.get("item_content")
            if item_content:
                extracted = extract_text_from_content(item_content)
                if extracted:
                    lines.append(extracted)
            else:
                txt = str(item.get("content", "") or item.get("text", "")).strip()
                if txt:
                    lines.append(txt)
    return "\n".join(lines).strip()

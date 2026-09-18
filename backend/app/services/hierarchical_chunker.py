import re
import uuid
import json
import hashlib
import html
from html.parser import HTMLParser
from typing import List, Dict, Any, Optional, Tuple


class _HTMLTableExtractor(HTMLParser):
    """표 HTML에서 컬럼 헤더와 상위 행 데이터를 검색 친화적 요약 텍스트로 추출하는 파서"""
    def __init__(self):
        super().__init__()
        self.rows: List[List[str]] = []
        self.current_row: List[str] = []
        self.current_cell: List[str] = []
        self.in_cell = False

    def handle_starttag(self, tag: str, attrs: Any):
        if tag in ("td", "th"):
            self.in_cell = True
            self.current_cell = []
        elif tag == "tr":
            self.current_row = []

    def handle_endtag(self, tag: str):
        if tag in ("td", "th"):
            self.in_cell = False
            cell_text = " ".join("".join(self.current_cell).split())
            self.current_row.append(cell_text)
        elif tag == "tr":
            if self.current_row:
                self.rows.append(self.current_row)

    def handle_data(self, data: str):
        if self.in_cell:
            self.current_cell.append(data)


class HierarchicalChunker:
    """
    MinerU 파싱 결과를 입력받아 3단계 계층 구조(Section - Parent - Child)로
    RAG 검색 및 LLM 생성에 최적화된 청크를 생성하는 엔진.
    - Level 1: Section (문서 구조/목차, 네비게이션)
    - Level 2: Parent Chunk (~2048 토큰, LLM 생성용 문맥)
    - Level 3: Child Chunk (~512 토큰 or 원자적 표, Vector DB 임베딩/검색용)
    """

    # 법률/규정 위계 정규식
    RE_PART = re.compile(r'^\s*(제\s*\d+\s*편\b(?:\s+[^\n]+)?)')
    RE_CHAPTER = re.compile(r'^\s*(제\s*\d+\s*장\b(?:\s+[^\n]+)?)')
    RE_SECTION = re.compile(r'^\s*(제\s*\d+\s*절\b(?:\s+[^\n]+)?)')
    RE_SUBSECTION = re.compile(r'^\s*(제\s*\d+\s*관\b(?:\s+[^\n]+)?)')
    RE_ADDENDUM = re.compile(r'^\s*(부\s*칙\b(?:\s+[^\n]+)?)')
    RE_ARTICLE = re.compile(r'^\s*(제\s*\d+\s*조(?:의\s*\d+)?)(?:\s*\(([^)]+)\))?')
    RE_APPENDIX = re.compile(r'^\s*(\[(?:별표|별지)(?:\s*제?\d+호?(?:의\d+)?)?\]|\b별표\s*\d+|\b별지\s*제?\d+호(?:\s*서식)?)')

    # 일반/공문서 번호 체계 정규식
    RE_ROMAN_NUM = re.compile(r'^\s*(?:[IVXLCDM]+|[Ⅰ-Ⅻ])[\.\s]')          # I. II. III. Ⅳ. 등 (대분류)
    RE_ARABIC_SUB_NUM = re.compile(r'^\s*\d+\.\d+')                      # 1.1, 1.2 등 (하위 번호)
    RE_ARABIC_NUM = re.compile(r'^\s*\d+[\.\s]')                         # 1. 2. 3. 등 (중분류/대분류)
    RE_KOREAN_CHAR = re.compile(r'^\s*[가-하][\.\s]')                     # 가. 나. 다. 등 (소분류)
    RE_PAREN_NUM = re.compile(r'^\s*\(\d+\)')                            # (1) (2) 등 (세분류)

    # 법률 조항/항·호 경계 정규식
    RE_LEGAL_SPLIT = re.compile(
        r'(?=[①-⑳])|'                              # 항 번호 경계
        r'(?<=\n)\s*(?=\d+\.\s|[가-하]\.\s)|'      # 줄바꿈 직후 호/목 번호
        r'(?<=[.:]\s)\s*(?=\d+\.\s|[가-하]\.\s)'   # 문장 종결/콜론 직후 호/목 번호
    )

    # 문장 종결 정규식 (인용부호/괄호 안 종결 제외)
    RE_KOREAN_SENTENCE_END = re.compile(r'(?<=(?:다|음|함|임|됨)\.)(?![")\'])\s+')
    RE_GENERAL_SENTENCE_END = re.compile(r'(?<=[.!?])(?![")\'])\s+(?=[A-Z가-힣0-9])')

    # 표 제목 및 각주 정규식
    RE_TABLE_TITLE_TEXT = re.compile(
        r"^(?:\*\*\[표\s*(?:제목)?:\s*|\[\s*표(?:\s*[\d\.\-]+)?\s*[\:\.\-\]]|【\s*표\s*】|표\s*\d+[\.\:\-]|Table\s*\d+[\.\:\-])",
        re.IGNORECASE
    )
    RE_TABLE_FOOTNOTE_TEXT = re.compile(
        r"^(?:\*\*\[표\s*각주:\s*|(?:※|\(?주\)?\s*[:\)]|출처\s*[:\)]|참고\s*[:\)]|\*|\#)\s*)+",
        re.IGNORECASE
    )

    @staticmethod
    def format_table_title(caption: str) -> str:
        clean = (caption or "").strip()
        if not clean:
            return ""
        m = re.match(r"^\*\*\[표\s*(?:제목)?:\s*(.+?)\]\*\*$", clean)
        val = m.group(1).strip() if m else clean
        return f"**[표 제목: {val}]**"

    @staticmethod
    def format_table_footnote(footnote: str) -> str:
        clean = (footnote or "").strip()
        if not clean:
            return ""
        m = re.match(r"^\*\*\[표\s*각주:\s*(.+?)\]\*\*$", clean)
        val = m.group(1).strip() if m else clean
        return f"**[표 각주: {val}]**"

    @staticmethod
    def generate_doc_id(name: Optional[str] = None) -> str:
        """
        문서명을 RFC 4122 표준 128비트 결정론적 UUID(UUID v5) 기반 32자리 고유 식별자(doc_xxxxxxxx...)로 변환.
        - 동일한 문서명/식별자에 대해 항상 일관된 UUID 반환 (Upsert 및 캐싱 안전)
        - 서로 다른 문서 간 충돌 확률 물리적 0% 보장 (128-bit)
        - 한글/특수문자 없이 완전한 순수 ASCII 16진수 [0-9a-f] 반환
        """
        if not name:
            return f"doc_{uuid.uuid4().hex}"
        clean = str(name).strip()
        # 이미 유효한 doc_ (32자리 hex) 형태인 경우 그대로 반환
        if clean.startswith("doc_") and len(clean) == 36 and clean[4:].isalnum():
            return clean
        # 하위 호환성: 단위테스트 등에서 명시적으로 지정한 단순 영문/숫자 식별자 호환 유지 (단, 과거 d_xxxxxx 해시 및 .pdf는 128-bit UUID로 변환)
        if re.match(r"^[a-zA-Z0-9_-]+$", clean) and not clean.lower().endswith(".pdf") and len(clean) <= 40 and not clean.startswith("d_"):
            return clean

        # 파일명/문서명 기반 128-bit 결정론적 UUID v5 생성
        u = uuid.uuid5(uuid.NAMESPACE_URL, f"urn:mineru:doc:{clean}")
        return f"doc_{u.hex}"

    @staticmethod
    def normalize_text_for_embedding(text: str) -> str:
        """
        임베딩 및 키워드 검색(Child Chunk) 대상 텍스트 정규화.
        줄바꿈과 연속 공백을 모두 단일 공백으로 치환하여 단어 잘림과 검색 왜곡을 방지합니다.
        1. 영문/숫자 하이픈 줄바꿈 복원: word-\\nbreak -> wordbreak
        2. 모든 줄바꿈(\\r, \\n) 및 연속 공백을 단일 공백(' ')으로 치환
        """
        if not text:
            return ""
        # 1. 영문 하이픈 줄바꿈 복원 (e.g., 'multi-\nlingual' -> 'multilingual')
        text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', text)
        # 2. 모든 개행 및 공백을 단일 공백으로 치환
        text = re.sub(r'\s+', ' ', text)
        return text.strip()

    @classmethod
    def repair_soft_wraps(cls, text: str) -> str:
        """
        PDF 너비 한계(Column Width) 및 OCR 레이아웃으로 인해 발생한
        단순 줄바꿈(Soft-wrap)을 단일 공백으로 치환하여 문장을 복원하고,
        의미 있는 구조적 경계(조항, 항·호, 번호 목록, 문장 종결)의 줄바꿈은 보존합니다.
        """
        if not text:
            return ""

        # 1. 영문 하이픈 줄바꿈 복원 (e.g., 'multi-\nlingual' -> 'multilingual')
        text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', text)

        # 2. 줄 단위로 분할
        raw_lines = [l.strip() for l in text.splitlines()]
        lines = [l for l in raw_lines if l]
        if not lines:
            return ""

        # 구조적 시작 정규식
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

        # 문장 종결 정규식
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
                # Soft-wrap: 단일 공백으로 결합
                curr_line = f"{curr_line} {next_line}"
                curr_line = re.sub(r'[ \t]+', ' ', curr_line)

        result_lines.append(curr_line)
        return "\n".join(result_lines)

    @classmethod
    def normalize_parent_text(cls, text: str, preserve_newlines: bool = False) -> str:
        """
        LLM 답변 생성용(Parent Chunk) 문맥 텍스트 정규화.
        - 문단 간 구분(\\n\\n) 및 목록 번호/조항 앞 개행은 보존
        - 문장 중간에 너비 한계로 인해 들어간 단순 줄바꿈은 단일 공백으로 연결
        - preserve_newlines=True인 경우 soft-wrap을 보정하고 문장/구조적 줄바꿈은 보존
        """
        if not text:
            return ""
        # 0. 빈 줄 2개 이상(\n{3,})으로 구분된 소제목/섹션 블록 보존
        major_blocks = [b.strip() for b in re.split(r'\n{3,}', text) if b.strip()]
        if len(major_blocks) > 1:
            return '\n\n\n'.join(cls.normalize_parent_text(b, preserve_newlines=preserve_newlines) for b in major_blocks).strip()

        # 1. 영문 하이픈 줄바꿈 복원
        text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', text)

        if preserve_newlines:
            paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
            cleaned_paragraphs = [cls.repair_soft_wraps(para) for para in paragraphs if para]
            return '\n\n'.join(cleaned_paragraphs).strip()

        # 2. 단락 단위(\\n\\s*\\n)로 분할
        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
        cleaned_paragraphs = []

        for para in paragraphs:
            lines = [l.strip() for l in para.split('\n') if l.strip()]
            if not lines:
                continue

            para_parts = []
            for line in lines:
                # 목록 번호, 조항, 불릿, 헤딩으로 시작하는지 확인
                # 예: ①~⑳, 1., (1), [제1조], 제1조, -, *, •, # 등
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

    @staticmethod
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

    @classmethod
    def split_text_into_units(cls, text: str, is_legal: bool = False, max_tokens: int = 512) -> List[str]:
        """
        텍스트를 문맥 손상 없이 최소 분할 단위(조항, 단락, 문장)로 정밀 분할합니다.
        우선순위:
          1. 법률 항(①~⑳), 호(1.), 목(가.) 경계 (legal 모드)
          2. 단락 경계 (\\n\\n)
          3. 줄바꿈 경계 (\\n)
          4. 한국어 및 일반 문장 종결 기호 (다., 음., ., !, ?)
          5. 단일 문장이 max_tokens 초과 시 최후의 수단으로 쉼표, 세미콜론, 공백 분할
        """
        clean_text = text.strip()
        if not clean_text:
            return []

        # 영문/숫자 하이픈 줄바꿈 사전 복원 (e.g. multi-\nlingual -> multilingual)
        clean_text = re.sub(r'(\w+)-\s*[\r\n]+\s*(\w+)', r'\1\2', clean_text)
        # PDF 너비 한계에 의한 단순 개행(Soft-wrap) 자동 보정
        clean_text = cls.repair_soft_wraps(clean_text)

        # 1단계: 법률 모드일 경우 항·호 단위 1차 분할
        if is_legal:
            preliminary_parts = [p.strip() for p in cls.RE_LEGAL_SPLIT.split(clean_text) if p.strip()]
        else:
            preliminary_parts = [clean_text]

        units: List[str] = []
        for part in preliminary_parts:
            # 2단계: 단락(\\n\\n) 단위 분할
            paragraphs = [p.strip() for p in re.split(r'\n\s*\n', part) if p.strip()]
            for para in paragraphs:
                # 3단계: 개조식 줄바꿈(\\n) 분할 (각 줄이 의미 있는 단위인 경우)
                lines = [l.strip() for l in para.split('\n') if l.strip()]
                for line in lines:
                    # 4단계: 문장 종결 기호 분할
                    korean_split = cls.RE_KOREAN_SENTENCE_END.split(line)
                    sentences: List[str] = []
                    for k_sent in korean_split:
                        k_clean = k_sent.strip()
                        if not k_clean:
                            continue
                        sub_sents = cls.RE_GENERAL_SENTENCE_END.split(k_clean)
                        sentences.extend(s.strip() for s in sub_sents if s.strip())

                    for sent in sentences:
                        # 5단계: 512 토큰 초과 시 최후의 수단 분할
                        if cls.estimate_korean_tokens(sent) > max_tokens:
                            sub_chunks = cls._force_split_large_sentence(sent, max_tokens)
                            units.extend(sub_chunks)
                        else:
                            units.append(sent)

        return units if units else [clean_text]

    @classmethod
    def _force_split_large_sentence(cls, sentence: str, max_tokens: int = 512) -> List[str]:
        """512 토큰을 초과하는 단일 초장문 문장을 쉼표, 세미콜론, 공백 단위로 안전 분할"""
        parts = re.split(r'(?<=[;,])\s+', sentence)
        result: List[str] = []
        curr = ""
        for p in parts:
            p_strip = p.strip()
            if not p_strip:
                continue
            cand = f"{curr} {p_strip}".strip() if curr else p_strip
            if cls.estimate_korean_tokens(cand) <= max_tokens:
                curr = cand
            else:
                if curr:
                    result.append(curr)
                if cls.estimate_korean_tokens(p_strip) > max_tokens:
                    words = p_strip.split()
                    w_curr = ""
                    for w in words:
                        w_cand = f"{w_curr} {w}".strip() if w_curr else w
                        if cls.estimate_korean_tokens(w_cand) <= max_tokens:
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

    @classmethod
    def generate_table_search_text(
        cls,
        raw_html: str,
        caption: str = "",
        footnote: str = "",
        max_tokens: int = 512
    ) -> str:
        """
        원형 표와 복합 청크의 일관성을 위해 Markdown Table 형식으로 표 검색 요약 텍스트를 생성합니다.
        대형 표라도 임의로 행을 자르지 않고 전체 행을 온전히 보존하며,
        토큰 초과 여부는 청크 메타데이터(token_overflow, warning) 및 UI를 통해 작업자에게 경고합니다.
        """
        md_table = cls.html_table_to_markdown(raw_html, caption=caption, footnote=footnote)
        if md_table:
            return md_table

        lines = []
        if caption and caption.strip():
            lines.append(cls.format_table_title(caption))
        if raw_html:
            clean_html = re.sub(r'<[^>]+>', ' ', raw_html)
            clean_html = " ".join(clean_html.split())
            if clean_html:
                lines.append(clean_html)
        if footnote and footnote.strip():
            lines.append(cls.format_table_footnote(footnote))
        return "\n".join(lines).strip()

    @classmethod
    def html_table_to_markdown(
        cls,
        raw_html: str,
        caption: Optional[str] = None,
        footnote: Optional[str] = None
    ) -> str:
        """
        소형 표, 대형 표 및 복합 청크를 위해 HTML 테이블을 Markdown 테이블 문자열로 변환합니다.
        - 컬럼 헤더 및 모든 데이터 행 파싱 (임의 자름 없이 전체 보존)
        - 캡션(**[표 제목: ...]**) 및 각주(**[표 각주: ...]**) 표준 형식 반영
        """
        if not raw_html or not raw_html.strip():
            return ""
        parser = _HTMLTableExtractor()
        try:
            parser.feed(raw_html)
            rows = parser.rows
            if not rows:
                clean = re.sub(r'<[^>]+>', ' ', raw_html).strip()
                return clean

            max_cols = max(len(r) for r in rows)
            if max_cols == 0:
                return ""

            lines: List[str] = []
            if caption and caption.strip():
                lines.append(cls.format_table_title(caption))

            # 헤더 행
            header_row = [c.replace("|", "/") for c in rows[0]] + [""] * (max_cols - len(rows[0]))
            lines.append("| " + " | ".join(header_row) + " |")
            lines.append("| " + " | ".join(["---"] * max_cols) + " |")

            # 본문 행 (전체 행 보존)
            for r in rows[1:]:
                clean_row = [c.replace("|", "/") for c in r] + [""] * (max_cols - len(r))
                lines.append("| " + " | ".join(clean_row) + " |")

            if footnote and footnote.strip():
                lines.append(cls.format_table_footnote(footnote))

            return "\n".join(lines)
        except Exception:
            clean = re.sub(r'<[^>]+>', ' ', raw_html).strip()
            return clean

    @staticmethod
    def _format_text_unit_as_html(text: str) -> str:
        """문단 텍스트를 HTML 단락 태그로 래핑하고 특수문자를 이스케이프합니다."""
        if not text or not text.strip():
            return ""
        escaped = html.escape(text.strip())
        escaped = escaped.replace("\n", "<br/>")
        return f"<p>{escaped}</p>"

    @classmethod
    def reconstruct_composite_raw_html(cls, chunk: Dict[str, Any], force: bool = False) -> str:
        """
        복합(composite) 청크의 raw_html에 문단 태그(<p>)가 누락된 구버전 데이터인 경우,
        chunk['text'](마크다운 본문)와 표 정보(tables 또는 raw_html)를 결합하여
        원본 문서 순서(문단 + 표 + 문단 + 표 ...) 그대로 복원된 완성형 HTML을 반환합니다.
        """
        raw_html = chunk.get("raw_html") or ""
        if not force and raw_html and re.search(r"<(?:p|div|span)\b", raw_html, re.I):
            return raw_html

        tables = chunk.get("tables") or (chunk.get("metadata", {}).get("tables") if isinstance(chunk.get("metadata"), dict) else []) or []
        table_htmls = [t.get("raw_html", "") for t in tables if t.get("raw_html")]
        if not table_htmls and raw_html:
            table_htmls = re.findall(r"(<table\b[\s\S]*?</table>)", raw_html, re.I)

        text = chunk.get("text") or ""
        if not text:
            return ("\n\n".join(table_htmls) if table_htmls else raw_html) or "<p>내용 없음</p>"

        blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
        reconstructed_parts: List[str] = []
        tbl_idx = 0

        for b in blocks:
            lines = b.split("\n")
            is_md_table = any(line.strip().startswith("|") for line in lines) and any("---" in line for line in lines)
            is_table_placeholder = (b == "[표]" or bool(re.match(r"^\[표\s*\d*\]$", b))) and not is_md_table

            if is_md_table or is_table_placeholder:
                if tbl_idx < len(table_htmls) and table_htmls[tbl_idx]:
                    reconstructed_parts.append(table_htmls[tbl_idx])
                    tbl_idx += 1
                else:
                    reconstructed_parts.append(f"<pre>{html.escape(b)}</pre>")
            else:
                html_u = cls._format_text_unit_as_html(b)
                if html_u:
                    reconstructed_parts.append(html_u)

        while tbl_idx < len(table_htmls):
            if table_htmls[tbl_idx]:
                reconstructed_parts.append(table_htmls[tbl_idx])
            tbl_idx += 1

        return "\n\n".join(reconstructed_parts) or raw_html

    @classmethod
    def get_chunk_kind(cls, chunk: Dict[str, Any]) -> str:
        """
        청크의 실제 데이터(tables, text, metadata)를 기반으로 UI 및 통계용 종류를 동적 계산합니다.
        """
        meta = chunk.get("metadata") or {}
        if meta.get("article_no") or meta.get("article_number") or chunk.get("chunk_type") in ("article", "article_clause"):
            return "article"
        breadcrumbs = chunk.get("breadcrumbs") or []
        if any(re.match(r"^제\s*\d+\s*조", str(b).strip()) for b in breadcrumbs):
            return "article"

        tables = chunk.get("tables") or meta.get("tables") or []
        raw_html = str(chunk.get("raw_html") or "")
        has_html_table = "<table" in raw_html.lower()
        has_tables = bool(tables or has_html_table or chunk.get("chunk_type") == "table" or chunk.get("is_table"))

        if not has_tables:
            return "paragraph"

        # 단독 표(table) vs 복합 청크(composite) 판별
        # 1) 표가 2개 이상이거나, 표 외에 일반 본문 텍스트가 함께 존재하는 경우 -> composite
        # 2) 표가 1개 이하이고 일반 본문 텍스트가 없는 순수 단독 표 청크 -> table
        if len(tables) > 1:
            return "composite"

        text = (chunk.get("text") or "").strip()
        caption = str(chunk.get("table_caption") or (tables[0].get("caption") if tables else "") or "").strip()
        footnote = str(chunk.get("table_footnote") or (tables[0].get("footnote") if tables else "") or "").strip()

        non_table_lines = []
        for line in text.split("\n"):
            line_str = line.strip()
            if not line_str:
                continue
            if line_str.startswith("|"):
                continue
            if line_str.startswith("[표") or (caption and caption in line_str) or cls.RE_TABLE_TITLE_TEXT.search(line_str):
                continue
            if line_str.startswith(("*", "※", "출처:")) or (footnote and footnote in line_str) or cls.RE_TABLE_FOOTNOTE_TEXT.search(line_str):
                continue
            non_table_lines.append(line_str)

        has_body_text = len(non_table_lines) > 0
        if has_body_text:
            return "composite"
        return "table"

    @classmethod
    def heal_composite_chunks(cls, child_chunks: List[Dict[str, Any]]) -> bool:
        """
        child_chunks 목록 중 표와 본문이 함께 있는 복합 청크의 raw_html에 문단 태그가 누락된 항목을 자동 복원합니다.
        순수 단독 표(table) 청크는 절대 복합 HTML로 오염시키지 않으며, 오염된 경우 tables[0].raw_html로 복구합니다.
        """
        changed = False
        for c in child_chunks:
            tables = c.get("tables") or (c.get("metadata") or {}).get("tables") or []
            kind = cls.get_chunk_kind(c)
            if kind == "composite":
                current_raw = c.get("raw_html") or ""
                if not re.search(r"<(?:p|div|span)\b", current_raw, re.I):
                    reconstructed = cls.reconstruct_composite_raw_html(c)
                    if reconstructed and reconstructed != current_raw:
                        c["raw_html"] = reconstructed
                        changed = True
            elif kind == "table" and tables:
                current_raw = c.get("raw_html") or ""
                clean_table_html = tables[0].get("raw_html") or ""
                if clean_table_html and re.search(r"<(?:p|div|span)\b", current_raw, re.I):
                    c["raw_html"] = clean_table_html
                    changed = True
        return changed

    def __init__(self, doc_id: Optional[str] = None, filter_headers_footers: bool = True, preserve_newlines: bool = False):
        self.doc_id = self.generate_doc_id(doc_id)
        self.filter_headers_footers = filter_headers_footers
        self.preserve_newlines = preserve_newlines

    def chunk_content_list(
        self,
        content_list: List[Any],
        doc_title: str = "Document",
        strategy: str = "general",
        preserve_newlines: Optional[bool] = None
    ) -> Dict[str, Any]:
        """
        MinerU의 content_list를 순회하여 정규 3단계 계층 구조
        (Section - Parent Chunk - Child Chunk)를 생성합니다.
        """
        if preserve_newlines is not None:
            self.preserve_newlines = preserve_newlines
        if not content_list:
            return {
                "doc_id": self.doc_id,
                "doc_title": doc_title,
                "strategy": strategy,
                "stats": {
                    "total_sections": 0,
                    "total_parent_sections": 0,
                    "total_parent_chunks": 0,
                    "total_child_chunks": 0,
                    "paragraph_chunks": 0,
                    "table_chunks": 0,
                    "total_words": 0,
                },
                "sections": [],
                "parent_sections": [],
                "parent_chunks": [],
                "child_chunks": [],
            }

        normalized_pages = self._normalize_content_list(content_list)
        if strategy == "legal":
            return self._chunk_legal_content(normalized_pages, doc_title)
        return self._chunk_general_content(normalized_pages, doc_title)

    def _normalize_content_list(self, content_list: List[Any]) -> List[List[Dict[str, Any]]]:
        """v1 및 v2 구조를 표준 2차원 리스트(페이지별 블록 목록)로 정규화"""
        if not content_list:
            return []

        # 만약 이미 2차원 리스트(v2 구조)라면 그대로 반환
        if isinstance(content_list[0], list):
            return content_list

        if isinstance(content_list[0], dict):
            max_page = max((b.get("page_idx", 0) for b in content_list if isinstance(b, dict)), default=0)
            pages_dict: Dict[int, List[Dict[str, Any]]] = {p: [] for p in range(max_page + 1)}
            for item in content_list:
                if not isinstance(item, dict):
                    continue
                p_idx = item.get("page_idx", 0)

                # 이미 MinerU content 블록 구조를 갖춘 경우
                if "content" in item and isinstance(item["content"], dict):
                    pages_dict.setdefault(p_idx, []).append(item)
                    continue

                b_type = item.get("type", "text")
                text_val = item.get("text", "")
                level = item.get("text_level")

                if b_type == "text" and level is not None:
                    block = {
                        "type": "title",
                        "content": {"title_content": [{"type": "text", "content": text_val}], "level": int(level)},
                        "bbox": item.get("bbox", [])
                    }
                elif b_type == "table":
                    caption_val = item.get("table_caption", "")
                    if isinstance(caption_val, list):
                        cap_list = caption_val
                    elif isinstance(caption_val, str) and caption_val:
                        cap_list = [{"type": "text", "content": caption_val}]
                    else:
                        cap_list = []

                    footnote_val = item.get("table_footnote", "")
                    if isinstance(footnote_val, list):
                        fn_list = footnote_val
                    elif isinstance(footnote_val, str) and footnote_val:
                        fn_list = [{"type": "text", "content": footnote_val}]
                    else:
                        fn_list = []

                    block = {
                        "type": "table",
                        "content": {
                            "html": item.get("table_body", "") or item.get("html", ""),
                            "table_caption": cap_list,
                            "table_footnote": fn_list,
                            "image_source": {"path": item.get("img_path", "")}
                        },
                        "bbox": item.get("bbox", [])
                    }
                elif b_type in ["index", "list"]:
                    list_text = item.get("text", "")
                    if not list_text and "list_items" in item:
                        list_text = "\n".join(str(it) for it in item["list_items"] if str(it).strip())
                    block = {
                        "type": b_type,
                        "content": {"list_items": item.get("list_items", []), "text": list_text},
                        "bbox": item.get("bbox", [])
                    }
                else:
                    block = {
                        "type": b_type,
                        "content": {"paragraph_content": [{"type": "text", "content": text_val}]},
                        "bbox": item.get("bbox", [])
                    }
                pages_dict.setdefault(p_idx, []).append(block)
            return [pages_dict[p] for p in sorted(pages_dict.keys())]
        return content_list

    def _chunk_general_content(
        self,
        normalized_pages: List[List[Dict[str, Any]]],
        doc_title: str
    ) -> Dict[str, Any]:
        """일반 문서용 헤딩(H1~H2 Section, H3/문단군 Parent, 문장/표 Child) 계층 청킹"""
        sections: List[Dict[str, Any]] = []
        root_section_id = f"{self.doc_id}_s00"
        root_section = {
            "id": root_section_id,
            "title": doc_title,
            "level": 0,
            "breadcrumbs": [doc_title],
            "parent_chunk_ids": [],
            "child_chunk_ids": [],
            "full_text": "",
            "page_range": [1, 1],
        }
        sections.append(root_section)
        heading_stack = [(0, doc_title, root_section_id)]

        section_counter = 0
        current_sec_id = root_section_id

        # 각 섹션별로 수집된 콘텐츠 항목들
        section_items: Dict[str, List[Dict[str, Any]]] = {root_section_id: []}

        for page_idx, page_blocks in enumerate(normalized_pages, start=1):
            if not isinstance(page_blocks, list):
                continue

            for block in page_blocks:
                b_type = block.get("type", "").lower()
                b_content = block.get("content", {})

                if self.filter_headers_footers and b_type in ["page_header", "page_footer", "header", "footer"]:
                    continue

                if b_type == "title":
                    title_text = self._extract_text_from_content(b_content.get("title_content", []))
                    if not title_text.strip():
                        continue
                    level = b_content.get("level", 1)

                    clean_title = title_text.strip()
                    if self.RE_ROMAN_NUM.match(clean_title) or self.RE_PART.match(clean_title) or self.RE_CHAPTER.match(clean_title):
                        level = 1
                    elif self.RE_ARABIC_SUB_NUM.match(clean_title):
                        level = 3
                    elif self.RE_KOREAN_CHAR.match(clean_title) or self.RE_PAREN_NUM.match(clean_title) or self.RE_ARTICLE.match(clean_title):
                        level = 3
                    elif self.RE_ARABIC_NUM.match(clean_title) or self.RE_SECTION.match(clean_title):
                        has_roman_in_stack = any(h[0] == 1 for h in heading_stack)
                        level = 2 if has_roman_in_stack else min(level, 2)

                    if level <= 2:
                        section_counter += 1
                        sec_id = f"{self.doc_id}_s{section_counter:02d}"

                        while heading_stack and heading_stack[-1][0] >= level:
                            heading_stack.pop()

                        parent_sec_id = heading_stack[-1][2] if heading_stack else root_section_id
                        breadcrumbs = [h[1] for h in heading_stack] + [title_text]
                        heading_stack.append((level, title_text, sec_id))

                        new_sec = {
                            "id": sec_id,
                            "title": title_text,
                            "level": level,
                            "parent_section_id": parent_sec_id,
                            "breadcrumbs": breadcrumbs,
                            "parent_chunk_ids": [],
                            "child_chunk_ids": [],
                            "full_text": f"[{title_text}]\n",
                            "page_range": [page_idx, page_idx],
                        }
                        sections.append(new_sec)
                        current_sec_id = sec_id
                        section_items[current_sec_id] = []
                    else:
                        # Level 3 이상은 Parent 제목 경계로 등록
                        current_breadcrumbs = [h[1] for h in heading_stack]
                        section_items.setdefault(current_sec_id, []).append({
                            "type": "heading_h3",
                            "title": title_text,
                            "page": page_idx,
                            "breadcrumbs": current_breadcrumbs,
                        })

                elif b_type in ["paragraph", "text", "index", "list", "equation", "equation_interline"]:
                    if b_type in ["index", "list"]:
                        para_text = self._extract_text_from_list_block(b_content, block)
                    elif b_type in ["equation", "equation_interline"]:
                        para_text = b_content.get("math_content", "") or b_content.get("text", "") or block.get("text", "")
                    else:
                        para_text = self._extract_text_from_content(b_content.get("paragraph_content", []))
                        if not para_text.strip():
                            if isinstance(b_content, str):
                                para_text = b_content
                            elif isinstance(b_content.get("content"), str):
                                para_text = b_content.get("content")
                    if not para_text.strip():
                        continue

                    current_breadcrumbs = [h[1] for h in heading_stack]
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "text",
                        "text": para_text.strip(),
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })

                elif b_type == "table":
                    html_table = b_content.get("html", "")
                    caption = self._extract_text_from_content(b_content.get("table_caption", []))
                    footnote = self._extract_text_from_content(b_content.get("table_footnote", []))
                    img_path = b_content.get("image_source", {}).get("path", "")
                    table_type = b_content.get("table_type", "simple_table")

                    current_breadcrumbs = [h[1] for h in heading_stack]
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "table",
                        "raw_html": html_table,
                        "caption": caption,
                        "footnote": footnote,
                        "image_path": img_path,
                        "table_type": table_type,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })

        all_parent_chunks: List[Dict[str, Any]] = []
        all_child_chunks: List[Dict[str, Any]] = []

        child_counter = 0
        parent_counter = 0

        for sec in sections:
            sec_id = sec["id"]
            items = section_items.get(sec_id, [])
            if not items:
                continue

            sec_children, child_counter = self._pack_to_child_chunks(
                items=items,
                sec_id=sec_id,
                child_counter=child_counter,
                doc_title=doc_title,
                is_legal=False
            )

            sec_parents, parent_counter = self._pack_to_parent_chunks(
                child_chunks=sec_children,
                sec_id=sec_id,
                sec_title=sec["title"],
                parent_counter=parent_counter
            )

            all_child_chunks.extend(sec_children)
            all_parent_chunks.extend(sec_parents)

            sec["parent_chunk_ids"] = [p["parent_chunk_id"] for p in sec_parents]
            sec["child_chunk_ids"] = [c["chunk_id"] for c in sec_children]
            if sec_children:
                sec["page_range"] = [
                    min(c["page_number"] for c in sec_children),
                    max(c.get("page_end", c["page_number"]) for c in sec_children)
                ]
                sec["full_text"] = "\n\n".join(p["text"] for p in sec_parents)

        self.recalculate_section_hierarchy(sections, doc_title=doc_title)
        stats = self._calculate_stats(sections, all_parent_chunks, all_child_chunks)

        return {
            "doc_id": self.doc_id,
            "doc_title": doc_title,
            "strategy": "general",
            "stats": stats,
            "sections": sections,
            "parent_sections": sections,
            "parent_chunks": all_parent_chunks,
            "child_chunks": all_child_chunks,
        }

    def _chunk_legal_content(
        self,
        normalized_pages: List[List[Dict[str, Any]]],
        doc_title: str
    ) -> Dict[str, Any]:
        """
        법률/규정 문서용 3단계 계층 청킹:
        - Section: 편, 장, 절, 관, 부칙, 별표 등 헤딩 트리
        - Parent: 조문(제N조 및 제목) 또는 섹션 서두 문맥 (~2048 토큰)
        - Child: 조문 내 항(①, ②), 호(1., 2.), 목(가.), 원자적 표 (~512 토큰)
        """
        sections: List[Dict[str, Any]] = []
        root_section_id = f"{self.doc_id}_s00"
        root_section = {
            "id": root_section_id,
            "title": doc_title,
            "level": 0,
            "breadcrumbs": [doc_title],
            "parent_chunk_ids": [],
            "child_chunk_ids": [],
            "full_text": "",
            "page_range": [1, 1],
        }
        sections.append(root_section)
        hierarchy_stack = [(0, doc_title, root_section_id)]

        section_counter = 0
        current_sec_id = root_section_id

        section_items: Dict[str, List[Dict[str, Any]]] = {root_section_id: []}

        for page_idx, page_blocks in enumerate(normalized_pages, start=1):
            if not isinstance(page_blocks, list):
                continue

            for block in page_blocks:
                b_type = block.get("type", "").lower()
                b_content = block.get("content", {})

                if self.filter_headers_footers and b_type in ["page_header", "page_footer", "header", "footer", "page_number"]:
                    continue

                if b_type == "title":
                    raw_text = self._extract_text_from_content(b_content.get("title_content", []))
                elif b_type in ["paragraph", "text"]:
                    raw_text = self._extract_text_from_content(b_content.get("paragraph_content", []))
                    if not raw_text.strip():
                        if isinstance(b_content, str):
                            raw_text = b_content
                        elif isinstance(b_content.get("content"), str):
                            raw_text = b_content.get("content")
                elif b_type in ["index", "list"]:
                    raw_text = self._extract_text_from_list_block(b_content, block)
                elif b_type in ["equation", "equation_interline"]:
                    raw_text = b_content.get("math_content", "") or b_content.get("text", "") or block.get("text", "")
                elif b_type == "table":
                    raw_text = ""
                else:
                    raw_text = ""

                clean_text = raw_text.strip()

                # 1. 표(Table) 처리
                if b_type == "table":
                    html_table = b_content.get("html", "")
                    caption = self._extract_text_from_content(b_content.get("table_caption", []))
                    footnote = self._extract_text_from_content(b_content.get("table_footnote", []))
                    img_path = b_content.get("image_source", {}).get("path", "")
                    table_type = b_content.get("table_type", "simple_table")

                    current_breadcrumbs = [h[1] for h in hierarchy_stack]
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "table",
                        "raw_html": html_table,
                        "caption": caption,
                        "footnote": footnote,
                        "image_path": img_path,
                        "table_type": table_type,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })
                    continue

                if not clean_text:
                    continue

                # 2. 법률 위계(장·절·관·부칙·별표) 검사 -> Section 등록
                level: Optional[int] = None
                matched_title: Optional[str] = None

                m_part = self.RE_PART.match(clean_text)
                m_chap = self.RE_CHAPTER.match(clean_text)
                m_sec = self.RE_SECTION.match(clean_text)
                m_subsec = self.RE_SUBSECTION.match(clean_text)
                m_addendum = self.RE_ADDENDUM.match(clean_text)
                m_appendix = self.RE_APPENDIX.match(clean_text)

                if m_part:
                    level = 1
                    matched_title = clean_text.split("\n")[0]
                elif m_chap or m_addendum:
                    level = 2
                    matched_title = clean_text.split("\n")[0]
                elif m_sec or m_appendix:
                    level = 3
                    matched_title = clean_text.split("\n")[0]
                elif m_subsec:
                    level = 4
                    matched_title = clean_text.split("\n")[0]

                if level is not None and matched_title:
                    section_counter += 1
                    sec_id = f"{self.doc_id}_s{section_counter:02d}"

                    while hierarchy_stack and hierarchy_stack[-1][0] >= level:
                        hierarchy_stack.pop()

                    parent_sec_id = hierarchy_stack[-1][2] if hierarchy_stack else root_section_id
                    breadcrumbs = [h[1] for h in hierarchy_stack] + [matched_title]
                    hierarchy_stack.append((level, matched_title, sec_id))

                    new_section = {
                        "id": sec_id,
                        "title": matched_title,
                        "level": level,
                        "parent_section_id": parent_sec_id,
                        "breadcrumbs": breadcrumbs,
                        "parent_chunk_ids": [],
                        "child_chunk_ids": [],
                        "full_text": f"[{matched_title}]\n",
                        "page_range": [page_idx, page_idx],
                    }
                    sections.append(new_section)
                    current_sec_id = sec_id
                    section_items[current_sec_id] = []
                    continue

                # 3. 조문(제N조) 시작 감지
                m_art = self.RE_ARTICLE.match(clean_text)
                current_breadcrumbs = [h[1] for h in hierarchy_stack]

                if m_art:
                    art_label = m_art.group(1).replace(" ", "")
                    art_title = m_art.group(2).strip() if m_art.group(2) else ""
                    art_display = f"{art_label}({art_title})" if art_title else art_label

                    section_items.setdefault(current_sec_id, []).append({
                        "type": "article_start",
                        "article_no": art_label,
                        "article_title": art_title,
                        "article_display": art_display,
                        "text": clean_text,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })
                else:
                    section_items.setdefault(current_sec_id, []).append({
                        "type": "text",
                        "text": clean_text,
                        "page": page_idx,
                        "breadcrumbs": current_breadcrumbs,
                    })

        all_parent_chunks: List[Dict[str, Any]] = []
        all_child_chunks: List[Dict[str, Any]] = []

        child_counter = 0
        parent_counter = 0

        for sec in sections:
            sec_id = sec["id"]
            items = section_items.get(sec_id, [])
            if not items:
                continue

            sec_children, child_counter = self._pack_to_child_chunks(
                items=items,
                sec_id=sec_id,
                child_counter=child_counter,
                doc_title=doc_title,
                is_legal=True
            )

            sec_parents, parent_counter = self._pack_to_parent_chunks(
                child_chunks=sec_children,
                sec_id=sec_id,
                sec_title=sec["title"],
                parent_counter=parent_counter
            )

            all_child_chunks.extend(sec_children)
            all_parent_chunks.extend(sec_parents)

            sec["parent_chunk_ids"] = [p["parent_chunk_id"] for p in sec_parents]
            sec["child_chunk_ids"] = [c["chunk_id"] for c in sec_children]
            if sec_children:
                sec["page_range"] = [
                    min(c["page_number"] for c in sec_children),
                    max(c.get("page_end", c["page_number"]) for c in sec_children)
                ]
                sec["full_text"] = "\n\n".join(p["text"] for p in sec_parents)

        self.recalculate_section_hierarchy(sections, doc_title=doc_title)
        stats = self._calculate_stats(sections, all_parent_chunks, all_child_chunks)

        return {
            "doc_id": self.doc_id,
            "doc_title": doc_title,
            "strategy": "legal",
            "stats": stats,
            "sections": sections,
            "parent_sections": sections,
            "parent_chunks": all_parent_chunks,
            "child_chunks": all_child_chunks,
        }

    def _pack_to_child_chunks(
        self,
        items: List[Dict[str, Any]],
        sec_id: str,
        child_counter: int,
        doc_title: str,
        is_legal: bool = False
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        수집된 원시 블록들을 문장/조항 분할 후 512 토큰 한도 내로 Child Chunk로 패킹합니다.
        표(Table) 블록은 원자성을 보존하여 단독 Child Chunk로 생성합니다.
        """
        child_chunks: List[Dict[str, Any]] = []

        MICRO_TABLE_MAX_TOKENS = 180
        MICRO_TABLE_MAX_ROWS = 6

        current_text_units: List[str] = []
        current_html_units: List[str] = []
        current_tables: List[Dict[str, Any]] = []
        current_tokens = 0
        current_start_page: Optional[int] = None
        current_end_page: Optional[int] = None
        current_breadcrumbs: List[str] = []
        current_meta: Dict[str, Any] = {}
        current_chunk_type = "paragraph"
        current_heading_title: Optional[str] = None

        def flush_child_chunk():
            nonlocal child_counter, current_text_units, current_html_units, current_tables, current_tokens, current_start_page, current_end_page
            if not current_text_units:
                return

            cleaned_units = [u.strip() for u in current_text_units if u.strip()]
            if not cleaned_units:
                current_text_units = []
                current_html_units = []
                current_tables = []
                current_tokens = 0
                current_start_page = None
                current_end_page = None
                return

            is_heading_chunk = bool(
                cleaned_units and (
                    (current_heading_title and (
                        cleaned_units[0] == current_heading_title
                        or cleaned_units[0] == f"{current_heading_title} (계속)"
                    ))
                    or cleaned_units[0].startswith("### ")
                )
            )

            if current_tables or self.preserve_newlines:
                full_child_text = "\n\n".join(u for u in cleaned_units if u)
            else:
                if is_heading_chunk:
                    h_unit = cleaned_units[0]
                    body_units = cleaned_units[1:]
                    if body_units:
                        full_child_text = f"{h_unit}\n\n" + self.normalize_text_for_embedding(" ".join(body_units))
                    else:
                        full_child_text = h_unit
                else:
                    full_child_text = self.normalize_text_for_embedding(" ".join(cleaned_units))

            if not full_child_text:
                current_text_units = []
                current_html_units = []
                current_tables = []
                current_tokens = 0
                current_start_page = None
                current_end_page = None
                return

            child_counter += 1
            cid = f"{self.doc_id}_c{child_counter:04d}"
            start_p = current_start_page if current_start_page is not None else 1
            end_p = current_end_page if current_end_page is not None else start_p
            if end_p < start_p:
                end_p = start_p
            pages_list = list(range(start_p, end_p + 1))

            meta = dict(current_meta)
            meta["doc_title"] = doc_title
            meta["page"] = start_p
            meta["page_start"] = start_p
            meta["page_end"] = end_p
            meta["pages"] = pages_list
            if is_heading_chunk:
                heading_val = current_heading_title or (
                    cleaned_units[0][4:].strip() if cleaned_units[0].startswith("### ") else cleaned_units[0]
                )
                meta["heading_title"] = heading_val

            if current_tables:
                # 1개의 표만 존재할 때, 함께 있는 텍스트 유닛들이 표 제목/각주에 해당하는지 검사
                is_pure_table = False
                extracted_caption = None
                extracted_footnote = None

                if len(current_tables) == 1:
                    single_t = current_tables[0]
                    if len(cleaned_units) == 1:
                        is_pure_table = True
                        extracted_caption = single_t.get("caption") or None
                        extracted_footnote = single_t.get("footnote") or None
                    else:
                        # 표 자체 마크다운(| ... |\n| --- |)을 제외한 나머지 유닛 검사
                        non_table_units = []
                        for u in cleaned_units:
                            u_str = u.strip()
                            if ("| ---" in u_str or "|---" in u_str) and "\n|" in u_str:
                                continue
                            non_table_units.append(u_str)

                        title_cands = []
                        fn_cands = []
                        other_cands = []
                        for u in non_table_units:
                            if self.RE_TABLE_TITLE_TEXT.search(u):
                                title_cands.append(u)
                            elif self.RE_TABLE_FOOTNOTE_TEXT.search(u):
                                fn_cands.append(u)
                            else:
                                other_cands.append(u)

                        # 일반 본문 문단이 전혀 없고 오직 표 제목/각주만 존재하는 경우 -> 순수 표 청크로 확정
                        if not other_cands:
                            is_pure_table = True
                            cap_parts = []
                            if single_t.get("caption"):
                                cap_parts.append(single_t.get("caption"))
                            for t in title_cands:
                                m = re.search(r"\*\*\[표\s*(?:제목)?:\s*(.+?)\]\*\*", t)
                                if m:
                                    cap_parts.append(m.group(1).strip())
                                else:
                                    clean_t = self.RE_TABLE_TITLE_TEXT.sub("", t).strip(" :-_[]()【】*")
                                    cap_parts.append(clean_t or t)
                            extracted_caption = " / ".join(p for p in cap_parts if p) or None

                            fn_parts = []
                            if single_t.get("footnote"):
                                fn_parts.append(single_t.get("footnote"))
                            for f in fn_cands:
                                m = re.search(r"\*\*\[표\s*각주:\s*(.+?)\]\*\*", f)
                                if m:
                                    fn_parts.append(m.group(1).strip())
                                else:
                                    clean_f = self.RE_TABLE_FOOTNOTE_TEXT.sub("", f).strip(" :-_[]()【】*")
                                    fn_parts.append(clean_f or f)
                            extracted_footnote = " / ".join(p for p in fn_parts if p) or None

                if is_pure_table:
                    chunk_type = "table"
                    is_table = True
                    is_atomic_table = True
                    single_t = current_tables[0]
                    combined_raw_html = single_t.get("raw_html", "")
                    tbl_caption = extracted_caption
                    tbl_footnote = extracted_footnote
                    single_t["caption"] = tbl_caption or ""
                    single_t["footnote"] = tbl_footnote or ""
                    meta["type"] = "table"
                    meta["has_tables"] = True
                    meta["table_count"] = 1
                    full_child_text = self.generate_table_search_text(combined_raw_html, tbl_caption or "", tbl_footnote or "")
                else:
                    # 복합 청크: 문단(<p>)과 표(<table>)가 문서 순서대로 결합된 완성형 HTML
                    combined_raw_html = "\n\n".join(u for u in current_html_units if u.strip())
                    if not combined_raw_html:
                        combined_raw_html = "\n<hr class=\"table-sep my-2\"/>\n".join(
                            t["raw_html"] for t in current_tables if t.get("raw_html")
                        )
                    chunk_type = "composite"
                    is_table = True
                    is_atomic_table = False
                    meta["type"] = "composite"
                    meta["has_tables"] = True
                    meta["table_count"] = len(current_tables)
                    tbl_caption = None
                    tbl_footnote = None
            else:
                combined_raw_html = ""
                chunk_type = current_chunk_type
                is_table = False
                is_atomic_table = False
                tbl_caption = None
                tbl_footnote = None
                if "type" not in meta:
                    meta["type"] = chunk_type

            child_tokens = self.estimate_korean_tokens(full_child_text)
            if child_tokens > 512:
                meta["token_overflow"] = True
                if is_table:
                    meta["warning"] = f"대형 표 (~{child_tokens}T) - 512 토큰 한도 초과 (분할 또는 정제 권장)"
                else:
                    meta["warning"] = f"청크 토큰 초과 (~{child_tokens}T) - 512 토큰 한도 초과 (분할 권장)"

            child_chunks.append({
                "chunk_id": cid,
                "parent_chunk_id": "",  # Parent 패킹 시 주입
                "parent_id": "",        # 하위 호환성 별칭
                "section_id": sec_id,
                "chunk_type": chunk_type,
                "text": full_child_text,
                "raw_html": combined_raw_html,
                "table_caption": tbl_caption,
                "table_footnote": tbl_footnote,
                "tables": list(current_tables) if current_tables else [],
                "token_estimate": child_tokens,
                "page_number": start_p,
                "page_end": end_p,
                "breadcrumbs": list(current_breadcrumbs),
                "is_table": is_table,
                "is_atomic_table": is_atomic_table,
                "metadata": meta,
            })

            current_text_units = []
            current_html_units = []
            current_tables = []
            current_tokens = 0
            current_start_page = None
            current_end_page = None

        for item in items:
            i_type = item.get("type", "text")
            page_num = item.get("page", 1)
            breadcrumbs = item.get("breadcrumbs", [])

            if i_type == "table":
                raw_html = item.get("raw_html", "")
                caption = item.get("caption", "")
                footnote = item.get("footnote", "")
                table_type = item.get("table_type", "simple_table")
                tbl_start_p = item.get("page", 1)
                tbl_end_p = item.get("page_end", tbl_start_p)
                if tbl_end_p < tbl_start_p:
                    tbl_end_p = tbl_start_p
                tbl_pages = list(range(tbl_start_p, tbl_end_p + 1))

                search_text = self.generate_table_search_text(raw_html, caption, footnote)
                tbl_tokens = self.estimate_korean_tokens(search_text)
                raw_html_tokens = self.estimate_korean_tokens(raw_html) if raw_html else tbl_tokens

                # 행 수 계산
                row_count = 0
                if raw_html:
                    try:
                        parser = _HTMLTableExtractor()
                        parser.feed(raw_html)
                        row_count = len(parser.rows)
                    except Exception:
                        row_count = 0

                # 1) 이전 누적 텍스트와 합쳤을 때 512 토큰 초과 시 이전 텍스트 먼저 flush
                if tbl_tokens <= MICRO_TABLE_MAX_TOKENS and (current_tokens + tbl_tokens > 512) and current_text_units:
                    flush_child_chunk()

                # 2) 소형 표 판별 (법률 문서는 원자성 보존, 일반 문서에서 180 토큰 이하 & 6행 이하인 경우 인라인 병합)
                is_micro_table = (
                    not is_legal
                    and (
                        (0 < row_count <= MICRO_TABLE_MAX_ROWS and tbl_tokens <= MICRO_TABLE_MAX_TOKENS)
                        or (row_count == 0 and raw_html_tokens <= MICRO_TABLE_MAX_TOKENS)
                    )
                    and (current_tokens + tbl_tokens <= 512)
                )

                if is_micro_table:
                    md_table = self.html_table_to_markdown(raw_html, caption=caption, footnote=footnote)
                    if not md_table:
                        md_table = search_text

                    if current_start_page is None:
                        current_start_page = tbl_start_p
                    current_end_page = max(current_end_page or tbl_start_p, tbl_end_p)
                    if not current_breadcrumbs:
                        current_breadcrumbs = list(breadcrumbs)

                    current_text_units.append(md_table)
                    current_html_units.append(raw_html)
                    current_tokens += tbl_tokens
                    current_tables.append({
                        "table_index": len(current_tables),
                        "caption": caption,
                        "footnote": footnote,
                        "raw_html": raw_html,
                        "table_type": table_type,
                        "page_number": tbl_start_p,
                        "page_end": tbl_end_p,
                        "row_count": row_count,
                        "token_estimate": tbl_tokens,
                    })
                    continue

                # 3) 대형 표 또는 법률 문서 표인 경우: 이전 텍스트 유닛 중 단독 표 제목 패턴이 있으면 흡수 후 flush
                if len(current_text_units) == 1 and current_heading_title and current_text_units[0] in (current_heading_title, f"### {current_heading_title}"):
                    if not caption:
                        caption = current_heading_title
                    current_text_units = []
                    current_html_units = []
                    current_tokens = 0
                elif len(current_text_units) == 1 and self.RE_TABLE_TITLE_TEXT.search(current_text_units[0]):
                    if not caption:
                        m = re.search(r"\*\*\[표\s*(?:제목)?:\s*(.+?)\]\*\*", current_text_units[0])
                        if m:
                            caption = m.group(1).strip()
                        else:
                            clean_t = self.RE_TABLE_TITLE_TEXT.sub("", current_text_units[0]).strip(" :-_[]()【】*")
                            caption = clean_t or current_text_units[0]
                    current_text_units = []
                    current_html_units = []
                    current_tokens = 0
                else:
                    flush_child_chunk()

                child_counter += 1
                cid = f"{self.doc_id}_c{child_counter:04d}"

                effective_breadcrumbs = list(current_breadcrumbs) if current_breadcrumbs else list(breadcrumbs)

                tbl_meta = {
                    "doc_title": doc_title,
                    "type": "table",
                    "has_tables": True,
                    "table_count": 1,
                    "page": tbl_start_p,
                    "page_start": tbl_start_p,
                    "page_end": tbl_end_p,
                    "pages": tbl_pages,
                }
                if tbl_tokens > 512:
                    tbl_meta["token_overflow"] = True
                    tbl_meta["warning"] = f"대형 표 (~{tbl_tokens}T) - 512 토큰 한도 초과 (분할 또는 정제 권장)"

                if current_meta.get("article_display"):
                    tbl_meta["article_no"] = current_meta.get("article_no", "")
                    tbl_meta["article_title"] = current_meta.get("article_title", "")
                    tbl_meta["article_display"] = current_meta.get("article_display", "")

                child_chunks.append({
                    "chunk_id": cid,
                    "parent_chunk_id": "",
                    "parent_id": "",
                    "section_id": sec_id,
                    "chunk_type": "table",
                    "text": search_text,
                    "raw_html": raw_html,
                    "table_caption": caption,
                    "table_footnote": footnote,
                    "table_type": table_type,
                    "token_estimate": tbl_tokens,
                    "page_number": tbl_start_p,
                    "page_end": tbl_end_p,
                    "breadcrumbs": effective_breadcrumbs,
                    "is_table": True,
                    "is_atomic_table": True,
                    "metadata": tbl_meta,
                })
                continue

            if i_type == "article_start":
                flush_child_chunk()
                current_breadcrumbs = breadcrumbs
                current_chunk_type = "article"
                current_meta = {
                    "type": "article",
                    "article_no": item.get("article_no", ""),
                    "article_title": item.get("article_title", ""),
                    "article_display": item.get("article_display", ""),
                }

                raw_art_text = item.get("text", "")
                units = self.split_text_into_units(raw_art_text, is_legal=True, max_tokens=512)
                for u in units:
                    u_tokens = self.estimate_korean_tokens(u)
                    if current_tokens + u_tokens > 512 and current_text_units:
                        flush_child_chunk()
                    if current_start_page is None:
                        current_start_page = page_num
                    current_end_page = page_num
                    current_text_units.append(u)
                    html_u = self._format_text_unit_as_html(u)
                    if html_u:
                        current_html_units.append(html_u)
                    current_tokens += u_tokens
                continue

            if i_type == "heading_h3":
                flush_child_chunk()
                title_text = item.get("title", "").strip()
                current_breadcrumbs = list(breadcrumbs)
                current_chunk_type = "paragraph"
                current_meta = {}
                current_heading_title = title_text
                if title_text:
                    heading_unit = title_text
                    current_text_units.append(heading_unit)
                    html_u = self._format_text_unit_as_html(heading_unit)
                    if html_u:
                        current_html_units.append(html_u)
                    current_tokens += self.estimate_korean_tokens(heading_unit)
                    if current_start_page is None:
                        current_start_page = page_num
                    current_end_page = page_num
                continue

            raw_text = item.get("text", "")
            if not current_breadcrumbs:
                current_breadcrumbs = breadcrumbs

            units = self.split_text_into_units(raw_text, is_legal=is_legal, max_tokens=512)
            for u in units:
                u_tokens = self.estimate_korean_tokens(u)
                if current_tokens + u_tokens > 512 and current_text_units:
                    flush_child_chunk()
                    if current_heading_title and not is_legal:
                        cont_heading = f"{current_heading_title} (계속)"
                        current_text_units.append(cont_heading)
                        html_u = self._format_text_unit_as_html(cont_heading)
                        if html_u:
                            current_html_units.append(html_u)
                        current_tokens += self.estimate_korean_tokens(cont_heading)
                if current_start_page is None:
                    current_start_page = page_num
                current_end_page = page_num
                current_text_units.append(u)
                html_u = self._format_text_unit_as_html(u)
                if html_u:
                    current_html_units.append(html_u)
                current_tokens += u_tokens

        flush_child_chunk()
        return child_chunks, child_counter


    def _pack_to_parent_chunks(
        self,
        child_chunks: List[Dict[str, Any]],
        sec_id: str,
        sec_title: str,
        parent_counter: int
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        Child Chunk들을 2048 토큰 한도 내로 결합하여 완성도 높은 LLM 문맥용 Parent Chunk를 생성합니다.
        2048 토큰을 초과하는 초대형 표는 독립 Parent Chunk로 단독 승격합니다.
        """
        parent_chunks: List[Dict[str, Any]] = []
        if not child_chunks:
            return parent_chunks, parent_counter

        current_children: List[Dict[str, Any]] = []
        current_tokens = 0
        current_parent_title: Optional[str] = None

        def _get_child_heading(c_node: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
            art = c_node.get("metadata", {}).get("article_display")
            if art:
                return art, art
            h_meta = c_node.get("metadata", {}).get("heading_title")
            if h_meta:
                clean_h = re.sub(r"\s*\(계속\)$", "", h_meta.strip())
                return clean_h, None
            h_match = re.match(r"^###\s+([^\n]+)", c_node.get("text", ""))
            if h_match:
                clean_h = re.sub(r"\s*\(계속\)$", "", h_match.group(1).strip())
                return clean_h, None
            return None, None

        def flush_parent():
            nonlocal parent_counter, current_children, current_tokens, current_parent_title
            if not current_children:
                return

            parent_counter += 1
            pid = f"{self.doc_id}_p{parent_counter:04d}"

            body_parts = []
            for c in current_children:
                if c.get("chunk_type") == "table":
                    cap = c.get("table_caption")
                    cap_prefix = f"[표: {cap}]\n" if cap else "[표]\n"
                    table_content = c.get("raw_html") or c.get("text", "")
                    c_text = f"{cap_prefix}{table_content}".strip()
                else:
                    c_text = c.get("text", "")

                if not c_text:
                    continue

                if not body_parts:
                    body_parts.append(c_text)
                else:
                    h_title = c.get("metadata", {}).get("heading_title")
                    is_h = bool(h_title and (c_text.startswith(h_title) or c_text.startswith(f"### {h_title}")))
                    if not is_h and not c.get("metadata", {}).get("article_display"):
                        is_h = bool(re.match(r"^###\s+", c_text))

                    if is_h:
                        # 소제목 앞은 빈 줄 2개(\n\n\n)로 여백 구분
                        body_parts.append("\n\n\n" + c_text)
                    else:
                        # 일반 문단 간격은 빈 줄 1개(\n\n)
                        body_parts.append("\n\n" + c_text)

            body_text = "".join(body_parts).strip()

            first_c = current_children[0]
            sec_bcs = first_c.get("breadcrumbs") or [sec_title]
            bc_str = " > ".join(sec_bcs)

            distinct_headings = []
            for c in current_children:
                h_name, _ = _get_child_heading(c)
                effective_h = h_name or sec_title
                if effective_h and effective_h not in distinct_headings:
                    distinct_headings.append(effective_h)

            if len(distinct_headings) > 1 and not first_c.get("metadata", {}).get("article_display"):
                title_val = sec_title
            else:
                title_val = current_parent_title or first_c.get("metadata", {}).get("article_display") or sec_title

            if current_parent_title and current_parent_title.endswith(" (계속)"):
                context_header = f"[{bc_str} (계속)]"
            else:
                context_header = f"[{bc_str}]"
            raw_parent_text = f"{context_header}\n\n{body_text}".strip()
            parent_full_text = self.normalize_parent_text(raw_parent_text, preserve_newlines=self.preserve_newlines)

            p_tokens = self.estimate_korean_tokens(parent_full_text)
            p_chunk = {
                "parent_chunk_id": pid,
                "id": pid,  # 호환성 별칭
                "section_id": sec_id,
                "title": title_val,
                "breadcrumbs": list(sec_bcs),
                "text": parent_full_text,
                "token_estimate": p_tokens,
                "child_chunk_ids": [c["chunk_id"] for c in current_children],
                "page_range": [
                    min(c["page_number"] for c in current_children),
                    max(c.get("page_end", c["page_number"]) for c in current_children),
                ],
            }
            parent_chunks.append(p_chunk)

            for c in current_children:
                c["parent_chunk_id"] = pid
                c["parent_id"] = pid

            current_children = []
            current_tokens = 0
            current_parent_title = None

        for child in child_chunks:
            # 1. 2048 토큰을 초과하는 초대형 표 단독 승격 규칙
            raw_html_len = len(child.get("raw_html", "")) if child.get("raw_html") else 0
            raw_table_tokens = self.estimate_korean_tokens(child.get("raw_html", "")) if raw_html_len > 0 else child["token_estimate"]

            if child.get("chunk_type") == "table" and raw_table_tokens > 2048:
                flush_parent()
                current_children.append(child)
                current_tokens = raw_table_tokens
                current_parent_title = child.get("table_caption") or f"{sec_title} - 대형 표"
                flush_parent()
                continue

            # 2. 제목 식별: 법률 조문(article_display) 또는 일반 문서 Heading(metadata heading_title / 텍스트 헤딩)
            h_name, art_disp = _get_child_heading(child)
            target_heading = h_name or sec_title

            # 제목 변경 감지 시 독립 Parent 생성 (단, '(계속)' 접미사가 붙은 현재 제목의 베이스 타이틀과 비교)
            base_parent_title = current_parent_title.replace(" (계속)", "") if current_parent_title else None
            if art_disp:
                # [법률 문서] 조문(제N조) 변경 감지 시 토큰 수와 무관하게 즉시 분할 (1조문 = 1부모 원칙 보존)
                if base_parent_title and target_heading and base_parent_title != target_heading:
                    flush_parent()
            else:
                # [일반 문서] 소제목 변경 감지 시 누적 토큰이 MIN_PARENT_TOKENS(1600) 이상일 때만 분할하여 풍부한 문맥 보장
                MIN_PARENT_TOKENS = 1600
                if base_parent_title and target_heading and base_parent_title != target_heading:
                    if current_tokens >= MIN_PARENT_TOKENS:
                        flush_parent()

            if not current_parent_title and target_heading:
                current_parent_title = target_heading

            # 3. 2048 토큰 초과 검사
            c_tokens = child.get("token_estimate", 0)
            if current_tokens + c_tokens > 2048 and current_children:
                flush_parent()
                if target_heading:
                    current_parent_title = f"{target_heading} (계속)"

            current_children.append(child)
            current_tokens += c_tokens

        flush_parent()
        return parent_chunks, parent_counter

    def export_to_jsonl(self, etl_result: Dict[str, Any]) -> str:
        """
        RAG Vector DB 및 하이브리드 검색 엔진 적재를 위한 표준 JSONL을 생성합니다.
        - 검색/임베딩 대상: text
        - LLM 프롬프트 생성 문맥: parent_context_text (Small-to-Big Retrieval 100% 지원)
        """
        lines: List[str] = []
        parent_map = {
            p.get("parent_chunk_id", p.get("id", "")): p
            for p in etl_result.get("parent_chunks", [])
        }
        sec_list = etl_result.get("sections") or etl_result.get("parent_sections") or []
        section_map = {s["id"]: s for s in sec_list}

        for chunk in etl_result.get("child_chunks", []):
            if chunk.get("is_ignored"):
                continue

            pid = chunk.get("parent_chunk_id") or chunk.get("parent_id", "")
            parent = parent_map.get(pid, {})
            sec_id = chunk.get("section_id") or parent.get("section_id", "")
            section = section_map.get(sec_id, {})

            breadcrumbs = chunk.get("breadcrumbs") or section.get("breadcrumbs") or []
            breadcrumbs_str = " > ".join(breadcrumbs) if breadcrumbs else ""

            start_page = chunk.get("page_number", 1)
            end_page = chunk.get("page_end", start_page)
            if end_page < start_page:
                end_page = start_page
            pages_list = list(range(start_page, end_page + 1))

            meta = dict(chunk.get("metadata") or {})
            c_type = self.get_chunk_kind(chunk)

            chunk_tables = chunk.get("tables") or meta.get("tables") or []
            has_tables = bool(chunk_tables or c_type in ("table", "composite"))
            table_count = len(chunk_tables) if chunk_tables else (1 if c_type == "table" else 0)

            # 불필요하거나 중복되는 레거시 메타데이터 제거 (Vector DB 필터링 안전성 확보)
            meta.pop("tables", None)
            meta.pop("is_table", None)
            meta.pop("is_atomic_table", None)
            meta.pop("table_caption", None)
            meta.pop("table_footnote", None)
            meta.pop("has_image", None)
            meta.pop("image_path", None)
            meta.pop("image_url", None)

            # 표준 메타데이터 스칼라 필드 주입
            meta["type"] = c_type
            meta["doc_title"] = etl_result.get("doc_title", "")
            meta["section"] = section.get("title", "")
            meta["page"] = start_page
            meta["page_start"] = start_page
            meta["page_end"] = end_page
            meta["pages"] = pages_list
            meta["has_tables"] = has_tables
            meta["table_count"] = table_count

            # tables 항목 정제: table_type 제거 및 필수 속성(table_id, caption, footnote, raw_html)만 보존
            clean_tables = []
            cid = chunk.get("chunk_id", "")
            for idx, t in enumerate(chunk_tables):
                clean_tables.append({
                    "table_id": t.get("table_id") or f"{cid}_t{idx + 1}",
                    "caption": t.get("caption") or chunk.get("table_caption") or "",
                    "footnote": t.get("footnote") or chunk.get("table_footnote") or "",
                    "raw_html": t.get("raw_html") or chunk.get("raw_html") or "",
                })

            # 단독 표(table)인데 chunk_tables가 비어있는 레거시 청크의 경우 자체 raw_html 기반 생성
            if c_type == "table" and not clean_tables and chunk.get("raw_html"):
                clean_tables.append({
                    "table_id": f"{cid}_t1",
                    "caption": chunk.get("table_caption") or "",
                    "footnote": chunk.get("table_footnote") or "",
                    "raw_html": chunk.get("raw_html") or "",
                })

            parent_text = parent.get("text", "")
            if breadcrumbs_str and not parent_text.startswith("["):
                parent_context_text = f"[{breadcrumbs_str}]\n{parent_text}".strip()
            else:
                parent_context_text = parent_text.strip()

            record = {
                "id": cid,
                "parent_chunk_id": pid,
                "section_id": sec_id,
                "section_title": section.get("title", ""),
                "breadcrumbs": breadcrumbs,
                "breadcrumbs_str": breadcrumbs_str,
                "text": chunk.get("text", ""),
                "parent_context_text": parent_context_text,
                "page": start_page,
                "pages": pages_list,
                "token_estimate": chunk.get("token_estimate", self.estimate_korean_tokens(chunk.get("text", ""))),
                "parent_token_estimate": parent.get("token_estimate", self.estimate_korean_tokens(parent_text)),
                "metadata": meta,
            }

            if end_page > start_page:
                record["page_end"] = end_page
            if has_tables and clean_tables:
                record["tables"] = clean_tables
            if c_type == "composite":
                raw_val = self.reconstruct_composite_raw_html(chunk) or chunk.get("raw_html", "")
            else:
                raw_val = chunk.get("raw_html", "")

            if raw_val:
                record["raw_html"] = raw_val

            lines.append(json.dumps(record, ensure_ascii=False))

        return "\n".join(lines)

    @classmethod
    def recalculate_section_hierarchy(
        cls,
        sections: List[Dict[str, Any]],
        doc_title: str = ""
    ) -> List[Dict[str, Any]]:
        """
        부모-자식 트리 구조(parent_section_id)를 바탕으로
        전역 계층 레벨(level: H0 -> H1 -> H2 -> H3)과 breadcrumbs를 일괄 재계산합니다.
        - 루트 섹션: level = 0, breadcrumbs = [root.title]
        - 직속 자식: level = 1, breadcrumbs = [root.title, sec.title]
        - 깊이 N:   level = N, breadcrumbs = [ancestors..., sec.title]
        """
        if not sections:
            return []

        # 1. 루트 섹션 식별 (level==0, _s00, _root, 또는 parent_section_id 없는 첫 항목)
        root_sec = None
        for s in sections:
            sid = str(s.get("id", ""))
            if s.get("level", 0) == 0 or sid.endswith("_s00") or sid.endswith("_root") or not s.get("parent_section_id"):
                root_sec = s
                break

        if not root_sec and sections:
            root_sec = sections[0]

        root_id = root_sec.get("id") if root_sec else None

        # 2. 빠른 조회를 위한 id map
        sec_map: Dict[str, Dict[str, Any]] = {str(s.get("id", "")): s for s in sections if s.get("id")}

        # 3. 트리 탐색 및 레벨/브레드크럼 재계산
        for s in sections:
            sid = str(s.get("id", ""))
            if s is root_sec or sid == root_id:
                s["level"] = 0
                title = s.get("title") or doc_title or "문서"
                s["breadcrumbs"] = [title]
                s["parent_section_id"] = None
                continue

            chain = []
            curr = s
            visited = {sid}

            while curr:
                pid = curr.get("parent_section_id")
                if not pid or pid not in sec_map or pid in visited:
                    break
                visited.add(pid)
                parent = sec_map[pid]
                chain.append(parent)
                if parent is root_sec or str(parent.get("id", "")) == root_id:
                    break
                curr = parent

            ancestors = list(reversed(chain))

            # 루트 섹션이 조상 체인의 맨 앞에 없으면 루트를 최상위 부모로 연결 (고아 섹션 보호)
            if root_sec and (not ancestors or (ancestors[0] is not root_sec and str(ancestors[0].get("id", "")) != root_id)):
                ancestors = [root_sec] + ancestors

            calculated_level = len(ancestors)
            breadcrumbs = [a.get("title", "") for a in ancestors] + [s.get("title", "")]
            final_parent_id = ancestors[-1].get("id") if ancestors else root_id

            s["level"] = calculated_level
            s["breadcrumbs"] = breadcrumbs
            s["parent_section_id"] = final_parent_id

        return sections

    @classmethod
    def sync_section_page_ranges(
        cls,
        sections: List[Dict[str, Any]],
        child_chunks: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        섹션들의 page_range를 소속 청크 및 하위 자식 섹션들을 바탕으로 상향식(Bottom-up) 동기화합니다.
        - 직속 Child 청크가 있는 경우: min(page_number) ~ max(page_end or page_number)
        - 하위 자식 섹션들이 있는 경우: 하위 섹션들의 page_range 최소~최대값을 재귀 취합
        - 청크도 없고 하위 섹션도 없는 경우: 기존 page_range 유지
        """
        if not sections:
            return []

        child_map = {c.get("chunk_id"): c for c in child_chunks}
        children_by_parent: Dict[str, List[Dict[str, Any]]] = {}
        for s in sections:
            psid = s.get("parent_section_id")
            if psid:
                children_by_parent.setdefault(psid, []).append(s)

        computed_ranges: Dict[str, List[int]] = {}
        visiting = set()

        def compute_range(sec: Dict[str, Any]) -> List[int]:
            sid = sec.get("id", "")
            if sid in computed_ranges:
                return computed_ranges[sid]
            if sid in visiting:
                return sec.get("page_range", [1, 1])
            visiting.add(sid)

            min_page = float("inf")
            max_page = float("-inf")

            # 1. 직속 Child 청크들의 페이지 범위
            for cid in sec.get("child_chunk_ids", []):
                c = child_map.get(cid)
                if c:
                    start = c.get("page_number", 1)
                    end = c.get("page_end", start)
                    if start < min_page:
                        min_page = start
                    if end > max_page:
                        max_page = end

            # 2. 하위 자식 섹션들의 페이지 범위 (재귀)
            for sub in children_by_parent.get(sid, []):
                sub_range = compute_range(sub)
                if sub_range[0] < min_page:
                    min_page = sub_range[0]
                if sub_range[1] > max_page:
                    max_page = sub_range[1]

            visiting.remove(sid)

            if min_page != float("inf") and max_page != float("-inf"):
                res_range = [int(min_page), int(max_page)]
            else:
                res_range = sec.get("page_range", [1, 1])

            computed_ranges[sid] = res_range
            return res_range

        for s in sections:
            s["page_range"] = compute_range(s)

        return sections

    @classmethod
    def reindex_etl_result(cls, etl_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        수동 편집(분할/병합/섹션 재지정) 후 불연속해진 모든 ID를
        '문서 물리적 등장 순서(Page & Block Position)' 기준으로 일괄 재정렬(Re-index)합니다.
        - doc_id: 6자리 해시 기반 정규화 (d_xxxxxx)
        - sections: s00 (root), s01, s02...
        - parent_chunks: p001, p002, p003...
        - child_chunks: c001, c002, c003...
        - Section-Parent-Child 간 모든 양방향 참조 일괄 갱신
        """
        import copy
        res = copy.deepcopy(etl_result)
        raw_doc_id = res.get("doc_id") or ""
        active_pdf = res.get("active_pdf")
        doc_title = res.get("doc_title")

        # 1. 이미 128-bit UUID (doc_ + 32자리 hex) 형태인 경우 유지
        if isinstance(raw_doc_id, str) and raw_doc_id.startswith("doc_") and len(raw_doc_id) == 36 and raw_doc_id[4:].isalnum():
            doc_id = raw_doc_id
        else:
            # 2. 구버전 ID(d_xxxxxx 등)인 경우 원본 문서명을 기반으로 128-bit UUID v5로 자동 업그레이드
            seed = active_pdf or doc_title or raw_doc_id or "doc"
            doc_id = cls.generate_doc_id(seed)
        res["doc_id"] = doc_id

        raw_sections = res.get("sections") or res.get("parent_sections") or []
        raw_parents = res.get("parent_chunks", [])
        raw_children = res.get("child_chunks", [])

        # 0. 계층 순서 사전 동기화 (섹션 내 parent_chunk_ids 및 부모 내 child_chunk_ids 순서 반영)
        parent_dict = {p.get("parent_chunk_id") or p.get("id"): p for p in raw_parents}
        child_dict = {c.get("chunk_id"): c for c in raw_children}

        synced_parents = []
        visited_pids = set()
        for sec in raw_sections:
            for pid in sec.get("parent_chunk_ids", []):
                if pid in parent_dict and pid not in visited_pids:
                    synced_parents.append(parent_dict[pid])
                    visited_pids.add(pid)
        for p in raw_parents:
            pid = p.get("parent_chunk_id") or p.get("id")
            if pid not in visited_pids:
                synced_parents.append(p)
                visited_pids.add(pid)

        synced_children = []
        visited_cids = set()
        for p in synced_parents:
            for cid in p.get("child_chunk_ids", []):
                if cid in child_dict and cid not in visited_cids:
                    synced_children.append(child_dict[cid])
                    visited_cids.add(cid)
        for c in raw_children:
            cid = c.get("chunk_id")
            if cid not in visited_cids:
                synced_children.append(c)
                visited_cids.add(cid)

        raw_parents = synced_parents
        raw_children = synced_children

        # 0-1. 복합(composite) 청크의 누락된 문단 HTML 자동 복원
        cls.heal_composite_chunks(raw_children)

        # 1. 소속 청크 및 하위 섹션 범위를 반영한 page_range 동기화
        raw_sections = cls.sync_section_page_ranges(raw_sections, raw_children)

        # 2. 물리적 페이지 순서 및 계층 구조(Tree DFS) 기반 정렬 (안정 정렬)
        root_sec = None
        normal_sections = []
        for s in raw_sections:
            if s.get("level", 0) == 0 or s.get("id", "").endswith("_s00") or s.get("id", "").endswith("_root"):
                root_sec = s
            else:
                normal_sections.append(s)

        root_id = root_sec.get("id") if root_sec else None
        children_map: Dict[str, List[Dict[str, Any]]] = {}
        for s in normal_sections:
            pid = s.get("parent_section_id") or root_id or "__root__"
            children_map.setdefault(pid, []).append(s)

        # 동일 부모 내 형제 섹션들끼리 page_range[0] 기준 안정 정렬
        for s_list in children_map.values():
            s_list.sort(key=lambda item: item.get("page_range", [1, 1])[0])

        sorted_sections = []
        if root_sec:
            sorted_sections.append(root_sec)

        visited_sids = set()
        if root_sec:
            visited_sids.add(root_sec.get("id"))

        def traverse(parent_id: str):
            for child in children_map.get(parent_id, []):
                cid = child.get("id")
                if cid not in visited_sids:
                    visited_sids.add(cid)
                    sorted_sections.append(child)
                    traverse(cid)

        if root_id:
            traverse(root_id)

        # 부모 연결이 끊어졌거나 매핑에서 누락된 고아 섹션들 보존 (페이지 순 정렬)
        remaining = [s for s in normal_sections if s.get("id") not in visited_sids]
        remaining.sort(key=lambda s: s.get("page_range", [1, 1])[0])
        for r in remaining:
            rid = r.get("id")
            if rid not in visited_sids:
                visited_sids.add(rid)
                sorted_sections.append(r)
                traverse(rid)

        # Parent는 page_range[0] 기준 정렬
        sorted_parents = sorted(raw_parents, key=lambda p: p.get("page_range", [1, 1])[0])

        # Child는 page_number 기준 정렬
        sorted_children = sorted(raw_children, key=lambda c: c.get("page_number", 1))

        # 2. 신규 ID 매핑 맵 생성
        section_id_map: Dict[str, str] = {}
        sec_counter = 1
        new_sections = []
        for sec in sorted_sections:
            old_sid = sec.get("id", "")
            if sec.get("level", 0) == 0 or old_sid.endswith("_s00") or old_sid.endswith("_root"):
                new_sid = f"{doc_id}_s00"
            else:
                new_sid = f"{doc_id}_s{sec_counter:02d}"
                sec_counter += 1
            section_id_map[old_sid] = new_sid
            sec["id"] = new_sid
            new_sections.append(sec)

        parent_id_map: Dict[str, str] = {}
        parent_counter = 1
        new_parents = []
        for p in sorted_parents:
            old_pid = p.get("parent_chunk_id") or p.get("id", "")
            new_pid = f"{doc_id}_p{parent_counter:04d}"
            parent_counter += 1
            parent_id_map[old_pid] = new_pid
            p["parent_chunk_id"] = new_pid
            p["id"] = new_pid
            new_parents.append(p)

        child_id_map: Dict[str, str] = {}
        child_counter = 1
        new_children = []
        for c in sorted_children:
            old_cid = c.get("chunk_id", "")
            new_cid = f"{doc_id}_c{child_counter:04d}"
            child_counter += 1
            child_id_map[old_cid] = new_cid
            c["chunk_id"] = new_cid

            p_start = c.get("page_number", 1)
            p_end = c.get("page_end", p_start)
            if p_end < p_start:
                p_end = p_start

            c.pop("image_path", None)
            c.pop("image_url", None)

            # 표(tables) 정규화 및 table_id 일관성 부여
            existing_tables = c.get("tables")
            if not existing_tables:
                raw_html = c.get("raw_html", "")
                is_old_table = c.get("is_table") or c.get("chunk_type") == "table" or ("<table" in raw_html.lower())
                if is_old_table and raw_html:
                    c["tables"] = [{
                        "table_id": f"{new_cid}_t1",
                        "raw_html": raw_html,
                        "caption": c.get("table_caption") or "",
                        "footnote": c.get("table_footnote") or "",
                        "table_type": c.get("table_type") or "table"
                    }]
                else:
                    c["tables"] = []
            else:
                for idx, tbl in enumerate(existing_tables):
                    tbl["table_id"] = f"{new_cid}_t{idx + 1}"

            # 레거시 필드 완전 삭제 (Clean Drop)
            c.pop("chunk_type", None)
            c.pop("is_table", None)
            c.pop("is_atomic_table", None)
            c.pop("table_caption", None)
            c.pop("table_footnote", None)
            c.pop("table_type", None)

            if isinstance(c.get("metadata"), dict):
                c["metadata"]["page"] = p_start
                c["metadata"]["page_start"] = p_start
                c["metadata"]["page_end"] = p_end
                c["metadata"]["pages"] = list(range(p_start, p_end + 1))
                c["metadata"]["type"] = cls.get_chunk_kind(c)
                c["metadata"].pop("has_image", None)
                c["metadata"].pop("image_path", None)
                c["metadata"].pop("image_url", None)

            new_children.append(c)

        # 3. 상호 참조 ID 일괄 갱신
        for sec in new_sections:
            old_psid = sec.get("parent_section_id")
            if old_psid and old_psid in section_id_map:
                sec["parent_section_id"] = section_id_map[old_psid]

            sec["parent_chunk_ids"] = [
                parent_id_map[pid] for pid in sec.get("parent_chunk_ids", []) if pid in parent_id_map
            ]
            sec["child_chunk_ids"] = [
                child_id_map[cid] for cid in sec.get("child_chunk_ids", []) if cid in child_id_map
            ]

        # 4. 전역 계층 레벨 및 breadcrumbs 일괄 재계산
        cls.recalculate_section_hierarchy(new_sections, doc_title=res.get("doc_title", ""))

        section_obj_map = {s.get("id"): s for s in new_sections if s.get("id")}

        for p in new_parents:
            old_sid = p.get("section_id")
            if old_sid and old_sid in section_id_map:
                p["section_id"] = section_id_map[old_sid]

            sec = section_obj_map.get(p.get("section_id"))
            if sec and sec.get("breadcrumbs"):
                p["breadcrumbs"] = list(sec["breadcrumbs"])

                p_text = p.get("text", "")
                if p_text and p_text.startswith("["):
                    p_bc_str = " > ".join(p["breadcrumbs"])
                    p["text"] = re.sub(r"^\[([^\]]+?)(\s*\(계속\))?\]", rf"[{p_bc_str}\2]", p_text)

            p["child_chunk_ids"] = [
                child_id_map[cid] for cid in p.get("child_chunk_ids", []) if cid in child_id_map
            ]

        for c in new_children:
            old_pid = c.get("parent_chunk_id") or c.get("parent_id")
            if old_pid and old_pid in parent_id_map:
                c["parent_chunk_id"] = parent_id_map[old_pid]
                c["parent_id"] = parent_id_map[old_pid]

            old_sid = c.get("section_id")
            if old_sid and old_sid in section_id_map:
                c["section_id"] = section_id_map[old_sid]

            sec = section_obj_map.get(c.get("section_id"))
            if sec and sec.get("breadcrumbs"):
                c["breadcrumbs"] = list(sec["breadcrumbs"])

        res["sections"] = new_sections
        res["parent_sections"] = new_sections
        res["parent_chunks"] = new_parents
        res["child_chunks"] = new_children
        res["stats"] = cls._calculate_stats(new_sections, new_parents, new_children)

        return res

    @classmethod
    def _calculate_stats(
        cls,
        sections: List[Dict[str, Any]],
        parents: List[Dict[str, Any]],
        children: List[Dict[str, Any]]
    ) -> Dict[str, int]:
        kinds = [cls.get_chunk_kind(c) for c in children]
        return {
            "total_sections": len(sections),
            "total_parent_sections": len(sections),
            "total_parent_chunks": len(parents),
            "total_child_chunks": len(children),
            "paragraph_chunks": sum(1 for k in kinds if k in ("paragraph", "article")),
            "table_chunks": sum(1 for k in kinds if k == "table"),
            "composite_chunks": sum(1 for k in kinds if k == "composite"),
            "article_chunks": sum(1 for k in kinds if k == "article"),
            "total_words": sum(c.get("token_estimate", 0) for c in children),
        }

    def _extract_text_from_content(self, content_items: Any) -> str:
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

    def _extract_text_from_list_block(self, b_content: Any, block: Optional[Dict[str, Any]] = None) -> str:
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
                return str(b_content.get("text", "") or b_content.get("content", ""))
            return ""

        lines: List[str] = []
        for item in list_items:
            if isinstance(item, str):
                if item.strip():
                    lines.append(item.strip())
            elif isinstance(item, dict):
                item_content = item.get("item_content")
                if item_content:
                    extracted = self._extract_text_from_content(item_content)
                    if extracted:
                        lines.append(extracted)
                else:
                    txt = str(item.get("content", "") or item.get("text", "")).strip()
                    if txt:
                        lines.append(txt)
        return "\n".join(lines).strip()


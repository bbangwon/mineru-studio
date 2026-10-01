import re

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
    re.IGNORECASE,
)
RE_TABLE_FOOTNOTE_TEXT = re.compile(
    r"^(?:\*\*\[표\s*각주:\s*|(?:※|\(?주\)?\s*[:\)]|출처\s*[:\)]|참고\s*[:\)]|\*|\#)\s*)+",
    re.IGNORECASE,
)

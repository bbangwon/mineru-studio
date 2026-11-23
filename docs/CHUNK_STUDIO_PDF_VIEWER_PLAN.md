# 청크 스튜디오 원본 PDF 뷰어 (원본 대조 모드) 구현 계획서

- **작성일**: 2026-11-23
- **작업 브랜치**: `feat/chunk-studio-pdf-viewer` (기준: `main` @ `28d2dd4`)
- **대상 프로젝트**: `mineru-studio` (FastAPI + React 19 + Tailwind CSS v4 + `pypdfium2` / `Pillow`)

---

## 1. 개요 및 설계 목표

### 1.1 배경 및 현황 진단
현재 Chunk Studio(`frontend/src/components/ChunkStudio.tsx`)는 `lg:grid-cols-12` 기반 3열 구조(`1열 HierarchyPane: 3/12`, `2열 ChunkListPane: 4/12`, `3열 ChunkEditorPane: 5/12`)로 운영되며, 스튜디오 내부에서 원본 PDF를 바로 대조할 수 있는 뷰어가 부재합니다. 이로 인해 OCR 오탈자, 표 병합 구조, 페이지 번호 귀속(`page_number` ~ `page_end`)을 검수하려면 외부 PDF 뷰어를 별도로 열어 수동으로 페이지를 찾아가야 하는 불편이 있습니다.

코드베이스 및 워크스페이스 실데이터를 점검한 결과는 다음과 같습니다.

1. **기존 PDF 서빙 엔드포인트의 한계 (`backend/app/routers/pdf.py`)**:
   * `GET /api/pdf`가 이미 구현되어 있으나 프론트엔드에서 미사용 중이며, `job_manager.get_active_pdf_path()` 전역 상태에만 의존하므로 `filename` 쿼리 파라미터로 특정 문서를 명시적으로 지정할 수 없습니다.
2. **대용량 PDF 실존에 따른 브라우저 직접 렌더링 부담**:
   * 워크스페이스 `pdfs/` 디렉터리에는 수백 MB 단위의 도록·보고서 PDF가 포함되어 있습니다.
     * `국립광주박-신안해저문화재 조사보고 총서4-백자-2023.pdf`: 281MB / 231페이지
     * `신안해저선에서 찾아낸 것들 - 도록.pdf`: 42MB / 194페이지
     * `국립광주박물관 도자문화관 가이드북_261029.pdf`: 13MB / 39페이지
     * `도자문화관 가이드북 신안해저도자_10.30..pdf`: 13MB / 39페이지
     * `[보도자료]국립박물관 최초의 도자 전문 전시관‘도자문화관’12월 18일 공개_m.pdf`: 1.6MB / 8페이지
   * 단순 `<iframe>` 또는 전체 PDF 바이너리 로드 방식은 281MB 문서에서 초기 로딩 지연·브라우저 메모리 점유를 유발하고, `#page=N` 프래그먼트 동적 전환 시 브라우저별 동기화 오작동이 발생하기 쉽습니다.
3. **서버측 고속 단일 페이지 렌더링 인프라 이미 구비**:
   * `.venv`에 `pypdfium2` 및 `Pillow`(WebP 코덱 지원 확인 완료)가 이미 설치되어 있어 추가 패키지 도입 없이 단일 페이지 이미지 렌더링이 가능합니다.
   * 실제 보유 PDF 대상 벤치마크 결과 281MB PDF에서도 `open=4.3ms`, `1페이지 렌더링(scale=1.5)=154.3ms`, 일반 PDF는 `5.2~21.8ms` (스캔/고밀도 105.1ms) 수준으로 즉각 응답이 가능합니다.
4. **페이지 자동 연동 메타데이터 완비**:
   * 모든 `ChildChunk`(`frontend/src/types/index.ts`)에 1-based `page_number` 및 선택적 `page_end`가 이미 존재하므로, 별도 데이터 마이그레이션 없이 청크 선택과 원본 PDF 페이지 이동을 즉시 연동할 수 있습니다.

### 1.2 확정된 아키텍처 및 UX 원칙
1. **A안 채택 — 서버측 단일 페이지 이미지 렌더링 (`pypdfium2` → WebP) + 새 탭 원본 열기**:
   * 대용량 PDF도 전체 파일을 내려받지 않고 현재 필요한 1페이지만 렌더링해 즉시 표시하며, 인접 페이지 백그라운드 프리페치로 페이지 넘김 체감 지연을 제거합니다.
   * 원본 PDF 내 텍스트 드래그 복사나 `Ctrl+F` 검색이 필요한 예외 상황을 위해 뷰어 툴바에 **새 탭에서 원본 PDF 열기**(`/api/pdf?filename=...#page=N`) 버튼을 제공합니다.
2. **3열 에디터 우측 위치 유지 — `[좌측 슬림 레일 | 원본 PDF 뷰어 | 3열 에디터]`**:
   * PDF 대조 모드 진입 시 1·2열(`HierarchyPane`, `ChunkListPane`)은 자동 접히고, 그 자리에 원본 PDF 뷰어가 배치됩니다.
   * 3열 에디터는 기존 우측 자리를 그대로 유지하면서 오히려 폭이 넓어지므로(기존 `5/12 ≈ 42%` → 기본 `50%`, `30~70%` 드래그 조절) 레이아웃 깨짐 없이 편안하게 대조 편집할 수 있습니다.
3. **1·2열 임시 오버레이 드로어 복귀 & 연속 검수 동선**:
   * PDF 대조 모드 중 좌측 슬림 레일(`40px`)의 `1열 트리` / `2열 목록` 아이콘 클릭 시 기존 `HierarchyPane` / `ChunkListPane`을 임시 오버레이 드로어로 띄워 섹션·청크를 탐색하고 점프할 수 있습니다(Child 청크 선택, 백드롭 클릭, `Esc` 시 자동 닫힘).
   * 1·2열을 열지 않고도 연속 검수가 가능하도록 `ChunkEditorPane` 헤더에 **`◀ 이전 | N/M | 다음 ▶`** 청크 순차 이동 컨트롤을 제공합니다.
4. **좌측 전역 `SidebarNav` 자동 접힘 연동**:
   * PDF 대조 모드 진입 시 좌측 전역 `SidebarNav`(`w-60` 240px → `w-16` 64px)가 펼쳐져 있으면 자동으로 접어 가로 폭 `176px`를 추가 확보하고, PDF 모드를 닫으면 진입 전 접힘 상태로 복원합니다.
5. **향후 확장성 고려**:
   * `PdfViewerPane`을 독립 컴포넌트로 설계하고 `highlightBboxes` 확장 포인트를 예약해 두어, 추후 `feat/image-chunk-vlm`의 `bbox`(0~1000 정규화 좌표) 하이라이트 오버레이나 `TableEditorModal` 원본 대조 등에도 손쉽게 재사용할 수 있도록 합니다.

---

## 2. API 및 데이터/상태 인터페이스 설계

### 2.1 백엔드 REST API 명세 (`backend/app/routers/pdf.py`)

#### ① `GET /api/pdf/page-image` (신규)
> **라우팅 순서 주의**: `@router.delete("/{filename}")`보다 **반드시 상단**에 등록해 경로 충돌/섀도잉을 방지합니다.

* **Query Parameters**:
  * `page: int = Query(1, ge=1)` — 1-based 대상 페이지 번호
  * `filename: Optional[str] = Query(None)` — PDF 파일명 또는 상대 경로(`find_pdf_path()`로 NFC/NFD 및 서브폴더 탐색, 미지정 시 `job_manager.get_active_pdf_path()` fallback)
  * `dpi: int = Query(150, ge=72, le=300)` — 렌더링 해상도 (`72~300` DPI)
  * `fmt: Literal["webp", "png"] = Query("webp")` — 출력 이미지 포맷
* **Response**:
  * `200 OK`: `Response(content=image_bytes, media_type="image/webp" | "image/png")`
  * Headers:
    * `Cache-Control: private, max-age=3600`
    * `X-PDF-Total-Pages: <전체 페이지 수>`
    * `X-PDF-Page: <렌더링된 1-based 페이지 번호>`
* **Error Responses**:
  * `404 Not Found`: 대상 PDF 파일을 찾을 수 없는 경우
  * `400 Bad Request`: 요청한 `page`가 문서 전체 페이지 수(`total_pages`)를 초과한 경우 (`1 <= page <= total_pages` 위반)
  * `422 Unprocessable Entity`: `page < 1`, `dpi` 범위 초과, 허용되지 않은 `fmt`

#### ② `GET /api/pdf` (기존 보강)
* **기존**: `@router.get("")`가 파라미터 없이 `job_manager.get_active_pdf_path()`만 사용.
* **변경**: `filename: Optional[str] = Query(None)` 파라미터 추가.
  * `filename`이 전달되면 `find_pdf_path(filename)`으로 탐색하고, 없으면 404 반환.
  * `filename`이 생략되면 기존대로 `job_manager.get_active_pdf_path()` 사용(하위 호환 100% 유지).
  * `FileResponse(pdf_path, media_type="application/pdf")` 반환으로 브라우저 새 탭 inline 열람 및 `#page=N` 점프 지원.

### 2.2 백엔드 렌더링 서비스 (`backend/app/services/pdf_render_svc.py`)

1. **스레드 안전성 보호 (`threading.Lock`)**:
   * `pypdfium2`(PDFium C++ 라이브러리)는 멀티스레드 동시 접근에 안전하지 않으므로, 모듈 전역 `_PDFIUM_LOCK = threading.Lock()`으로 `PdfDocument` open / page load / render / close 구간을 보호합니다.
   * 프론트엔드 인접 페이지 프리페치로 동일 시점에 여러 요청이 들어와도 크래시 없이 순차·안전 처리됩니다.
2. **인메모리 LRU 캐시 (`collections.OrderedDict`)**:
   * 최대 보관 수량 `MAX_CACHE_ITEMS = 48` (LRU eviction).
   * 캐시 키: `(str(pdf_path.resolve()), stat.st_mtime_ns, page, dpi, fmt)`.
   * 동일 페이지 재조회 및 앞뒤 페이지 왕복 시 `0ms`대에 즉시 반환되며, PDF 파일이 덮어쓰기/재업로드되어 `mtime_ns`가 바뀌면 캐시가 자동 무효화됩니다.
3. **리소스 누수 방지 및 비블로킹 서빙**:
   * `try ... finally` 블록에서 `bitmap.close()`, `page_obj.close()`, `doc.close()`를 명시적으로 호출합니다.
   * `dpi / 72.0` 배율로 `page_obj.render(scale=dpi / 72.0)` 후 Pillow `Image`를 `webp(quality=85, method=4)` 또는 `png` 바이트로 직렬화합니다.
   * `GET /api/pdf/page-image` 핸들러는 동기 `def`로 정의하여 FastAPI가 워커 스레드풀에서 실행하도록 합니다(이벤트 루프 블로킹 방지).

### 2.3 프론트엔드 상태 & Props 인터페이스

#### ① `App.tsx` → `ChunkStudio` Props 확장
* `activePdf?: string` — `selectedPdf` 전달
* `totalPages?: number` — `etlData?.total_pages` 또는 `pdfList.find((p) => p.filename === selectedPdf)?.total_pages` 전달
* `onPdfModeChange?: (isOpen: boolean) => void` — PDF 대조 모드 진입/종료 시 좌측 전역 `SidebarNav` 자동 접힘/복원 제어용 콜백
  * `App.tsx` 내부에 `sidebarCollapsedBeforePdfRef = useRef<boolean | null>(null)`를 두어, PDF 모드를 켤 때 현재 `isSidebarCollapsed` 값을 기억하고 `false`였다면 `true`로 전환, PDF 모드를 끌 때(또는 `studio` 탭을 벗어날 때) 저장된 원래 상태로 복원합니다.

#### ② `ChunkStudio` 신규 상태 및 영속성
* `isPdfViewerOpen: boolean` (기본 `false`) — 원본 대조 모드 활성화 여부
* `pdfOverlayPane: 'tree' | 'list' | null` (기본 `null`) — PDF 모드 중 임시 오버레이로 열린 패널
* `pdfSplitRatio: number` (기본 `50`, 허용 범위 `30~70`) — 좌측 PDF 뷰어 폭 비율(`%`). `localStorage` 키 `mineru_pdf_split_ratio`로 유지
* `pdfCurrentPage: number` (기본 `1`) — 현재 PDF 뷰어에 표시 중인 1-based 페이지 번호
* `isPdfPageSynced: boolean` (기본 `true`) — 청크 선택 변경 시 `activeChunk.page_number`로 자동 동기화 여부
* `mobileTab: 'tree' | 'list' | 'editor' | 'pdf'` — `< lg` 반응형 탭에 `'pdf'` 추가

#### ③ `ChunkStudioContext` 확장 필드
* PDF 상태/제어: `activePdf`, `pdfTotalPages`, `isPdfViewerOpen`, `setIsPdfViewerOpen`, `togglePdfViewer`, `openPdfAtPage(page: number)`
* 오버레이/네비게이션: `pdfOverlayPane`, `setPdfOverlayPane`, `closePdfOverlay`
* 청크 순차 이동: `activeChunkIndex`, `filteredChunksCount`, `goToPrevChunk`, `goToNextChunk`

---

## 3. UI/UX 레이아웃 및 인터랙션 설계

### 3.1 화면 전환 구조 (Desktop `lg:` 이상)

```text
[일반 모드: 기존 3열 (!isPdfViewerOpen)]
┌────┬──────────────┬──────────────────┬───────────────────────┐
│사이드│  1열: 계층   │   2열: 청크 목록  │     3열: 에디터        │
│ 바  │   (3/12)     │     (4/12)       │       (5/12)          │
└────┴──────────────┴──────────────────┴───────────────────────┘

[원본 대조 모드 (isPdfViewerOpen)]
┌──┬──┬──────────────────────────║─────────────────────────────┐
│사│레│   원본 PDF 뷰어 (50%)     ║   3열: 에디터 (50%)          │
│이│일│  [< p.3/39 >] [폭맞춤/+/-]║  [◀ 이전 | 3/42 | 다음 ▶]     │
│드│  │  [p.3][p.4] [🔗연동][새탭]║  [PDF 닫기] [분할][삭제]     │
│  │트│                          ║                             │
│접│리│   (원본 PDF 페이지 이미지) ║   청크 본문 / 표 / 메타 편집  │
│힘│목│                          ║                             │
│  │록│                          ║                             │
└──┴──┴──────────────────────────║─────────────────────────────┘
      ↑                          ↑
  클릭 시 1·2열              드래그 리사이즈 핸들
  임시 오버레이 드로어        (30% ~ 70%, 더블클릭 50%)

[임시 오버레이 열림 (pdfOverlayPane === 'tree' | 'list')]
┌──┬──┬─────────────────────┬────║─────────────────────────────┐
│사│레│  오버레이: 1열/2열   │반투║   3열: 에디터 (50%)          │
│이│일│  (기존 Pane 재사용) │명  ║                             │
│드│  │  • 섹션 필터/트리    │백드║  청크 선택 시 오버레이       │
│  │  │  • 청크 클릭 시 점프 │롭  ║  자동 닫힘 & PDF 페이지 연동  │
└──┴──┴─────────────────────┴────║─────────────────────────────┘
```

### 3.2 `PdfViewerPane` 툴바 및 뷰포트 기능 (`frontend/src/components/chunk-studio/PdfViewerPane.tsx`)
1. **페이지 네비게이션**:
   * `이전(<)` 버튼, 직접 페이지 번호 입력(`input type="number"`, Enter/Blur 시 `1~totalPages` 클램핑 이동), `/ {totalPages}`, `다음(> )` 버튼.
   * **다중 페이지 청크 빠른 점프 칩**: 현재 활성 청크의 `page_end > page_number`인 경우(예: `p.3~p.5`), 툴바 하단 보조 줄 또는 인라인에 `[p.3] [p.4] [p.5]` 칩을 표시해 걸친 페이지를 원클릭으로 오갈 수 있습니다(긴 범위는 최대 6개 노출 후 축약).
2. **청크 ↔ PDF 페이지 스마트 동기화**:
   * **자동 연동 토글(`Link2` / `Unlink2`)**:
     * `ON`(기본): 2열·오버레이·`이전/다음`으로 다른 청크를 선택하면 즉시 `activeChunk.page_number` 페이지로 이동.
     * `OFF`: 사용자가 PDF 앞뒤 페이지를 자유롭게 탐색하는 동안 다른 청크를 눌러도 현재 보고 있던 PDF 페이지가 바뀌지 않음.
   * **수동 이탈 시 복귀 버튼**: 연동이 `ON`이더라도 사용자가 뷰어 내에서 직접 다른 페이지(예: `p.10`)를 둘러보고 있다면, `"현재 청크(p.3)로"` 원클릭 복귀 배지 버튼이 노출됩니다.
3. **확대/축소 및 고해상도 자동 전환**:
   * 모드: `폭 맞춤(Fit)` (기본, `w-full h-auto`), `75%`, `100%`, `125%`, `150%`, `200%` 및 `-` / `+` 스텝 버튼.
   * 기본 배율(`Fit` ~ `125%`)에서는 `dpi=150`을 요청해 빠른 응답을 유지하고, `150%` 이상 확대 시 자동으로 `dpi=220` 고해상도 이미지를 요청해 작은 글씨·표 선명도를 확보합니다.
4. **인접 페이지 프리페치 & 부드러운 전환**:
   * 현재 페이지 `p` 로드 시 `p + 1` 및 `p - 1`의 이미지 URL을 백그라운드 `new Image()`로 미리 캐싱해 다음 페이지 전환이 즉각 이루어집니다.
   * 새 페이지 로딩 중에는 이전 페이지 이미지를 살짝 흐리게(`opacity-60`) 유지한 채 우상단/중앙 미니 스피너만 표시해 흰 화면 깜빡임을 방지합니다.
   * 네트워크/렌더링 오류 시 안내 메시지와 `다시 시도` 버튼을 제공합니다.
5. **보조 액션**:
   * **새 탭에서 원본 PDF 열기** (`<a href="/api/pdf?filename=...#page=N" target="_blank" rel="noopener noreferrer">`)
   * **닫기(`X`)**: 일반 3열 모드로 즉시 복귀.
6. **향후 `bbox` 확장 포인트**:
   * Props에 선택적 `highlightBboxes?: Array<{ bbox: number[]; label?: string }>` 인터페이스를 예약해 두어, 향후 이미지 청크/블록 좌표 하이라이트 오버레이 레이어를 페이지 이미지 위에 정확히 겹쳐 올릴 수 있습니다.

### 3.3 좌측 슬림 레일, 드래그 리사이저, 임시 오버레이 드로어
1. **좌측 슬림 레일 (`w-10 shrink-0`)**:
   * `1열 트리` (`Network` 아이콘): 클릭 시 `pdfOverlayPane`을 `'tree'`로 토글.
   * `2열 목록` (`Layers` 아이콘 + 필터된 청크 수 배지): 클릭 시 `pdfOverlayPane`을 `'list'`로 토글.
   * `3열 복귀` (`Columns3` / `PanelLeftOpen` 아이콘): PDF 대조 모드를 종료하고 기본 3열 에디터로 복귀.
2. **드래그 리사이즈 핸들 (`w-1.5 cursor-col-resize`)**:
   * 마우스 드래그(`pointerdown` → `window` `pointermove`/`pointerup`)로 PDF 뷰어 폭을 `30% ~ 70%` 범위에서 실시간 조절합니다.
   * 드래그 중 PDF/에디터 텍스트가 우발적으로 선택되지 않도록 `select-none` 적용.
   * 핸들 더블클릭 시 기본 `50%` 비율로 초기화됩니다.
3. **임시 오버레이 드로어 (`absolute inset-y-0 left-10 z-30`)**:
   * 레일 바로 우측에 그림자(`shadow-2xl`)가 있는 슬라이드 오버레이(`1열 트리: w-[340px] sm:w-[400px]`, `2열 목록: w-[380px] sm:w-[440px]`)로 기존 `HierarchyPane` 또는 `ChunkListPane`을 그대로 렌더링합니다.
   * 나머지 영역을 덮는 반투명 백드롭 클릭 또는 `Esc` 키로 닫힙니다.
   * **자동 닫힘 UX 규칙**:
     * 1열 트리에서 **섹션 헤더**를 클릭해 필터링하거나 트리를 접고 펼칠 때는 오버레이를 유지해 연속 탐색을 허용하고, **최하위 Child 청크**를 클릭해 편집 대상으로 선택할 때는 오버레이를 자동으로 닫고 PDF를 해당 페이지로 이동합니다.
     * 2열 목록에서 **Child 청크 카드**를 클릭해 선택하면 오버레이를 자동으로 닫습니다. (검색·필터 버튼 조작 시에는 유지)

### 3.4 `ChunkEditorPane` 통합, 단축키 및 반응형
1. **에디터 헤더 확장 (`ChunkEditorPane.tsx`)**:
   * 우측 액션 영역에 **`원본 PDF`** 토글 버튼 추가 (`isPdfViewerOpen` 상태에 따라 활성 강조 표시).
   * 청크 부제목의 `Page 3` / `Page 3~5` 텍스트를 클릭 가능한 버튼으로 개선해, 클릭 시 해당 페이지로 원본 PDF 뷰어를 바로 엽니다(`openPdfAtPage(activeChunk.page_number || 1)`).
   * PDF 모드 활성화 시 헤더에 컴팩트한 청크 순차 이동 바 **`[◀] 3 / 42 [▶]`** 표시(첫/마지막 청크에서는 비활성화).
2. **키보드 단축키 (`ChunkStudio.tsx`)**:
   * `Alt + P`: 원본 PDF 대조 모드 ON/OFF 토글.
   * `Escape`: 임시 오버레이 드로어가 열려 있으면 오버레이만 우선 닫음.
   * `<input>`, `<textarea>`, `<select>`, `[contenteditable="true"]`에 포커스가 있을 때는 단축키가 입력을 방해하지 않도록 무시합니다(단, `Escape`로 오버레이 닫기는 허용).
3. **모바일/태블릿 반응형 (`< lg`)**:
   * 기존 상단 탭바(`1. 계층구조 | 2. 목록 | 3. 에디터`) 우측에 `4. PDF` 탭을 추가합니다.
   * 모바일에서는 1열/2열/3열/PDF 중 선택된 탭이 전체 화면으로 전환되며, 에디터에서 `원본 PDF` 버튼 클릭 시 `mobileTab`을 `'pdf'`로 전환합니다.

---

## 4. Phase별 상세 구현 계획

### Phase 1: 백엔드 페이지 렌더링 서비스 및 API 구현 (`backend/`)
1. `backend/app/services/pdf_render_svc.py` 신규 작성:
   * `render_pdf_page(pdf_path: Path, page: int, dpi: int = 150, fmt: Literal["webp", "png"] = "webp") -> PdfRenderResult`
   * `_PDFIUM_LOCK` 동시성 보호, `OrderedDict` LRU 캐시(`MAX_CACHE_ITEMS = 48`), `mtime_ns` 무효화, 페이지 범위 초과 시 명시적 예외(`ValueError` 또는 HTTP 변환용 커스텀 예외) 발생.
2. `backend/app/routers/pdf.py` 수정:
   * `GET /api/pdf/page-image` 엔드포인트 추가 (`@router.delete("/{filename}")` 위쪽에 배치).
   * 기존 `GET /api/pdf`에 `filename: Optional[str] = None` 쿼리 파라미터 추가 및 `find_pdf_path()` 연동.
3. `backend/tests/test_pdf_viewer_api.py` 신규 작성:
   * 유효 PDF WebP/PNG 렌더링, 응답 헤더(`X-PDF-Total-Pages`, `X-PDF-Page`, `Cache-Control`), 페이지 초과(`400`), 파일 미존재(`404`), 한글 파일명(NFC/NFD), 병렬 스레드 동시 요청 안정성, `GET /api/pdf?filename=...` 동작 검증.

### Phase 2: 프론트엔드 API 헬퍼 및 상위 App 연동 (`frontend/src/api/`, `frontend/src/App.tsx`)
1. `frontend/src/api/client.ts` 수정:
   * `getPdfPageImageUrl({ filename, page, dpi, fmt })` 빌더 함수 추가.
   * `getOriginalPdfUrl(filename?: string, page?: number)` 빌더 함수 추가 (`#page=N` 포함).
2. `frontend/src/App.tsx` 수정:
   * `ChunkStudio`에 `activePdf={selectedPdf}`, `totalPages={...}`, `onPdfModeChange={handlePdfModeChange}` 전달.
   * `handlePdfModeChange` 콜백으로 `SidebarNav` 자동 접힘/원복 및 `activeTab !== 'studio'` 전환 시 사이드바 복원 처리.

### Phase 3: `PdfViewerPane` 컴포넌트 구현 (`frontend/src/components/chunk-studio/PdfViewerPane.tsx`)
1. 독립형 PDF 페이지 뷰어 컴포넌트 작성:
   * 툴바(페이지 이동·입력, 다중 페이지 청크 점프 칩, 자동 연동 토글 및 `"현재 청크(p.N)"` 복귀, 확대/축소 + 고DPI 자동 전환, 새 탭 원본 열기, 닫기).
   * 뷰포트(스크롤 가능한 캔버스 영역, 다크/라이트 모드 대응, 로딩 오버레이, 오류 재시도, 인접 페이지 프리페치).
   * 향후 `bbox` 하이라이트 오버레이를 위한 선택적 `highlightBboxes` prop 구조 반영.

### Phase 4: `ChunkStudio` 레이아웃 통합 및 기존 패널 연동 (`frontend/src/components/`)
1. `frontend/src/components/ChunkStudio.tsx` 수정:
   * PDF 모드 상태(`isPdfViewerOpen`, `pdfOverlayPane`, `pdfSplitRatio`, `pdfCurrentPage`, `isPdfPageSynced`) 및 청크 선택/문서 전환 동기화 `useEffect` 추가.
   * `activeChunkIndex`, `goToPrevChunk`, `goToNextChunk`, `openPdfAtPage` 구현 및 `ChunkStudioContext` 공급.
   * Desktop `lg:` 분기 레이아웃(기존 `grid-cols-12` 3열 vs `[슬림 레일 | PdfViewerPane | 리사이즈 핸들 | ChunkEditorPane]` + `pdfOverlayPane` 드로어) 및 Mobile `< lg` `4. PDF` 탭 구현.
   * `Alt+P` / `Esc` 키보드 단축키 등록.
2. `frontend/src/components/chunk-studio/ChunkEditorPane.tsx` 수정:
   * 헤더 `원본 PDF` 토글 버튼, `Page N` 클릭 연동, PDF 모드 시 `[◀] N / M [▶]` 이전/다음 청크 컨트롤 추가.
   * PDF Split 모드일 때 `lg:col-span-*` 대신 `flex-1 min-w-0`으로 배치되도록 클래스 분기.
3. `frontend/src/components/chunk-studio/HierarchyPane.tsx` & `ChunkListPane.tsx` 수정:
   * `isOverlayMode?: boolean` / `onCloseOverlay?: () => void` (또는 Context `pdfOverlayPane` 참조)를 통해 오버레이 드로어 내부 렌더링 시 `lg:hidden`·`lg:col-span-*` 클래스를 제거하고 전체 폭(`w-full h-full flex`)으로 표시, 상단 닫기(`X`) 버튼 제공.
   * 오버레이 모드에서 Child 청크 클릭 시 자동으로 오버레이 닫힘 연동.

### Phase 5: 통합 검증 및 빌드 테스트
1. 백엔드 pytest 실행 및 통과 확인.
2. 프론트엔드 lint(`oxlint`) 및 TypeScript + Vite 프로덕션 빌드(`tsc -b && vite build`) 통과 확인.
3. 실데이터 PDF(대용량 281MB 포함) 대상 렌더링·오버레이·리사이즈 스모크 테스트.

---

## 5. 변경 대상 파일 매트릭스

| 구분 | 파일 경로 | 역할 및 변경 내용 |
| :--- | :--- | :--- |
| **백엔드 (신규)** | `backend/app/services/pdf_render_svc.py` | `pypdfium2` 기반 단일 페이지 WebP/PNG 렌더링, `threading.Lock` 보호, LRU 캐시 |
| **백엔드 (수정)** | `backend/app/routers/pdf.py` | `GET /api/pdf/page-image` 추가(라우팅 상단 배치), `GET /api/pdf?filename=...` 지원 |
| **테스트 (신규)** | `backend/tests/test_pdf_viewer_api.py` | 페이지 렌더링, 헤더, 에러 코드, 한글 파일명, 병렬 동시성, 원본 서빙 테스트 |
| **프론트 (수정)** | `frontend/src/api/client.ts` | `getPdfPageImageUrl()`, `getOriginalPdfUrl()` 헬퍼 추가 |
| **프론트 (수정)** | `frontend/src/App.tsx` | `ChunkStudio`에 `activePdf`, `totalPages`, `onPdfModeChange`(사이드바 자동 접힘) 연동 |
| **프론트 (신규)** | `frontend/src/components/chunk-studio/PdfViewerPane.tsx` | PDF 페이지 이미지 뷰어, 줌/고DPI 전환, 페이지 점프, 프리페치, 청크 동기화 UI |
| **프론트 (수정)** | `frontend/src/components/ChunkStudio.tsx` | Split View 레이아웃, 좌측 슬림 레일, 드래그 리사이저, 임시 오버레이, 단축키, 모바일 PDF 탭 |
| **프론트 (수정)** | `frontend/src/components/chunk-studio/ChunkEditorPane.tsx` | 헤더 `원본 PDF` 토글, `Page N` 클릭 열기, 이전/다음 청크 이동 바, flex 레이아웃 분기 |
| **프론트 (수정)** | `frontend/src/components/chunk-studio/HierarchyPane.tsx` | 임시 오버레이 드로어 내부 풀폭 렌더링, 닫기 버튼, Child 선택 시 오버레이 자동 닫힘 |
| **프론트 (수정)** | `frontend/src/components/chunk-studio/ChunkListPane.tsx` | 임시 오버레이 드로어 내부 풀폭 렌더링, 닫기 버튼, 청크 선택 시 오버레이 자동 닫힘 |

---

## 6. 테스트 및 검증 계획

1. **백엔드 단위·통합 테스트 (`pytest`)**:
   * 실행 명령: `.venv/bin/pytest backend/tests/test_pdf_viewer_api.py backend/tests/test_pdf_deletion.py`
   * 검증 항목:
     * 유효 PDF 페이지 `webp` / `png` 바이너리 응답 및 `X-PDF-Total-Pages`, `X-PDF-Page` 헤더 일치
     * `page > total_pages` 요청 시 `400`, 미존재 파일 요청 시 `404`, 잘못된 파라미터(`page=0`, `dpi=50`) 시 `422`
     * 한글 파일명 NFC/NFD 및 서브폴더 경로 정상 조회
     * `ThreadPoolExecutor` 기반 동시 다중 페이지 요청 시 예외/크래시 없음
     * `GET /api/pdf?filename=...` 지정 문서 서빙 및 미지정 시 활성 문서 fallback
2. **프론트엔드 정적 검사 및 프로덕션 빌드**:
   * 실행 명령: `cd frontend && npm run lint && npm run build`
   * `oxlint` 및 `tsc -b`(Strict `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` 포함) + Vite 번들 오류 0 확인.
3. **실데이터 스모크 검증**:
   * 실제 대용량 PDF(`국립광주박-신안해저문화재 조사보고 총서4-백자-2023.pdf` 281MB 등) 선택 후 스튜디오에서 PDF 대조 모드 진입 → 페이지 전환 체감 속도, 리사이즈 드래그, 1·2열 오버레이 열기/자동 닫힘, 다크/라이트 테마 UI, `새 탭에서 원본 PDF 열기` 동작 확인.

---

## 7. 주요 리스크 및 대응 방안

| 리스크 | 영향 | 대응 방안 |
| :--- | :--- | :--- |
| `pypdfium2` 멀티스레드 비안전성 | 프리페치 동시 요청 시 C++ 레벨 세그폴트/크래시 가능 | `_PDFIUM_LOCK`으로 PDFium open/render/close 임계구역 직렬화 및 `try ... finally` 명시적 자원 해제 |
| FastAPI 라우트 섀도잉 | `/api/pdf/page-image`가 동적 경로 파라미터와 충돌할 위험 | `GET /api/pdf/page-image`를 `@router.delete("/{filename}")`보다 상단에 정의하고 통합 테스트로 검증 |
| `lg:col-span-*` 클래스와 Split/오버레이 레이아웃 충돌 | 에디터나 오버레이 패널 폭이 틀어지거나 숨겨짐 | 일반 3열 모드(`grid-cols-12`)와 PDF 대조 모드(`flex`) 및 오버레이 모드(`w-full h-full`)별로 명시적으로 클래스 분기 |
| 문서 전환(`activePdf` 변경) 시 이전 페이지 잔존 | 다른 PDF를 열었는데 이전 문서 페이지/오버레이가 유지됨 | `activePdf` 변경을 감지하는 `useEffect`에서 `pdfOverlayPane` 닫기 및 현재 활성 청크 페이지로 재동기화 |
| 향후 `feat/image-chunk-vlm` 병합 시 기능 결합 | 이미지 청크 `bbox` 하이라이트 연동 시 뷰어 재수정 필요 | `PdfViewerPane`에 `highlightBboxes` 선택 prop 및 상대 좌표 오버레이 컨테이너 구조를 미리 설계해 무충돌 결합 지원 |

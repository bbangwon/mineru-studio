# 이미지 청크 · Parent-Child 연계(방식 B) · VLM 설명 자동 생성 구현 계획서

- **작성일**: 2026-11-23 (최종 수정일: 2026-11-24 — `pdf-viewer` 반영 최신화)
- **작업 브랜치**: `feat/image-chunk-vlm` (기준: `main` @ `6deab10`, 원본 PDF 뷰어 반영 이후)
- **대상 프로젝트**: `mineru-studio` (FastAPI + React SPA + `rag_embed_core` / Qdrant Embedded·Remote + Ollama OpenAI 호환 API)

---

## 1. 개요 및 설계 목표

### 1.1 배경 및 현재 파이프라인 진단
『도자문화관 가이드북 신안해저도자_10.30..pdf』의 MinerU 4.x 파싱 결과(`output/mineru_basic_auto_korean/도자문화관 가이드북 신안해저도자_10.30./auto/도자문화관 가이드북 신안해저도자_10.30._content_list_v2.json`)를 분석한 결과, 총 39페이지에 `paragraph` 138개, `title` 37개, **`image` 109개**, `table` 1개 등이 존재하며 시각 자료가 문서 정보의 핵심 비중을 차지합니다. 그러나 현재 파이프라인은 다음 세 지점에서 이미지 자료가 탈락하고 있습니다.

1. **청킹 전략 (`backend/app/services/chunker/strategies/general.py`, `legal.py`)**: `b_type == "image"` 처리 분기가 없어 109장의 이미지가 모두 스킵됩니다. 이로 인해 `요지 지도` 섹션(`doc_261fa20eb14d5ceba36c822f8a003e88_s12`)처럼 이미지 단독 섹션이 빈 섹션으로 남습니다.
2. **정합성·재색인·JSONL 익스포트 (`reindexer.py`, `jsonl_exporter.py`)**: `image_path`, `image_url`, `has_image` 속성을 `pop()`으로 제거하고 있으며, `tables[]`와 같은 구조화된 이미지 배열 필드가 없습니다.
3. **임베딩·Qdrant 적재 (`embedding_svc.py`)**: `reserved_keys`에서 이미지 키를 배제할 뿐 Qdrant Payload에 이미지 배열 및 Parent 이미지 참조 정보를 담지 않습니다.

또한 해당 가이드북 PDF의 109개 이미지 중 MinerU가 `image_caption`으로 직접 묶어준 항목은 3개뿐(`image_footnote` 35개, `<150px` 소형 이미지 2개)이며, 유물명·크기·유물번호 등 핵심 설명은 대부분 이미지 인접 `paragraph` 블록에 별도로 위치해 있습니다.

### 1.2 확정된 아키텍처 원칙
1. **Child Chunk (`images[]` + 설명 결합)**: 이미지와 이미지 설명(캡션 + 원문 설명 + VLM 시각 설명)을 하나의 Child Chunk로 구성하고, 기존 `tables[]`와 100% 대칭되는 `images[]` 배열을 클라이언트에 함께 전달합니다.
2. **Parent Chunk (`[이미지: ...]` 표식 + 설명만 승격)**: LLM 답변 참고자료로 쓰이는 `ParentChunk.text`에는 무거운 경로나 바이너리를 넣지 않고, `[이미지: 캡션 (p.N)]\n설명 텍스트` 형식으로 **"이미지가 존재한다는 표식 + 텍스트 설명"**만 올립니다.
3. **방식 B (Child `images[]` + 경량 `parent_images[]` 동시 적재)**: Child 자체의 `images[]`뿐 아니라, 해당 Child가 속한 Parent 내 모든 이미지의 경량 참조(`parent_images[]`)를 JSONL 및 Qdrant Payload에 함께 저장합니다. 이를 통해 **텍스트 Child만 검색되고 이미지 Child가 Top-K에 포함되지 않더라도**, LLM이 `parent_text`를 근거로 답변할 때 클라이언트가 관련 이미지의 페이지·좌표(`bbox`)·캡션을 즉시 활용할 수 있습니다.
4. **원본 PDF 기반 열람 지원**: 클라이언트에서 원본을 보여줄 때는 별도 크롭 이미지 배포에 의존하지 않고, **원본 PDF의 해당 페이지(`page_number`) + MinerU 정규화 좌표(`bbox`, 0~1000)**로 바로 이동·하이라이트할 수 있게 합니다(`image_path`/`image_url`은 스튜디오 검수 및 선택적 썸네일 미리보기용으로 병행 유지).
5. **VLM 이미지 설명 초안 자동 생성**: 로컬 Ollama 멀티모달 API(및 OpenAI 호환 API 폴백)를 호출해 이미지 시각 설명 초안을 자동 생성하고, Chunk Studio에서 단건/일괄 생성 후 검수·편집할 수 있게 합니다.

---

## 2. 데이터 스키마 설계 (Single Source of Truth)

### 2.1 `EmbeddedImageItem` (Child 내 `images[]` 항목)
기존 `EmbeddedTableItem`과 100% 대칭되는 단일 이미지 엔티티 구조입니다.

| 필드 | 타입 | 설명 |
| :--- | :--- | :--- |
| `image_id` | `string` | 이미지 고유 ID (`{chunk_id}_i{idx+1}`, 재색인 시 자동 재부여) |
| `image_index` | `number` | 청크 내 0-based 순번 |
| `image_path` | `string` | MinerU 산출물 기준 상대 경로 (예: `"images/page_1_image_4.jpg"`) |
| `image_url` | `string?` | 스튜디오 정적 서빙 경로 (예: `"/output/mineru_basic_auto_korean/.../auto/images/page_1_image_4.jpg"`) |
| `caption` | `string?` | PDF에서 추출/매칭되거나 수동 편집한 이미지 캡션 |
| `footnote` | `string?` | PDF에서 추출되거나 수동 편집한 이미지 각주 |
| `description` | `string?` | VLM 자동 초안 또는 수동 작성한 시각 설명 |
| `page_number` | `number` | 1-based 페이지 번호 |
| `bbox` | `number[]?` | MinerU 0~1000 정규화 좌표 `[x0, y0, x1, y1]` (PDF 뷰어 위치 강조용) |
| `width` | `number?` | 이미지 원본 가로 픽셀 크기(선택) |
| `height` | `number?` | 이미지 원본 세로 픽셀 크기(선택) |
| `vlm_generated` | `boolean?` | VLM으로 초안이 생성된 설명인지 여부 |

### 2.2 `ParentImageRef` (방식 B 경량 참조 `parent_images[]` 항목)
텍스트 청크가 검색되었을 때 소속 Parent가 보유한 이미지를 클라이언트에 알리기 위한 경량 참조 객체입니다.

| 필드 | 타입 | 설명 |
| :--- | :--- | :--- |
| `image_id` | `string` | 원본 이미지 ID (`{image_chunk_id}_i{n}`) |
| `chunk_id` | `string` | 해당 이미지가 속한 Child Chunk ID |
| `caption` | `string?` | 이미지 제목/캡션 |
| `description` | `string?` | 짧은 시각 설명 요약(미리보기·툴팁·참고용) |
| `page_number` | `number` | 1-based 페이지 번호 |
| `bbox` | `number[]?` | MinerU 0~1000 정규화 좌표 `[x0, y0, x1, y1]` |
| `image_path` | `string` | MinerU 상대 경로 |
| `image_url` | `string?` | 스튜디오 정적 서빙 경로 |

### 2.3 `ChildChunk` & `ParentChunk` 확장 필드
* **`ChildChunk` 확장**:
  * `images?: EmbeddedImageItem[]` (기본 `[]`)
  * `has_images?: boolean`
  * `image_count?: number`
* **`ParentChunk` 확장**:
  * `images?: ParentImageRef[]` (소속 Child들의 이미지 집계 목록, 기본 `[]`)
  * `has_images?: boolean`
  * `image_count?: number`
  * `text` 조립 규칙(`engine.py` `_pack_to_parent_chunks()` 및 `useHierarchyMutations.ts`):
    * `table` 청크가 `[표: {cap}]\n...` 형식으로 올라가는 것과 동일하게, 이미지 포함 청크는 아래 형식으로 `ParentChunk.text`에 반영합니다.
    ```text
    [이미지: 청자 음각 모란무늬 긴목꽃병 (p.2)]
    청자 음각 모란무늬 긴목꽃병 靑磁陰刻牡丹文長頸花甁 중국 송-원 높이 45.0 신수 3319
    연녹색 유약의 긴 목 청자 꽃병으로, 목 부분에 가로 주름이 있고 몸통에 모란무늬가 음각되어 있다.
    ```
    * 복수 이미지가 한 청크에 병합된 경우 `[이미지: 캡션1 외 1건 (p.2)]` 형태로 간결하게 표기합니다.

### 2.4 `ChunkDisplayKind` 판별 규칙 (백엔드/프론트엔드 일치)
`backend/app/services/chunker/table_extractor.py`의 `get_chunk_kind()`와 `frontend/src/utils/chunkKindUtils.ts`의 `getChunkKind()`를 동일 기준으로 확장합니다.

* **판별 우선순위**:
  1. **`article`**: 조문 메타데이터(`article_no`, `article_number`) 또는 조문 breadcrumbs 존재 시
  2. **`composite`**:
     * `has_tables && has_images` (표와 이미지 동시 포함)
     * `has_tables && (has_body_text || table_count > 1)` (기존 복합 표 청크)
     * `has_images && has_non_image_body_text` (일반 본문 문단과 이미지가 병합된 청크)
  3. **`table`**: `has_tables && !has_images && !has_body_text` (단독 원형 표)
  4. **`image`**: `has_images && !has_tables && !has_non_image_body_text` (단독 이미지/도판 + 캡션·시각 설명 청크)
  5. **`paragraph`**: 기본 일반 문단

> **주의**: 단독 `image` 청크의 `text`에는 캡션과 시각 설명이 들어가는 것이 정상입니다. 기존 표 청크의 `has_body_text` 판별을 그대로 적용하면 이미지 설명 텍스트 때문에 단독 `image` 청크가 `composite`으로 오판될 수 있으므로, 이미지 청크 내부 생성 포맷(`**[이미지: ...]**`, `**[이미지 설명: ...]**`) 및 `images[]`의 `caption`/`footnote`/`description`과 일치하는 텍스트는 순수 본문에서 제외해 단독 `image` 청크가 정확히 `'image'`로 분류되도록 구현합니다.

### 2.5 JSONL 레코드 & Qdrant Payload 최종 스키마 예시 (방식 B)

#### 사례 ①: 이미지 Child Chunk가 직접 검색된 경우
```json
{
  "id": "doc_261fa20eb14d5ceba36c822f8a003e88_c0005",
  "doc_id": "doc_261fa20eb14d5ceba36c822f8a003e88",
  "doc_title": "도자문화관 가이드북 신안해저도자_10.30.",
  "source_pdf": "도자문화관 가이드북 신안해저도자_10.30..pdf",
  "parent_chunk_id": "doc_261fa20eb14d5ceba36c822f8a003e88_p0003",
  "section_id": "doc_261fa20eb14d5ceba36c822f8a003e88_s02",
  "section_title": "1. 14 세기 도자기와의 우연한 만남",
  "breadcrumbs": [
    "도자문화관 가이드북 신안해저도자_10.30.",
    "1. 14 세기 도자기와의 우연한 만남"
  ],
  "breadcrumbs_str": "도자문화관 가이드북 신안해저도자_10.30. > 1. 14 세기 도자기와의 우연한 만남",
  "text": "**[이미지: 청자 음각 모란무늬 긴목꽃병]**\n청자 음각 모란무늬 긴목꽃병 靑磁陰刻牡丹文長頸花甁 중국 송-원 높이 45.0 신수 3319\n[시각 설명] 연녹색 유약이 입혀진 긴 목의 청자 꽃병으로, 목에 가로 주름이 있고 몸통에 모란무늬가 음각되어 있으며 하단에는 연꽃잎 무늬가 둘러져 있다.",
  "parent_context_text": "[도자문화관 가이드북 신안해저도자_10.30. > 1. 14 세기 도자기와의 우연한 만남]\n...\n\n[이미지: 청자 음각 모란무늬 긴목꽃병 (p.2)]\n...",
  "page": 2,
  "pages": [2],
  "token_estimate": 92,
  "parent_token_estimate": 640,
  "images": [
    {
      "image_id": "doc_261fa20eb14d5ceba36c822f8a003e88_c0005_i1",
      "image_index": 0,
      "image_path": "images/page_1_image_4.jpg",
      "image_url": "/output/mineru_basic_auto_korean/도자문화관 가이드북 신안해저도자_10.30./auto/images/page_1_image_4.jpg",
      "caption": "청자 음각 모란무늬 긴목꽃병 靑磁陰刻牡丹文長頸花甁 중국 송-원 높이 45.0 신수 3319",
      "footnote": "",
      "description": "연녹색 유약이 입혀진 긴 목의 청자 꽃병으로, 목에 가로 주름이 있고 몸통에 모란무늬가 음각되어 있으며 하단에는 연꽃잎 무늬가 둘러져 있다.",
      "page_number": 2,
      "bbox": [235, 514, 410, 930],
      "vlm_generated": true
    }
  ],
  "parent_images": [
    {
      "image_id": "doc_261fa20eb14d5ceba36c822f8a003e88_c0005_i1",
      "chunk_id": "doc_261fa20eb14d5ceba36c822f8a003e88_c0005",
      "caption": "청자 음각 모란무늬 긴목꽃병 靑磁陰刻牡丹文長頸花甁 중국 송-원 높이 45.0 신수 3319",
      "description": "연녹색 유약이 입혀진 긴 목의 청자 꽃병...",
      "page_number": 2,
      "bbox": [235, 514, 410, 930],
      "image_path": "images/page_1_image_4.jpg",
      "image_url": "/output/mineru_basic_auto_korean/도자문화관 가이드북 신안해저도자_10.30./auto/images/page_1_image_4.jpg"
    }
  ],
  "metadata": {
    "doc_id": "doc_261fa20eb14d5ceba36c822f8a003e88",
    "doc_title": "도자문화관 가이드북 신안해저도자_10.30.",
    "type": "image",
    "section": "1. 14 세기 도자기와의 우연한 만남",
    "page": 2,
    "page_start": 2,
    "page_end": 2,
    "pages": [2],
    "has_tables": false,
    "table_count": 0,
    "has_images": true,
    "image_count": 1,
    "parent_has_images": true,
    "parent_image_count": 1
  }
}
```

#### 사례 ②: 같은 Parent 내의 텍스트 Child Chunk만 검색된 경우 (방식 B 핵심)
* `text`: 일반 본문 문단
* `images`: `[]` (자체 이미지 없음), `metadata.has_images`: `false`, `metadata.image_count`: `0`
* `parent_context_text`: 상위 Parent 내 `[이미지: ...]` 설명 포함
* `parent_images`: 해당 Parent에 속한 `ParentImageRef[]` 목록 포함 (`metadata.parent_has_images: true`, `metadata.parent_image_count: N`)
* **하위 호환성**: 이미지가 전혀 없는 기존 문서(법령/일반 텍스트 문서)는 `has_images: false`, `image_count: 0`, `parent_has_images: false`, `parent_image_count: 0`, `images: []`, `parent_images: []`가 적용되어 기존 테스트 및 Qdrant 필터와 100% 호환됩니다.

---

## 3. Phase별 상세 구현 계획

### Phase 1: 백엔드 이미지 블록 추출 · 캡션 매칭 · 계층 청킹 (`backend/app/services/chunker/`)

1. **신규 모듈 `backend/app/services/chunker/image_extractor.py`**
   * `extract_image_block_info(block, page_num)`: MinerU v2 `content.image_source.path`, `image_caption`, `image_footnote`, `bbox`, `page` 추출.
   * `match_captions_to_images(page_items)`: 같은 페이지 내 `image` 블록과 인접 `text` 블록의 `bbox` 거리·정렬(상/하/좌/우 근접도) 및 유물/도판 캡션 패턴 정규식(예: `신안\s*\d+`, `신수\s*\d+`, `구\s*\d+`, `높이|지름|입지름|길이|무게`, `그림\s*\d+|도판\s*\d+|사진\s*\d+`, 한자 병기 유물 라벨 등)을 보수적으로 점수화하여 1차 자동 매칭합니다.
     * 캡션으로 흡수된 텍스트 블록은 중복 청크 생성을 막기 위해 해당 이미지 항목의 `caption` / `description`으로 병합합니다(단, 장문의 일반 서술 문단은 본문으로 유지하고 보수적으로 매칭해 오탐을 방지).
   * `is_decorative_noise_image(img_path, bbox, caption, footnote)`: 극소 장식 아이콘/구분선(예: `width < 48` 또는 `height < 48`이면서 캡션/각주 없음)은 기본 제외 또는 `is_ignored=True` 후보로 판별하고, 가이드북의 실제 유물/지도/사진(109장 중 대부분)은 누락 없이 보존합니다.
   * `generate_image_search_text(caption, footnote, description)`: 임베딩/검색용 텍스트 표준 포맷 생성(`**[이미지: ...]**`, 본문 설명, `**[이미지 각주: ...]**`).
   * `build_parent_image_refs(child_chunks)` / `resolve_image_url(image_path, content_list_path)`: `ParentImageRef[]` 집계 및 `/output/...` 정적 URL 해석.

2. **청킹 전략 확장 (`backend/app/services/chunker/strategies/general.py`, `legal.py`)**
   * `GeneralChunkingStrategy.chunk()` 및 `LegalChunkingStrategy.chunk()`에 `b_type == "image"` 수집 분기 추가.
   * 페이지 블록 순회 종료 시 페이지 내 `match_captions_to_images()`를 실행해 이미지-캡션 연결을 수행한 뒤 `section_items[current_sec_id]`에 추가.
   * `요지 지도`처럼 제목 아래 이미지 블록만 존재하는 섹션도 `section_items`가 비어 있지 않게 되어 빈 섹션 문제 해소.

3. **엔진 확장 (`backend/app/services/chunker/engine.py`)**
   * `_normalize_content_list()`: v1/v2 `b_type == "image"` 포맷(`img_path`, `image_caption`, `image_footnote`, `bbox`) 정규화 지원.
   * `chunk_content_list()`: 각 섹션에 이미지 단독 항목이 있더라도 `items`가 존재하므로 정상 청킹 수행.
   * `_pack_to_child_chunks()`: `i_type == "image"` 처리 추가.
     * 텍스트 블록은 flush(또는 인접 짧은 캡션만 동반)하고 이미지 청크를 `images[]`, `has_images`, `image_count` 포함 형태로 패킹(표와 동일하게 512 토큰 한도 예외 또는 메타 보존).
   * `_pack_to_parent_chunks()`:
     * `image` 청크(또는 이미지 포함 청크)의 본문을 Parent `text`에 `[이미지: {caption or '삽화'} (p.{page})]\n{c_text}` 형태로 조립.
     * `p_chunk`에 소속 Child들의 이미지를 집계한 `images` (`ParentImageRef[]`), `has_images`, `image_count` 저장.

4. **종류 판별 및 재색인·정합성 (`table_extractor.py`, `reindexer.py`)**
   * `table_extractor.py`: `get_chunk_kind()`에 `'image'` 판별 분기 추가.
   * `reindexer.py`:
     * 기존 `c.pop("image_path", None)`, `c.pop("image_url", None)`, `c["metadata"].pop(...)` 삭제 로직을 `tables[]`와 동일하게 `images[]` 보존 및 `image_id = f"{new_cid}_i{idx + 1}"` 재부여 로직으로 교체.
     * `reconcile_hierarchy_integrity()`에서 Parent의 `images` (`ParentImageRef[]`), `has_images`, `image_count`를 소속 Child 목록 기준으로 양방향 동기화.
     * `calculate_stats()`에 `image_chunks`, `total_images` 추가.

5. **라우터·작업 관리자 연계 (`backend/app/routers/etl.py`, `backend/app/services/job_manager.py`)**
   * `content_list_v2.json`의 디렉토리 위치로부터 `/output/<pipeline>/<doc>/<mode>/images/...` 기준 `image_url` 및 `source_pdf`를 주입하는 공통 후처리 헬퍼를 `/api/etl/sample`, `/api/etl/parse`, `/api/etl/parse-job`, `/api/etl/rechunk`, `/api/etl/reset`, `/api/etl/parts/merge`에 일괄 적용.

---

### Phase 2: JSONL 익스포트 · Qdrant 적재/검색(방식 B) · 원본 PDF 서빙 확장

1. **JSONL 익스포터 (`backend/app/services/chunker/jsonl_exporter.py`)**
   * 구버전 `meta.pop("has_image", None)` 등 정리 후, 신규 표준 필드 주입:
     * `metadata["has_images"]`, `metadata["image_count"]`
     * `metadata["parent_has_images"]`, `metadata["parent_image_count"]`
   * 레코드 최상위 필드:
     * `source_pdf`: `etl_result.get("active_pdf")`
     * `images`: 해당 Child의 `EmbeddedImageItem[]` (보유 시)
     * `parent_images`: 해당 Child가 속한 Parent의 `ParentImageRef[]` (소속 Parent가 이미지를 보유 시, 방식 B)

2. **Qdrant 임베딩 및 하이브리드 검색 (`backend/app/services/embedding_svc.py`)**
   * `reserved_keys`에 `"images"`, `"has_images"`, `"image_count"`, `"parent_images"`, `"parent_has_images"`, `"parent_image_count"`, `"source_pdf"` 추가.
   * `embed_and_upsert()`:
     * `parent_map` 또는 동일 `parent_chunk_id`를 공유하는 `active_chunks` 그룹에서 `ParentImageRef[]`를 자동 집계(이미 `parent["images"]`가 있으면 재사용, 없으면 child들로부터 동적 계산).
     * Qdrant `payload`에 `images`, `has_images`, `image_count`, `parent_images`, `parent_has_images`, `parent_image_count`, `source_pdf` 저장.
     * `texts[i]`는 캡션 + 시각 설명이 포함된 `chunk["text"]`를 그대로 사용하므로 기존 `BGE-m3-ko` Dense + `KiwiSparseEncoder` IDF 하이브리드 검색이 즉시 동작.
   * `hybrid_search()`:
     * 검색 결과 딕셔너리에 `images`, `has_images`, `image_count`, `parent_images`, `parent_has_images`, `parent_image_count`, `source_pdf` 반환.

3. **RAG 컨텍스트 강화 (`backend/app/services/llm_refine_svc.py`)**
   * `build_rag_context()`에서 `[참조 #N]` 조립 시 해당 청크가 이미지 청크(`images`)이거나 `parent_images`를 보유한 경우, 참조 헤더 및 보조 라인에 관련 이미지 개수·페이지·캡션 정보를 명시해 LLM이 출처 페이지를 정확히 안내할 수 있도록 보강.

4. **원본 PDF 문서 지정 스트리밍 연계 (`backend/app/routers/pdf.py` — 기구현 재사용)**:
   * `GET /api/pdf?filename=...` (`_resolve_target_pdf_path()` + `_is_within_allowed_pdf_dirs()`) 및 `GET /api/pdf/page-image`가 `pdf-viewer` 작업으로 이미 구현되어 있으며, 프론트엔드 URL 헬퍼(`getOriginalPdfUrl()`, `getPdfPageImageUrl()` in `frontend/src/api/client.ts`)도 구비되어 있습니다.
   * 따라서 별도 라우터 수정 없이 기존 엔드포인트·헬퍼를 재사용하되, JSONL/Qdrant의 `source_pdf`에는 `App.tsx`의 `activePdfForViewer`와 동일하게 가능하면 서브폴더 상대 경로까지 일관되게 보존하여 `find_pdf_path()`가 동명 파일도 정확히 해소하도록 맞춥니다.

---

### Phase 3: VLM 이미지 설명 초안 자동 생성 파이프라인 (`backend/app/services/llm_*`, `backend/app/routers/llm.py`)

1. **LLM 설정 확장 (`backend/app/services/llm_config_svc.py`)**
   * `LLMConfig` 필드 추가(모두 기본값 보유로 기존 `output/llm_config.json` 하위 호환):
     * `vlm_model_name: Optional[str] = None` (비어 있으면 `model_name` 재사용, 별도 VLM 모델 예: `gemma4:12b`, `qwen2.5vl:7b` 지정 가능)
     * `image_description_prompt: str = DEFAULT_IMAGE_DESCRIPTION_PROMPT`
   * `DEFAULT_IMAGE_DESCRIPTION_PROMPT` 및 `get_default_image_description_prompt()` 추가:
     * **문화재·전문문서 할루시네이션 차단 원칙**: 유물명·시대·가마·소장번호 등 사실 정보는 함께 제공된 `[기존 캡션]`과 `[주변 문맥]`에서만 인용하고 절대 추측·창작하지 않으며, 이미지에서 직접 관찰되는 시각적 특징(형태·유약 색상·문양·재질·지도 내 지명·사진 속 인물/장면·문자 등)만 한국어 2~4문장으로 객관적 서술.

2. **비전 추론 서비스 확장 (`backend/app/services/llm_refine_svc.py`)**
   * **로컬 이미지 안전 로드 & 리사이즈 헬퍼**:
     * `image_path`/`image_url`을 `OUTPUT_DIR` 하위 실제 파일로 해석하고 `Path.resolve().is_relative_to(OUTPUT_DIR.resolve())` 검증으로 Path Traversal 차단.
     * PIL(`Pillow`)로 RGB 변환 후 긴 변 최대 `1024px` 이하 JPEG(quality=85)로 축소하여 RTX 4060 8GB VRAM 및 Ollama 토큰 처리 속도 최적화, base64 인코딩.
   * **`_post_vision_chat()`**:
     * Ollama 엔드포인트(`11434` 또는 `ollama`)인 경우 네이티브 `/api/chat` (`messages[].images: [b64_str]`, `think: False`) 우선 호출.
     * 그 외 또는 실패 시 표준 OpenAI 멀티모달 포맷(`/v1/chat/completions`, `content: [{"type": "text", ...}, {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}]`)으로 폴백.
   * **`describe_image_chunk()`**:
     * 단일 이미지 또는 청크(`images[]`)와 선택적 `caption`, `breadcrumbs`, `context_text`, `custom_prompt`, `doc_dir` 등을 입력받아 설명 초안 텍스트 생성.

3. **VLM API 엔드포인트 (`backend/app/routers/llm.py`)**
   * `GET /api/llm/config/default-image-prompt`: 기본 이미지 설명 프롬프트 반환.
   * `POST /api/llm/describe-image`: 단건 이미지 설명 초안 생성 (로컬 이미지 파일 검증, VLM 호출 후 초안 및 소요시간 반환).
   * 일괄 초안 생성 백그라운드 API (문서 내 `description`이 비어 있는 이미지 청크 대상):
     * `POST /api/llm/describe-images/batch`: 대상 `filename` 또는 현재 청크 목록 중 설명이 비어 있는(또는 `overwrite=True`) 이미지 청크에 대해 순차 VLM 설명 초안 생성 시작 (GPU 경합 방지를 위해 동시 1건 순차 실행).
     * `GET /api/llm/describe-images/status`: 진행률(`completed/total`), 현재 처리 중인 `chunk_id`, 결과 목록 및 오류 상태 조회.
     * `POST /api/llm/describe-images/cancel`: 일괄 작업 안전 중단 요청.
     * 작업 완료 시 해당 문서의 `rag_chunks_edited.json`에 설명 초안 반영 및 `ParentChunk.text`/`ParentImageRef[]` 재동기화 옵션 지원.

---

### Phase 4: 프론트엔드 Chunk Studio & Retrieval Playground UI (`frontend/src/`)

1. **타입 및 유틸리티 동기화**
   * `frontend/src/types/index.ts`: `EmbeddedImageItem`, `ParentImageRef`, `ChildChunk`(`images`, `has_images`, `image_count`), `ParentChunk`(`images`, `has_images`, `image_count`), `EtlStats`(`image_chunks`, `total_images`), `SearchResultItem`(`images`, `parent_images`, `source_pdf`), `LLMConfig`(`vlm_model_name`, `image_description_prompt`), `LLMDescribeImageResponse` 추가.
   * `frontend/src/utils/chunkKindUtils.ts`: `ChunkDisplayKind`에 `'image'` 추가, `hasImageData()`, `getChunkKind()`, `getChunkKindLabel()`(`이미지`), `getChunkKindBadgeClass()`(`sky` 계열) 구현.
   * `frontend/src/utils/pageUtils.ts`: `RESERVED_METADATA_KEYS`에 신규 이미지 키 등록, `computeImageMetadata()`, `syncChunkSystemMetadata()` 확장.
   * `frontend/src/utils/tableChunkUtils.ts` (필요 시 이미지 보조 유틸 분리 `imageChunkUtils.ts`):
     * `mergeChunkAssets()`: 선택된 청크 병합 시 `images[]` 배열 순서대로 결합 및 `image_index` 재정렬.
     * `deriveChunkTypeAndTables()` / 분할 로직: 복합 청크 분할 시 이미지가 어느 파트에 남는지 보존·매핑.
   * `frontend/src/hooks/useHierarchyMutations.ts`:
     * `handleUpdateChunk`, 병합/분할/이동/삭제 시 상위 `ParentChunk.text`에 `[이미지: ... (p.N)]` 표식 반영 및 `ParentChunk.images`(`ParentImageRef[]`) 자동 재계산 헬퍼 연동.

2. **Chunk Studio UI (`ChunkStudio.tsx`, `PdfViewerPane.tsx`, `ChunkEditorPane.tsx`, `ChunkListPane.tsx`, `ChunkCard.tsx`, 모달들)**
   * **`ChunkStudio.tsx` & `PdfViewerPane.tsx` (`bbox` 하이라이트 연동)**:
     * `PdfViewerPane`에 이미 예약된 `highlightBboxes` prop(MinerU 0~1000 정규화 좌표 `[x0, y0, x1, y1]`)에 `activeChunk.images`를 연결합니다.
     * 다중 페이지 청크나 자유 페이지 탐색(`isPdfPageSynced === false`) 시 엉뚱한 페이지에 오버레이가 그려지지 않도록, **반드시 `img.page_number === pdfCurrentPage`인 항목만 필터링**하여 `highlightBboxes`로 전달합니다.
   * **`ChunkEditorPane.tsx`**:
     * 이미지 포함 청크(`hasImageData(activeChunk)`)일 때 상단 **이미지 프리뷰 및 편집 패널** 렌더링:
       * 이미지 썸네일 카드, 페이지 번호 & `bbox` 좌표 표시, `caption` / `footnote` / `description` 입력 필드(PDF 뷰어의 `Space` 패닝 및 `Alt+P` 단축키 충돌 방지를 위해 표준 `<input>`/`<textarea>` 사용), 개별 이미지 제거 버튼.
       * **`📄 원본 PDF p.N 열기`** 버튼: 새 탭이 아닌 Chunk Studio 내장 `openPdfAtPage(img.page_number)`를 호출해 즉시 PDF 뷰어 해당 페이지 + `bbox` 하이라이트로 이동합니다(새 탭 열기는 `PdfViewerPane` 툴바에서 이미 지원).
       * 각 이미지별 **`🖼️ AI 설명 초안(VLM)`** 버튼: 생성된 설명을 바로 `description`에 채우고 `chunk.text` 동기화 버튼/자동 반영 지원.
     * PDF 대조 모드에서 에디터 폭이 최대 `30%`까지 축소될 수 있으므로 이미지 프리뷰/편집 패널은 좁은 폭에서도 깨지지 않는 세로 스택·반응형 레이아웃으로 구성합니다.
     * `isImageChunk`가 포함될 때 토큰 한도 경고 대신 이미지 보존 안내 또는 적절한 길이 안내 표시.
   * **`ChunkListPane.tsx` & `ChunkCard.tsx`**:
     * 2열 필터에 `이미지` 필터 옵션 추가 및 툴바에 **`🖼️ 빈 이미지 일괄 설명 생성`** 액션(진행률 표시 + 중단 가능) 추가.
     * PDF 대조 모드에서는 `ChunkListPane`이 `isOverlayMode`(`380~440px` 드로어)로 열리므로 툴바·필터 컨트롤은 `flex-wrap`으로 줄바꿈을 허용하고, 드로어를 닫아도 배치 진행 상태를 확인할 수 있게 유지합니다.
     * `ChunkCard.tsx`에 `IMAGE` / `COMPOSITE (이미지 N)` 뱃지 및 소형 썸네일 미리보기 표시.
   * **`ChunkMergeModal.tsx` & `ChunkSplitModal.tsx`**:
     * 병합 대상 청크들에 포함된 이미지 개수(`이미지 N개 결합 보존`) 및 분할 시 이미지 보존 안내 표시.
   * **`JsonlModal.tsx`**:
     * `jsonl_exporter.py`와 100% 일치하도록 `images`, `parent_images`, `source_pdf`, `metadata.has_images`, `metadata.parent_has_images` 미리보기 생성.
   * **`LLMConfigModal.tsx`**:
     * `VLM 모델 이름 (선택)` 입력 필드 및 모델 탐색 연동, 프롬프트 탭에 `이미지 설명(VLM)` 탭 추가.
   * **`StatCards.tsx`**: 이미지 청크 수(`image_chunks`) 통계 표시(보유 시).

3. **Retrieval Playground UI (`RetrievalPlayground.tsx`)**
   * 검색 결과 카드 및 상세 모달에 아래 두 영역 명확히 구분 표시:
     * **해당 청크 이미지 (`item.images[]`)**: 유물 캡션·시각 설명·썸네일 미리보기 및 `frontend/src/api/client.ts`의 `getOriginalPdfUrl(item.source_pdf, img.page_number)`를 활용한 **`📄 원본 PDF p.N 열기`** 링크(선택적으로 `/api/pdf/page-image` 경량 미리보기 연계 가능).
     * **상위 Parent 관련 이미지 (`item.parent_images[]`)** *(방식 B)*: 텍스트 청크만 검색되었을 때도 `"이 섹션(Parent)에 포함된 이미지 N건"` 배지·목록(캡션, 페이지 번호, `bbox`, `getOriginalPdfUrl()` 기반 PDF 열기 링크)을 표시.

---

## 4. 변경 대상 파일 매트릭스

| 구분 | 파일 경로 | 역할 및 변경 내용 |
| :--- | :--- | :--- |
| **백엔드 (신규)** | `backend/app/services/chunker/image_extractor.py` | 이미지 블록 파싱, `bbox`/패턴 기반 캡션 매칭, 검색 텍스트·`ParentImageRef` 생성 |
| **백엔드 (수정)** | `backend/app/services/chunker/strategies/general.py` | `b_type == "image"` 수집 및 페이지별 캡션 매칭 호출 |
| **백엔드 (수정)** | `backend/app/services/chunker/strategies/legal.py` | `b_type == "image"` 수집 지원(별지/도판 포함 법령 대응) |
| **백엔드 (수정)** | `backend/app/services/chunker/engine.py` | `_normalize_content_list`, `_pack_to_child_chunks`, `_pack_to_parent_chunks` 이미지 확장 |
| **백엔드 (수정)** | `backend/app/services/chunker/table_extractor.py` | `get_chunk_kind()`에 `'image'` 판별 추가 |
| **백엔드 (수정)** | `backend/app/services/chunker/reindexer.py` | `images[]` 보존·`image_id` 재부여, `reconcile_hierarchy_integrity` Parent 이미지 동기화 |
| **백엔드 (수정)** | `backend/app/services/chunker/jsonl_exporter.py` | 방식 B(`images[]`, `parent_images[]`, `source_pdf`, 이미지 메타) 익스포트 |
| **백엔드 (수정)** | `backend/app/services/embedding_svc.py` | `reserved_keys`, Qdrant payload 이미지·`parent_images` 적재 및 `hybrid_search` 반환 |
| **백엔드 (수정)** | `backend/app/services/job_manager.py` | 청킹 후 `image_url`·`source_pdf` 주입 |
| **백엔드 (수정)** | `backend/app/routers/etl.py` | `/sample`, `/parse`, `/rechunk`, `/reset`, `/parts/merge` 이미지 URL·메타 동기화 |
| **백엔드 (재사용)** | `backend/app/routers/pdf.py` | *(기구현 재사용)* `GET /api/pdf?filename=...` 및 `GET /api/pdf/page-image` 기존 구현 그대로 활용 |
| **백엔드 (수정)** | `backend/app/services/llm_config_svc.py` | `vlm_model_name`, `image_description_prompt` 설정 및 기본 프롬프트 추가 |
| **백엔드 (수정)** | `backend/app/services/llm_refine_svc.py` | 이미지 리사이즈/base64, `_post_vision_chat`, `describe_image_chunk`, `build_rag_context` 보강 |
| **백엔드 (수정)** | `backend/app/routers/llm.py` | VLM 단건/배치/상태/취소 및 기본 이미지 프롬프트 API 추가 |
| **프론트 (수정)** | `frontend/src/types/index.ts` | `EmbeddedImageItem`, `ParentImageRef`, VLM/검색 응답 타입 추가 |
| **프론트 (수정)** | `frontend/src/utils/chunkKindUtils.ts` | `'image'` kind 판별 및 뱃지 스타일 추가 |
| **프론트 (수정)** | `frontend/src/utils/pageUtils.ts` | `RESERVED_METADATA_KEYS`, `computeImageMetadata` 추가 |
| **프론트 (수정)** | `frontend/src/utils/tableChunkUtils.ts` | `mergeChunkAssets` / 분할 시 `images[]` 결합·보존 처리 |
| **프론트 (수정)** | `frontend/src/hooks/useHierarchyMutations.ts` | 편집/병합/분할/삭제 시 `ParentChunk.text` 및 `ParentChunk.images` 동기화 |
| **프론트 (수정)** | `frontend/src/api/client.ts` | VLM 단건/일괄 API 클라이언트 함수 추가 |
| **프론트 (수정)** | `frontend/src/components/chunk-studio/ChunkEditorPane.tsx` | 이미지 프리뷰/편집 패널, VLM 초안 버튼, `openPdfAtPage()` 내장 뷰어 이동 버튼(좁은 분할 폭 반응형 대응) |
| **프론트 (수정)** | `frontend/src/components/chunk-studio/ChunkListPane.tsx` | `image` 필터 및 빈 이미지 일괄 설명 생성 컨트롤(`isOverlayMode` 좁은 드로어 대응) |
| **프론트 (수정)** | `frontend/src/components/ChunkStudio.tsx` | 이미지 업데이트·VLM 단건/배치 상태 핸들링 연동, `PdfViewerPane` `highlightBboxes` (`page_number === pdfCurrentPage` 필터) 전달 |
| **프론트 (수정)** | `frontend/src/components/ChunkCard.tsx` | 이미지 청크 뱃지 및 썸네일 미리보기 |
| **프론트 (수정)** | `frontend/src/components/ChunkMergeModal.tsx` | 병합 대상 이미지 개수 보존 안내 |
| **프론트 (수정)** | `frontend/src/components/ChunkSplitModal.tsx` | 분할 시 이미지 보존/배치 안내 |
| **프론트 (수정)** | `frontend/src/components/JsonlModal.tsx` | `images[]` 및 `parent_images[]` JSONL 미리보기 동기화 |
| **프론트 (수정)** | `frontend/src/components/LLMConfigModal.tsx` | VLM 모델 선택 및 이미지 설명 프롬프트 탭 추가 |
| **프론트 (수정)** | `frontend/src/components/StatCards.tsx` | 이미지 청크 통계 표시 |
| **프론트 (수정)** | `frontend/src/components/RetrievalPlayground.tsx` | `images[]` & `parent_images[]` 표시 및 원본 PDF 페이지 열기 연계 |
| **테스트 (신규)** | `backend/tests/test_image_chunking.py` | 이미지 청킹, 캡션 매칭, 재색인, JSONL 및 방식 B Qdrant payload 테스트 |
| **테스트 (신규)** | `backend/tests/test_vlm_describe_api.py` | VLM 단건/배치/폴백/보안(Path Traversal) Mock 테스트 |

---

## 5. 테스트 및 검증 계획

1. **백엔드 단위·통합 테스트 (`pytest`)**
   * 신규 `backend/tests/test_image_chunking.py`:
     * `image` 블록 추출 및 `bbox` 근접도 기반 캡션 매칭 검증
     * 이미지 단독 섹션(`요지 지도` 유형)이 빈 섹션이 되지 않고 `image` Child + Parent `[이미지: ...]`로 생성되는지 검증
     * `reindex_etl_result` 및 `reconcile_hierarchy_integrity` 시 `images[]` 유지, `image_id` 재정렬, `ParentImageRef[]` 동기화 검증
     * `export_to_jsonl` 및 `embedding_svc.embed_and_upsert` / `hybrid_search`에서 **방식 B**(`images[]`, `parent_images[]`, `source_pdf`) 검증
     * 이미지가 없는 기존 문서의 하위 호환성 검증
   * 신규 `backend/tests/test_vlm_describe_api.py`:
     * Ollama 네이티브 `/api/chat` (`images: [...]`) 및 OpenAI 호환 폴백 payload 검증
     * `OUTPUT_DIR` 외부 경로 차단(Path Traversal 방지) 및 빈 요청 `400` 검증
     * 배치 생성 작업 진행 상태·취소 흐름 검증
   * 기존 백엔드 테스트 19개 파일(`test_pdf_viewer_api.py` 포함) 전수 실행하여 회귀 없음 확인.

2. **프론트엔드 타입 검사 및 프로덕션 빌드**
   * `cd frontend && npx tsc --noEmit && npm run build`

3. **실제 가이드북 데이터 E2E 검증**
   * 대상: `pdfs/도자문화관 가이드북 신안해저도자_10.30..pdf`
   * 재청킹 실행 → `image_chunks` / `요지 지도` 섹션 생성 확인 → VLM 단건·배치 설명 초안 생성 → Qdrant 색인 → 검색 질의 테스트:
     * `"용천요 청자 특징"` (텍스트 청크 검색 시 `parent_images[]` 노출 확인)
     * `"요지 지도"` (이미지 청크 직접 검색 및 `images[]` 반환 확인)
     * `"사사수부공용 접시"` (명문/세부 이미지 + 캡션 검색 및 `/api/pdf?filename=...#page=N` 열람 확인)

---

## 6. 주요 리스크 및 대응 방안

| 리스크 | 영향 | 대응 방안 |
| :--- | :--- | :--- |
| 기존 `rag_chunks_edited.json` 덮어쓰기 | 이미 수동 교정한 청크 손실 가능 | 기존 저장된 `rag_chunks_edited.json`은 자동 재생성하지 않으며, 사용자가 명시적으로 `재청킹(/api/etl/rechunk)` 또는 백업 후 반영하도록 유지 |
| RTX 4060 8GB VRAM 경합 | VLM 추론과 Dense 임베딩(`BGE-m3-ko`) 동시 실행 시 OOM 위험 | VLM 배치 작업은 동시성 1(순차 실행) + 이미지 긴 변 1024px 이하 리사이즈 적용, 임베딩과 VLM 배치 동시 실행 시 안내 |
| 인접 캡션 오매칭 | 일반 본문 문단이 이미지 캡션으로 잘못 흡수될 수 있음 | 짧은 길이·`bbox` 인접도·유물 라벨 패턴을 만족하는 경우만 보수적으로 매칭하고, Studio 병합/분할 UI로 즉시 보정 가능하게 보장 |
| 비-비전 LLM 설정 시 VLM 호출 실패 | 텍스트 전용 모델(`exaone3.5` 등) 선택 상태에서 이미지 설명 생성 실패 | `LLMConfig.vlm_model_name`으로 VLM 전용 모델 분리 지정 지원, 미지원 모델 응답 시 명확한 안내 메시지 반환 |

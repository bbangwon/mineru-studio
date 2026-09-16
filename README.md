# MinerU RAG ETL Studio

**MinerU (OpenDataLab)** 엔진을 활용한 **RAG(Retrieval-Augmented Generation) 전용 문서 ETL 및 부모-자식(Parent-Child) 계층 청킹 플랫폼**입니다.

Apple Silicon(Mac M-series)의 **MLX/Metal** 하드웨어 가속 환경에서 고속 구동됩니다.

---

## 🚀 RAG ETL 핵심 기능

1. **부모-자식 계층 청킹 (Hierarchical / Parent-Child Chunking)**:
   - MinerU의 Heading `level`과 레이아웃 메타데이터를 파싱하여 `[문서 > 상위 장 > 하위 절]` 계층 트리 자동 구성
   - **부모 섹션(Parent Chunk)**: LLM 생성 컨텍스트용 거시적 섹션 전체 문맥
   - **자식 청크(Child Chunk)**: 검색 및 임베딩용 정밀 문단/표 단위 (약 100~300 토큰)
2. **원형 100% 무손실 표(Atomic Table) 보존**:
   - 표를 토큰 수 기준으로 임의 절단하지 않고 하나의 완전한 엔티티(`<table>...</table>`)로 캡슐화
   - MinerU가 크롭한 고해상도 표 이미지 경로 및 `bbox`, 페이지 메타데이터 자동 연결
   - 추후 RAG 인덱싱 시 **Multi-Vector / 요약 인덱싱** 전략 지원
3. **표준 RAG JSONL 원클릭 익스포트**:
   - LangChain, LlamaIndex, Pinecone, Chroma, Milvus, Qdrant 등에 즉시 적재 가능한 표준 JSONL 파일 다운로드 (`/api/etl/export/jsonl`)
4. **인터랙티브 청크 뷰어 & 문서 트리 탐색기**:
   - 좌측 문서 헤딩 트리 클릭 시 해당 부모 섹션의 자식 청크만 실시간 필터링
   - 표 원형 렌더링 확인 및 실시간 단일 JSONL 레코드 인스펙터 제공
5. **동적 PDF 업로드 & 맞춤 파싱**:
   - 상단 툴바에서 새 PDF 업로드 및 페이지 범위/엔진 선택 후 실시간 파싱 실행
6. **로컬 LLM 기반 청크 텍스트 자동 교정 (gemma4:12b-mlx, temp=0.0)**:
   - OpenAI 호환 엔드포인트를 통한 비정상적인 줄바꿈(단어 중간 개행) 및 국립국어원 띄어쓰기 규정 자동 정제
   - Before vs After Diff 비교 뷰를 통한 안전한 검토 및 원클릭 교정본 반영
7. **다중 PDF 문서 ETL & RAG 파이프라인 통합 대시보드**:
   - 저장소 내 모든 PDF의 ETL 파싱, 청크 산출물(청크/섹션/표 개수), 검수/수정본 저장 여부, Qdrant 벡터 색인 현황을 한눈에 거시 관제
   - 드래그 앤 드롭 파일 등록, 실시간 백그라운드 작업 진행률 모니터링, 원클릭 스튜디오 진입 및 파싱 지원
8. **작업공간 & 작업 데이터 스냅샷 백업 및 원복(복원)**:
   - PDF 원본, MinerU 파싱 산출물, 교정/편집된 청크 데이터(`rag_chunks_edited.json`), 시스템 설정 전체를 단일 ZIP으로 스냅샷 백업
   - 단일 문서 또는 전체 작업공간 단위 백업 지원
   - 원복 실행 전 '자동 안전 백업(Safety Backup)' 생성으로 복원 실수 방지
   - 외부 백업 ZIP 파일 다운로드 보관 및 업로드 원복(가져오기) 지원

---

## 🚀 빠른 시작

### 1. 웹 스튜디오 실행 (FastAPI + React SPA)
```bash
./run.sh
```
- 웹 UI: [http://localhost:8001](http://localhost:8001) (`frontend/dist` React 앱이 자동 빌드되어 서빙됩니다.)

### 2. 프론트엔드 실시간 개발 모드 (Vite HMR)
```bash
cd frontend
npm run dev
```
- 프론트엔드 HMR 개발 서버: [http://localhost:5173](http://localhost:5173) (FastAPI 백엔드로 자동 API 프록시)

### 3. 주요 API 엔드포인트
- `GET /api/pdf/list`: 문서 목록 조회
- `POST /api/pdf/upload`: 신규 PDF 업로드
- `POST /api/pdf/select`: 활성 PDF 변경
- `POST /api/etl/parse`: MinerU 파싱 & 계층 청킹 실행
- `GET /api/etl/sample`: 현재 로드된 ETL 청크 결과 조회
- `GET /api/etl/export/jsonl`: RAG 표준 JSONL 다운로드
- `GET /api/backup/list`: 백업 아카이브 목록 조회
- `POST /api/backup/create`: 작업공간 또는 문서 백업 생성
- `POST /api/backup/{backup_id}/restore`: 지정 백업으로 원복 (안전 백업 자동 생성)
- `GET /api/backup/{backup_id}/download`: 백업 ZIP 아카이브 다운로드
- `POST /api/backup/upload`: 백업 ZIP 업로드 및 등록/원복
- `DELETE /api/backup/{backup_id}`: 백업 삭제
- `GET /api/pdf`: 활성 원본 PDF 뷰


export interface PdfItemStats {
  total_chunks: number;
  parent_sections: number;
  parent_chunks: number;
  tables_count: number;
  estimated_tokens: number;
}

export interface PdfItem {
  filename: string;
  size_bytes: number;
  total_pages: number;
  is_current: boolean;
  mtime?: number;
  etl_status?: 'not_started' | 'running' | 'completed' | 'failed';
  backend?: string;
  method?: string;
  strategy?: string;
  has_saved_edit?: boolean;
  is_embedded?: boolean;
  active_job?: {
    task_id: string;
    status: string;
    progress_msg?: string;
    elapsed_time?: number;
  } | null;
  stats?: PdfItemStats | null;
  last_modified?: string | null;
}

export interface QdrantStatus {
  connected: boolean;
  mode?: string;
  collection?: string;
  error?: string | null;
  used_cache?: boolean;
}

export interface GlobalStats {
  total_pdfs: number;
  parsed_pdfs: number;
  running_jobs: number;
  total_chunks: number;
  embedded_pdfs: number;
  qdrant_connected?: boolean;
}

export interface PdfListResponse {
  pdfs: PdfItem[];
  current: string | null;
  global_stats?: GlobalStats;
  qdrant_status?: QdrantStatus;
}


// 1. Section (목차 노드 / 거시 계층)
export interface SectionNode {
  id: string;                      // 예: "d_xxxx_s01"
  title: string;                   // "제1장 총칙"
  level: number;                   // 1 (장), 2 (절), 3 (관) ...
  parent_section_id?: string;      // 상위 섹션 참조
  breadcrumbs: string[];           // ["규정집", "제1장 총칙"]
  parent_chunk_ids: string[];      // 소속된 Parent 청크 ID 목록
  child_chunk_ids: string[];       // 소속된 Child 청크 ID 목록 (하위 호환 및 편의)
  full_text?: string;
  page_range: [number, number];
  bbox?: number[];
}

// 하위 호환성 타입 별칭
export type ParentSection = SectionNode;

export type SectionInsertPosition =
  | { type: 'end' }
  | { type: 'start' }
  | { type: 'after'; sectionId: string };

// 2. Parent Chunk (문맥 / 중간 계층, ~2048 tokens)
export interface ParentChunk {
  parent_chunk_id: string;         // 예: "d_xxxx_p001"
  id?: string;                     // 호환성 별칭
  section_id: string;              // 소속 섹션 ID ("d_xxxx_s01")
  title?: string;                  // 서브섹션명 또는 "제1조(목적)"
  text: string;                    // LLM 주입용 결합 문맥 텍스트 (~2048 토큰)
  token_estimate: number;
  child_chunk_ids: string[];       // 소속된 Child 청크 ID 목록
  page_range: [number, number];
  is_edited?: boolean;
}

export type ParentInsertPosition =
  | { type: 'end' }
  | { type: 'start' }
  | { type: 'after'; parentId: string };

// 3. Child Chunk (검색 / 미시 계층, ~512 tokens or Atomic Table)
export interface ChildChunk {
  chunk_id: string;                // 예: "d_xxxx_c001"
  parent_chunk_id: string;         // 소속 Parent 청크 ID ("d_xxxx_p001")
  parent_id?: string;              // 하위 호환성 별칭 (일부 컴포넌트 호환)
  section_id: string;              // 소속 Section ID ("d_xxxx_s01")
  chunk_type: 'paragraph' | 'table' | 'article_clause' | 'article';
  text: string;                    // 검색/임베딩 대상 텍스트 (~512 토큰 or 표 요약)
  token_estimate: number;
  page_number: number;
  page_end?: number;
  breadcrumbs: string[];           // ["제1장 총칙", "제1조(목적)"]
  raw_html?: string;               // 표 원형 보존
  table_caption?: string;
  table_footnote?: string;
  image_path?: string;
  image_url?: string;
  table_type?: string;
  is_table?: boolean;
  is_atomic_table?: boolean;
  is_edited?: boolean;
  is_ignored?: boolean;            // Vector DB 임베딩 제외 플래그
  parent_text?: string;            // 부모 청크 전체 문맥 텍스트
  metadata?: Record<string, any>;
}

export interface SaveEtlResponse {
  success: boolean;
  message: string;
  saved_at: number;
  total_chunks: number;
}

export interface EtlStats {
  total_sections?: number;
  total_parent_sections: number;
  total_parent_chunks?: number;
  total_child_chunks: number;
  paragraph_chunks: number;
  table_chunks: number;
  article_chunks?: number;
  total_words: number;
}

// 4. 전체 ETL 결과 컨테이너 (3단계 계층 Single Source of Truth)
export interface HierarchicalEtlResult {
  doc_id: string;
  doc_title: string;
  strategy?: 'general' | 'legal' | string;
  stats: EtlStats;
  sections: SectionNode[];
  parent_sections?: SectionNode[]; // 하위 호환성 별칭
  parent_chunks: ParentChunk[];
  child_chunks: ChildChunk[];
  elapsed_time?: number;
  active_pdf?: string;
  total_pages?: number;
  preserve_newlines?: boolean;
}

// 하위 호환성 타입 별칭
export type EtlResult = HierarchicalEtlResult;

export interface ParseRequestParams {
  filename?: string;
  all_pages?: boolean;
  start_page?: number | null;
  end_page?: number | null;
  lang?: string;
  backend?: string;
  method?: string;
  formula?: boolean;
  strategy?: 'general' | 'legal' | string;
  preserve_newlines?: boolean;
}

export interface JobStatusResponse {
  task_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress_msg?: string;
  elapsed_time?: number;
  filename?: string;
  strategy?: string;
  result?: HierarchicalEtlResult;
  error?: string;
  active?: boolean;
}

// 5. Qdrant & 하이브리드 임베딩 관련 타입
export interface QdrantConfig {
  mode: 'embedded' | 'remote';
  local_path: string;
  url?: string;
  api_key?: string | null;
  collection_name: string;
  recreate_collection: boolean;
  dense_model_name?: string;
  dense_dim?: number;
  batch_size?: number;
  dense_vector_name?: string;
  sparse_vector_name?: string;
}

export interface QdrantTestResponse {
  success: boolean;
  mode: string;
  target: string;
  collections?: string[];
  collections_count?: number;
  message: string;
  error?: string;
}

export interface EmbedStatusResponse {
  status: 'idle' | 'running' | 'done' | 'error';
  progress_msg: string;
  progress_pct: number;
  last_result?: {
    success: boolean;
    collection_name: string;
    total_chunks: number;
    upserted_count: number;
    elapsed_time: number;
    dense_dim: number;
    export_file?: string;
  };
  error?: string | null;
  elapsed_time: number;
}

export interface SearchResultItem {
  rank: number;
  id: string;
  score: number;
  chunk_id: string;
  parent_chunk_id?: string;
  parent_text?: string;
  section_id?: string;
  text: string;
  title: string;
  page_number?: number;
  page_end?: number;
  page_idx: number;
  chunk_type: string;
  heading_hierarchy: string[];
  breadcrumbs?: string[];
  token_count: number;
  token_estimate?: number;
  raw_html?: string;
  table_caption?: string;
  table_footnote?: string;
  is_table?: boolean;
  image_url?: string | null;
  metadata?: Record<string, any>;
  payload?: Record<string, any>;
}

export interface SearchTestResponse {
  success: boolean;
  query: string;
  collection_name: string;
  total_matches: number;
  results: SearchResultItem[];
}

// 6. LLM 설정 및 텍스트 자동 교정 관련 타입
export interface LLMConfig {
  base_url: string;
  model_name: string;
  api_key?: string;
  temperature: number;
  max_tokens: number;
  timeout?: number;
  system_prompt: string;
}

export interface LLMTestResponse {
  success: boolean;
  message: string;
  model: string;
  latency_ms?: number;
  error?: string;
}

export interface LLMRefineResponse {
  success: boolean;
  original_text: string;
  refined_text: string;
  elapsed_seconds: number;
  original_chars: number;
  refined_chars: number;
}

// 7. 기본 파서 설정 관련 타입
export interface ParserConfig {
  backend: string;
  method: string;
  formula: boolean;
  strategy: string;
  all_pages: boolean;
  start_page: number;
  end_page: number;
  preserve_newlines?: boolean;
}

// 8. 작업공간 및 문서 백업/원복(복원) 관련 타입
export interface BackupStats {
  pdf_count: number;
  pdf_names: string[];
  edited_docs_count: number;
  total_chunks: number;
  has_configs: boolean;
  includes_vector_db?: boolean;
}

export interface BackupItem {
  version?: string;
  backup_id: string;
  filename: string;
  name: string;
  description?: string;
  backup_type: 'workspace' | 'document';
  target_doc?: string;
  created_at: string;
  timestamp: number;
  size_bytes: number;
  is_safety_backup?: boolean;
  includes_vector_db?: boolean;
  stats: BackupStats;
}

export interface BackupListResponse {
  success: boolean;
  backups: BackupItem[];
}

export interface CreateBackupRequest {
  name?: string;
  description?: string;
  backup_type?: 'workspace' | 'document';
  target_doc?: string;
  include_vector_db?: boolean;
}

export interface RestoreBackupResponse {
  success: boolean;
  result: {
    success: boolean;
    backup_id: string;
    restored_files_count: number;
    safety_backup_id?: string;
    manifest?: BackupItem;
    message: string;
  };
  message: string;
}




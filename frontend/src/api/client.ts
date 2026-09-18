import type {
  EtlResult,
  PdfListResponse,
  ParseRequestParams,
  ParserConfig,
  BackupItem,
  BackupListResponse,
  CreateBackupRequest,
  RestoreBackupResponse,
} from '../types';

export async function getPdfList(): Promise<PdfListResponse> {
  const res = await fetch('/api/pdf/list');
  if (!res.ok) {
    throw new Error('PDF 목록을 불러오지 못했습니다.');
  }
  return res.json();
}

export async function selectPdf(filename: string): Promise<{ success: boolean; current: string; total_pages: number }> {
  const res = await fetch('/api/pdf/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });
  if (!res.ok) {
    throw new Error('PDF 선택 변경에 실패했습니다.');
  }
  return res.json();
}

export async function uploadPdf(file: File): Promise<{
  success: boolean;
  filename: string;
  total_pages: number;
  size_bytes: number;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/pdf/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'PDF 업로드에 실패했습니다.');
  }
  return res.json();
}

export async function getEtlSample(strategy: string = 'general', filename?: string): Promise<EtlResult> {
  const params = new URLSearchParams({ strategy });
  if (filename) {
    params.set('filename', filename);
  }
  const res = await fetch(`/api/etl/sample?${params.toString()}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'ETL 분석 샘플을 불러오지 못했습니다.');
  }
  return res.json();
}

export async function runEtlParse(params: ParseRequestParams): Promise<EtlResult> {
  const res = await fetch('/api/etl/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'ETL 파이프라인 실행 중 오류가 발생했습니다.');
  }
  return res.json();
}

export async function startEtlJob(params: ParseRequestParams): Promise<{ success: boolean; task_id: string; status: string; message: string }> {
  const res = await fetch('/api/etl/parse-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '백그라운드 태스크 등록에 실패했습니다.');
  }
  return res.json();
}

export async function getJobStatus(taskId: string): Promise<import('../types').JobStatusResponse> {
  const res = await fetch(`/api/etl/jobs/${encodeURIComponent(taskId)}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '태스크 상태 조회 실패');
  }
  return res.json();
}

export async function getActiveJob(): Promise<import('../types').JobStatusResponse | null> {
  try {
    const res = await fetch('/api/etl/jobs/active');
    if (!res.ok) return null;
    const data = await res.json();
    return data.active === false ? null : data;
  } catch {
    return null;
  }
}

export async function saveEtlResult(data: EtlResult): Promise<import('../types').SaveEtlResponse> {
  const res = await fetch('/api/etl/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '수정본 저장에 실패했습니다.');
  }
  return res.json();
}

export async function resetEtlResult(strategy: string = 'general', filename?: string): Promise<EtlResult> {
  const res = await fetch('/api/etl/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy, filename }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '원본 데이터 초기화에 실패했습니다.');
  }
  return res.json();
}

export async function reindexEtlResult(data?: EtlResult): Promise<EtlResult> {
  const res = await fetch('/api/etl/reindex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : JSON.stringify({}),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'ID 재정렬에 실패했습니다.');
  }
  return res.json();
}

// 5. Qdrant & 하이브리드 검색 API
export async function getQdrantConfig(): Promise<import('../types').QdrantConfig> {
  const res = await fetch('/api/qdrant/config');
  if (!res.ok) throw new Error('Qdrant 설정을 불러오지 못했습니다.');
  return res.json();
}

export async function saveQdrantConfig(
  config: import('../types').QdrantConfig
): Promise<{ success: boolean; config: import('../types').QdrantConfig }> {
  const res = await fetch('/api/qdrant/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Qdrant 설정 저장에 실패했습니다.');
  }
  return res.json();
}

export async function testQdrantConnection(
  params?: Partial<import('../types').QdrantConfig>
): Promise<import('../types').QdrantTestResponse> {
  const res = await fetch('/api/qdrant/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Qdrant 연결 테스트 실패');
  }
  return res.json();
}

export async function getQdrantCollections(): Promise<{
  success: boolean;
  current_collection: string;
  collections: string[];
  error?: string;
}> {
  const res = await fetch('/api/qdrant/collections');
  if (!res.ok) {
    throw new Error('Qdrant 컬렉션 목록을 불러오지 못했습니다.');
  }
  return res.json();
}

export async function startEmbedJob(params?: {
  collection_name?: string;
  recreate_collection?: boolean;
  chunks?: any[];
  parent_chunks?: any[];
}): Promise<{ success: boolean; message: string; total_chunks?: number; status: string }> {
  const res = await fetch('/api/etl/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '임베딩 작업 등록 실패');
  }
  return res.json();
}

export async function getEmbedStatus(): Promise<import('../types').EmbedStatusResponse> {
  const res = await fetch('/api/etl/embed/status');
  if (!res.ok) {
    throw new Error('임베딩 상태 조회 실패');
  }
  return res.json();
}

export async function searchTest(
  query: string,
  limit: number = 10,
  collection_name?: string
): Promise<import('../types').SearchTestResponse> {
  const res = await fetch('/api/etl/search/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit, collection_name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '하이브리드 검색 실패');
  }
  return res.json();
}

// 6. LLM 설정 및 청크 텍스트 자동 교정 API
export async function getLLMConfig(): Promise<import('../types').LLMConfig> {
  const res = await fetch('/api/llm/config');
  if (!res.ok) throw new Error('LLM 설정을 불러오지 못했습니다.');
  return res.json();
}

export async function saveLLMConfig(
  config: import('../types').LLMConfig
): Promise<{ success: boolean; config: import('../types').LLMConfig }> {
  const res = await fetch('/api/llm/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'LLM 설정 저장에 실패했습니다.');
  }
  return res.json();
}

export async function getDefaultSystemPrompt(): Promise<{ default_prompt: string }> {
  const res = await fetch('/api/llm/config/default-prompt');
  if (!res.ok) throw new Error('기본 프롬프트를 불러오지 못했습니다.');
  return res.json();
}

export async function getLLMModels(
  baseUrl?: string,
  apiKey?: string
): Promise<{ success: boolean; models: string[] }> {
  const params = new URLSearchParams();
  if (baseUrl) params.append('base_url', baseUrl);
  if (apiKey) params.append('api_key', apiKey);
  const queryStr = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/llm/models${queryStr}`);
  if (!res.ok) throw new Error('모델 목록을 조회하지 못했습니다.');
  return res.json();
}

export async function testLLMConnection(
  params?: Partial<import('../types').LLMConfig>
): Promise<import('../types').LLMTestResponse> {
  const res = await fetch('/api/llm/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'LLM 연결 테스트 실패');
  }
  return res.json();
}

export async function refineChunkText(
  text: string,
  customPrompt?: string
): Promise<import('../types').LLMRefineResponse> {
  const res = await fetch('/api/llm/refine-chunk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, custom_prompt: customPrompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '청크 텍스트 교정 실패');
  }
  return res.json();
}

export async function deletePdfDocument(
  filename: string,
  deleteVectors: boolean = true
): Promise<{ success: boolean; message: string; current_selected_pdf?: string }> {
  const res = await fetch(`/api/pdf/${encodeURIComponent(filename)}?delete_vectors=${deleteVectors}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '문서 삭제에 실패했습니다.');
  }
  return res.json();
}

export async function resetEtlByFilename(
  filename: string,
  deleteVectors: boolean = true
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/api/etl/${encodeURIComponent(filename)}?delete_vectors=${deleteVectors}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || '파싱 산출물 초기화에 실패했습니다.');
  }
  return res.json();
}

// ----------------------------------------------------
// Parser Configuration API
// ----------------------------------------------------

export async function getParserConfig(): Promise<ParserConfig> {
  const res = await fetch('/api/parser/config');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '파서 설정을 불러오지 못했습니다.');
  }
  return res.json();
}

export async function saveParserConfig(
  config: ParserConfig
): Promise<{ success: boolean; config: ParserConfig }> {
  const res = await fetch('/api/parser/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '파서 설정을 저장하지 못했습니다.');
  }
  return res.json();
}

export async function resetParserConfig(): Promise<{ success: boolean; config: ParserConfig }> {
  const res = await fetch('/api/parser/config/reset', {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '파서 설정을 초기화하지 못했습니다.');
  }
  return res.json();
}

// ----------------------------------------------------
// Backup & Restore API
// ----------------------------------------------------

export async function getBackupList(): Promise<BackupListResponse> {
  const res = await fetch('/api/backup/list');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '백업 목록을 불러오지 못했습니다.');
  }
  return res.json();
}

export async function createBackup(
  req: CreateBackupRequest
): Promise<{ success: boolean; manifest: BackupItem; message: string }> {
  const res = await fetch('/api/backup/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '백업 생성에 실패했습니다.');
  }
  return res.json();
}

export async function restoreBackup(
  backupId: string,
  createSafetyBackup: boolean = true
): Promise<RestoreBackupResponse> {
  const res = await fetch(`/api/backup/${encodeURIComponent(backupId)}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ create_safety_backup: createSafetyBackup }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '백업 복원 중 오류가 발생했습니다.');
  }
  return res.json();
}

export async function deleteBackup(
  backupId: string
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/api/backup/${encodeURIComponent(backupId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '백업 삭제에 실패했습니다.');
  }
  return res.json();
}

export async function uploadBackup(
  file: File,
  restoreImmediately: boolean = false
): Promise<{ success: boolean; backup_id: string; manifest: BackupItem; restored: boolean; message: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`/api/backup/upload?restore_immediately=${restoreImmediately}`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '백업 파일 업로드에 실패했습니다.');
  }
  return res.json();
}




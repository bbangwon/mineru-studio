import type { ChildChunk, EmbeddedTableItem } from '../types';
import { getChunkKind } from './chunkKindUtils';

/**
 * 청크의 페이지 번호/범위를 읽기 쉬운 문자열로 포맷팅합니다. (예: "p.3", "p.3~p.5")
 */
export function formatChunkPage(chunk: Pick<ChildChunk, 'page_number' | 'page_end'>): string {
  const start = chunk.page_number || 1;
  const end = chunk.page_end;
  if (end && end > start) {
    return `p.${start}~p.${end}`;
  }
  return `p.${start}`;
}

/**
 * 청크의 페이지 번호/범위를 "Page 3" 또는 "Page 3~5" 형식으로 포맷팅합니다.
 */
export function formatChunkPageFull(chunk: Pick<ChildChunk, 'page_number' | 'page_end'>): string {
  const start = chunk.page_number || 1;
  const end = chunk.page_end;
  if (end && end > start) {
    return `Page ${start}~${end}`;
  }
  return `Page ${start}`;
}

/**
 * 시작 페이지와 끝 페이지 사이의 연속된 페이지 번호 배열을 반환합니다.
 */
export function getChunkPageList(startPage: number, endPage?: number): number[] {
  const start = startPage || 1;
  const end = endPage && endPage >= start ? endPage : start;
  const pages: number[] = [];
  for (let p = start; p <= end; p++) {
    pages.push(p);
  }
  return pages;
}

/**
 * 청크의 최상위 page_number와 page_end를 metadata 내부에 일관되게 동기화합니다.
 * - page: 단일 검색 호환 (시작 페이지)
 * - page_start: 범위 시작 페이지
 * - page_end: 범위 끝 페이지
 * - pages: 다중 페이지 매칭 검색용 배열
 */
export function syncChunkPageMetadata(
  metadata: Record<string, any> | undefined,
  pageNumber: number,
  pageEnd?: number
): Record<string, any> {
  const start = pageNumber || 1;
  const end = pageEnd && pageEnd >= start ? pageEnd : start;
  const pages = getChunkPageList(start, end);

  const updated = { ...(metadata || {}) };
  updated.page = start;
  updated.page_start = start;
  updated.page_end = end;
  updated.pages = pages;

  return updated;
}

/**
 * 청크의 물리 페이지 및 표 구조/문서 식별 정보를 metadata 객체와 일관되게 동기화합니다.
 */
export function syncChunkSystemMetadata(
  chunk: Pick<ChildChunk, 'metadata' | 'page_number' | 'page_end' | 'chunk_type' | 'tables' | 'raw_html' | 'is_table' | 'is_atomic_table'>,
  docTitle?: string
): Record<string, any> {
  const pageMeta = syncChunkPageMetadata(chunk.metadata, chunk.page_number, chunk.page_end);
  const tableSummary = computeTableMetadata(chunk);

  const updated: Record<string, any> = {
    ...pageMeta,
    ...tableSummary,
  };

  if (chunk.chunk_type) {
    updated.chunk_type = chunk.chunk_type;
    updated.type = chunk.chunk_type;
  }

  if (docTitle) {
    updated.doc_title = docTitle;
  }

  return updated;
}

/**
 * 시스템 예약 메타데이터 키 목록입니다.
 * - 청크 유형 및 도메인 구조: chunk_type, type (시스템 자동 추적/계산 속성)
 * - 문서/청크 식별자: doc_id, doc_title, chunk_id, parent_chunk_id, section_id 등
 * - 페이지/출처 좌표: page, page_start, page_end, pages, page_idx, page_number 등
 * - 표(Table) 구조/파생 속성: is_table, is_atomic_table, has_tables, table_count, tables 등
 * - 본문/제목/계층: text, parent_text, title, breadcrumbs, heading_hierarchy 등
 * - 통계/이미지: token_count, token_estimate, char_length, has_image 등
 * 커스텀 메타데이터 입력, 복사/상속, 일괄 적용 시 이 키들은 원천 보호 및 제외됩니다.
 */
export const RESERVED_METADATA_KEYS = new Set([
  // 1. 청크 유형 및 도메인 구조 (시스템 자동 추적 속성)
  'chunk_type',
  'type',

  // 2. 문서 및 청크 식별자
  'doc_id',
  'doc_title',
  'chunk_id',
  'parent_chunk_id',
  'section_id',
  'id',

  // 3. 페이지 및 물리 좌표
  'page',
  'page_start',
  'page_end',
  'pages',
  'page_idx',
  'page_number',

  // 4. 표(Table) 구조 및 파생 속성 (시스템 자동 추적/계산 대상)
  'is_table',
  'is_atomic_table',
  'has_tables',
  'table_count',
  'tables',
  'table_type',
  'table_caption',
  'table_footnote',
  'raw_html',

  // 5. 본문 문맥 및 제목/계층 정보
  'text',
  'parent_text',
  'title',
  'breadcrumbs',
  'heading_hierarchy',

  // 6. 이미지 및 텍스트/토큰 통계
  'has_image',
  'image_path',
  'image_url',
  'token_count',
  'token_estimate',
  'char_length',
]);

/**
 * 청크의 실제 데이터(tables, raw_html, chunk_type)로부터 표 관련 상태를 자동 계산합니다.
 */
export interface TableMetadataSummary {
  has_tables: boolean;
  table_count: number;
  is_table: boolean;
  is_atomic_table: boolean;
}

export function computeTableMetadata(
  chunk: Pick<ChildChunk, 'chunk_type' | 'tables' | 'raw_html' | 'is_table' | 'is_atomic_table'>
): TableMetadataSummary {
  const rawTables = chunk.tables;
  const tableListCount = Array.isArray(rawTables) ? rawTables.length : 0;
  const hasHtmlTable = Boolean(chunk.raw_html && /<table[\s>]/i.test(chunk.raw_html));
  const isTableType = chunk.chunk_type === 'table';

  const has_tables = tableListCount > 0 || hasHtmlTable || isTableType || Boolean(chunk.is_table);
  const table_count = tableListCount > 0 ? tableListCount : (has_tables ? 1 : 0);
  const is_table = isTableType || has_tables;
  const is_atomic_table = Boolean(
    chunk.is_atomic_table || (isTableType && table_count <= 1)
  );

  return {
    has_tables,
    table_count,
    is_table,
    is_atomic_table,
  };
}

/**
 * 메타데이터 객체에서 시스템/페이지 관련 키를 제외하고 순수 커스텀 메타데이터만 추출합니다.
 */
export function extractCustomMetadata(metadata?: Record<string, any>): Record<string, any> {
  if (!metadata) return {};
  const custom: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!RESERVED_METADATA_KEYS.has(key)) {
      custom[key] = value;
    }
  }
  return custom;
}

/**
 * 원본 메타데이터에 새 커스텀 메타데이터를 안전하게 병합하고,
 * 대상 청크의 pageNumber와 pageEnd를 온전히 유지하여 최종 메타데이터를 생성합니다.
 */
export function mergeMetadataWithPage(
  baseMeta: Record<string, any> | undefined,
  incomingMeta: Record<string, any> | undefined,
  pageNumber: number,
  pageEnd?: number
): Record<string, any> {
  const customBase = extractCustomMetadata(baseMeta);
  const customIncoming = extractCustomMetadata(incomingMeta);
  const merged = { ...customBase, ...customIncoming };
  return syncChunkPageMetadata(merged, pageNumber, pageEnd);
}

export interface BulkMetadataUpdateParams {
  chunks: ChildChunk[];
  mode: 'add_tag' | 'apply_batch' | 'delete_tag';
  key?: string;
  value?: any;
  tags?: Record<string, any>;
  scope: 'all' | 'section';
  sectionId?: string;
  overwrite?: boolean;
}

export interface BulkMetadataUpdateResult {
  updatedChunks: ChildChunk[];
  affectedCount: number;
}

/**
 * 청크 목록에 커스텀 메타데이터를 일괄 추가/수정/삭제합니다.
 * 시스템 예약어(페이지 번호, 식별자 등)는 안전하게 보호됩니다.
 */
export function applyBulkCustomMetadata(params: BulkMetadataUpdateParams): BulkMetadataUpdateResult {
  const { chunks, mode, key, value, tags, scope, sectionId, overwrite = true } = params;
  let affectedCount = 0;

  const updatedChunks = chunks.map((chunk) => {
    if (scope === 'section' && sectionId) {
      const cSec = chunk.section_id || chunk.parent_id;
      if (cSec !== sectionId) {
        return chunk;
      }
    }

    const currentMeta = { ...(chunk.metadata || {}) };
    let changed = false;

    if (mode === 'add_tag' && key) {
      const trimmedKey = key.trim();
      if (!trimmedKey || RESERVED_METADATA_KEYS.has(trimmedKey)) return chunk;
      if (overwrite || !(trimmedKey in currentMeta)) {
        if (currentMeta[trimmedKey] !== value) {
          currentMeta[trimmedKey] = value;
          changed = true;
        }
      }
    } else if (mode === 'apply_batch' && tags) {
      for (const [rawK, rawV] of Object.entries(tags)) {
        const trimmedK = rawK.trim();
        if (!trimmedK || RESERVED_METADATA_KEYS.has(trimmedK)) continue;
        if (overwrite || !(trimmedK in currentMeta)) {
          if (currentMeta[trimmedK] !== rawV) {
            currentMeta[trimmedK] = rawV;
            changed = true;
          }
        }
      }
    } else if (mode === 'delete_tag' && key) {
      const trimmedKey = key.trim();
      if (!trimmedKey || RESERVED_METADATA_KEYS.has(trimmedKey)) return chunk;
      if (trimmedKey in currentMeta) {
        delete currentMeta[trimmedKey];
        changed = true;
      }
    }

    if (changed) {
      affectedCount++;
      return {
        ...chunk,
        is_edited: true,
        metadata: syncChunkPageMetadata(currentMeta, chunk.page_number, chunk.page_end),
      };
    }
    return chunk;
  });

  return { updatedChunks, affectedCount };
}

/**
 * 청크 목록 전체에서 사용 중인 순수 커스텀 메타데이터 키 목록을 고유하게 수집합니다.
 */
export function getAllCustomMetadataKeys(chunks: ChildChunk[]): string[] {
  const keysSet = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.metadata) {
      for (const k of Object.keys(chunk.metadata)) {
        if (!RESERVED_METADATA_KEYS.has(k)) {
          keysSet.add(k);
        }
      }
    }
  }
  return Array.from(keysSet).sort();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 복합(composite) 청크의 raw_html에 문단 태그(<p>)가 누락되어 있거나 표만 존재하는 경우,
 * chunk.text(마크다운 본문)와 chunk.tables(표 HTML)를 매칭하여
 * 원본 문서 순서(문단 + 표 + 문단 + 표 ...) 그대로 복원된 통합 HTML 문자열을 생성합니다.
 */
export function reconstructCompositeHtml(
  chunk: Pick<ChildChunk, 'raw_html' | 'text' | 'tables' | 'metadata' | 'chunk_type'>,
  force: boolean = false
): string {
  const raw = chunk.raw_html || '';
  // force가 false이고 이미 문단 태그(<p>, <div>, <span>)가 포함되어 있다면 원형 그대로 유지
  if (!force && raw && /<p\b|<div\b|<span\b/i.test(raw)) {
    return raw;
  }

  const tables: EmbeddedTableItem[] = chunk.tables || chunk.metadata?.tables || [];
  let tableHtmls = tables.map((t) => t.raw_html).filter(Boolean) as string[];
  if (tableHtmls.length === 0 && raw) {
    const matched = raw.match(/<table\b[\s\S]*?<\/table>/gi);
    if (matched) {
      tableHtmls = matched;
    }
  }

  if (!chunk.text) {
    return (tableHtmls.length > 0 ? tableHtmls.join('\n\n') : raw) || '<p>내용 없음</p>';
  }

  const blocks = chunk.text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  let tblIdx = 0;
  const parts: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const isMdTable =
      (lines.some((l) => l.trim().startsWith('|')) && lines.some((l) => l.includes('---'))) ||
      (/\|/g.test(block) && /---/g.test(block));
    const isTablePlaceholder = (block === '[표]' || /^\[표\s*\d*\]$/.test(block)) && !isMdTable;

    if (isMdTable || isTablePlaceholder) {
      if (tblIdx < tableHtmls.length && tableHtmls[tblIdx]) {
        parts.push(tableHtmls[tblIdx]);
        tblIdx++;
      } else {
        const escaped = escapeHtml(block).replace(/\n/g, '<br/>');
        parts.push(`<div class="markdown-table-fallback p-2 rounded bg-slate-100 dark:bg-slate-900">${escaped}</div>`);
      }
    } else {
      const escaped = escapeHtml(block).replace(/\n/g, '<br/>');
      parts.push(`<p>${escaped}</p>`);
    }
  }

  while (tblIdx < tableHtmls.length) {
    if (tableHtmls[tblIdx]) {
      parts.push(tableHtmls[tblIdx]);
    }
    tblIdx++;
  }

  return parts.join('\n\n') || raw || chunk.text || '<p>내용 없음</p>';
}

/**
 * composite 청크의 raw_html에 문단 태그가 누락된 경우,
 * reconstructCompositeHtml을 이용해 raw_html을 완성형으로 복원합니다.
 * 단독 표(table) 청크가 <p> 태그로 오염된 경우 tables[0].raw_html로 자가 복구합니다.
 */
export function healCompositeChunk(chunk: ChildChunk): ChildChunk {
  const kind = getChunkKind(chunk);
  if (kind !== 'composite') {
    if (kind === 'table') {
      const tables: EmbeddedTableItem[] = chunk.tables || chunk.metadata?.tables || [];
      const cleanHtml = tables[0]?.raw_html;
      if (cleanHtml && chunk.raw_html && /<p\b|<div\b|<span\b/i.test(chunk.raw_html)) {
        return {
          ...chunk,
          raw_html: cleanHtml,
        };
      }
    }
    return chunk;
  }

  const currentRaw = chunk.raw_html || '';
  if (!currentRaw || !/<p\b|<div\b|<span\b/i.test(currentRaw)) {
    const healedRaw = reconstructCompositeHtml(chunk);
    if (healedRaw && healedRaw !== currentRaw) {
      return {
        ...chunk,
        raw_html: healedRaw,
      };
    }
  }
  return chunk;
}


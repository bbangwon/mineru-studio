import type { ChildChunk } from '../types';

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
 * 페이지 및 청크 식별용 시스템 예약 메타데이터 키 목록입니다.
 * 커스텀 메타데이터 복사/상속 시 이 키들은 제외됩니다.
 */
export const RESERVED_METADATA_KEYS = new Set([
  'page',
  'page_start',
  'page_end',
  'pages',
  'chunk_id',
  'parent_chunk_id',
  'section_id',
  'id',
  'has_image',
  'image_path',
  'image_url',
  'is_table',
  'is_atomic_table',
]);

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


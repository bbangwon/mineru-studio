import type { ChildChunk, EmbeddedTableItem } from '../types';

export type ChunkDisplayKind = 'article' | 'table' | 'composite' | 'paragraph';

/**
 * 청크에 실제 표 데이터(tables 배열 또는 raw_html <table>)가 존재하는지 확인합니다.
 */
export function hasTableData(chunk: Partial<ChildChunk> | null | undefined): boolean {
  if (!chunk) return false;
  const tables = (chunk.tables || chunk.metadata?.tables || []) as EmbeddedTableItem[];
  if (tables && tables.length > 0) return true;
  if (chunk.is_table || chunk.is_atomic_table || chunk.chunk_type === 'table') return true;
  if (chunk.raw_html && /<table/i.test(chunk.raw_html)) return true;
  return false;
}

/**
 * 청크에 순수 본문 텍스트(마크다운 표 제외)가 존재하는지 확인합니다.
 */
export function hasBodyText(chunk: Partial<ChildChunk> | null | undefined): boolean {
  if (!chunk || !chunk.text) return false;
  const trimmed = chunk.text.trim();
  if (!trimmed) return false;

  const caption = (chunk.table_caption || '').trim();
  const footnote = (chunk.table_footnote || '').trim();

  // 표 마크다운 문법(| ... |), 캡션([표...]), 각주(*, ※)를 제외한 순수 텍스트가 존재하는지 판별
  const nonTableText = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith('|')) return false;
      if (line.startsWith('[표') || (caption && line.includes(caption))) return false;
      if (line.startsWith('*') || line.startsWith('※') || line.startsWith('출처:') || (footnote && line.includes(footnote))) return false;
      return true;
    })
    .join('')
    .trim();

  return nonTableText.length > 0;
}

/**
 * 청크가 법률 조문인지 확인합니다.
 * metadata.article_no 또는 breadcrumbs 패턴 기반
 */
export function isArticleChunk(chunk: Partial<ChildChunk> | null | undefined): boolean {
  if (!chunk) return false;
  const meta = chunk.metadata || {};
  if (meta.article_no || meta.article_number) return true;
  if (chunk.chunk_type === 'article' || chunk.chunk_type === 'article_clause') return true;
  if (chunk.breadcrumbs && chunk.breadcrumbs.some((b) => /^제\s*\d+\s*조/.test(b.trim()))) {
    return true;
  }
  return false;
}

/**
 * 청크의 실제 데이터(tables, text, metadata)를 기반으로 UI 표시 종류를 동적 계산(Derived)합니다.
 * 
 * 우선순위:
 * 1. 조문 메타데이터 존재 -> 'article'
 * 2. 표 포함 & 본문 텍스트 존재 -> 'composite'
 * 3. 표 포함 & 본문 텍스트 부재 -> 'table'
 * 4. 기본 문단 -> 'paragraph'
 */
export function getChunkKind(chunk: Partial<ChildChunk> | null | undefined): ChunkDisplayKind {
  if (!chunk) return 'paragraph';

  if (isArticleChunk(chunk)) {
    return 'article';
  }

  const tableExists = hasTableData(chunk);
  const bodyExists = hasBodyText(chunk);
  const tables = ((chunk.tables || chunk.metadata?.tables || []) as EmbeddedTableItem[]);
  const tableCount = tables.length;

  if (tableExists && (bodyExists || tableCount > 1)) {
    return 'composite';
  }
  if (tableExists) {
    return 'table';
  }
  return 'paragraph';
}

/**
 * 청크 종류에 따른 사용자 친화적 한국어 라벨을 반환합니다.
 */
export function getChunkKindLabel(kind: ChunkDisplayKind, tableCount: number = 0): string {
  switch (kind) {
    case 'article':
      return '조문';
    case 'composite':
      return tableCount > 0 ? `복합 (표 ${tableCount})` : '복합 청크';
    case 'table':
      return '원형 표';
    case 'paragraph':
    default:
      return '문단';
  }
}

/**
 * 청크 종류에 따른 뱃지 스타일 클래스명을 반환합니다.
 */
export function getChunkKindBadgeClass(kind: ChunkDisplayKind): string {
  switch (kind) {
    case 'article':
      return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700';
    case 'composite':
      return 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700';
    case 'table':
      return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700';
    case 'paragraph':
    default:
      return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700';
  }
}

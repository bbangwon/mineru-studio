import type { ChildChunk, EmbeddedTableItem } from '../types';
import { estimateKoreanTokens } from './idUtils';

export interface TextBlock {
  type: 'paragraph' | 'table';
  text: string;
  startIndex: number;
  endIndex: number;
}

/**
 * 텍스트 내에서 Markdown 표 구간([start, end] 문자 인덱스 범위)을 감지합니다.
 * Markdown 표는 하나 이상의 '|'로 시작하는 라인과 구분자('---')를 포함하는 블록입니다.
 */
export function detectTableRanges(text: string): { start: number; end: number }[] {
  if (!text) return [];

  const ranges: { start: number; end: number }[] = [];
  const lines = text.split('\n');
  let currentOffset = 0;
  let inTable = false;
  let tableStart = 0;
  let hasDelimiter = false;
  let tableLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineStart = currentOffset;
    const lineEnd = currentOffset + line.length;

    const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length >= 2;
    const isDelimiterRow = isTableRow && /^[|:\s-]+$/.test(trimmed) && trimmed.includes('---');

    if (isTableRow) {
      if (!inTable) {
        inTable = true;
        tableStart = lineStart;
        hasDelimiter = isDelimiterRow;
        tableLines = [trimmed];
      } else {
        if (isDelimiterRow) hasDelimiter = true;
        tableLines.push(trimmed);
      }
    } else {
      if (inTable) {
        // 테이블 종료 처리
        if (tableLines.length >= 2 && hasDelimiter) {
          ranges.push({ start: tableStart, end: currentOffset - 1 });
        }
        inTable = false;
        hasDelimiter = false;
        tableLines = [];
      }
    }

    currentOffset = lineEnd + 1; // +1 for '\n'
  }

  // 마지막 라인이 테이블인 경우
  if (inTable && tableLines.length >= 2 && hasDelimiter) {
    ranges.push({ start: tableStart, end: text.length });
  }

  return ranges;
}

/**
 * 텍스트가 Markdown 표 또는 표 구조를 포함하고 있는지 확인합니다.
 */
export function hasMarkdownTable(text: string): boolean {
  if (!text) return false;
  const ranges = detectTableRanges(text);
  if (ranges.length > 0) return true;
  // 단독 [표] 플레이스홀더나 <table 태그도 감지
  if (text.includes('<table') || /^\s*\[표(?:\s*\d+)?\]/m.test(text)) {
    return true;
  }
  return false;
}

/**
 * 텍스트 전체가 오직 하나의 표로만 구성되어 있는지(단독 표 여부) 판별합니다.
 */
export function isPureTable(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const ranges = detectTableRanges(trimmed);
  if (ranges.length === 1) {
    const r = ranges[0];
    // 표 외 앞뒤 여백 및 공백만 있는 경우
    const nonTablePrefix = trimmed.slice(0, r.start).trim();
    const nonTableSuffix = trimmed.slice(r.end).trim();
    return nonTablePrefix.length === 0 && nonTableSuffix.length === 0;
  }
  return false;
}

/**
 * 텍스트를 문단 블록과 표 블록으로 순서대로 분해합니다.
 */
export function parseTextBlocks(text: string): TextBlock[] {
  if (!text) return [];
  const ranges = detectTableRanges(text);
  if (ranges.length === 0) {
    return [
      {
        type: 'paragraph',
        text: text.trim(),
        startIndex: 0,
        endIndex: text.length,
      },
    ];
  }

  const blocks: TextBlock[] = [];
  let lastIndex = 0;

  for (const r of ranges) {
    if (r.start > lastIndex) {
      const pText = text.slice(lastIndex, r.start).trim();
      if (pText) {
        blocks.push({
          type: 'paragraph',
          text: pText,
          startIndex: lastIndex,
          endIndex: r.start,
        });
      }
    }

    const tText = text.slice(r.start, r.end).trim();
    if (tText) {
      blocks.push({
        type: 'table',
        text: tText,
        startIndex: r.start,
        endIndex: r.end,
      });
    }

    lastIndex = r.end;
  }

  if (lastIndex < text.length) {
    const pText = text.slice(lastIndex).trim();
    if (pText) {
      blocks.push({
        type: 'paragraph',
        text: pText,
        startIndex: lastIndex,
        endIndex: text.length,
      });
    }
  }

  return blocks;
}

/**
 * 특정 분할 인덱스가 표의 내부(헤더/구분선/행 사이)를 관통하고 있는지 검사합니다.
 */
export function isInsideTable(splitIndex: number, text: string): boolean {
  const ranges = detectTableRanges(text);
  for (const r of ranges) {
    // 표 시작 바로 앞(r.start)이나 표 끝 바로 뒤(r.end)는 경계선이므로 허용
    if (splitIndex > r.start && splitIndex < r.end) {
      return true;
    }
  }
  return false;
}

/**
 * 분할 인덱스가 표 내부를 침범했을 때, 가장 가까운 표의 안전 경계(표 시작 직전 또는 표 끝 직후)를 찾습니다.
 */
export function findNearestTableBoundary(splitIndex: number, text: string): number {
  const ranges = detectTableRanges(text);
  for (const r of ranges) {
    if (splitIndex > r.start && splitIndex < r.end) {
      const distToStart = splitIndex - r.start;
      const distToEnd = r.end - splitIndex;
      return distToStart <= distToEnd ? r.start : r.end;
    }
  }
  return splitIndex;
}

/**
 * 복합 청크(Composite Chunk)에서 첫 번째 블록 경계(문단 ↔ 표 경계) 인덱스를 찾습니다.
 */
export function findBlockSeparationIndex(text: string): number | null {
  const blocks = parseTextBlocks(text);
  if (blocks.length <= 1) return null;

  // 가장 균형 잡힌 첫 번째 전환 지점 (Block 0 과 Block 1 사이)
  const firstBlock = blocks[0];
  return firstBlock.endIndex;
}

/**
 * 청크 분할 후 텍스트와 원본 메타데이터를 기반으로
 * 각 파트의 청크 타입(`paragraph`, `table`, `composite`) 및 표 메타데이터를 파생합니다.
 */
export function deriveChunkTypeAndTables(
  partText: string,
  originalChunk?: ChildChunk
): {
  chunk_type: 'paragraph' | 'table' | 'composite' | 'article_clause' | 'article';
  is_table: boolean;
  is_atomic_table: boolean;
  tables?: EmbeddedTableItem[];
  raw_html?: string;
  table_caption?: string;
  table_footnote?: string;
} {
  const trimmed = partText.trim();
  const hasTable = hasMarkdownTable(trimmed);
  const pureTable = isPureTable(trimmed);

  const origTables = originalChunk?.tables || [];
  const origRawHtml = originalChunk?.raw_html || '';

  // 1. 순수 문단인 경우 (표 없음)
  if (!hasTable) {
    const isLegalArticle =
      originalChunk?.chunk_type === 'article' || originalChunk?.chunk_type === 'article_clause';
    return {
      chunk_type: isLegalArticle ? originalChunk.chunk_type : 'paragraph',
      is_table: false,
      is_atomic_table: false,
      tables: undefined,
      raw_html: undefined,
      table_caption: undefined,
      table_footnote: undefined,
    };
  }

  // 2. 단독 표인 경우 (본문 텍스트 없이 표만 존재)
  if (pureTable) {
    // 표 HTML 추출 (원본에 HTML 표가 있다면 매칭)
    const tableHtmlMatches = origRawHtml.match(/<table\b[\s\S]*?<\/table>/gi) || [];
    const matchedHtml = tableHtmlMatches.length > 0 ? tableHtmlMatches[0] : origRawHtml;

    return {
      chunk_type: 'table',
      is_table: true,
      is_atomic_table: true,
      tables: origTables.length > 0 ? [origTables[0]] : undefined,
      raw_html: matchedHtml || undefined,
      table_caption: originalChunk?.table_caption,
      table_footnote: originalChunk?.table_footnote,
    };
  }

  // 3. 복합 청크인 경우 (문단과 표가 혼합됨)
  return {
    chunk_type: 'composite',
    is_table: true,
    is_atomic_table: false,
    tables: origTables.length > 0 ? origTables : undefined,
    raw_html: origRawHtml || undefined,
    table_caption: originalChunk?.table_caption,
    table_footnote: originalChunk?.table_footnote,
  };
}

/**
 * 청크 병합 시 선택된 청크들의 속성(`chunk_type`, `tables`, `raw_html`, `caption`, `footnote`)을
 * 규칙에 따라 통합 결합합니다.
 */
export function mergeChunkAssets(selectedChunks: ChildChunk[]): {
  chunk_type: 'paragraph' | 'table' | 'composite' | 'article_clause' | 'article';
  is_table: boolean;
  is_atomic_table: boolean;
  tables: EmbeddedTableItem[];
  raw_html?: string;
  table_caption?: string;
  table_footnote?: string;
} {
  if (selectedChunks.length === 0) {
    return {
      chunk_type: 'paragraph',
      is_table: false,
      is_atomic_table: false,
      tables: [],
    };
  }

  const hasAnyTableChunk = selectedChunks.some(
    (c) => c.chunk_type === 'table' || c.chunk_type === 'composite' || c.is_table || (c.tables && c.tables.length > 0)
  );

  // 1. 모든 청크가 일반 문단인 경우
  if (!hasAnyTableChunk) {
    const isAllLegal = selectedChunks.every(
      (c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause'
    );
    return {
      chunk_type: isAllLegal ? 'article' : 'paragraph',
      is_table: false,
      is_atomic_table: false,
      tables: [],
      raw_html: undefined,
      table_caption: undefined,
      table_footnote: undefined,
    };
  }

  // 2. 표가 포함된 경우 -> 무조건 복합 청크(composite)로 승격 (복수 표 또는 문단+표 결합)
  const allTables: EmbeddedTableItem[] = [];
  const htmlParts: string[] = [];
  const captions: string[] = [];
  const footnotes: string[] = [];

  for (let i = 0; i < selectedChunks.length; i++) {
    const chunk = selectedChunks[i];

    // 개별 표 객체 수집 및 table_index 재부여
    if (chunk.tables && chunk.tables.length > 0) {
      for (const t of chunk.tables) {
        allTables.push({
          ...t,
          table_index: allTables.length,
        });
      }
    } else if (chunk.chunk_type === 'table' && chunk.raw_html) {
      allTables.push({
        table_index: allTables.length,
        caption: chunk.table_caption,
        footnote: chunk.table_footnote,
        raw_html: chunk.raw_html,
        token_estimate: chunk.token_estimate || estimateKoreanTokens(chunk.text),
        page_number: chunk.page_number,
        page_end: chunk.page_end,
      });
    }

    // HTML 부분 조립: 표 HTML이 있으면 그대로 사용, 없으면 <p> 태그 래핑
    if (chunk.raw_html && chunk.raw_html.trim()) {
      htmlParts.push(chunk.raw_html.trim());
    } else if (chunk.text && chunk.text.trim()) {
      const escaped = chunk.text
        .trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');
      htmlParts.push(`<p>${escaped}</p>`);
    }

    if (chunk.table_caption && chunk.table_caption.trim()) {
      captions.push(chunk.table_caption.trim());
    }
    if (chunk.table_footnote && chunk.table_footnote.trim()) {
      footnotes.push(chunk.table_footnote.trim());
    }
  }

  const combinedRawHtml = htmlParts.length > 0 ? htmlParts.join('\n\n') : undefined;
  const combinedCaption = captions.length > 0 ? Array.from(new Set(captions)).join(' / ') : undefined;
  const combinedFootnote = footnotes.length > 0 ? Array.from(new Set(footnotes)).join(' / ') : undefined;

  return {
    chunk_type: 'composite',
    is_table: true,
    is_atomic_table: false,
    tables: allTables,
    raw_html: combinedRawHtml,
    table_caption: combinedCaption,
    table_footnote: combinedFootnote,
  };
}

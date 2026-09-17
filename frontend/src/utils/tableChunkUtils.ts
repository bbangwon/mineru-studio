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
  }

  const combinedRawHtml = htmlParts.length > 0 ? htmlParts.join('\n\n') : undefined;

  return {
    chunk_type: 'composite',
    is_table: true,
    is_atomic_table: false,
    tables: allTables,
    raw_html: combinedRawHtml,
    table_caption: undefined,
    table_footnote: undefined,
  };
}

/**
 * 셀 병합(colSpan, rowSpan)을 지원하는 표 셀 모델
 */
export interface TableCell {
  text: string;
  colSpan?: number;         // 가로 병합 (기본 1)
  rowSpan?: number;         // 세로 병합 (기본 1)
  isMergedHidden?: boolean; // 다른 셀에 의해 덮여 화면에 직접 표시되지 않는 셀
}

export type TableGrid = TableCell[][];

/**
 * 기본 N행 M열의 빈 TableGrid를 생성합니다.
 */
export function createDefaultTableGrid(rowCount = 3, colCount = 3): TableGrid {
  const grid: TableGrid = [];
  for (let r = 0; r < rowCount; r++) {
    const row: TableCell[] = [];
    for (let c = 0; c < colCount; c++) {
      row.push({
        text: r === 0 ? `항목 ${c + 1}` : `내용 ${r}-${c + 1}`,
        colSpan: 1,
        rowSpan: 1,
        isMergedHidden: false,
      });
    }
    grid.push(row);
  }
  return grid;
}

/**
 * HTML 문자열을 TableGrid로 파싱합니다.
 * <td colspan="..." rowspan="..."> 속성을 완벽히 인식하여 그리드 매트릭스에 매핑합니다.
 */
export function parseHtmlTableToGrid(html: string): {
  grid: TableGrid;
  caption?: string;
  footnote?: string;
} {
  const defaultRes = { grid: createDefaultTableGrid(3, 3), caption: undefined, footnote: undefined };
  if (!html || !html.trim()) return defaultRes;

  // 브라우저 DOMParser 사용
  let parser: DOMParser;
  try {
    parser = new DOMParser();
  } catch {
    return defaultRes;
  }

  const doc = parser.parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return defaultRes;

  const captionEl = table.querySelector('caption');
  const caption = captionEl ? captionEl.textContent?.trim() : undefined;

  const trEls = Array.from(table.querySelectorAll('tr'));
  if (trEls.length === 0) return defaultRes;

  // 1차 패스: 행 수 및 열 수 추정
  const tempGrid: (TableCell | null)[][] = [];

  for (let r = 0; r < trEls.length; r++) {
    if (!tempGrid[r]) tempGrid[r] = [];
    const tr = trEls[r];
    const cellEls = Array.from(tr.querySelectorAll('th, td'));

    let cIndex = 0;
    for (const cellEl of cellEls) {
      // 이미 이전 행의 rowspan에 의해 채워진 열 건너뛰기
      while (tempGrid[r][cIndex] !== undefined) {
        cIndex++;
      }

      const cs = parseInt(cellEl.getAttribute('colspan') || '1', 10) || 1;
      const rs = parseInt(cellEl.getAttribute('rowspan') || '1', 10) || 1;
      const text = cellEl.textContent?.trim() || '';

      // 기준 셀 배치
      tempGrid[r][cIndex] = {
        text,
        colSpan: cs,
        rowSpan: rs,
        isMergedHidden: false,
      };

      // colspan / rowspan 범위의 가려진 셀 채우기
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (dr === 0 && dc === 0) continue;
          const targetR = r + dr;
          const targetC = cIndex + dc;
          if (!tempGrid[targetR]) tempGrid[targetR] = [];
          tempGrid[targetR][targetC] = {
            text: '',
            colSpan: 1,
            rowSpan: 1,
            isMergedHidden: true,
          };
        }
      }

      cIndex += cs;
    }
  }

  // 열 수 균일화 (정규화)
  const maxCols = Math.max(...tempGrid.map((row) => row.length), 1);
  const finalGrid: TableGrid = [];

  for (let r = 0; r < tempGrid.length; r++) {
    const row: TableCell[] = [];
    for (let c = 0; c < maxCols; c++) {
      const cell = tempGrid[r]?.[c];
      if (cell) {
        row.push(cell);
      } else {
        row.push({ text: '', colSpan: 1, rowSpan: 1, isMergedHidden: false });
      }
    }
    finalGrid.push(row);
  }

  return {
    grid: finalGrid.length > 0 ? finalGrid : createDefaultTableGrid(3, 3),
    caption,
  };
}

/**
 * TableGrid를 표준 HTML <table> 문자열로 직렬화합니다.
 */
export function gridToHtmlTable(
  grid: TableGrid,
  caption?: string,
  footnote?: string
): string {
  if (!grid || grid.length === 0) return '';

  const lines: string[] = ['<table class="mineru-table border-collapse border border-slate-300 dark:border-slate-700 w-full text-xs">'];

  if (caption && caption.trim()) {
    lines.push(`  <caption class="font-bold text-slate-700 dark:text-slate-300 text-left py-1">${caption.trim()}</caption>`);
  }

  lines.push('  <tbody>');
  for (let r = 0; r < grid.length; r++) {
    lines.push('    <tr>');
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (cell.isMergedHidden) continue; // 병합으로 덮인 셀은 렌더링하지 않음

      const tag = r === 0 ? 'th' : 'td';
      const csAttr = cell.colSpan && cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '';
      const rsAttr = cell.rowSpan && cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '';
      const bgClass = r === 0 ? 'bg-slate-100 dark:bg-slate-800 font-semibold' : 'bg-white dark:bg-slate-900';
      const escapedText = (cell.text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>');

      lines.push(`      <${tag}${csAttr}${rsAttr} class="border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 ${bgClass}">${escapedText}</${tag}>`);
    }
    lines.push('    </tr>');
  }
  lines.push('  </tbody>');

  if (footnote && footnote.trim()) {
    lines.push(`  <tfoot><tr><td colspan="${grid[0]?.length || 1}" class="text-[10px] text-slate-500 py-1 italic">${footnote.trim()}</td></tr></tfoot>`);
  }

  lines.push('</table>');
  return lines.join('\n');
}

/**
 * Markdown 표 문자열을 TableGrid로 파싱합니다.
 */
export function parseMarkdownTableToGrid(mdText: string): TableGrid {
  if (!mdText) return createDefaultTableGrid(3, 3);
  const lines = mdText.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|') && l.endsWith('|'));
  if (lines.length < 2) return createDefaultTableGrid(3, 3);

  const grid: TableGrid = [];
  for (const line of lines) {
    if (/^[|:\s-]+$/.test(line) && line.includes('---')) {
      continue; // 구분선 행 스킵
    }
    // 양 끝 '|' 제거 후 셀 분할
    const content = line.slice(1, -1);
    const cells = content.split('|').map((c) => ({
      text: c.trim(),
      colSpan: 1,
      rowSpan: 1,
      isMergedHidden: false,
    }));
    grid.push(cells);
  }

  return grid.length > 0 ? grid : createDefaultTableGrid(3, 3);
}

/**
 * TableGrid를 RAG 검색 임베딩용 Markdown 파이프 표로 변환합니다.
 */
export function gridToMarkdownTable(grid: TableGrid): string {
  if (!grid || grid.length === 0) return '';
  const numCols = Math.max(...grid.map((r) => r.length), 1);
  const lines: string[] = [];

  for (let r = 0; r < grid.length; r++) {
    const rowCells: string[] = [];
    for (let c = 0; c < numCols; c++) {
      const cell = grid[r]?.[c];
      const text = cell && !cell.isMergedHidden ? cell.text.replace(/\|/g, '\\|').replace(/\n/g, ' ') : '';
      rowCells.push(text);
    }
    lines.push(`| ${rowCells.join(' | ')} |`);

    // 1행(헤더) 다음에 구분선 삽입
    if (r === 0) {
      const delimiters = Array(numCols).fill('---');
      lines.push(`| ${delimiters.join(' | ')} |`);
    }
  }

  return lines.join('\n');
}

/**
 * 엑셀 또는 스프레드시트에서 복사한 탭 구분 텍스트(TSV)를 TableGrid로 변환합니다.
 */
export function parseTsvToGrid(tsvText: string): TableGrid {
  if (!tsvText) return createDefaultTableGrid(3, 3);
  const lines = tsvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return createDefaultTableGrid(3, 3);

  return lines.map((line) => {
    const parts = line.split('\t');
    return parts.map((p) => ({
      text: p.trim(),
      colSpan: 1,
      rowSpan: 1,
      isMergedHidden: false,
    }));
  });
}

/**
 * 청크에서 특정 인덱스의 표를 삭제하고, 남은 데이터 정합성을 유지합니다.
 * 남은 표가 0개인 경우 자동으로 'paragraph' 청크로 상태 전이됩니다.
 */
export function deleteTableFromChunk(chunk: ChildChunk, tableIndex: number): ChildChunk {
  // 1. 단일 표 청크인 경우 -> 바로 일반 문단(paragraph)으로 강등
  if (chunk.chunk_type === 'table') {
    return {
      ...chunk,
      chunk_type: 'paragraph',
      is_table: false,
      is_atomic_table: false,
      tables: undefined,
      raw_html: undefined,
      table_caption: undefined,
      table_footnote: undefined,
      is_edited: true,
      metadata: {
        ...(chunk.metadata || {}),
        type: 'paragraph',
        tables: undefined,
        table_caption: undefined,
        table_footnote: undefined,
      },
    };
  }

  // 2. 복합 청크(composite)인 경우
  const currentTables: EmbeddedTableItem[] = [
    ...(chunk.tables || chunk.metadata?.tables || []),
  ];

  if (tableIndex < 0 || tableIndex >= currentTables.length) {
    return chunk;
  }

  // 대상 표 제거 및 table_index 재정렬
  currentTables.splice(tableIndex, 1);
  const reindexedTables = currentTables.map((t, idx) => ({
    ...t,
    table_index: idx,
  }));

  // 남은 표가 0개면 문단(paragraph) 청크로 자동 전환
  if (reindexedTables.length === 0) {
    // 텍스트에서 마크다운 표 블록 모두 제거
    const textBlocks = parseTextBlocks(chunk.text || '');
    const remainingText = textBlocks
      .filter((b) => b.type === 'paragraph')
      .map((b) => b.text)
      .join('\n\n')
      .trim();

    return {
      ...chunk,
      chunk_type: 'paragraph',
      is_table: false,
      is_atomic_table: false,
      tables: undefined,
      raw_html: undefined,
      table_caption: undefined,
      table_footnote: undefined,
      text: remainingText || chunk.text,
      is_edited: true,
      metadata: {
        ...(chunk.metadata || {}),
        type: 'paragraph',
        tables: undefined,
        table_caption: undefined,
        table_footnote: undefined,
      },
    };
  }

  // 남은 표가 1개 이상인 경우: 복합 청크 유지 및 본문/HTML 재조립
  const textBlocks = parseTextBlocks(chunk.text || '');
  let tblCount = 0;
  const newTextBlocks: string[] = [];

  for (const block of textBlocks) {
    if (block.type === 'table') {
      if (tblCount === tableIndex) {
        // 삭제 대상 표 건너뜀
        tblCount++;
        continue;
      }
      tblCount++;
    }
    newTextBlocks.push(block.text);
  }

  const newText = newTextBlocks.join('\n\n').trim();

  // raw_html 조립
  const htmlParts: string[] = [];
  for (const t of reindexedTables) {
    if (t.raw_html) htmlParts.push(t.raw_html);
  }
  const newRawHtml = htmlParts.join('\n\n');

  return {
    ...chunk,
    chunk_type: 'composite',
    is_table: true,
    is_atomic_table: false,
    tables: reindexedTables,
    raw_html: newRawHtml,
    table_caption: undefined,
    table_footnote: undefined,
    text: newText,
    is_edited: true,
    metadata: {
      ...(chunk.metadata || {}),
      type: 'composite',
      tables: reindexedTables,
      table_caption: undefined,
      table_footnote: undefined,
    },
  };
}

/**
 * 청크에 새 표를 추가합니다. 단일 표나 문단 청크였던 경우 자동으로 복합 청크('composite')로 승격됩니다.
 */
export function addTableToChunk(
  chunk: ChildChunk,
  templateGrid?: TableGrid,
  caption?: string,
  footnote?: string
): ChildChunk {
  const grid = templateGrid || createDefaultTableGrid(3, 3);
  const tableHtml = gridToHtmlTable(grid, caption, footnote);
  const tableMd = gridToMarkdownTable(grid);

  const currentTables: EmbeddedTableItem[] = [
    ...(chunk.tables || chunk.metadata?.tables || []),
  ];

  // 만약 단일 표 청크(tables 배열 없음)였다면 기존 표도 tables[0]으로 승격 보존
  if (chunk.chunk_type === 'table' && currentTables.length === 0 && chunk.raw_html) {
    currentTables.push({
      table_index: 0,
      caption: chunk.table_caption,
      footnote: chunk.table_footnote,
      raw_html: chunk.raw_html,
      token_estimate: chunk.token_estimate || estimateKoreanTokens(chunk.text),
      page_number: chunk.page_number,
      page_end: chunk.page_end,
    });
  }

  const newTableItem: EmbeddedTableItem = {
    table_index: currentTables.length,
    caption: caption || `[표 ${currentTables.length + 1}]`,
    footnote: footnote || '',
    raw_html: tableHtml,
    token_estimate: estimateKoreanTokens(tableMd),
    page_number: chunk.page_number,
    page_end: chunk.page_end,
  };

  const updatedTables = [...currentTables, newTableItem];

  // 텍스트 끝에 마크다운 표 결합
  const separator = chunk.text && chunk.text.trim() ? '\n\n' : '';
  const updatedText = `${chunk.text || ''}${separator}${tableMd}`;

  // raw_html 끝에 결합
  const rawSeparator = chunk.raw_html && chunk.raw_html.trim() ? '\n\n' : '';
  const updatedRawHtml = `${chunk.raw_html || ''}${rawSeparator}${tableHtml}`;

  return {
    ...chunk,
    chunk_type: 'composite',
    is_table: true,
    is_atomic_table: false,
    tables: updatedTables,
    raw_html: updatedRawHtml,
    table_caption: undefined,
    table_footnote: undefined,
    text: updatedText,
    is_edited: true,
    metadata: {
      ...(chunk.metadata || {}),
      type: 'composite',
      tables: updatedTables,
      table_caption: undefined,
      table_footnote: undefined,
    },
  };
}

/**
 * 청크 내 특정 인덱스의 표 데이터를 수정(셀 편집, 행/열 편집, 병합 반영)하고
 * 청크의 text, tables, raw_html을 원자적으로 삼중 동기화합니다.
 */
export function updateTableInChunk(
  chunk: ChildChunk,
  tableIndex: number,
  grid: TableGrid,
  caption?: string,
  footnote?: string
): ChildChunk {
  const newHtml = gridToHtmlTable(grid, caption, footnote);
  const newMd = gridToMarkdownTable(grid);

  // 1. 단일 표 청크인 경우
  if (chunk.chunk_type === 'table') {
    return {
      ...chunk,
      raw_html: newHtml,
      text: newMd,
      table_caption: caption,
      table_footnote: footnote,
      token_estimate: estimateKoreanTokens(newMd),
      is_edited: true,
      tables: [
        {
          table_index: 0,
          caption,
          footnote,
          raw_html: newHtml,
          token_estimate: estimateKoreanTokens(newMd),
          page_number: chunk.page_number,
        },
      ],
      metadata: {
        ...(chunk.metadata || {}),
        table_caption: caption,
        table_footnote: footnote,
      },
    };
  }

  // 2. 복합 청크인 경우
  const currentTables: EmbeddedTableItem[] = [
    ...(chunk.tables || chunk.metadata?.tables || []),
  ];

  if (tableIndex < 0 || tableIndex >= currentTables.length) {
    return chunk;
  }

  currentTables[tableIndex] = {
    ...currentTables[tableIndex],
    caption,
    footnote,
    raw_html: newHtml,
    token_estimate: estimateKoreanTokens(newMd),
  };

  // 본문 text 내의 해당 표 마크다운 블록 교체
  const textBlocks = parseTextBlocks(chunk.text || '');
  let tblCount = 0;
  let replaced = false;

  const newBlocks = textBlocks.map((block) => {
    if (block.type === 'table') {
      if (tblCount === tableIndex) {
        replaced = true;
        tblCount++;
        return newMd;
      }
      tblCount++;
    }
    return block.text;
  });

  let updatedText = newBlocks.join('\n\n');
  if (!replaced) {
    // 텍스트 블록에서 표가 안 잡혔다면 끝에 추가
    updatedText = `${chunk.text || ''}\n\n${newMd}`.trim();
  }

  // raw_html 조립
  const htmlParts: string[] = [];
  for (const t of currentTables) {
    if (t.raw_html) htmlParts.push(t.raw_html);
  }
  const updatedRawHtml = htmlParts.join('\n\n');

  return {
    ...chunk,
    chunk_type: 'composite',
    is_table: true,
    is_atomic_table: false,
    tables: currentTables,
    raw_html: updatedRawHtml,
    table_caption: undefined,
    table_footnote: undefined,
    text: updatedText,
    is_edited: true,
    metadata: {
      ...(chunk.metadata || {}),
      type: 'composite',
      tables: currentTables,
      table_caption: undefined,
      table_footnote: undefined,
    },
  };
}


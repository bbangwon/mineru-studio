import type { HierarchicalEtlResult, SectionNode, ParentChunk, ChildChunk } from '../types';

export type MineruTier = 'flash' | 'basic' | 'standard' | 'advanced';

export const MINERU_TIER_OPTIONS: ReadonlyArray<{
  value: MineruTier;
  label: string;
  shortLabel: string;
}> = [
  {
    value: 'basic',
    label: 'Basic (소형 모델/OCR 고속 파이프라인 - 권장)',
    shortLabel: 'Basic',
  },
  {
    value: 'standard',
    label: 'Standard (소형 모델 + VLM 하이브리드)',
    shortLabel: 'Standard',
  },
  {
    value: 'advanced',
    label: 'Advanced (고정밀 VLM 심층 레이아웃)',
    shortLabel: 'Advanced',
  },
  {
    value: 'flash',
    label: 'Flash (초고속 디지털 텍스트 추출)',
    shortLabel: 'Flash',
  },
];

const LEGACY_TIER_MAP: Record<string, MineruTier> = {
  pipeline: 'basic',
  'hybrid-engine': 'standard',
  vlm: 'standard',
};

/**
 * 레거시 backend 값('pipeline', 'hybrid-engine') 및 MinerU 4.x 티어를 정규화
 */
export function normalizeMineruTier(backend?: string | null): MineruTier {
  if (!backend) return 'basic';
  const normalized = backend.trim().toLowerCase();
  if (normalized in LEGACY_TIER_MAP) {
    return LEGACY_TIER_MAP[normalized];
  }
  if (
    normalized === 'flash' ||
    normalized === 'basic' ||
    normalized === 'standard' ||
    normalized === 'advanced'
  ) {
    return normalized;
  }
  return 'basic';
}

export function getMineruTierBadgeLabel(backend?: string | null): string {
  const tier = normalizeMineruTier(backend);
  return MINERU_TIER_OPTIONS.find((opt) => opt.value === tier)?.shortLabel || 'Basic';
}

/**
 * 문서명이 법률/규정 문서에 해당하는지 정규식 검사
 */
export const isLegalDoc = (name: string): boolean => /규정|지침|기준|법률|조례|훈령|전문/.test(name);

/**
 * 백엔드 또는 이전 스키마 데이터를 3단계 정규 계층(Section - Parent - Child) 구조로 보정
 */
export function normalizeEtlData(data: any): HierarchicalEtlResult {
  if (!data) return data;
  const sections: SectionNode[] = data.sections || data.parent_sections || [];
  const parent_chunks: ParentChunk[] = data.parent_chunks || [];
  const child_chunks: ChildChunk[] = (data.child_chunks || []).map((c: any) => {
    let tables = Array.isArray(c.tables) ? c.tables : [];
    if (tables.length === 0) {
      const rawHtml = c.raw_html || '';
      const isOldTable = c.is_table || c.chunk_type === 'table' || (rawHtml && rawHtml.toLowerCase().includes('<table'));
      if (isOldTable && rawHtml) {
        tables = [{
          table_index: 0,
          table_id: `${c.chunk_id}_t1`,
          raw_html: rawHtml,
          caption: c.table_caption || '',
          footnote: c.table_footnote || '',
          table_type: c.table_type || 'table',
        }];
      }
    }
    const cleanChunk = {
      ...c,
      parent_chunk_id: c.parent_chunk_id || c.parent_id || '',
      parent_id: c.parent_chunk_id || c.parent_id || '',
      section_id: c.section_id || '',
      tables,
    };
    delete cleanChunk.chunk_type;
    delete cleanChunk.is_table;
    delete cleanChunk.is_atomic_table;
    delete cleanChunk.table_caption;
    delete cleanChunk.table_footnote;
    delete cleanChunk.table_type;
    return cleanChunk;
  });

  return {
    ...data,
    sections,
    parent_sections: sections,
    parent_chunks,
    child_chunks,
  };
}

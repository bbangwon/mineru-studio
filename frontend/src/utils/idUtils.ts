import type { HierarchicalEtlResult, ChildChunk, ParentChunk, SectionNode } from '../types';
import { syncChunkPageMetadata } from './pageUtils';

/**
 * 한국어 서브워드/BPE 특성을 반영한 표준 토큰 추정 공식:
 * token_estimate = max(floor(len(text) / 2.0), floor(len(text.split()) * 2.2))
 */
export function estimateKoreanTokens(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const charTokens = Math.floor(trimmed.length / 2.0);
  const wordTokens = Math.floor(trimmed.split(/\s+/).length * 2.2);
  return Math.max(charTokens, wordTokens);
}

/**
 * 문서명을 128-bit 결정론적 고유 식별자(doc_xxxxxxxx...)로 변환
 */
export function generateDocId(name?: string): string {
  if (!name) return `doc_${Math.random().toString(16).slice(2).padStart(8, '0')}`;
  const clean = name.trim();
  if (clean.startsWith('doc_') && clean.length === 36) {
    return clean;
  }
  // 결정론적 128비트(32자리 16진수) 해시 생성
  let h1 = 0xdeadbeef, h2 = 0x41c64e6d;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const part3 = ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0');
  const part4 = (((h1 + h2) * 31) >>> 0).toString(16).padStart(8, '0');
  return `doc_${part1}${part2}${part3}${part4}`;
}

/**
 * 주어진 청크 목록에서 사용된 c 번호 중 최댓값 + 1을 채번하여 새 청크 ID를 생성합니다.
 * 형식: {doc_id}_c{다음번호 4자리}
 */
export function getNextChunkId(childChunks: ChildChunk[], docId: string): string {
  let maxSeq = 0;
  const seqRegex = /_c(\d+)$/;

  for (const chunk of childChunks) {
    const match = chunk.chunk_id.match(seqRegex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `${docId}_c${String(nextSeq).padStart(4, '0')}`;
}

/**
 * 주어진 Parent 청크 목록에서 사용된 p 번호 중 최댓값 + 1을 채번하여 새 Parent ID를 생성합니다.
 * 형식: {doc_id}_p{다음번호 4자리}
 */
export function getNextParentChunkId(parentChunks: ParentChunk[], docId: string): string {
  let maxSeq = 0;
  const seqRegex = /_p(\d+)$/;

  for (const parent of parentChunks) {
    const pid = parent.parent_chunk_id || parent.id || '';
    const match = pid.match(seqRegex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `${docId}_p${String(nextSeq).padStart(3, '0')}`;
}

/**
 * 주어진 섹션 목록에서 사용된 s 번호 중 최댓값 + 1을 채번하여 새 Section ID를 생성합니다.
 * 형식: {doc_id}_s{다음번호 2자리}
 */
export function getNextSectionId(sections: SectionNode[], docId: string): string {
  let maxSeq = 0;
  const seqRegex = /_s(\d+)$/;

  for (const sec of sections) {
    const match = sec.id.match(seqRegex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = maxSeq + 1;
  return `${docId}_s${String(nextSeq).padStart(2, '0')}`;
}

/**
 * 3단계 계층(Section -> Parent -> Child)의 순서를 Single Source of Truth 원칙에 따라 일괄 동기화합니다.
 * 1. sections 순서와 각 section의 parent_chunk_ids 순서에 따라 etl.parent_chunks를 재정렬합니다.
 * 2. parent_chunks 순서와 각 parent의 child_chunk_ids 순서에 따라 etl.child_chunks를 재정렬합니다.
 * 3. 각 section의 child_chunk_ids를 소속 Parent들의 child_chunk_ids 순서대로 동기화합니다.
 */
export function syncHierarchyOrder(etl: HierarchicalEtlResult): HierarchicalEtlResult {
  const sections = (etl.sections && etl.sections.length > 0)
    ? etl.sections
    : (etl.parent_sections || []);
  const parentChunks = etl.parent_chunks || [];
  const childChunks = etl.child_chunks || [];

  const parentMap = new Map<string, ParentChunk>();
  for (const p of parentChunks) {
    const pid = p.parent_chunk_id || p.id || '';
    if (pid) parentMap.set(pid, p);
  }

  const childMap = new Map<string, ChildChunk>();
  for (const c of childChunks) {
    childMap.set(c.chunk_id, c);
  }

  // 1. 섹션 순서 및 sec.parent_chunk_ids에 따른 parent_chunks 정렬
  const orderedParents: ParentChunk[] = [];
  const visitedParentIds = new Set<string>();

  for (const sec of sections) {
    const pids = sec.parent_chunk_ids || [];
    for (const pid of pids) {
      const p = parentMap.get(pid);
      if (p && !visitedParentIds.has(pid)) {
        orderedParents.push(p);
        visitedParentIds.add(pid);
      }
    }
  }

  // 혹시 어떤 섹션에도 명시되지 않은 잔여 Parent 청크 보존
  for (const p of parentChunks) {
    const pid = p.parent_chunk_id || p.id || '';
    if (pid && !visitedParentIds.has(pid)) {
      orderedParents.push(p);
      visitedParentIds.add(pid);
    }
  }

  // 2. orderedParents 및 p.child_chunk_ids에 따른 child_chunks 정렬
  const orderedChildren: ChildChunk[] = [];
  const visitedChildIds = new Set<string>();

  for (const p of orderedParents) {
    const cids = p.child_chunk_ids || [];
    for (const cid of cids) {
      const c = childMap.get(cid);
      if (c && !visitedChildIds.has(cid)) {
        orderedChildren.push(c);
        visitedChildIds.add(cid);
      }
    }
  }

  // 부모에 명시되지 않은 잔여 Child 청크 보존
  for (const c of childChunks) {
    if (!visitedChildIds.has(c.chunk_id)) {
      orderedChildren.push(c);
      visitedChildIds.add(c.chunk_id);
    }
  }

  // 3. 각 섹션의 child_chunk_ids 동기화
  const updatedSectionsWithChildren: SectionNode[] = sections.map((sec) => {
    const secPids = sec.parent_chunk_ids || [];
    const secChildIds: string[] = [];
    for (const pid of secPids) {
      const p = parentMap.get(pid);
      if (p && p.child_chunk_ids) {
        for (const cid of p.child_chunk_ids) {
          if (!secChildIds.includes(cid)) {
            secChildIds.push(cid);
          }
        }
      }
    }
    return {
      ...sec,
      child_chunk_ids: secChildIds.length > 0 ? secChildIds : (sec.child_chunk_ids || []),
    };
  });

  // 4. 소속 청크 및 하위 섹션(Children)을 반영한 page_range 상향식(Bottom-up) 동기화
  const updatedSections = syncSectionPageRanges(updatedSectionsWithChildren, orderedChildren);

  return {
    ...etl,
    sections: updatedSections,
    parent_sections: updatedSections,
    parent_chunks: orderedParents,
    child_chunks: orderedChildren,
  };
}

/**
 * 섹션들의 page_range를 소속 청크 및 하위 자식 섹션들을 바탕으로 상향식(Bottom-up) 동기화합니다.
 * - 직속 Child 청크가 있는 경우: 해당 청크들의 min(page_number) ~ max(page_end || page_number)
 * - 하위 자식 섹션들이 있는 경우: 하위 섹션들의 page_range 최소~최대값을 재귀적으로 취합
 * - 청크도 없고 하위 섹션도 없는 경우: 기존 page_range 유지
 */
export function syncSectionPageRanges(
  sections: SectionNode[],
  childChunks: ChildChunk[]
): SectionNode[] {
  if (!sections || sections.length === 0) return [];

  const childMap = new Map<string, ChildChunk>();
  for (const c of childChunks) {
    childMap.set(c.chunk_id, c);
  }

  // 부모 섹션 ID -> 직속 자식 섹션들 매핑
  const childrenByParent = new Map<string, SectionNode[]>();
  for (const s of sections) {
    if (s.parent_section_id) {
      if (!childrenByParent.has(s.parent_section_id)) {
        childrenByParent.set(s.parent_section_id, []);
      }
      childrenByParent.get(s.parent_section_id)!.push(s);
    }
  }

  const computedRanges = new Map<string, [number, number]>();
  const visiting = new Set<string>();

  function computeRange(sec: SectionNode): [number, number] {
    if (computedRanges.has(sec.id)) {
      return computedRanges.get(sec.id)!;
    }
    if (visiting.has(sec.id)) {
      return sec.page_range && sec.page_range.length === 2 ? sec.page_range : [1, 1];
    }
    visiting.add(sec.id);

    let minPage = Infinity;
    let maxPage = -Infinity;

    // 1. 직속 Child 청크들의 페이지 범위
    const cids = sec.child_chunk_ids || [];
    for (const cid of cids) {
      const c = childMap.get(cid);
      if (c) {
        const start = c.page_number || 1;
        const end = c.page_end || start;
        if (start < minPage) minPage = start;
        if (end > maxPage) maxPage = end;
      }
    }

    // 2. 하위 자식 섹션들의 페이지 범위 (재귀)
    const childSecs = childrenByParent.get(sec.id) || [];
    for (const sub of childSecs) {
      const subRange = computeRange(sub);
      if (subRange[0] < minPage) minPage = subRange[0];
      if (subRange[1] > maxPage) maxPage = subRange[1];
    }

    visiting.delete(sec.id);

    let resultRange: [number, number];
    if (minPage !== Infinity && maxPage !== -Infinity) {
      resultRange = [minPage, maxPage];
    } else {
      resultRange = sec.page_range && sec.page_range.length === 2 ? sec.page_range : [1, 1];
    }

    computedRanges.set(sec.id, resultRange);
    return resultRange;
  }

  return sections.map((s) => {
    const range = computeRange(s);
    return {
      ...s,
      page_range: range,
    };
  });
}

/**
 * 부모-자식 트리 구조(parent_section_id)를 바탕으로
 * 전역 계층 레벨(level: H0 -> H1 -> H2 -> H3)과 breadcrumbs를 일괄 재계산합니다.
 * - 루트 섹션: level = 0, breadcrumbs = [root.title]
 * - 직속 자식: level = 1, breadcrumbs = [root.title, sec.title]
 * - 깊이 N:   level = N, breadcrumbs = [ancestors..., sec.title]
 */
export function recalculateSectionHierarchy(
  sections: SectionNode[],
  docTitle?: string
): SectionNode[] {
  if (!sections || sections.length === 0) return [];

  // 1. 루트 섹션 식별 (level===0, _s00, _root, 또는 parent_section_id 없는 첫 항목)
  let rootSec = sections.find(
    (s) => s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root') || !s.parent_section_id
  );
  if (!rootSec && sections.length > 0) {
    rootSec = sections[0];
  }
  const rootId = rootSec?.id;

  const secMap = new Map<string, SectionNode>();
  for (const s of sections) {
    secMap.set(s.id, s);
  }

  // 2. 각 섹션의 깊이(depth) 및 브레드크럼 재계산
  return sections.map((s) => {
    if (s.id === rootId || s === rootSec) {
      const title = s.title || docTitle || '문서';
      return {
        ...s,
        level: 0,
        breadcrumbs: [title],
        parent_section_id: undefined,
      };
    }

    const chain: SectionNode[] = [];
    let curr: SectionNode | undefined = s;
    const visited = new Set<string>([s.id]);

    while (curr) {
      const pid: string | undefined = curr.parent_section_id;
      if (!pid || !secMap.has(pid) || visited.has(pid)) {
        break;
      }
      visited.add(pid);
      const parentSec: SectionNode = secMap.get(pid)!;
      chain.push(parentSec);
      if (parentSec.id === rootId || parentSec === rootSec) {
        break;
      }
      curr = parentSec;
    }

    const ancestors = [...chain].reverse();

    // 루트 섹션이 조상 체인의 맨 앞에 없으면 루트를 최상위 부모로 연결 (고아 섹션 보호)
    if (rootSec && (ancestors.length === 0 || ancestors[0].id !== rootId)) {
      ancestors.unshift(rootSec);
    }

    const calculatedLevel = ancestors.length;
    const breadcrumbs = [...ancestors.map((a) => a.title), s.title];
    const finalParentId = ancestors.length > 0 ? ancestors[ancestors.length - 1].id : rootId;

    return {
      ...s,
      level: calculatedLevel,
      breadcrumbs,
      parent_section_id: finalParentId,
    };
  });
}

/**
 * 문서 물리적 등장 순서(Page & Block Position)를 기준으로
 * 3단계 계층(Section - Parent - Child)의 전체 ID를 순차적으로 일괄 재정렬(Re-index)합니다.
 * - Section ID: {doc_id}_s00 (루트), {doc_id}_s01, s02...
 * - Parent ID:  {doc_id}_p001, p002, p003...
 * - Child ID:   {doc_id}_c001, c002, c003...
 * - 3단계 간 양방향 참조(parent_section_id, parent_chunk_ids, child_chunk_ids, section_id 등) 일괄 동기화
 * - 전역 계층 레벨(H0 -> H1 -> H2 -> H3) 및 breadcrumbs 일괄 재계산
 */
export function reindexEtlData(etl: HierarchicalEtlResult): HierarchicalEtlResult {
  const synchronizedEtl = syncHierarchyOrder(etl);
  const rawDocId = synchronizedEtl.doc_id || '';
  const docId = (rawDocId.startsWith('doc_') && rawDocId.length === 36)
    ? rawDocId
    : generateDocId((synchronizedEtl as any).active_pdf || synchronizedEtl.doc_title || rawDocId);

  const rawSections = (synchronizedEtl.sections && synchronizedEtl.sections.length > 0)
    ? synchronizedEtl.sections
    : (synchronizedEtl.parent_sections || []);
  const rawParents = synchronizedEtl.parent_chunks || [];
  const rawChildren = synchronizedEtl.child_chunks || [];

  // 1. 물리적 페이지 순서 및 계층 구조(Tree DFS) 기반 정렬 (안정 정렬)
  let rootSec: SectionNode | null = null;
  const normalSections: SectionNode[] = [];
  for (const s of rawSections) {
    if (s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')) {
      rootSec = s;
    } else {
      normalSections.push(s);
    }
  }

  // 부모 ID -> 자식 섹션 목록 매핑 (계층 트리 구조 보존)
  const rootId = rootSec?.id;
  const childrenMap = new Map<string, SectionNode[]>();
  for (const s of normalSections) {
    const pId = s.parent_section_id || rootId || '__root__';
    if (!childrenMap.has(pId)) {
      childrenMap.set(pId, []);
    }
    childrenMap.get(pId)!.push(s);
  }

  // 동일 부모 내 형제(Sibling) 섹션들끼리 page_range[0] 기준으로 안정 정렬
  for (const list of childrenMap.values()) {
    list.sort((a, b) => {
      const pA = a.page_range ? a.page_range[0] : 1;
      const pB = b.page_range ? b.page_range[0] : 1;
      return pA - pB;
    });
  }

  // DFS 재귀 순회로 계층 및 페이지 순서대로 평탄화 (부모 직후에 자식들 순서대로 배치)
  const sortedSections: SectionNode[] = [];
  if (rootSec) sortedSections.push(rootSec);

  const visitedSecIds = new Set<string>();
  if (rootSec) visitedSecIds.add(rootSec.id);

  function traverse(parentId: string) {
    const children = childrenMap.get(parentId) || [];
    for (const child of children) {
      if (!visitedSecIds.has(child.id)) {
        visitedSecIds.add(child.id);
        sortedSections.push(child);
        traverse(child.id);
      }
    }
  }

  if (rootId) {
    traverse(rootId);
  }
  // 혹시 부모 연결이 없거나 매핑에서 누락된 고아 섹션들 보존 (페이지 순 정렬)
  const remaining = normalSections.filter((s) => !visitedSecIds.has(s.id));
  remaining.sort((a, b) => {
    const pA = a.page_range ? a.page_range[0] : 1;
    const pB = b.page_range ? b.page_range[0] : 1;
    return pA - pB;
  });
  for (const r of remaining) {
    if (!visitedSecIds.has(r.id)) {
      visitedSecIds.add(r.id);
      sortedSections.push(r);
      traverse(r.id);
    }
  }

  const sortedParents = [...rawParents].sort((a, b) => {
    const pA = a.page_range ? a.page_range[0] : 1;
    const pB = b.page_range ? b.page_range[0] : 1;
    return pA - pB;
  });

  const sortedChildren = [...rawChildren].sort((a, b) => {
    const pA = a.page_number || 1;
    const pB = b.page_number || 1;
    return pA - pB;
  });

  // 2. 신규 ID 매핑 생성
  const sectionIdMap: Record<string, string> = {};
  let secIdx = 1;
  const newSections = sortedSections.map((sec) => {
    let newSecId: string;
    if (sec.level === 0 || sec.id.endsWith('_s00') || sec.id.endsWith('_root')) {
      newSecId = `${docId}_s00`;
    } else {
      newSecId = `${docId}_s${String(secIdx++).padStart(2, '0')}`;
    }
    sectionIdMap[sec.id] = newSecId;
    return { ...sec, id: newSecId };
  });

  const parentIdMap: Record<string, string> = {};
  let parentIdx = 1;
  const newParents = sortedParents.map((parent) => {
    const oldPid = parent.parent_chunk_id || parent.id || '';
    const newPid = `${docId}_p${String(parentIdx++).padStart(4, '0')}`;
    if (oldPid) {
      parentIdMap[oldPid] = newPid;
    }
    return {
      ...parent,
      parent_chunk_id: newPid,
      id: newPid,
    };
  });

  const childIdMap: Record<string, string> = {};
  let childIdx = 1;
  const newChildren = sortedChildren.map((child) => {
    const oldCid = child.chunk_id;
    const newCid = `${docId}_c${String(childIdx++).padStart(4, '0')}`;
    childIdMap[oldCid] = newCid;

    const startPage = child.page_number || 1;
    const endPage = child.page_end || startPage;
    const finalEnd = endPage > startPage ? endPage : undefined;

    const meta = { ...(child.metadata || {}) };
    delete (meta as Record<string, any>).original_chunk_id;
    const synchronizedMeta = syncChunkPageMetadata(
      meta,
      startPage,
      finalEnd
    );

    return {
      ...child,
      chunk_id: newCid,
      metadata: synchronizedMeta,
    };
  });

  // 3. 상호 참조 ID 일괄 갱신
  const mappedSections: SectionNode[] = newSections.map((sec) => ({
    ...sec,
    parent_section_id: sec.parent_section_id ? (sectionIdMap[sec.parent_section_id] || sec.parent_section_id) : undefined,
    parent_chunk_ids: (sec.parent_chunk_ids || []).map((pid) => parentIdMap[pid] || pid).filter(Boolean),
    child_chunk_ids: (sec.child_chunk_ids || []).map((cid) => childIdMap[cid] || cid).filter(Boolean),
  }));

  // 4. 전역 계층 레벨 및 breadcrumbs 일괄 재계산
  const finalSections = recalculateSectionHierarchy(mappedSections, etl.doc_title);
  const sectionObjMap = new Map<string, SectionNode>(finalSections.map((s) => [s.id, s]));

  const finalParents: ParentChunk[] = newParents.map((parent) => ({
    ...parent,
    section_id: sectionIdMap[parent.section_id] || parent.section_id,
    child_chunk_ids: parent.child_chunk_ids.map((cid) => childIdMap[cid] || cid).filter(Boolean),
  }));

  const finalChildren: ChildChunk[] = newChildren.map((child) => {
    const oldPid = child.parent_chunk_id || child.parent_id || '';
    const newPid = parentIdMap[oldPid] || oldPid;
    const oldSid = child.section_id;
    const newSid = sectionIdMap[oldSid] || oldSid;
    const sec = sectionObjMap.get(newSid);

    return {
      ...child,
      parent_chunk_id: newPid,
      parent_id: newPid,
      section_id: newSid,
      breadcrumbs: sec?.breadcrumbs ? [...sec.breadcrumbs] : child.breadcrumbs,
    };
  });

  return {
    ...etl,
    doc_id: docId,
    sections: finalSections,
    parent_sections: finalSections,
    parent_chunks: finalParents,
    child_chunks: finalChildren,
  };
}

/**
 * UI 표시용 Child 청크 ID 포맷터
 * doc_1b3e74823f195d1b921b6f3d8070a2c4_c0001 -> c0001
 */
export function formatDisplayChunkId(id?: string | null): string {
  if (!id) return '';
  const match = id.match(/_c(\d+)$/i);
  if (match) return `c${match[1]}`;
  if (id.includes('_')) {
    const last = id.split('_').pop();
    if (last) return last;
  }
  return id;
}

/**
 * UI 표시용 Parent 청크 ID 포맷터
 * doc_1b3e74823f195d1b921b6f3d8070a2c4_p0001 -> P0001
 * p0001 -> P0001
 */
export function formatDisplayParentId(id?: string | null): string {
  if (!id) return '';
  const match = id.match(/_p(\d+)$/i);
  if (match) return `P${match[1]}`;
  if (id.includes('_')) {
    const last = id.split('_').pop();
    if (last) {
      if (/^p\d+$/i.test(last)) return 'P' + last.slice(1);
      return last;
    }
  }
  if (/^p\d+$/i.test(id)) return 'P' + id.slice(1);
  return id;
}

/**
 * UI 표시용 Section ID 포맷터
 * doc_1b3e74823f195d1b921b6f3d8070a2c4_s01 -> s01
 */
export function formatDisplaySectionId(id?: string | null): string {
  if (!id) return '';
  const match = id.match(/_s(\d+)$/i);
  if (match) return `s${match[1]}`;
  if (id.includes('_')) {
    const last = id.split('_').pop();
    if (last) return last;
  }
  return id;
}

/**
 * UI 표시용 범용 ID 포맷터
 */
export function formatDisplayId(id?: string | null): string {
  if (!id) return '';
  if (/_p\d+$/i.test(id) || /^p\d+$/i.test(id)) return formatDisplayParentId(id);
  if (/_c\d+$/i.test(id) || /^c\d+$/i.test(id)) return formatDisplayChunkId(id);
  if (/_s\d+$/i.test(id) || /^s\d+$/i.test(id)) return formatDisplaySectionId(id);
  if (id.includes('_')) {
    const last = id.split('_').pop();
    if (last) return last;
  }
  return id;
}

/**
 * 클립보드 복사 헬퍼 함수 (Navigator Clipboard API 및 Fallback 지원)
 */
export async function copyToClipboard(text?: string | null): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    if (typeof document !== 'undefined') {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    }
  } catch {
    return false;
  }
  return false;
}


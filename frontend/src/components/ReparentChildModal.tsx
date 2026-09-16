import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FolderTree,
  CornerDownRight,
  Check,
  Plus,
  AlertTriangle,
  Search,
  Info,
} from 'lucide-react';
import type {
  ChildChunk,
  ParentSection,
  ParentChunk,
  ReparentChildChunkParams,
} from '../types';
import { CopyableBadge } from './CopyableBadge';
import { estimateKoreanTokens } from '../utils/idUtils';
import { formatChunkPageFull } from '../utils/pageUtils';

interface ReparentChildModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetChunks: ChildChunk[];
  parentSections: ParentSection[];
  parentChunks: ParentChunk[];
  childChunks?: ChildChunk[];
  onReparent: (params: ReparentChildChunkParams) => void;
}

export const ReparentChildModal: React.FC<ReparentChildModalProps> = ({
  isOpen,
  onClose,
  targetChunks,
  parentSections,
  parentChunks,
  onReparent,
}) => {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [newSectionId, setNewSectionId] = useState<string>('');
  const [newParentTitle, setNewParentTitle] = useState<string>('');
  const [newInsertPosition, setNewInsertPosition] = useState<'end' | 'start'>('end');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Target chunks metadata
  const targetChunkIds = useMemo(() => targetChunks.map((c) => c.chunk_id), [targetChunks]);
  const targetChildIdSet = useMemo(() => new Set(targetChunkIds), [targetChunkIds]);

  // Source parent IDs of target chunks
  const sourceParentIds = useMemo(() => {
    const ids = new Set<string>();
    targetChunks.forEach((c) => {
      const pid = c.parent_chunk_id || c.parent_id;
      if (pid) ids.add(pid);
    });
    return ids;
  }, [targetChunks]);

  // Find parents that will become empty (auto-pruned)
  const emptyParentWarnings = useMemo(() => {
    const warnings: string[] = [];
    sourceParentIds.forEach((pid) => {
      const p = parentChunks.find((item) => (item.parent_chunk_id || item.id) === pid);
      if (p) {
        const remaining = p.child_chunk_ids.filter((cid) => !targetChildIdSet.has(cid));
        if (remaining.length === 0) {
          warnings.push(`기존 Parent '${p.title || pid}'에 남은 자식 청크가 없어 이동 후 자동 정리(삭제)됩니다.`);
        }
      }
    });
    return warnings;
  }, [sourceParentIds, parentChunks, targetChildIdSet]);

  // Section lookup map
  const sectionMap = useMemo(() => {
    const map = new Map<string, ParentSection>();
    parentSections.forEach((s) => map.set(s.id, s));
    return map;
  }, [parentSections]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && targetChunks.length > 0) {
      setMode('existing');
      setError('');
      setSearchQuery('');

      // Find initial parent: first available parent that is NOT a source parent
      const firstNonSource = parentChunks.find(
        (p) => !sourceParentIds.has(p.parent_chunk_id || p.id || '')
      );
      setSelectedParentId(firstNonSource ? (firstNonSource.parent_chunk_id || firstNonSource.id || '') : '');

      // Initial new section
      const firstSection = targetChunks[0]?.section_id || parentSections[0]?.id || '';
      setNewSectionId(firstSection);

      // Default new title proposal
      if (targetChunks.length === 1 && targetChunks[0].text) {
        const firstLine = targetChunks[0].text.trim().split('\n')[0].slice(0, 30);
        setNewParentTitle(firstLine || '새 서브섹션 문맥');
      } else {
        setNewParentTitle('새 서브섹션 문맥');
      }
      setNewInsertPosition('end');
    }
  }, [isOpen, targetChunks, parentChunks, sourceParentIds, parentSections]);

  if (!isOpen || targetChunks.length === 0) return null;

  // Destination parent details (if mode === 'existing')
  const destParent = parentChunks.find(
    (p) => (p.parent_chunk_id || p.id) === selectedParentId
  );
  const destSection = destParent ? sectionMap.get(destParent.section_id) : null;

  // Token estimate calculation for destination parent
  const totalTargetTokens = targetChunks.reduce((acc, c) => acc + (c.token_estimate || estimateKoreanTokens(c.text)), 0);
  const predictedDestTokens = destParent ? (destParent.token_estimate || 0) + totalTargetTokens : totalTargetTokens;
  const isDestOverTokenLimit = predictedDestTokens > 2048;

  // Filtered parent chunks for search
  const filteredParentChunks = parentChunks.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const pid = (p.parent_chunk_id || p.id || '').toLowerCase();
    const title = (p.title || '').toLowerCase();
    const sec = sectionMap.get(p.section_id);
    const secTitle = (sec?.title || '').toLowerCase();
    return pid.includes(q) || title.includes(q) || secTitle.includes(q);
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'existing') {
      if (!selectedParentId) {
        setError('이동할 대상 Parent 청크를 선택해주세요.');
        return;
      }
      // Check if moving to the exact same parent for a single chunk
      if (targetChunks.length === 1) {
        const currentPid = targetChunks[0].parent_chunk_id || targetChunks[0].parent_id;
        if (selectedParentId === currentPid) {
          setError('이미 현재 상위 Parent에 속해 있습니다.');
          return;
        }
      }

      onReparent({
        chunkIds: targetChunkIds,
        targetParentChunkId: selectedParentId,
      });
      onClose();
    } else {
      if (!newSectionId) {
        setError('신규 Parent가 소속될 섹션을 선택해주세요.');
        return;
      }
      const trimmedTitle = newParentTitle.trim();
      if (!trimmedTitle) {
        setError('신규 Parent 제목을 입력해주세요.');
        return;
      }

      onReparent({
        chunkIds: targetChunkIds,
        targetParentChunkId: null,
        createNewParent: {
          sectionId: newSectionId,
          title: trimmedTitle,
          insertPosition: { type: newInsertPosition },
        },
      });
      onClose();
    }
  };

  const isSingle = targetChunks.length === 1;
  const singleChunk = targetChunks[0];
  const singleParent = isSingle ? parentChunks.find((p) => (p.parent_chunk_id || p.id) === (singleChunk.parent_chunk_id || singleChunk.parent_id)) : null;
  const singleSection = isSingle ? sectionMap.get(singleChunk.section_id) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl text-indigo-600 dark:text-indigo-400">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base flex items-center gap-2">
                <span>Child 청크 Parent(상위 문맥) 재할당</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-bold">
                  {targetChunks.length}개 청크
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                선택한 자식 청크를 다른 Parent 청크로 이동하거나 새 Parent를 생성하여 독립시킵니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 text-xs bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 대상 청크 정보 카드 */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/70 dark:border-slate-700/60 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span>이동 대상 Child 청크</span>
              <span>총 추정 토큰: ~{totalTargetTokens} tok</span>
            </div>

            {isSingle ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <CopyableBadge
                    id={singleChunk.chunk_id}
                    type="chunk"
                    titlePrefix="청크 ID"
                    className="text-xs font-mono font-bold px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded border border-slate-300 dark:border-slate-600"
                  />
                  <span className="text-xs text-slate-400 font-mono">
                    {formatChunkPageFull(singleChunk)}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                    현재 소속: <strong>{singleParent?.title || singleChunk.parent_chunk_id || singleChunk.parent_id}</strong>
                    {singleSection?.title ? ` (${singleSection.title})` : ''}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 italic bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-800 font-sans">
                  "{singleChunk.text || (singleChunk.raw_html ? 'HTML 표 데이터' : '(빈 청크)')}"
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap max-h-20 overflow-y-auto">
                  {targetChunks.map((c) => (
                    <CopyableBadge
                      key={c.chunk_id}
                      id={c.chunk_id}
                      type="chunk"
                      titlePrefix="청크 ID"
                      className="text-[11px] font-mono px-1.5 py-0.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 rounded border border-slate-200 dark:border-slate-700"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 모드 선택 탭 (기존 Parent로 이동 vs 새 Parent 생성) */}
          <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setMode('existing');
                setError('');
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer ${
                mode === 'existing'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>기존 Parent 청크로 이동</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('new');
                setError('');
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer ${
                mode === 'new'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>새 Parent 청크 생성 후 이동 (독립)</span>
            </button>
          </div>

          {/* 모드 1: 기존 Parent 선택 */}
          {mode === 'existing' && (
            <div className="space-y-3">
              {/* 검색창 */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Parent ID, 제목, 섹션명으로 검색..."
                  className="w-full text-xs pl-8 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              {/* Parent 선택 셀렉터 */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  대상 Parent 청크 선택
                </label>
                <select
                  value={selectedParentId}
                  onChange={(e) => {
                    setSelectedParentId(e.target.value);
                    setError('');
                  }}
                  className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  size={6}
                >
                  {parentSections.map((sec) => {
                    const secParents = filteredParentChunks.filter((p) => p.section_id === sec.id);
                    if (secParents.length === 0) return null;

                    return (
                      <optgroup
                        key={sec.id}
                        label={`📂 ${sec.title} (Level ${sec.level})`}
                        className="font-bold text-slate-500 dark:text-slate-400 py-1"
                      >
                        {secParents.map((p) => {
                          const pid = p.parent_chunk_id || p.id || '';
                          const isCurrent = sourceParentIds.has(pid);
                          const childCount = p.child_chunk_ids?.length || 0;
                          const tokens = p.token_estimate || 0;

                          return (
                            <option
                              key={pid}
                              value={pid}
                              disabled={isSingle && isCurrent}
                              className={`py-1 text-xs ${
                                isSingle && isCurrent
                                  ? 'text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-900/50'
                                  : 'text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              　{pid}: {p.title || '(제목 없음)'} · 자식 {childCount}개 (~{tokens} tok)
                              {isCurrent ? ' (현재 소속)' : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              {/* 이동 미리보기 안내 카드 */}
              {destParent && (
                <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 rounded-xl space-y-1.5 text-xs">
                  <div className="flex items-center justify-between font-semibold text-indigo-900 dark:text-indigo-200">
                    <span className="flex items-center gap-1.5">
                      <CornerDownRight className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>이동 대상 Parent 미리보기</span>
                    </span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                        isDestOverTokenLimit
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300'
                          : 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 border border-indigo-200'
                      }`}
                    >
                      예상 토큰: ~{predictedDestTokens} tok {isDestOverTokenLimit ? '(2048 권장 초과)' : ''}
                    </span>
                  </div>

                  <div className="text-[11px] text-indigo-700 dark:text-indigo-300 space-y-0.5">
                    <div>• 대상 섹션: <strong>{destSection?.title || destParent.section_id}</strong></div>
                    <div>• 대상 Parent: <strong>{destParent.title || destParent.parent_chunk_id}</strong></div>
                    <div>• 이동 후 소속 자식 청크 수: <strong>{(destParent.child_chunk_ids?.length || 0) + targetChunks.length}개</strong></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 모드 2: 신규 Parent 생성 */}
          {mode === 'new' && (
            <div className="space-y-3">
              {/* 소속 섹션 선택 */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <FolderTree className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  신규 Parent가 소속될 섹션 선택
                </label>
                <select
                  value={newSectionId}
                  onChange={(e) => setNewSectionId(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                >
                  {parentSections.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {sec.title} (Level {sec.level})
                    </option>
                  ))}
                </select>
              </div>

              {/* 신규 Parent 제목 */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  신규 Parent 청크 제목
                </label>
                <input
                  type="text"
                  value={newParentTitle}
                  onChange={(e) => {
                    setNewParentTitle(e.target.value);
                    setError('');
                  }}
                  placeholder="예: 제2조(정의), 2.1 세부 추진 내용 등"
                  className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              {/* 섹션 내 삽입 위치 */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  해당 섹션 내 삽입 위치
                </label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="insertPos"
                      checked={newInsertPosition === 'end'}
                      onChange={() => setNewInsertPosition('end')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>섹션의 맨 끝에 추가 (기본)</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="insertPos"
                      checked={newInsertPosition === 'start'}
                      onChange={() => setNewInsertPosition('start')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>섹션의 맨 앞에 추가</span>
                  </label>
                </div>
              </div>

              {/* 신규 생성 안내 */}
              <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 rounded-xl text-xs text-indigo-800 dark:text-indigo-200 space-y-1">
                <div className="font-semibold flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>새 Parent 생성 안내</span>
                </div>
                <div className="text-[11px] text-indigo-700 dark:text-indigo-300 leading-relaxed">
                  선택한 청크 {targetChunks.length}개로 구성된 신규 Parent 청크가 채번되어 지정한 섹션에 독립 배치됩니다.
                </div>
              </div>
            </div>
          )}

          {/* 기존 Parent 빈 청크 자동 정리 경고 알림 */}
          {emptyParentWarnings.length > 0 && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-xl space-y-1 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>빈 Parent 자동 정리 알림</span>
              </div>
              {emptyParentWarnings.map((w, idx) => (
                <p key={idx} className="text-[11px] text-amber-700 dark:text-amber-400">
                  • {w}
                </p>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={mode === 'existing' && (!selectedParentId || (isSingle && sourceParentIds.has(selectedParentId)))}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Parent 재할당 적용</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

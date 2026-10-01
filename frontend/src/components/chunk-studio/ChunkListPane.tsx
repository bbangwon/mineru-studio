import {
  ArrowLeft,
  PanelLeftOpen,
  Layers,
  FolderTree,
  X,
  Search,
  AlignLeft,
  Table2,
  Scale,
  AlertTriangle,
  Sparkles,
  CheckSquare,
  Square,
  Trash2,
  Merge,
  ChevronUp,
  ChevronDown,
  Plus,
  Edit2,
  GripVertical,
  CheckCircle2,
  EyeOff,
  Eye,
  ShieldCheck,
  Info,
  ListOrdered,
} from 'lucide-react';
import { CopyableBadge } from '../CopyableBadge';
import { formatChunkPage } from '../../utils/pageUtils';
import { estimateKoreanTokens } from '../../utils/idUtils';
import { getChunkKind } from '../../utils/chunkKindUtils';
import type { ChildChunk } from '../../types';
import { useChunkStudio } from './ChunkStudioContext';

export function ChunkListPane() {
  const {
    mobileTab,
    setMobileTab,
    isTreeCollapsed,
    setIsTreeCollapsed,
    filteredChunks,
    activeChunk,
    activeChunkId,
    setSelectedChunkId,
    filterParent,
    onSelectSection,
    chunkQuery,
    setChunkQuery,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    linterStats,
    onReindexIds,
    onBatchCleanEmptyChunks,
    selectedChunkIds,
    clearSelectedChunks,
    selectAllFilteredChunks,
    onDeleteChunks,
    handleDeleteSelectedChunks,
    handleDeleteSingleChunk,
    onReparentChildChunk,
    handleOpenReparentSelectedChunks,
    handleOpenReparentSingleChunk,
    onMergeChunks,
    setIsMergeModalOpen,
    isLoading,
    visibleGroups,
    parentMap,
    parentChunksBySection,
    onMoveParent,
    handleOpenReassignParentSectionModal,
    onAddChild,
    setTargetParentForAddChild,
    setIsAddChildModalOpen,
    setTargetInsertAfterChunkId,
    onUpdateParent,
    setTargetParentForEdit,
    setIsEditParentModalOpen,
    onDeleteParent,
    toggleSelectChunk,
    dragOverTarget,
    setDragOverTarget,
    calculateDropPosition,
    handleChildDrop,
    draggedItem,
    setDraggedItem,
    onToggleIgnoreChunk,
    displayLimit,
    setDisplayLimit,
    displayedChildCount,
  } = useChunkStudio();

  return (
    <section
      className={`${
        mobileTab === 'list' ? 'flex' : 'hidden'
      } lg:flex ${
        isTreeCollapsed ? 'lg:col-span-5' : 'lg:col-span-4'
      } flex-col bg-slate-50/50 dark:bg-slate-950/60 min-h-0 overflow-hidden transition-all duration-200`}
    >
      {/* Header */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Mobile Back Button */}
          <button
            type="button"
            onClick={() => setMobileTab('tree')}
            className="lg:hidden p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white rounded mr-0.5 cursor-pointer"
            title="1열 계층 구조로 이동"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          {/* Desktop Expand Tree Button */}
          {isTreeCollapsed && (
            <button
              type="button"
              onClick={() => setIsTreeCollapsed(false)}
              className="hidden lg:inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 px-2 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-800 mr-1.5 transition cursor-pointer shadow-2xs"
              title="계층 트리 패널 다시 펼치기"
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
              <span>트리</span>
            </button>
          )}

          <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider truncate">
            2열: 청크 목록
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            총 <strong className="text-slate-900 dark:text-slate-100 font-semibold">{filteredChunks.length}</strong>개
          </span>
          {/* Mobile Quick Switch to Editor button */}
          {activeChunk && (
            <button
              type="button"
              onClick={() => setMobileTab('editor')}
              className="lg:hidden px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold border border-indigo-200 dark:border-indigo-800"
            >
              에디터 →
            </button>
          )}
        </div>
      </div>

      {/* Active section indicator pill */}
      {filterParent && (
        <div className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/60 border-b border-indigo-100 dark:border-indigo-800 flex items-center justify-between text-xs text-indigo-800 dark:text-indigo-200 shrink-0">
          <span className="truncate font-semibold flex items-center gap-1.5">
            <FolderTree className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>필터: {filterParent.title}</span>
          </span>
          <button
            type="button"
            onClick={() => onSelectSection(null)}
            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-200 p-0.5 rounded cursor-pointer"
            title="필터 해제"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search and Filters */}
      <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 shrink-0">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={chunkQuery}
            onChange={(e) => setChunkQuery(e.target.value)}
            placeholder="청크 내용 / ID 검색..."
            className="w-full text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg pl-8 pr-2.5 py-1.5 focus:bg-white dark:focus:bg-slate-900 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden placeholder-slate-400 dark:placeholder-slate-500 font-medium"
          />
        </div>

        {/* Type & Status Filter Buttons */}
        <div className="flex items-center justify-between gap-1">
          {/* Type Filters */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              className={`text-[11px] px-2 py-0.5 rounded font-medium transition cursor-pointer ${
                typeFilter === 'all'
                  ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('paragraph')}
              className={`text-[11px] px-2 py-0.5 rounded font-medium transition flex items-center gap-1 cursor-pointer ${
                typeFilter === 'paragraph'
                  ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <AlignLeft className="w-3 h-3" />
              문단
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('table')}
              className={`text-[11px] px-2 py-0.5 rounded font-medium transition flex items-center gap-1 cursor-pointer ${
                typeFilter === 'table'
                  ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Table2 className="w-3 h-3" />
              표
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('article')}
              className={`text-[11px] px-2 py-0.5 rounded font-medium transition flex items-center gap-1 cursor-pointer ${
                typeFilter === 'article'
                  ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Scale className="w-3 h-3" />
              조문
            </button>
          </div>

          {/* Status & Linter Filters */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'edited' ? 'all' : 'edited')}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition cursor-pointer ${
                statusFilter === 'edited'
                  ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700 font-bold'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="수정된 청크만 보기"
            >
              수정됨
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'ignored' ? 'all' : 'ignored')}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition cursor-pointer ${
                statusFilter === 'ignored'
                  ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-900 dark:text-rose-200 border-rose-300 dark:border-rose-700 font-bold'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="제외된 청크만 보기"
            >
              제외됨
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'linter' ? 'all' : 'linter')}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition cursor-pointer flex items-center gap-1 ${
                statusFilter === 'linter'
                  ? 'bg-amber-500 text-white border-amber-600 font-bold shadow-2xs'
                  : linterStats.totalWarnings > 0
                  ? 'border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60'
                  : 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="토큰 초과/부족/공백 청크 필터링"
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              <span>품질경고</span>
              {linterStats.totalWarnings > 0 && (
                <span className="font-mono text-[9px] px-1 rounded bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200">
                  {linterStats.totalWarnings}
                </span>
              )}
            </button>
            {linterStats.emptyCount > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === 'empty' ? 'all' : 'empty')}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'empty'
                    ? 'bg-rose-600 text-white border-rose-700 font-bold shadow-2xs'
                    : 'border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/60'
                }`}
                title="공백만 있는 빈 청크 보기"
              >
                <span>빈 청크</span>
                <span className="font-mono text-[9px] px-1 rounded bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-200">
                  {linterStats.emptyCount}
                </span>
              </button>
            )}

            {onReindexIds && (
              <button
                type="button"
                onClick={onReindexIds}
                className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-indigo-50/70 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 font-medium transition cursor-pointer flex items-center gap-1 ml-auto"
                title="전체 섹션(s00~)과 청크(c0001~) ID를 문서 순서 및 128-bit 고유 규격으로 일괄 재정렬"
              >
                <ListOrdered className="w-2.5 h-2.5 text-indigo-600 dark:text-indigo-400" />
                <span>ID 재정렬</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Empty Chunks Linter Banner */}
      {linterStats.emptyCount > 0 && onBatchCleanEmptyChunks && (
        <div className="px-3 py-2 bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-800 flex items-center justify-between text-xs text-rose-900 dark:text-rose-200 shrink-0 animate-in fade-in">
          <span className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>공백만 있는 빈 청크 <strong>{linterStats.emptyCount}</strong>개 발견</span>
          </span>
          <button
            type="button"
            onClick={onBatchCleanEmptyChunks}
            className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 shadow-2xs"
            title="빈 청크를 임베딩 대상에서 일괄 제외 처리합니다."
          >
            <Sparkles className="w-3 h-3" />
            <span>일괄 정리</span>
          </button>
        </div>
      )}

      {/* Multi-Selection Merge Action Bar */}
      {selectedChunkIds.size > 0 && (
        <div className="px-3 py-2 bg-indigo-50 dark:bg-indigo-950/60 border-b border-indigo-200 dark:border-indigo-800 flex items-center justify-between gap-2 shrink-0 animate-in fade-in">
          <div className="flex items-center gap-2">
            <span className="font-bold text-xs text-indigo-950 dark:text-indigo-200 flex items-center gap-1">
              <CheckSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{selectedChunkIds.size}개 선택됨</span>
            </span>
            <button
              type="button"
              onClick={clearSelectedChunks}
              className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
            >
              해제
            </button>
            <button
              type="button"
              onClick={selectAllFilteredChunks}
              className="text-[11px] text-indigo-700 dark:text-indigo-300 hover:text-indigo-950 dark:hover:text-indigo-100 underline cursor-pointer"
            >
              현재 목록 전체선택
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!onDeleteChunks}
              onClick={handleDeleteSelectedChunks}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
              title="선택한 청크들을 일괄 삭제합니다 (소속 Parent 본문 자동 축소 및 정합성 보장)."
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>선택 삭제 ({selectedChunkIds.size})</span>
            </button>

            {onReparentChildChunk && (
              <button
                type="button"
                onClick={handleOpenReparentSelectedChunks}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                title="선택한 청크들을 다른 Parent 청크로 이동하거나 새 Parent를 생성하여 독립시킵니다."
              >
                <FolderTree className="w-3.5 h-3.5" />
                <span>Parent 재할당 ({selectedChunkIds.size})</span>
              </button>
            )}

            <button
              type="button"
              disabled={selectedChunkIds.size < 2 || !onMergeChunks}
              onClick={() => setIsMergeModalOpen(true)}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
              title={
                selectedChunkIds.size < 2
                  ? '2개 이상의 청크를 선택해야 병합할 수 있습니다.'
                  : '선택한 청크들을 하나로 병합합니다.'
              }
            >
              <Merge className="w-3.5 h-3.5" />
              <span>청크 병합 ({selectedChunkIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Chunk Card List grouped by Parent Chunk Container Boxes */}
      <div className="flex-1 p-3 overflow-y-auto space-y-3">
        {isLoading ? (
          <div className="text-slate-400 text-center py-20 text-xs">청크 불러오는 중...</div>
        ) : visibleGroups.length === 0 ? (
          <div className="text-center py-20 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-800">
            <Layers className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto mb-1.5" />
            <p className="text-xs text-slate-400 dark:text-slate-500">조건에 맞는 청크가 없습니다.</p>
          </div>
        ) : (
          visibleGroups.map((group: any) => {
            const parent = group.parent;
            const pid = parent.parent_chunk_id || parent.id || '';
            const pWords = parent.token_estimate || 0;
            const isParentOver = pWords > 2048;
            const parentSec = parentMap.get(parent.section_id);
            const secPids = parentSec?.parent_chunk_ids && parentSec.parent_chunk_ids.length > 0
              ? parentSec.parent_chunk_ids
              : (parentChunksBySection.get(parent.section_id) || []).map((p: any) => p.parent_chunk_id || p.id || '');
            const pIdxInSec = secPids.indexOf(pid);
            const isFirstInSec = pIdxInSec === 0;
            const isLastInSec = pIdxInSec === secPids.length - 1 || pIdxInSec === -1;

            return (
              <div
                key={pid}
                id={`parent-box-${pid}`}
                className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/70 p-2.5 space-y-2 shadow-2xs transition"
              >
                {/* Parent Container Box Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1.5 border-b border-slate-200/80 dark:border-slate-800/80">
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <CopyableBadge
                      id={pid}
                      type="parent"
                      prefix="Parent: "
                      titlePrefix="전체 Parent ID"
                      className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-700/80 shadow-2xs shrink-0"
                    />
                    {parent.title && (
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-[170px]" title={parent.title}>
                        {parent.title}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      p.{parent.page_range?.[0] || 1}{parent.page_range?.[1] && parent.page_range[1] > (parent.page_range[0] || 1) ? `~${parent.page_range[1]}` : ''}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono bg-white dark:bg-slate-800 px-1.5 py-0.2 rounded border border-slate-200 dark:border-slate-700 shrink-0">
                      자식 {group.children.length}개
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Parent Order Move Up/Down Buttons */}
                    {onMoveParent && secPids.length > 1 && (
                      <div className="flex items-center gap-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5 shadow-2xs">
                        <button
                          type="button"
                          disabled={isFirstInSec}
                          onClick={() => onMoveParent(pid, 'up')}
                          className={`p-1 rounded transition ${
                            isFirstInSec
                              ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                              : 'text-purple-600 dark:text-purple-400 hover:text-purple-950 dark:hover:text-purple-200 hover:bg-purple-50 dark:hover:bg-slate-700 cursor-pointer'
                          }`}
                          title={isFirstInSec ? '해당 섹션의 첫 번째 Parent입니다' : '위로 이동 (순서 맞바꾸기)'}
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={isLastInSec}
                          onClick={() => onMoveParent(pid, 'down')}
                          className={`p-1 rounded transition ${
                            isLastInSec
                              ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                              : 'text-purple-600 dark:text-purple-400 hover:text-purple-950 dark:hover:text-purple-200 hover:bg-purple-50 dark:hover:bg-slate-700 cursor-pointer'
                          }`}
                          title={isLastInSec ? '해당 섹션의 마지막 Parent입니다' : '아래로 이동 (순서 맞바꾸기)'}
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Fast Section Reassign Button (Tree Modal) */}
                    <button
                      type="button"
                      onClick={(e) => handleOpenReassignParentSectionModal(parent, e)}
                      className="flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 rounded-lg px-2 py-0.5 shadow-2xs transition cursor-pointer group"
                      title="상위 섹션 변경 (트리에서 선택)"
                    >
                      <FolderTree className="w-3 h-3 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform shrink-0" />
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate max-w-[140px]">
                        {parentMap.get(parent.section_id)?.title || parent.section_id}
                      </span>
                      <ChevronDown className="w-2.5 h-2.5 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 shrink-0" />
                    </button>

                    {/* Parent Token Estimate Badge */}
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                        isParentOver
                          ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                      }`}
                      title={`Parent 누적 토큰: ~${pWords} tokens (권장: 2048 이하)`}
                    >
                      ~{pWords} tok
                    </span>

                    {/* + Child Button */}
                    {onAddChild && (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetParentForAddChild(parent);
                          setIsAddChildModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[11px] font-semibold transition cursor-pointer shadow-2xs"
                        title="이 Parent에 새 Child 청크 추가"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Child 추가</span>
                      </button>
                    )}

                    {/* Edit Parent Button */}
                    {onUpdateParent && (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetParentForEdit(parent);
                          setIsEditParentModalOpen(true);
                        }}
                        className="p-1 text-slate-400 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-md transition cursor-pointer shadow-2xs"
                        title="Parent 제목 및 섹션 수정"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}

                    {/* Delete Parent Button */}
                    {onDeleteParent && (
                      <button
                        type="button"
                        onClick={() => {
                          const confirmed = window.confirm(
                            `정말로 '${parent.title || pid}' 부모 청크를 삭제하시겠습니까?\n소속된 ${group.children.length}개의 자식 청크도 함께 삭제됩니다.`
                          );
                          if (confirmed) {
                            onDeleteParent(pid);
                          }
                        }}
                        className="p-1 text-slate-400 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-md transition cursor-pointer shadow-2xs"
                        title="Parent 및 소속 자식 청크 삭제"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Child Cards inside Parent Container */}
                <div className="space-y-2">
                  {group.children.length === 0 ? (
                    <div className="py-4 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-white/60 dark:bg-slate-900/40">
                      <p className="text-xs text-slate-400 dark:text-slate-500 mb-1.5 font-medium">소속된 자식 청크가 없습니다.</p>
                      {onAddChild && (
                        <button
                          type="button"
                          onClick={() => {
                            setTargetParentForAddChild(parent);
                            setIsAddChildModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 rounded-lg font-semibold transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>첫 번째 Child 청크 추가</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    group.children.map((chunk: ChildChunk) => {
                      const isSelected = activeChunkId === chunk.chunk_id;
                      const isChecked = selectedChunkIds.has(chunk.chunk_id);
                      const tableList = chunk.tables || chunk.metadata?.tables || [];
                      const chunkKind = getChunkKind(chunk);
                      const isComposite = chunkKind === 'composite';
                      const isTable = chunkKind === 'table';
                      const isArticle = chunkKind === 'article';
                      const isIgnored = Boolean(chunk.is_ignored);
                      const isEdited = Boolean(chunk.is_edited);

                      const cWords = chunk.token_estimate || (chunk.text ? estimateKoreanTokens(chunk.text) : 0);
                      const isCEmpty = (!chunk.text || !chunk.text.trim()) && (!chunk.raw_html || !chunk.raw_html.trim());
                      const isCOver = !isTable && !isComposite && cWords > 512;
                      const isCUnder = !isTable && !isComposite && !isCEmpty && cWords > 0 && cWords < 20;

                      const isCardTarget = dragOverTarget?.id === chunk.chunk_id;
                      const cardDropIndicator = isCardTarget
                        ? dragOverTarget.position === 'before'
                          ? 'border-t-2 border-indigo-500 shadow-md'
                          : 'border-b-2 border-indigo-500 shadow-md'
                        : '';

                      return (
                        <div
                          key={chunk.chunk_id}
                          id={`chunk-card-${chunk.chunk_id}`}
                          onClick={() => {
                            setSelectedChunkId(chunk.chunk_id);
                            setMobileTab('editor');
                          }}
                          onDragOver={(e) => {
                            if (!draggedItem || draggedItem.type !== 'child' || draggedItem.id === chunk.chunk_id) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const pos = calculateDropPosition(e, false);
                            setDragOverTarget({ type: 'child', id: chunk.chunk_id, position: pos });
                          }}
                          onDragLeave={() => {
                            if (dragOverTarget?.id === chunk.chunk_id) {
                              setDragOverTarget(null);
                            }
                          }}
                          onDrop={(e) => {
                            if (!draggedItem || draggedItem.type !== 'child') return;
                            const pos = calculateDropPosition(e, false);
                            handleChildDrop(e, chunk, pos);
                          }}
                          className={`p-3 rounded-xl border transition-all cursor-pointer select-none text-xs relative ${cardDropIndicator} ${
                            isChecked
                              ? 'bg-indigo-50/50 dark:bg-indigo-950/50 border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-400/30 shadow-xs'
                              : isSelected
                              ? 'bg-indigo-50/40 dark:bg-slate-800 border-indigo-500 ring-2 ring-indigo-500/30 shadow-md'
                              : isIgnored
                              ? 'bg-slate-50/70 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 opacity-60 hover:opacity-100 hover:bg-white dark:hover:bg-slate-900'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-2xs'
                          }`}
                        >
                          {/* Top Row: Checkbox, Type, Page, ID, Status & Linter Badges */}
                          <div className="flex items-center justify-between gap-1.5 pb-1.5 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Drag handle */}
                              <span
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  setDraggedItem({
                                    type: 'child',
                                    id: chunk.chunk_id,
                                    parentId: pid,
                                    sectionId: parent.section_id,
                                  });
                                  e.dataTransfer.setData(
                                    'application/json',
                                    JSON.stringify({ type: 'child', id: chunk.chunk_id })
                                  );
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => {
                                  setDraggedItem(null);
                                  setDragOverTarget(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="cursor-grab active:cursor-grabbing text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 transition"
                                title="드래그하여 순서 변경"
                              >
                                <GripVertical className="w-3.5 h-3.5" />
                              </span>

                              {/* Checkbox for merge selection */}
                              <button
                                type="button"
                                onClick={(e) => toggleSelectChunk(chunk.chunk_id, e)}
                                className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition p-0.5 rounded cursor-pointer shrink-0"
                                title={isChecked ? '선택 해제' : '병합 대상으로 선택'}
                              >
                                {isChecked ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400" />
                                )}
                              </button>

                              {isComposite ? (
                                <span className="bg-teal-100 dark:bg-teal-950/80 text-teal-800 dark:text-teal-300 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <Layers className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                                  복합 (표 {tableList.length > 0 ? tableList.length : '포함'})
                                </span>
                              ) : isTable ? (
                                <span className="bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <Table2 className="w-3 h-3" />
                                  표
                                </span>
                              ) : isArticle ? (
                                <span className="bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <Scale className="w-3 h-3" />
                                  조문
                                </span>
                              ) : (
                                <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <AlignLeft className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                                  문단
                                </span>
                              )}

                              <CopyableBadge
                                id={chunk.chunk_id}
                                type="chunk"
                                titlePrefix="전체 청크 ID"
                                className="text-[10px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-semibold shrink-0"
                              />

                              <span className="text-[10px] text-slate-400 font-mono">
                                {formatChunkPage(chunk)}
                              </span>

                              {isEdited && (
                                <span className="bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                  <CheckCircle2 className="w-2.5 h-2.5 text-amber-500" />
                                  수정됨
                                </span>
                              )}

                              {isIgnored && (
                                <span className="bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                  <EyeOff className="w-2.5 h-2.5 text-rose-500" />
                                  제외됨
                                </span>
                              )}

                              {/* Linter Badges */}
                              {isCEmpty ? (
                                <span className="bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                  <AlertTriangle className="w-2.5 h-2.5 text-rose-600 dark:text-rose-400" />
                                  빈 청크
                                </span>
                              ) : isComposite ? (
                                <span className="bg-teal-50 dark:bg-teal-950/80 text-teal-800 dark:text-teal-300 border border-teal-300 dark:border-teal-800 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                  <ShieldCheck className="w-2.5 h-2.5 text-teal-600 dark:text-teal-400" />
                                  문단+표 결합
                                </span>
                              ) : isTable ? (
                                <span className="bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                  <ShieldCheck className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                                  표 원형 보존 상태
                                </span>
                              ) : isCOver ? (
                                <span className="bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[9px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                  <AlertTriangle className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                                  512+ tokens
                                </span>
                              ) : isCUnder ? (
                                <span className="bg-sky-50 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 text-[9px] font-medium px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                  <Info className="w-2.5 h-2.5 text-sky-600 dark:text-sky-400" />
                                  &lt;20 tokens
                                </span>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-1">
                              {/* Quick Ignore Toggle Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleIgnoreChunk(chunk.chunk_id);
                                }}
                                className={`p-1 rounded transition cursor-pointer ${
                                  isIgnored
                                    ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/60 bg-rose-50 dark:bg-rose-950/40'
                                    : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                                title={isIgnored ? '임베딩 포함으로 변경' : '임베딩 제외로 변경'}
                              >
                                {isIgnored ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>

                              {/* Quick Reparent Button */}
                              {onReparentChildChunk && (
                                <button
                                  type="button"
                                  onClick={(e) => handleOpenReparentSingleChunk(chunk, e)}
                                  className="p-1 rounded transition cursor-pointer text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-800"
                                  title="상위 Parent 재할당 (이 청크를 다른 Parent로 이동하거나 새 Parent 생성)"
                                >
                                  <FolderTree className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Quick Add Child Below Button */}
                              {onAddChild && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTargetParentForAddChild(parent);
                                    setTargetInsertAfterChunkId(chunk.chunk_id);
                                    setIsAddChildModalOpen(true);
                                  }}
                                  className="p-1 rounded transition cursor-pointer text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60"
                                  title="이 청크 바로 아래에 새 Child 추가"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Quick Single Delete Button */}
                              {onDeleteChunks && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteSingleChunk(chunk.chunk_id);
                                  }}
                                  className="p-1 rounded transition cursor-pointer text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60"
                                  title="이 청크 즉시 삭제 (확인 후 삭제)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Text Snippet (Line Clamped) */}
                          <div className="pt-2 text-slate-700 dark:text-slate-200 leading-snug line-clamp-2 text-[11px]">
                            {(() => {
                              const tblCap = chunk.tables?.[0]?.caption || chunk.metadata?.tables?.[0]?.caption || chunk.table_caption;
                              if (isTable && tblCap) {
                                return `[표] ${tblCap}`;
                              }
                              return chunk.text || (chunk.raw_html ? 'HTML 표 데이터' : '(빈 청크)');
                            })()}
                          </div>

                          {/* Footer Row: Parent Section & Token count */}
                          <div className="pt-2 mt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-400 font-mono">
                            <span className="truncate max-w-[170px]" title={parentSec?.title || chunk.section_id || chunk.parent_id}>
                              {parentSec?.title || chunk.section_id || chunk.parent_id}
                            </span>
                            <span>~{cWords} tokens</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Pagination / Smooth Scroll Guard for 1000+ chunks */}
        {filteredChunks.length > displayLimit && (
          <div className="p-3 bg-white dark:bg-slate-900 border border-dashed border-indigo-200 dark:border-indigo-800 rounded-xl text-center flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-600 dark:text-slate-300 font-medium">
              전체 {filteredChunks.length}개 청크 중 <strong>{displayedChildCount}</strong>개 표시 중 (부드러운 스크롤)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDisplayLimit((prev: number) => prev + 50)}
                className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-semibold rounded-lg transition cursor-pointer"
              >
                +50개 더 보기
              </button>
              <button
                type="button"
                onClick={() => setDisplayLimit(filteredChunks.length)}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition cursor-pointer"
              >
                모두 표시
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

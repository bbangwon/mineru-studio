import React from 'react';
import {
  Layers,
  Table2,
  Scale,
  AlignLeft,
  Scissors,
  Trash2,
  FileCode2,
  Copy,
  ClipboardPaste,
  Sparkles,
  Loader2,
  ArrowLeft,
  RefreshCw,
  Plus,
  Edit2,
  Globe,
  X,
  Check,
  Info,
  AlertTriangle,
  EyeOff,
  FolderTree,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  BookOpen,
  Tag,
  Download,
  CheckCircle2,
  ListPlus,
} from 'lucide-react';
import type {
  ChildChunk,
  EmbeddedTableItem,
} from '../../types';
import { CopyableBadge } from '../CopyableBadge';
import {
  formatChunkPageFull,
  extractCustomMetadata,
  parseCustomMetaValue,
  reconstructCompositeHtml,
  computeTableMetadata,
} from '../../utils/pageUtils';
import {
  getChunkKind,
  getChunkKindLabel,
  hasTableData,
} from '../../utils/chunkKindUtils';
import { useChunkStudio } from './ChunkStudioContext';
export function ChunkEditorPane() {
  const {
    mobileTab,
    setMobileTab,
    isTreeCollapsed,
    activeChunk,
    activeParentChunk,
    activeParent,
    docTitle: docTitleProp,
    onSplitChunk,
    onReparentChildChunk,
    onUpdateChunk,
    setIsBulkMetaModalOpen,
    setRefineError,
    setIsSplitModalOpen,
    onDeleteChunks,
    handleDeleteSingleChunk,
    onOpenJsonlModal,
    editorTab,
    setEditorTab,
    handleFieldChange,
    handleSyncRawHtmlFromText,
    onUpdateParent,
    onMoveParent,
    setTargetParentForEdit,
    setIsEditParentModalOpen,
    handleOpenReparentSingleChunk,
    handleOpenReassignParentSectionModal,
    parentChunks,
    parentChunksBySection,
    parentMap,
    handleOpenTableEditor,
    handleDeleteTableClick,
    handleAddTable,
    pageStartInput,
    setPageStartInput,
    pageEndInput,
    setPageEndInput,
    newMetaKey,
    setNewMetaKey,
    newMetaVal,
    setNewMetaVal,
    newMetaType,
    setNewMetaType,
    editingMetaKey,
    editingMetaVal,
    setEditingMetaVal,
    editingMetaType,
    setEditingMetaType,
    metadataClipboard,
    metaNotice,
    isImportMenuOpen,
    setIsImportMenuOpen,
    importSources,
    handleAddMetaTag,
    handleDeleteMetaTag,
    handleDeleteMetaTagElement,
    handleStartEditMetaTag,
    handleSaveEditMetaTag,
    handleCancelEditMetaTag,
    handleFillMetaForm,
    handleCopyMeta,
    handlePasteMeta,
    handleImportFromSource,
    handleQuickApplyToAll,
    isTableChunk,
    activeCharCount,
    activeWordCount,
    isOverTokenLimit,
    isUnderTokenLimit,
    isStudioRefining,
    studioRefineError,
    studioDiffData,
    handleStudioRunAiRefine,
    setOpenDiffChunkId,
  } = useChunkStudio();

  return (
        <section
          className={`${
            mobileTab === 'editor' ? 'flex' : 'hidden'
          } lg:flex ${
            isTreeCollapsed ? 'lg:col-span-7' : 'lg:col-span-5'
          } flex-col bg-white dark:bg-slate-900 min-h-0 overflow-hidden transition-all duration-200`}
        >
          {activeChunk ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Editor Top Bar */}
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900 flex items-center justify-between shrink-0 gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Mobile Back Button */}
                  <button
                    type="button"
                    onClick={() => setMobileTab('list')}
                    className="lg:hidden p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0 cursor-pointer flex items-center gap-1 text-xs font-semibold"
                    title="2열 청크 목록으로 이동"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">목록</span>
                  </button>

                  {(() => {
                    const activeKind = getChunkKind(activeChunk);
                    return (
                      <div className={`p-1.5 rounded-lg shrink-0 ${
                        activeKind === 'composite'
                          ? 'bg-teal-50 dark:bg-teal-950/80 text-teal-600 dark:text-teal-400'
                          : activeKind === 'table'
                          ? 'bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400'
                          : activeKind === 'article'
                          ? 'bg-purple-50 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400'
                          : 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400'
                      }`}>
                        {activeKind === 'composite' ? (
                          <Layers className="w-4 h-4" />
                        ) : activeKind === 'table' ? (
                          <Table2 className="w-4 h-4" />
                        ) : activeKind === 'article' ? (
                          <Scale className="w-4 h-4" />
                        ) : (
                          <AlignLeft className="w-4 h-4" />
                        )}
                      </div>
                    );
                  })()}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">3열: 에디터</h2>
                      <CopyableBadge
                        id={activeChunk.chunk_id}
                        type="chunk"
                        titlePrefix="전체 청크 ID"
                        className="text-[11px] font-bold px-1.5 py-0.2 bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded shrink-0 border border-slate-300 dark:border-slate-700"
                      />
                      {activeChunk.is_edited && (
                        <span className="text-[10px] bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-bold px-1.5 py-0.2 rounded shrink-0">
                          수정됨
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {formatChunkPageFull(activeChunk)} · 실시간 동기화
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  {onSplitChunk && getChunkKind(activeChunk) !== 'table' && (
                    <button
                      type="button"
                      onClick={() => setIsSplitModalOpen(true)}
                      className="text-xs text-amber-700 dark:text-amber-300 hover:text-amber-900 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-300 dark:border-amber-800 px-2 sm:px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 font-semibold cursor-pointer shadow-2xs"
                      title="긴 청크를 2개로 분할"
                    >
                      <Scissors className="w-3.5 h-3.5 text-amber-600" />
                      <span className="hidden sm:inline">청크 분할</span>
                    </button>
                  )}

                  {onDeleteChunks && (
                    <button
                      type="button"
                      onClick={() => handleDeleteSingleChunk(activeChunk.chunk_id)}
                      className="text-xs text-rose-700 dark:text-rose-300 hover:text-rose-900 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-300 dark:border-rose-800 px-2 sm:px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 font-semibold cursor-pointer shadow-2xs"
                      title="현재 청크 삭제 (상위 Parent 텍스트 자동 축소)"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span className="hidden sm:inline">삭제</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onOpenJsonlModal(activeChunk)}
                    className="text-xs text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-700 px-2 sm:px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 font-semibold cursor-pointer shadow-2xs"
                  >
                    <FileCode2 className="w-3.5 h-3.5" />
                    <span>JSONL</span>
                  </button>
                </div>
              </div>

              {/* Real-time Quality & Token Warning Banner */}
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs shrink-0 font-mono">
                <div className="flex items-center gap-3">
                  <span>
                    글자 수: <strong className="text-slate-800 dark:text-slate-200 font-semibold">{activeCharCount}</strong>자
                  </span>
                  <span>
                    추정 토큰: <strong className="text-indigo-600 dark:text-indigo-400 font-semibold">~{activeWordCount}</strong> tokens
                  </span>
                </div>

                {isTableChunk ? (
                  <span className="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 rounded font-sans text-[11px] flex items-center gap-1.5 font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    표 원형 보존 상태 (Atomic Table - 512 한도 예외)
                  </span>
                ) : isOverTokenLimit ? (
                  <div className="flex items-center gap-1.5 font-sans">
                    <span className="text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded text-[11px] flex items-center gap-1 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      512 토큰 초과 (분할 권장)
                    </span>
                    {onSplitChunk && activeChunk.chunk_type !== 'table' && (
                      <button
                        type="button"
                        onClick={() => setIsSplitModalOpen(true)}
                        className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                        title="분할 도구 열기"
                      >
                        <Scissors className="w-3 h-3" />
                        <span>지금 분할하기</span>
                      </button>
                    )}
                  </div>
                ) : isUnderTokenLimit ? (
                  <span className="text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 px-2 py-0.5 rounded font-sans text-[11px] flex items-center gap-1 font-medium">
                    <Info className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    20 토큰 미만 (2열에서 병합 권장)
                  </span>
                ) : (
                  <span className="text-emerald-700 dark:text-emerald-400 font-sans text-[11px] flex items-center gap-1 font-medium">
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    임베딩 최적 길이
                  </span>
                )}
              </div>

              {/* Exclude notice if ignored */}
              {activeChunk.is_ignored && (
                <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2 font-medium shrink-0">
                  <EyeOff className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>이 청크는 RAG Vector DB 임베딩 및 JSONL 다운로드에서 제외됩니다.</span>
                </div>
              )}

              {/* Scrollable Editor Body */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {/* 1. 상단: Section & Parent 위계 영역 (Level 1 & Level 2) */}
                <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/60 space-y-2.5">
                  {/* (1) Section 위계 맥락 (Breadcrumbs) */}
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center flex-wrap gap-1.5 bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-indigo-100/80 dark:border-indigo-900/40">
                    <span className="font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-1 shrink-0">
                      <FolderTree className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>소속 위계 맥락:</span>
                    </span>
                    {(activeChunk.breadcrumbs || []).length > 0 ? (
                      activeChunk.breadcrumbs.map((b: string, idx: number) => (
                        <React.Fragment key={idx}>
                          <span className={idx === (activeChunk.breadcrumbs?.length || 0) - 1 ? 'font-semibold text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}>
                            {b}
                          </span>
                          {idx < (activeChunk.breadcrumbs?.length || 0) - 1 && (
                            <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
                          )}
                        </React.Fragment>
                      ))
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">{activeParent?.title || '루트'}</span>
                    )}
                  </div>

                  {/* (2) Parent 청크 정보 행 */}
                  {activeParentChunk && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="font-bold text-slate-800 dark:text-slate-200 shrink-0 flex items-center gap-1">
                          <FolderTree className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                          <span>상위 Parent:</span>
                        </span>
                        <CopyableBadge
                          id={activeParentChunk.parent_chunk_id || activeParentChunk.id}
                          type="parent"
                          titlePrefix="전체 Parent ID"
                          className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-700 shrink-0"
                        />
                        {activeParentChunk.title && (
                          <span className="text-slate-700 dark:text-slate-200 font-medium truncate max-w-xs" title={activeParentChunk.title}>
                            · {activeParentChunk.title}
                          </span>
                        )}
                        {onUpdateParent && (
                          <button
                            type="button"
                            onClick={() => {
                              setTargetParentForEdit(activeParentChunk);
                              setIsEditParentModalOpen(true);
                            }}
                            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline flex items-center gap-0.5 font-semibold ml-0.5 cursor-pointer"
                            title="Parent 정보 수정"
                          >
                            <Edit2 className="w-2.5 h-2.5" />
                            <span>수정</span>
                          </button>
                        )}
                        {onMoveParent && (() => {
                          const apId = activeParentChunk.parent_chunk_id || activeParentChunk.id || '';
                          const aSec = parentMap.get(activeParentChunk.section_id);
                          const secPids = aSec?.parent_chunk_ids && aSec.parent_chunk_ids.length > 0
                            ? aSec.parent_chunk_ids
                            : (parentChunksBySection.get(activeParentChunk.section_id) || []).map((p: any) => p.parent_chunk_id || p.id || '');
                          const pIdx = secPids.indexOf(apId);
                          const isFirst = pIdx === 0;
                          const isLast = pIdx === secPids.length - 1 || pIdx === -1;
                          if (secPids.length <= 1) return null;
                          return (
                            <div className="flex items-center gap-0.5 ml-1 bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 rounded p-0.5 shadow-2xs">
                              <button
                                type="button"
                                disabled={isFirst}
                                onClick={() => onMoveParent(apId, 'up')}
                                className={`p-0.5 rounded transition ${
                                  isFirst
                                    ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                    : 'text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-900/50 cursor-pointer'
                                }`}
                                title={isFirst ? '해당 섹션의 첫 번째 Parent입니다' : '위로 이동 (순서 맞바꾸기)'}
                              >
                                <ChevronUp className="w-2.5 h-2.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isLast}
                                onClick={() => onMoveParent(apId, 'down')}
                                className={`p-0.5 rounded transition ${
                                  isLast
                                    ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                    : 'text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-900/50 cursor-pointer'
                                }`}
                                title={isLast ? '해당 섹션의 마지막 Parent입니다' : '아래로 이동 (순서 맞바꾸기)'}
                              >
                                <ChevronDown className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400 font-mono shrink-0">
                        <span>
                          소속 자식 청크: <strong className="text-slate-800 dark:text-slate-200">{activeParentChunk.child_chunk_ids?.length || 1}</strong>개
                        </span>
                        <span
                          className={
                            (activeParentChunk.token_estimate || 0) > 2048
                              ? 'text-amber-700 dark:text-amber-400 font-bold'
                              : 'text-slate-600 dark:text-slate-400'
                          }
                        >
                          Parent 토큰: ~{activeParentChunk.token_estimate || 0} tok {(activeParentChunk.token_estimate || 0) > 2048 ? '(비대 알림)' : ''}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* (3) Parent 단위 Section 재할당 버튼 */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-indigo-100/80 dark:border-indigo-900/50">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                      <FolderTree className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <span>Parent 소속 섹션:</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const targetP =
                          activeParentChunk ||
                          (parentChunks || []).find(
                            (p: any) => (p.parent_chunk_id || p.id) === (activeChunk.parent_chunk_id || activeChunk.parent_id)
                          );
                        if (targetP) {
                          handleOpenReassignParentSectionModal(targetP);
                        }
                      }}
                      className="flex-1 min-w-0 flex items-center justify-between text-xs font-medium bg-white dark:bg-slate-900 hover:bg-indigo-50/60 dark:hover:bg-slate-800 border border-indigo-200 dark:border-indigo-800 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 hover:border-indigo-400 transition cursor-pointer shadow-2xs group"
                      title="트리에서 Parent 청크 소속 섹션 재배치"
                    >
                      <span className="truncate">
                        {parentMap.get(activeChunk.section_id || activeChunk.parent_id || '')?.title ||
                          activeChunk.section_id ||
                          '섹션 지정 필요'}
                      </span>
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold shrink-0 ml-1.5 group-hover:underline">
                        트리에서 변경
                      </span>
                    </button>
                  </div>
                </div>
                
                {/* 2. 하단: Child 청크 제어 영역 (Level 3) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800">
                  {/* Child 단위 Parent 재할당 */}
                  <div className="flex flex-col justify-between min-w-0">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
                        <FolderTree className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                        Child 단위 Parent 재할당
                      </span>
                    </label>
                    {onReparentChildChunk ? (
                      <button
                        type="button"
                        onClick={() => handleOpenReparentSingleChunk(activeChunk)}
                        className="w-full py-1.5 px-2 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 dark:hover:bg-purple-900/60 border border-purple-200 dark:border-purple-800 rounded-lg transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                        title="이 Child 청크만 다른 Parent로 이동하거나 새 Parent를 생성하여 독립시킵니다."
                      >
                        <FolderTree className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                        <span>이 청크만 Parent 재할당</span>
                      </button>
                    ) : (
                      <div className="text-xs text-slate-400 italic py-1">재할당 비활성화</div>
                    )}
                  </div>

                  {/* Page Number & Range Selector */}
                  <div className="min-w-0">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
                        <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                        페이지 번호 (시작 ~ 끝)
                      </span>
                      <span className="font-mono text-[10px] text-slate-400 font-semibold shrink-0">
                        {formatChunkPageFull(activeChunk)}
                      </span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1">
                        <input
                          type="number"
                          min="1"
                          value={pageStartInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPageStartInput(val);
                            const num = parseInt(val, 10);
                            if (!isNaN(num) && num >= 1) {
                              const currentEnd = activeChunk.page_end;
                              const updated: ChildChunk = {
                                ...activeChunk,
                                page_number: num,
                                page_end: currentEnd && currentEnd >= num ? currentEnd : undefined,
                                is_edited: true,
                              };
                              onUpdateChunk(updated, true);
                            }
                          }}
                          onBlur={() => {
                            const num = parseInt(pageStartInput, 10);
                            if (isNaN(num) || num < 1) {
                              setPageStartInput(String(activeChunk.page_number || 1));
                            }
                          }}
                          placeholder="시작"
                          className="w-full text-xs font-mono font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          title="시작 페이지 번호"
                        />
                      </div>
                      <span className="text-slate-400 dark:text-slate-500 text-xs font-bold shrink-0">~</span>
                      <div className="flex-1">
                        <input
                          type="number"
                          min={parseInt(pageStartInput, 10) || 1}
                          value={pageEndInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPageEndInput(val);
                            const num = parseInt(val, 10);
                            const startNum = activeChunk.page_number || 1;
                            if (val.trim() === '') {
                              const updated: ChildChunk = {
                                ...activeChunk,
                                page_end: undefined,
                                is_edited: true,
                              };
                              onUpdateChunk(updated, true);
                            } else if (!isNaN(num) && num >= startNum) {
                              const updated: ChildChunk = {
                                ...activeChunk,
                                page_end: num,
                                is_edited: true,
                              };
                              onUpdateChunk(updated, true);
                            }
                          }}
                          onBlur={() => {
                            const num = parseInt(pageEndInput, 10);
                            const startNum = activeChunk.page_number || 1;
                            if (!pageEndInput.trim()) {
                              // OK: single page
                            } else if (isNaN(num) || num < startNum) {
                              setPageEndInput(activeChunk.page_end ? String(activeChunk.page_end) : '');
                            }
                          }}
                          placeholder="끝 (선택)"
                          className="w-full text-xs font-mono font-medium bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          title="종료 페이지 번호 (선택사항, 단일 페이지는 비움)"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Embedding Exclude Toggle */}
                  <div className="flex flex-col justify-end">
                    <label className="flex items-center gap-2 p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(activeChunk.is_ignored)}
                        onChange={(e) => handleFieldChange('is_ignored', e.target.checked)}
                        className="w-4 h-4 text-rose-600 rounded border-slate-300 dark:border-slate-700 focus:ring-rose-500 cursor-pointer"
                      />
                      <div className="text-xs">
                        <span className={`font-semibold ${activeChunk.is_ignored ? 'text-rose-700 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}`}>
                          임베딩 대상에서 제외
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Table & Composite Specific Fields & Tabs */}
                {(() => {
                  const activeTableList = activeChunk.tables || activeChunk.metadata?.tables || [];
                  const activeKind = getChunkKind(activeChunk);
                  const hasTablesInActiveChunk = hasTableData(activeChunk);
                  const isActiveComposite = activeKind === 'composite';

                  if (!hasTablesInActiveChunk) return null;

                  return (
                    <div className="space-y-3">
                      <div className="space-y-3 p-3.5 bg-indigo-50/40 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/50">
                        <div className="flex items-center justify-between border-b border-indigo-200/60 dark:border-indigo-800/60 pb-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditorTab('text')}
                              className={`text-xs font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                                editorTab === 'text'
                                  ? 'bg-indigo-600 text-white shadow-2xs'
                                  : 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                              }`}
                            >
                              {isActiveComposite ? '본문/마크다운 텍스트' : '표 텍스트'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditorTab('raw_html')}
                              className={`text-xs font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                                editorTab === 'raw_html'
                                  ? 'bg-indigo-600 text-white shadow-2xs'
                                  : 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                              }`}
                            >
                              {isActiveComposite ? '통합 HTML 원형 (문단+표)' : '표 HTML 원형'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditorTab('preview')}
                              className={`text-xs font-bold px-2.5 py-1 rounded-lg transition cursor-pointer ${
                                editorTab === 'preview'
                                  ? 'bg-indigo-600 text-white shadow-2xs'
                                  : 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                              }`}
                            >
                              {isActiveComposite ? '통합 문서 미리보기' : 'HTML 미리보기'}
                            </button>
                          </div>

                          <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            {isActiveComposite ? `복합 청크 (표 ${activeTableList.length || 1}개 결합)` : '원형 보존 표'}
                          </span>
                        </div>

                        {activeKind === 'table' ? (
                          <div className="space-y-2.5">
                            {/* 단일 표 제어 툴바 */}
                            <div className="flex items-center justify-between pb-1 border-b border-indigo-100 dark:border-indigo-900/50">
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                <Table2 className="w-3.5 h-3.5 text-indigo-500" />
                                <span>단일 표 속성 및 내용</span>
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenTableEditor(activeChunk, 0, activeChunk.raw_html, activeTableList[0]?.caption || activeChunk.table_caption, activeTableList[0]?.footnote || activeChunk.table_footnote)}
                                  className="text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                                  title="표 제목, 각주, 셀 데이터 및 가로/세로 셀 병합 창 열기"
                                >
                                  <Edit2 className="w-2.5 h-2.5" />
                                  <span>내용/병합 편집</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAddTable(activeChunk)}
                                  className="text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                                  title="새 표를 추가하여 복합 청크(Composite)로 승격합니다"
                                >
                                  <Plus className="w-2.5 h-2.5 text-indigo-500" />
                                  <span>+ 표 추가</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTableClick(activeChunk, 0, '원형 보존 표')}
                                  className="text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/70 hover:bg-rose-100 dark:hover:bg-rose-900 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                                  title="표를 삭제하고 일반 문단 청크로 전환합니다"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                  <span>표 삭제</span>
                                </button>
                              </div>
                            </div>

                            {(() => {
                              const singleCaption = activeTableList[0]?.caption || activeChunk.table_caption || activeChunk.metadata?.table_caption;
                              const singleFootnote = activeTableList[0]?.footnote || activeChunk.table_footnote || activeChunk.metadata?.table_footnote;
                              return (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
                                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                                      <span className="font-semibold text-slate-700 dark:text-slate-300">표 제목 (Caption)</span>
                                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">조회 전용</span>
                                    </div>
                                    <div className="text-xs text-slate-800 dark:text-slate-200 break-words" title={singleCaption || ''}>
                                      {singleCaption || <span className="text-slate-400 dark:text-slate-500 italic">설정된 제목 없음</span>}
                                    </div>
                                  </div>
                                  <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
                                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                                      <span className="font-semibold text-slate-700 dark:text-slate-300">표 각주 (Footnote)</span>
                                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">조회 전용</span>
                                    </div>
                                    <div className="text-xs text-slate-800 dark:text-slate-200 break-words" title={singleFootnote || ''}>
                                      {singleFootnote || <span className="text-slate-400 dark:text-slate-500 italic">설정된 각주 없음</span>}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* 단일 표 실시간 렌더링 컨테이너 */}
                            <div className="pt-2 border-t border-indigo-200/50 dark:border-indigo-900/50">
                              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1 font-medium">
                                <span className="flex items-center gap-1 font-semibold text-indigo-700 dark:text-indigo-300">
                                  <Table2 className="w-3 h-3 text-indigo-500" />
                                  <span>표 실시간 미리보기</span>
                                </span>
                                <span className="text-[9px] text-slate-400 font-mono">
                                  {activeChunk.raw_html ? '원형 보존 HTML' : '내용 없음'}
                                </span>
                              </div>
                              <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 max-h-48 overflow-auto prose-custom text-[11px] leading-relaxed shadow-2xs">
                                {activeChunk.raw_html ? (
                                  <div dangerouslySetInnerHTML={{ __html: activeChunk.raw_html }} />
                                ) : (
                                  <p className="text-slate-400 dark:text-slate-600 italic text-xs">표 원형 데이터가 없습니다.</p>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : isActiveComposite && activeTableList.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                포함된 개별 표 목록 ({activeTableList.length}개)
                              </label>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleAddTable(activeChunk)}
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                                  title="이 복합 청크에 새 표를 추가합니다"
                                >
                                  <Plus className="w-3 h-3 text-indigo-500" />
                                  <span>표 추가</span>
                                </button>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                                  제목·각주는 [내용/병합 편집]에서 수정
                                </span>
                              </div>
                            </div>
                            <div className="space-y-2">
                              {activeTableList.map((tbl: EmbeddedTableItem, idx: number) => (
                                <div
                                  key={idx}
                                  className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-indigo-100 dark:border-indigo-900/60 shadow-2xs space-y-2"
                                >
                                  <div className="flex items-center justify-between text-xs border-b border-slate-100 dark:border-slate-800 pb-1.5">
                                    <span className="font-bold text-[11px] text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                                      <Table2 className="w-3.5 h-3.5" />
                                      표 {idx + 1}
                                      {tbl.page_number && (
                                        <span className="text-[10px] font-normal text-slate-400">
                                          (p.{tbl.page_number})
                                        </span>
                                      )}
                                      {tbl.row_count ? (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono font-normal">
                                          {tbl.row_count}행
                                        </span>
                                      ) : null}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleOpenTableEditor(activeChunk, idx, tbl.raw_html, tbl.caption, tbl.footnote)}
                                        className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 cursor-pointer transition"
                                        title="표 제목, 각주, 셀 데이터 및 가로/세로 셀 병합 창 열기"
                                      >
                                        <Edit2 className="w-2.5 h-2.5" />
                                        <span>내용/병합 편집</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteTableClick(activeChunk, idx, `표 ${idx + 1}`)}
                                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950 hover:bg-rose-100 dark:hover:bg-rose-900 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center gap-0.5 cursor-pointer transition"
                                        title="이 표 삭제"
                                      >
                                        <Trash2 className="w-2.5 h-2.5" />
                                        <span>삭제</span>
                                      </button>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                                      <div className="flex items-center justify-between text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-0.5">
                                        <span className="font-semibold text-slate-600 dark:text-slate-300">표 {idx + 1} 제목 (Caption)</span>
                                        <span className="text-[9px] text-slate-400 dark:text-slate-500 font-normal">조회 전용</span>
                                      </div>
                                      <div className="text-xs text-slate-800 dark:text-slate-200 break-words" title={tbl.caption || ''}>
                                        {tbl.caption || <span className="text-slate-400 dark:text-slate-500 italic">설정된 제목 없음</span>}
                                      </div>
                                    </div>
                                    <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                                      <div className="flex items-center justify-between text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-0.5">
                                        <span className="font-semibold text-slate-600 dark:text-slate-300">표 {idx + 1} 각주 (Footnote)</span>
                                        <span className="text-[9px] text-slate-400 dark:text-slate-500 font-normal">조회 전용</span>
                                      </div>
                                      <div className="text-xs text-slate-800 dark:text-slate-200 break-words" title={tbl.footnote || ''}>
                                        {tbl.footnote || <span className="text-slate-400 dark:text-slate-500 italic">설정된 각주 없음</span>}
                                      </div>
                                    </div>
                                  </div>

                                  {/* 개별 표 실시간 렌더링 컨테이너 */}
                                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
                                    <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1 font-medium">
                                      <span className="flex items-center gap-1 font-semibold text-indigo-700 dark:text-indigo-300">
                                        <Table2 className="w-3 h-3 text-indigo-500" />
                                        <span>표 {idx + 1} 실제 내용 미리보기</span>
                                      </span>
                                      <span className="text-[9px] text-slate-400 font-mono">
                                        {tbl.row_count ? `${tbl.row_count}행 데이터` : '실시간 렌더링'}
                                      </span>
                                    </div>
                                    <div className="p-2.5 bg-slate-50/80 dark:bg-slate-950/80 rounded-lg border border-slate-200/80 dark:border-slate-800/80 max-h-48 overflow-auto prose-custom text-[11px] leading-relaxed shadow-2xs">
                                      {tbl.raw_html ? (
                                        <div dangerouslySetInnerHTML={{ __html: tbl.raw_html }} />
                                      ) : (
                                        <p className="text-slate-400 dark:text-slate-600 italic text-xs">표 원형 데이터가 없습니다.</p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })()}

                {/* Main Textarea / Code / Preview */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        {(() => {
                          const kind = getChunkKind(activeChunk);
                          if (editorTab === 'raw_html') {
                            return kind === 'composite'
                              ? '통합 HTML 원형 코드 (raw_html: 문단+표)'
                              : '표 HTML 원형 코드 (raw_html)';
                          }
                          if (editorTab === 'preview') {
                            return kind === 'composite'
                              ? '통합 문서 미리보기 (문단+표)'
                              : '표 렌더링 미리보기 (HTML Preview)';
                          }
                          if (kind === 'composite') return '복합 청크 본문 텍스트 (Markdown) 편집';
                          if (kind === 'table') return '표 검색 요약 텍스트 (Text) 편집';
                          if (kind === 'article') return '조문 본문 텍스트 (Text) 편집';
                          return '청크 본문 텍스트 (Text) 편집';
                        })()}
                      </label>

                      {editorTab !== 'preview' && (
                        <button
                          type="button"
                          onClick={handleStudioRunAiRefine}
                          disabled={isStudioRefining}
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-2xs flex items-center gap-1 cursor-pointer disabled:opacity-50 transition"
                          title="로컬 LLM을 사용하여 비정상적인 줄바꿈과 띄어쓰기를 자동으로 교정합니다"
                        >
                          {isStudioRefining ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>AI 교정 중...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3 h-3" />
                              <span>🪄 AI 교정</span>
                            </>
                          )}
                        </button>
                      )}

                      {editorTab !== 'preview' && !hasTableData(activeChunk) && (
                        <button
                          type="button"
                          onClick={() => handleAddTable(activeChunk)}
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                          title="이 청크에 표를 추가합니다"
                        >
                          <Table2 className="w-3 h-3 text-indigo-500" />
                          <span>+ 표 삽입</span>
                        </button>
                      )}

                      {studioDiffData && (
                        <button
                          type="button"
                          onClick={() => {
                            if (activeChunk) setOpenDiffChunkId(activeChunk.chunk_id);
                          }}
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 cursor-pointer transition"
                          title="AI 교정 결과 Diff 비교 창 열기"
                        >
                          <span>Diff 보기</span>
                        </button>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">수정 즉시 2열 목록에 반영됩니다.</span>
                  </div>

                  {studioRefineError && (
                    <div className="p-2 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-lg flex items-center justify-between text-xs">
                      <span>{studioRefineError}</span>
                      <button
                        type="button"
                        onClick={() => setRefineError(null)}
                        className="text-rose-400 hover:text-rose-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {hasTableData(activeChunk) && editorTab === 'preview' ? (
                    <div className="p-4 bg-slate-50/80 dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800 min-h-[220px] max-h-[420px] overflow-y-auto">
                      <div
                        className="prose-custom text-xs"
                        dangerouslySetInnerHTML={{
                          __html: (() => {
                            const isComposite = getChunkKind(activeChunk) === 'composite';
                            if (isComposite) {
                              return reconstructCompositeHtml(activeChunk);
                            }
                            return activeChunk.raw_html || activeChunk.text || '<p>표 내용 없음</p>';
                          })(),
                        }}
                      />
                    </div>
                  ) : (hasTableData(activeChunk) || Boolean(activeChunk.raw_html)) && editorTab === 'raw_html' ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
                        <span className="font-mono text-[10px] text-slate-400">
                          {getChunkKind(activeChunk) === 'composite' ? '문단+표 통합 HTML 코드' : '원형 표 HTML 코드'}
                        </span>
                        <button
                          type="button"
                          onClick={handleSyncRawHtmlFromText}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                          title="본문 텍스트 내용과 원형 표를 결합하여 HTML을 재구성합니다"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          <span>본문 텍스트 기반 HTML 재동기화</span>
                        </button>
                      </div>
                      <textarea
                        value={
                          activeChunk.raw_html ||
                          (hasTableData(activeChunk)
                            ? reconstructCompositeHtml(activeChunk)
                            : '')
                        }
                        onChange={(e) => handleFieldChange('raw_html', e.target.value)}
                        rows={11}
                        className="w-full font-mono text-xs p-3.5 bg-slate-900 text-emerald-400 rounded-xl border border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y"
                        placeholder="<table>...</table>"
                      />
                    </div>
                  ) : (
                    <textarea
                      value={activeChunk.text || ''}
                      onChange={(e) => handleFieldChange('text', e.target.value)}
                      rows={11}
                      className="w-full text-xs p-3.5 bg-white dark:bg-slate-950 rounded-xl border border-slate-300 dark:border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed text-slate-800 dark:text-slate-100 resize-y font-sans shadow-2xs placeholder-slate-400 dark:placeholder-slate-500"
                      placeholder="청크 본문 텍스트를 입력하세요..."
                    />
                  )}
                </div>

                {/* Custom Metadata Tags Editor */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        임베딩 커스텀 메타데이터
                      </span>
                    </div>

                    {/* Metadata Action Toolbar */}
                    <div className="flex items-center gap-1.5 relative">
                      {/* 가져오기 드롭다운 */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setIsImportMenuOpen(!isImportMenuOpen)}
                          disabled={importSources.length === 0}
                          title={importSources.length === 0 ? '가져올 수 있는 이전 청크가 없습니다.' : '다른 청크에서 메타데이터 가져오기'}
                          className="px-2 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                        >
                          <Download className="w-3 h-3 text-indigo-500" />
                          <span>가져오기</span>
                          <ChevronDown className="w-3 h-3 text-slate-400" />
                        </button>

                        {isImportMenuOpen && (
                          <div className="absolute right-0 top-full mt-1.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-30 p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-100">
                            <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              메타데이터 가져올 청크 선택
                            </div>
                            {importSources.map((s: any, idx: number) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleImportFromSource(s.chunk)}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition cursor-pointer flex flex-col"
                              >
                                <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                                  <span>{s.label}</span>
                                  <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.2 rounded font-mono">
                                    {s.count}개
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-400 truncate mt-0.5 font-mono">
                                  {s.subLabel}
                                </span>
                              </button>
                            ))}
                            <div className="pt-1 border-t border-slate-100 dark:border-slate-800 px-2 py-0.5 text-[9px] text-slate-400">
                              ※ 현재 청크의 페이지 번호는 유지됩니다.
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 복사 버튼 */}
                      <button
                        type="button"
                        onClick={handleCopyMeta}
                        title="현재 청크의 커스텀 메타데이터 복사 (페이지 제외)"
                        className="px-2 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                      >
                        <Copy className="w-3 h-3 text-slate-500" />
                        <span>복사</span>
                      </button>

                      {/* 붙여넣기 버튼 */}
                      <button
                        type="button"
                        onClick={handlePasteMeta}
                        disabled={!metadataClipboard || Object.keys(metadataClipboard).length === 0}
                        title={metadataClipboard ? `클립보드 메타데이터(${Object.keys(metadataClipboard).length}개) 붙여넣기` : '복사된 메타데이터 없음'}
                        className="px-2 py-1 text-[11px] font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                      >
                        <ClipboardPaste className="w-3 h-3 text-emerald-500" />
                        <span>붙여넣기</span>
                        {metadataClipboard && Object.keys(metadataClipboard).length > 0 && (
                          <span className="text-[9px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 px-1 rounded-full font-mono font-bold">
                            {Object.keys(metadataClipboard).length}
                          </span>
                        )}
                      </button>

                      {/* 일괄 관리 버튼 */}
                      <button
                        type="button"
                        onClick={() => setIsBulkMetaModalOpen(true)}
                        title="문서 전체 또는 섹션 메타데이터 일괄 추가/전파/삭제"
                        className="px-2 py-1 text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/60 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                      >
                        <Layers className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                        <span>일괄 관리</span>
                      </button>
                    </div>
                  </div>

                  {/* 피드백 알림 배너 */}
                  {metaNotice && (
                    <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs text-indigo-700 dark:text-indigo-300 font-medium flex items-center gap-1.5 animate-in fade-in duration-150">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                      <span>{metaNotice}</span>
                    </div>
                  )}

                  {/* 시스템 자동 추적 메타데이터 (읽기 전용 표시) */}
                  {(() => {
                    const tableSummary = computeTableMetadata(activeChunk);
                    const docTitle = activeChunk.metadata?.doc_title || docTitleProp;
                    return (
                      <div className="p-2 bg-slate-100/80 dark:bg-slate-900/80 rounded-lg border border-slate-200/80 dark:border-slate-800 text-[11px] space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center justify-between">
                          <span>시스템 자동 추적 속성 (읽기 전용)</span>
                          <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-normal">본문/문서 상태 기반 자동 계산</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {docTitle && (
                            <span className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300 font-medium">
                              <span className="text-slate-400">문서:</span>
                              <span className="font-semibold text-slate-900 dark:text-slate-100">{docTitle}</span>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300 font-mono">
                            <span className="text-slate-400 font-sans">유형:</span>
                            <span className="font-semibold text-indigo-600 dark:text-indigo-400 font-sans">
                              {getChunkKindLabel(getChunkKind(activeChunk), tableSummary.table_count)}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300 font-mono">
                            <span className="text-slate-400 font-sans">위치:</span>
                            <span>{formatChunkPageFull(activeChunk)}</span>
                          </span>
                          <span className={`inline-flex items-center gap-1 border px-2 py-0.5 rounded font-medium ${
                            tableSummary.has_tables
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                          }`}>
                            <span className="text-slate-400">표 상태:</span>
                            <span>
                              {tableSummary.has_tables
                                ? (tableSummary.is_atomic_table ? '원자적 단독 표' : `표 ${tableSummary.table_count}개 포함`)
                                : '표 없음'}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded text-slate-500 dark:text-slate-400 font-mono">
                            <span className="font-sans">토큰:</span>
                            <span>~{activeChunk.token_estimate || 0}</span>
                          </span>
                        </div>

                        {/* 조문 메타데이터 빠른 편집 필드 */}
                        <div className="pt-2 mt-1 border-t border-slate-200/60 dark:border-slate-800/80">
                          <div className="flex items-center justify-between pb-1">
                            <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                              <Scale className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                              <span>법률/규정 조문 메타데이터</span>
                            </span>
                            {activeChunk.metadata?.article_no && (
                              <span className="text-[10px] text-purple-600 dark:text-purple-400 font-mono font-semibold">
                                {activeChunk.metadata.article_no}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-400 dark:text-slate-500 block mb-0.5">조문 번호</label>
                              <input
                                type="text"
                                value={activeChunk.metadata?.article_no || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const newMeta = { ...(activeChunk.metadata || {}) };
                                  if (val) {
                                    newMeta.article_no = val;
                                    newMeta.article_display = newMeta.article_title ? `${val}(${newMeta.article_title})` : val;
                                  } else {
                                    delete newMeta.article_no;
                                    delete newMeta.article_display;
                                  }
                                  handleFieldChange('metadata', newMeta);
                                }}
                                placeholder="예: 제1조, 제24조의2"
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 dark:text-slate-500 block mb-0.5">조문 제목</label>
                              <input
                                type="text"
                                value={activeChunk.metadata?.article_title || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const newMeta = { ...(activeChunk.metadata || {}) };
                                  if (val) {
                                    newMeta.article_title = val;
                                    if (newMeta.article_no) {
                                      newMeta.article_display = `${newMeta.article_no}(${val})`;
                                    }
                                  } else {
                                    delete newMeta.article_title;
                                    if (newMeta.article_no) {
                                      newMeta.article_display = newMeta.article_no;
                                    }
                                  }
                                  handleFieldChange('metadata', newMeta);
                                }}
                                placeholder="예: 목적, 정의"
                                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Existing Custom Tags (순수 커스텀 태그만 표시) */}
                  <div className="flex flex-wrap gap-1.5 min-h-[30px] items-center">
                    {(() => {
                      const customEntries = Object.entries(extractCustomMetadata(activeChunk.metadata));
                      if (customEntries.length === 0) {
                        return (
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">등록된 커스텀 태그가 없습니다.</span>
                        );
                      }
                      return customEntries.map(([key, val]) => {
                        const isEditingThis = editingMetaKey === key;
                        const isArr = Array.isArray(val);

                        if (isEditingThis) {
                          return (
                            <span
                              key={key}
                              className="inline-flex items-center gap-1.5 text-xs bg-indigo-50 dark:bg-indigo-950/70 text-indigo-950 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 px-2 py-1 rounded-md shadow-2xs font-mono animate-in fade-in duration-100"
                            >
                              <span className="font-bold text-indigo-700 dark:text-indigo-400">{key}:</span>
                              <input
                                type="text"
                                value={editingMetaVal}
                                onChange={(e) => setEditingMetaVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveEditMetaTag();
                                  if (e.key === 'Escape') handleCancelEditMetaTag();
                                }}
                                autoFocus
                                placeholder={editingMetaType === 'array' ? '태그1, 태그2 (쉼표 구분)' : '값 입력'}
                                className="bg-white dark:bg-slate-900 border border-indigo-400 dark:border-indigo-600 rounded px-1.5 py-0.5 text-xs text-slate-900 dark:text-slate-100 font-sans focus:outline-hidden focus:ring-1 focus:ring-indigo-500 w-36"
                              />
                              <button
                                type="button"
                                onClick={() => setEditingMetaType((prev: string) => (prev === 'array' ? 'text' : 'array'))}
                                className="text-[10px] text-indigo-700 dark:text-indigo-300 bg-indigo-200/70 dark:bg-indigo-900 px-1 py-0.5 rounded cursor-pointer hover:bg-indigo-300"
                                title="타입 전환 (텍스트 <-> 배열)"
                              >
                                {editingMetaType === 'array' ? '배열' : '텍스트'}
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveEditMetaTag}
                                className="text-emerald-600 hover:text-emerald-700 dark:hover:text-emerald-400 p-0.5 rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/50 cursor-pointer"
                                title="저장 (Enter)"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEditMetaTag}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                                title="취소 (Esc)"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          );
                        }

                        // Display Mode: Array vs Scalar
                        if (isArr) {
                          return (
                            <span
                              key={key}
                              className="group inline-flex items-center gap-1.5 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-indigo-200 dark:border-indigo-800/80 px-2 py-1 rounded-md shadow-2xs font-mono hover:border-indigo-400 dark:hover:border-indigo-600 transition"
                            >
                              <button
                                type="button"
                                onClick={() => handleFillMetaForm(key, val)}
                                title="클릭 시 하단 입력창에 채우기"
                                className="font-semibold text-indigo-700 dark:text-indigo-400 hover:underline cursor-pointer"
                              >
                                {key}:
                              </button>
                              <div className="flex flex-wrap gap-1 items-center">
                                {val.length === 0 ? (
                                  <span className="text-[11px] text-slate-400 italic">빈 배열</span>
                                ) : (
                                  val.map((item: string, idx: number) => (
                                    <span
                                      key={idx}
                                      className="inline-flex items-center gap-0.5 text-[11px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900 px-1.5 py-0.2 rounded font-sans"
                                    >
                                      <span>#{item}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteMetaTagElement(key, idx);
                                        }}
                                        className="text-indigo-400 hover:text-rose-500 rounded p-0.5 transition cursor-pointer"
                                        title={`'${item}' 태그 삭제`}
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </span>
                                  ))
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleStartEditMetaTag(key, val)}
                                className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer opacity-60 group-hover:opacity-100 transition"
                                title="값 수정"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleQuickApplyToAll(key, val)}
                                className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer ml-0.5 opacity-60 group-hover:opacity-100 transition"
                                title="이 태그를 문서 전체 청크에 일괄 적용"
                              >
                                <Globe className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMetaTag(key)}
                                className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer ml-0.5 opacity-60 group-hover:opacity-100 transition"
                                title="키 전체 삭제"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          );
                        }

                        // Display Mode: Scalar (string, number, etc.)
                        return (
                          <span
                            key={key}
                            className="group inline-flex items-center gap-1.5 text-xs bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 px-2 py-1 rounded-md shadow-2xs font-mono hover:border-indigo-300 dark:hover:border-indigo-700 transition"
                          >
                            <button
                              type="button"
                              onClick={() => handleFillMetaForm(key, val)}
                              title="클릭 시 하단 입력창에 채우기"
                              className="font-semibold text-indigo-700 dark:text-indigo-400 hover:underline cursor-pointer"
                            >
                              {key}:
                            </button>
                            <span
                              onClick={() => handleStartEditMetaTag(key, val)}
                              title="클릭하여 값 바로 수정"
                              className="text-slate-600 dark:text-slate-300 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-300 transition"
                            >
                              {String(val)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleStartEditMetaTag(key, val)}
                              className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer opacity-60 group-hover:opacity-100 transition"
                              title="값 바로 수정"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickApplyToAll(key, val)}
                              className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer ml-0.5 opacity-60 group-hover:opacity-100 transition"
                              title="이 태그를 문서 전체 청크에 일괄 적용"
                            >
                              <Globe className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMetaTag(key)}
                              className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer ml-0.5 opacity-60 group-hover:opacity-100 transition"
                              title="태그 삭제"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      });
                    })()}
                  </div>

                  {/* Add / Update Tag Inputs */}
                  {(() => {
                    const isExistingKey = Boolean(
                      activeChunk.metadata &&
                      newMetaKey.trim() &&
                      newMetaKey.trim() in activeChunk.metadata
                    );

                    return (
                      <div className="space-y-1.5 pt-1">
                        {/* Type Toggle */}
                        <div className="flex items-center justify-between">
                          <div className="flex rounded-md border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-100 dark:bg-slate-900 text-[11px]">
                            <button
                              type="button"
                              onClick={() => setNewMetaType('text')}
                              className={`px-2 py-0.5 rounded transition cursor-pointer ${
                                newMetaType === 'text'
                                  ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs font-semibold'
                                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                              }`}
                            >
                              단일 텍스트
                            </button>
                            <button
                              type="button"
                              onClick={() => setNewMetaType('array')}
                              className={`px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${
                                newMetaType === 'array'
                                  ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs font-semibold'
                                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                              }`}
                            >
                              <ListPlus className="w-3 h-3" />
                              <span>태그 목록 (배열)</span>
                            </button>
                          </div>
                          {newMetaType === 'array' && (
                            <span className="text-[10px] text-slate-400">
                              쉼표(,)로 구분 입력
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newMetaKey}
                            onChange={(e) => setNewMetaKey(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddMetaTag();
                            }}
                            placeholder={newMetaType === 'array' ? 'Key (예: keywords)' : 'Key (예: category)'}
                            className="w-1/3 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden font-mono"
                          />
                          <input
                            type="text"
                            value={newMetaVal}
                            onChange={(e) => setNewMetaVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddMetaTag();
                            }}
                            placeholder={
                              newMetaType === 'array'
                                ? 'Value (예: 산재보상, 근골격계 - 쉼표 구분)'
                                : 'Value (예: safety_rules)'
                            }
                            className="flex-1 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                          />
                          <button
                            type="button"
                            onClick={handleAddMetaTag}
                            disabled={!newMetaKey.trim()}
                            className={`px-3 py-1.5 disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer shrink-0 ${
                              isExistingKey
                                ? 'bg-amber-600 hover:bg-amber-700'
                                : 'bg-indigo-600 hover:bg-indigo-700'
                            }`}
                            title={isExistingKey ? '기존 키의 값을 업데이트합니다' : '새 메타데이터 태그 추가'}
                          >
                            {isExistingKey ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>값 수정</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" />
                                <span>태그 추가</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Live Parsed Preview for Array */}
                        {newMetaType === 'array' && newMetaVal.trim() && (
                          <div className="flex flex-wrap gap-1 items-center px-1">
                            <span className="text-[10px] text-slate-400">미리보기:</span>
                            {(parseCustomMetaValue(newMetaVal, 'array') as string[]).map((t, idx) => (
                              <span
                                key={idx}
                                className="bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] px-1.5 py-0.2 rounded font-mono"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="text-[10px] text-slate-400 dark:text-slate-500 pt-0.5">
                          ※ doc_title, page, table(표) 관련 속성은 시스템이 본문과 동기화하여 자동 관리하므로 커스텀 태그로 등록할 수 없습니다.
                        </div>
                      </div>
                    );
                  })()}
                </div>

              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/50 dark:bg-slate-950/60">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3 shadow-2xs">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">선택된 청크가 없습니다</h3>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed mb-4">
                2열 청크 타임라인 목록에서 청크를 클릭하면 본문 텍스트, 메타데이터, 부모 섹션을 집중적으로 편집할 수 있습니다.
              </p>
              <button
                type="button"
                onClick={() => setMobileTab('list')}
                className="lg:hidden px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer shadow-xs flex items-center gap-1.5"
              >
                <Layers className="w-4 h-4" />
                <span>청크 목록으로 이동</span>
              </button>
            </div>
          )}
        </section>

  );
}

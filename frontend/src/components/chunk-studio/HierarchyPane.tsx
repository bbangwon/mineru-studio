import React from 'react';
import {
  Network,
  Search,
  AlertTriangle,
  Plus,
  PanelLeftClose,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderTree,
  Edit2,
  Check,
  X,
  Trash2,
  CornerDownRight,
  CornerUpLeft,
  GripVertical,
  BookOpen,
  Folder,
  FileText,
  Info,
  Layers,
} from 'lucide-react';
import {
  formatDisplayParentId,
} from '../../utils/idUtils';
import type {
  ParentSection,
  ChildChunk,
} from '../../types';
import { useChunkStudio } from './ChunkStudioContext';

export function HierarchyPane() {
  const {
    mobileTab,
    setMobileTab,
    isTreeCollapsed,
    setIsTreeCollapsed,
    isAnySectionExpanded,
    collapseAllSections,
    expandAllSections,
    setManualExpandedState,
    onAddSection,
    setIsAddSectionModalOpen,
    selectedSectionId,
    onSelectSection,
    sectionSearch,
    setSectionSearch,
    emptySectionsCount,
    onBatchCleanEmptySections,
    isLoading,
    visibleTopLevelSections,
    childChunksBySection,
    parentSections,
    parentChunksBySection,
    childChunksByParent,
    childSectionsMap,
    isParentExpanded,
    toggleExpandParent,
    isSectionExpanded,
    toggleExpandSection,
    activeParentChunk,
    dragOverTarget,
    setDragOverTarget,
    draggedItem,
    setDraggedItem,
    calculateDropPosition,
    handleParentDrop,
    handleSectionDrop,
    handleSelectParentChunkFromTree,
    editingSectionId,
    editingSectionTitle,
    setEditingSectionTitle,
    startEditSection,
    saveEditSection,
    cancelEditSection,
    handleDeleteSectionClick,
    onIndentSection,
    onOutdentSection,
    onMoveSection,
    onMoveParent,
    onAddParent,
    onAddChild,
    onUpdateParent,
    onDeleteParent,
    onReparentSection,
    onDeleteSection,
    setTargetParentForAddChild,
    setIsAddChildModalOpen,
    setTargetParentForEdit,
    setIsEditParentModalOpen,
    setReparentModalSection,
    setIsReparentModalOpen,
    setTargetSectionIdForAddParent,
    setIsAddParentModalOpen,
    renderChildChunkItem,
    matchedSectionIdSet,
  } = useChunkStudio();

  return (
    <section
          className={`${
            mobileTab === 'tree' ? 'flex' : 'hidden'
          } lg:flex ${
            isTreeCollapsed ? 'lg:hidden' : 'lg:col-span-3'
          } flex-col bg-white dark:bg-slate-900 min-h-0 overflow-hidden transition-all duration-200`}
        >
          {/* Header */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Network className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider truncate">
                1열: 계층 구조
              </h2>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={isAnySectionExpanded ? collapseAllSections : expandAllSections}
                className="text-[11px] font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition cursor-pointer px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-800 bg-white dark:bg-slate-800 shadow-2xs"
                title={isAnySectionExpanded ? '모든 하위 청크 접기' : '모든 하위 청크 펼치기'}
              >
                {isAnySectionExpanded ? '접기' : '펼치기'}
              </button>
              {onAddSection && (
                <button
                  type="button"
                  onClick={() => setIsAddSectionModalOpen(true)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-semibold transition cursor-pointer shadow-2xs"
                  title="새 섹션 추가"
                >
                  <Plus className="w-3 h-3" />
                  <span className="hidden sm:inline">추가</span>
                </button>
              )}
              {selectedSectionId && (
                <button
                  type="button"
                  onClick={() => onSelectSection(null)}
                  className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition cursor-pointer px-1 py-0.5"
                  title="섹션 필터 해제"
                >
                  전체
                </button>
              )}

              {/* Desktop Collapse Button */}
              <button
                type="button"
                onClick={() => setIsTreeCollapsed(true)}
                className="hidden lg:inline-flex p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                title="계층 패널 접기 (에디터 공간 넓히기)"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={sectionSearch}
                onChange={(e) => setSectionSearch(e.target.value)}
                placeholder="섹션 제목 / 청크 내용 검색..."
                className="w-full text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg pl-8 pr-2.5 py-1.5 focus:bg-white dark:focus:bg-slate-900 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden placeholder-slate-400 dark:placeholder-slate-500 font-medium"
              />
            </div>
          </div>

          {/* Empty sections cleanup bar */}
          {emptySectionsCount > 0 && onBatchCleanEmptySections && (
            <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200/70 dark:border-amber-900/60 flex items-center justify-between text-[11px] text-amber-800 dark:text-amber-200 shrink-0">
              <div className="flex items-center gap-1.5 truncate">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="truncate">
                  청크 없는 빈 섹션 <strong>{emptySectionsCount}개</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={onBatchCleanEmptySections}
                className="text-[10px] px-1.5 py-0.5 bg-amber-200/90 hover:bg-amber-300 dark:bg-amber-900 dark:hover:bg-amber-800 text-amber-900 dark:text-amber-100 font-bold rounded transition shrink-0 cursor-pointer shadow-2xs"
                title="청크가 없는 모든 빈 섹션 일괄 삭제"
              >
                일괄 정리
              </button>
            </div>
          )}

          {/* Quick Guide */}
          <div className="px-3 py-1.5 bg-indigo-50/40 dark:bg-indigo-950/40 border-b border-indigo-100/60 dark:border-indigo-900/50 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-indigo-300/80 shrink-0">
            <Info className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
            <span className="truncate">섹션을 열어 최하위 청크(Child)를 보고 바로 이동할 수 있습니다.</span>
          </div>

          {/* Section List */}
          <div className="flex-1 p-2 overflow-y-auto space-y-1 text-xs font-medium">
            {isLoading ? (
              <div className="text-slate-400 dark:text-slate-500 text-center py-16">계층 구조 분석 중...</div>
            ) : visibleTopLevelSections.length === 0 ? (
              <div className="text-slate-400 dark:text-slate-500 text-center py-16">표시할 섹션이 없습니다.</div>
            ) : (() => {
              // 헬퍼: 특정 섹션 직속 청크 렌더링
              const renderSectionChunks = (sec: ParentSection) => {
                const sectionChildren = childChunksBySection.get(sec.id) || [];
                const secParents = parentChunksBySection.get(sec.id) || [];

                if (secParents.length > 0) {
                  const assignedChildIds = new Set<string>();
                  secParents.forEach((p: any) => {
                    (p.child_chunk_ids || []).forEach((cid: string) => assignedChildIds.add(cid));
                  });
                  const unassignedChildren = sectionChildren.filter(
                    (c: ChildChunk) =>
                      !assignedChildIds.has(c.chunk_id) &&
                      (!c.parent_chunk_id || c.parent_chunk_id === 'unassigned')
                  );

                  return (
                    <div className="space-y-1 mt-0.5">
                      {secParents.map((parent: any, parentIdx: number) => {
                        const pid = parent.parent_chunk_id || parent.id || '';
                        const isFirstParent = parentIdx === 0;
                        const isLastParent = parentIdx === secParents.length - 1;
                        const pExpanded = isParentExpanded(pid);
                        const pChildren =
                          childChunksByParent.get(pid) ||
                          sectionChildren.filter(
                            (c: ChildChunk) => (c.parent_chunk_id || c.parent_id) === pid
                          );
                        const hasPChildren = pChildren.length > 0;
                        const shortPid = formatDisplayParentId(pid);
                        const isParentActive = activeParentChunk?.parent_chunk_id === pid;
                        const isTarget = dragOverTarget?.id === pid;
                        const dropIndicatorClass = isTarget
                          ? dragOverTarget.position === 'inside'
                            ? 'ring-2 ring-purple-500 bg-purple-100/80 dark:bg-purple-950/80'
                            : dragOverTarget.position === 'before'
                            ? 'border-t-2 border-purple-500 shadow-xs'
                            : 'border-b-2 border-purple-500 shadow-xs'
                          : '';

                        return (
                          <div key={pid} className="space-y-0.5">
                            {/* Level 2: Parent Chunk Node */}
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectParentChunkFromTree(sec.id, pid);
                              }}
                              onDragOver={(e) => {
                                if (!draggedItem) return;
                                if (draggedItem.type === 'parent' && draggedItem.id === pid) return;
                                if (draggedItem.type === 'section') return;
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedItem.type === 'child') {
                                  setDragOverTarget({ type: 'parent', id: pid, position: 'inside' });
                                } else {
                                  const pos = calculateDropPosition(e, false);
                                  setDragOverTarget({ type: 'parent', id: pid, position: pos });
                                }
                              }}
                              onDragLeave={() => {
                                if (dragOverTarget?.id === pid) {
                                  setDragOverTarget(null);
                                }
                              }}
                              onDrop={(e) => {
                                if (!draggedItem || draggedItem.type === 'section') return;
                                const pos = draggedItem.type === 'child' ? 'inside' : calculateDropPosition(e, false);
                                handleParentDrop(e, parent, pos);
                              }}
                              className={`group/parent py-1 px-1.5 rounded-md cursor-pointer flex items-center justify-between text-[11px] transition select-none ${dropIndicatorClass} ${
                                isParentActive
                                  ? 'bg-purple-100/90 dark:bg-purple-950/70 text-purple-950 dark:text-purple-200 font-semibold border border-purple-300 dark:border-purple-800 shadow-2xs'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-purple-50/70 dark:hover:bg-purple-950/40 hover:text-purple-950 dark:hover:text-purple-200'
                              }`}
                              title={`[${pid}] ${parent.title || ''}\n토큰: ${parent.token_estimate || 0}T | 자식 청크: ${pChildren.length}개\n${parent.text?.slice(0, 100) || ''}...`}
                            >
                              <div className="flex items-center gap-1.5 truncate min-w-0 pr-1">
                                <span
                                  draggable
                                  onDragStart={(e) => {
                                    e.stopPropagation();
                                    setDraggedItem({
                                      type: 'parent',
                                      id: pid,
                                      sectionId: sec.id,
                                    });
                                    e.dataTransfer.setData(
                                      'application/json',
                                      JSON.stringify({ type: 'parent', id: pid })
                                    );
                                    e.dataTransfer.effectAllowed = 'move';
                                  }}
                                  onDragEnd={() => {
                                    setDraggedItem(null);
                                    setDragOverTarget(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="cursor-grab active:cursor-grabbing text-slate-400 dark:text-slate-500 hover:text-purple-600 dark:hover:text-purple-300 -ml-1 mr-0.5 p-0.5 opacity-0 group-hover/parent:opacity-100 transition rounded hover:bg-purple-100 dark:hover:bg-purple-950/60 shrink-0"
                                  title="드래그하여 섹션 내 순서 변경 또는 다른 섹션으로 이동"
                                >
                                  <GripVertical className="w-3 h-3" />
                                </span>

                                {hasPChildren ? (
                                  <button
                                    type="button"
                                    onClick={(e) => toggleExpandParent(pid, e)}
                                    className="p-0.5 text-slate-400 dark:text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 rounded hover:bg-purple-100 dark:hover:bg-purple-950/60 transition cursor-pointer shrink-0"
                                    title={pExpanded ? '자식 청크 접기' : '자식 청크 펼치기'}
                                  >
                                    {pExpanded ? (
                                      <ChevronDown className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-3 h-3 inline-block shrink-0" />
                                )}

                                <Layers
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isParentActive ? 'text-purple-600 dark:text-purple-400' : 'text-purple-500 dark:text-purple-400'
                                  }`}
                                />
                                <span className="font-mono text-[10px] text-purple-700 dark:text-purple-400 font-bold shrink-0">
                                  [{shortPid}]
                                </span>
                                <span className="truncate font-medium">
                                  {parent.title ||
                                    (parent.text
                                      ? parent.text.trim().split('\n')[0].slice(0, 24)
                                      : '부모 문맥')}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0 font-mono text-[9px]">
                                {/* Action buttons on hover */}
                                {onMoveParent && secParents.length > 1 && (
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover/parent:opacity-100 transition">
                                    <button
                                      type="button"
                                      disabled={isFirstParent}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onMoveParent(pid, 'up');
                                      }}
                                      className={`p-0.5 rounded transition ${
                                        isFirstParent
                                          ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                          : 'text-purple-600 dark:text-purple-400 hover:text-purple-950 dark:hover:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-950/60 cursor-pointer'
                                      }`}
                                      title={isFirstParent ? '맨 위 Parent입니다' : '위로 이동 (순서 맞바꾸기)'}
                                    >
                                      <ChevronUp className="w-2.5 h-2.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isLastParent}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onMoveParent(pid, 'down');
                                      }}
                                      className={`p-0.5 rounded transition ${
                                        isLastParent
                                          ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                          : 'text-purple-600 dark:text-purple-400 hover:text-purple-950 dark:hover:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-950/60 cursor-pointer'
                                      }`}
                                      title={isLastParent ? '맨 아래 Parent입니다' : '아래로 이동 (순서 맞바꾸기)'}
                                    >
                                      <ChevronDown className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                )}
                                {onAddChild && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTargetParentForAddChild(parent);
                                      setIsAddChildModalOpen(true);
                                    }}
                                    className="opacity-0 group-hover/parent:opacity-100 p-0.5 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 rounded hover:bg-purple-100 dark:hover:bg-purple-950/60 transition cursor-pointer"
                                    title="이 Parent에 새 Child 청크 추가"
                                  >
                                    <Plus className="w-2.5 h-2.5" />
                                  </button>
                                )}
                                {onUpdateParent && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTargetParentForEdit(parent);
                                      setIsEditParentModalOpen(true);
                                    }}
                                    className="opacity-0 group-hover/parent:opacity-100 p-0.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded hover:bg-purple-100 dark:hover:bg-purple-950/60 transition cursor-pointer"
                                    title="Parent 제목 및 섹션 수정"
                                  >
                                    <Edit2 className="w-2.5 h-2.5" />
                                  </button>
                                )}
                                {onDeleteParent && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const confirmed = window.confirm(
                                        `정말로 '${parent.title || pid}' 부모 청크를 삭제하시겠습니까?\n소속된 ${pChildren.length}개 자식 청크도 함께 삭제됩니다.`
                                      );
                                      if (confirmed) {
                                        onDeleteParent(pid);
                                      }
                                    }}
                                    className="opacity-0 group-hover/parent:opacity-100 p-0.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/60 transition cursor-pointer"
                                    title="Parent 청크 삭제"
                                  >
                                    <Trash2 className="w-2.5 h-2.5" />
                                  </button>
                                )}
                                <span
                                  className={`px-1 py-0.2 rounded font-mono ${
                                    (parent.token_estimate || 0) > 2048
                                      ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 font-bold'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                  }`}
                                  title={`부모 청크 추정 토큰: ${parent.token_estimate || 0}T`}
                                >
                                  {parent.token_estimate || 0}T
                                </span>
                                <span
                                  className={`px-1 py-0.2 rounded font-mono font-semibold ${
                                    isParentActive
                                      ? 'bg-purple-200 dark:bg-purple-900 text-purple-900 dark:text-purple-200'
                                      : 'bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border border-purple-200/70 dark:border-purple-800'
                                  }`}
                                  title={`자식 청크: ${pChildren.length}개`}
                                >
                                  C {pChildren.length}
                                </span>
                              </div>
                            </div>

                            {/* Level 3: Children under Parent */}
                            {pExpanded && hasPChildren && (
                              <div className="ml-3.5 pl-2 border-l-2 border-purple-200/70 dark:border-purple-900/60 space-y-0.5 my-0.5">
                                {pChildren.map((chunk: ChildChunk) => renderChildChunkItem(sec.id, chunk))}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Unassigned children in section */}
                      {unassignedChildren.length > 0 && (
                        <div className="space-y-0.5 pt-1 border-t border-slate-200/50 dark:border-slate-800">
                          <div className="px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1">
                            <span>미할당 자식 청크 ({unassignedChildren.length}개)</span>
                          </div>
                          <div className="ml-2 pl-2 border-l border-amber-300/70 space-y-0.5">
                            {unassignedChildren.map((chunk: ChildChunk) => renderChildChunkItem(sec.id, chunk))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                // Legacy document fallback (no parent_chunks): render child chunks directly
                if (sectionChildren.length > 0) {
                  return (
                    <div className="space-y-0.5 mt-0.5">
                      {sectionChildren.map((chunk: ChildChunk) => renderChildChunkItem(sec.id, chunk))}
                    </div>
                  );
                }

                return null;
              };

              // 헬퍼: 재귀 섹션 노드 렌더링
              const renderSectionNode = (
                sec: ParentSection,
                depth = 0,
                visited = new Set<string>()
              ): React.ReactNode => {
                if (visited.has(sec.id)) return null; // 순환 참조 방지
                const nextVisited = new Set(visited);
                nextVisited.add(sec.id);

                const isRoot = sec.level === 0;
                const isActive = selectedSectionId === sec.id && !activeParentChunk;
                const isEditingThis = editingSectionId === sec.id;
                const isExpanded = isSectionExpanded(sec.id);

                const rawChildSecs = childSectionsMap.get(sec.id) || [];
                const childSecs = matchedSectionIdSet
                  ? rawChildSecs.filter((s: ParentSection) => matchedSectionIdSet.has(s.id))
                  : rawChildSecs;

                const sectionChildren = childChunksBySection.get(sec.id) || [];
                const secParents = parentChunksBySection.get(sec.id) || [];
                const hasSubTree = childSecs.length > 0 || sectionChildren.length > 0 || secParents.length > 0;

                const pCount =
                  sec.parent_chunk_ids && sec.parent_chunk_ids.length > 0
                    ? sec.parent_chunk_ids.length
                    : secParents.length;
                const cCount =
                  sec.child_chunk_ids && sec.child_chunk_ids.length > 0
                    ? sec.child_chunk_ids.length
                    : sectionChildren.length;
                const sCount = childSecs.length;
                const isLeafEmpty = pCount === 0 && cCount === 0 && sCount === 0;

                const isSecTarget = dragOverTarget?.id === sec.id;
                const secDropIndicatorClass = isSecTarget
                  ? dragOverTarget.position === 'inside'
                    ? 'ring-2 ring-indigo-500 bg-indigo-100/70 dark:bg-indigo-950/70'
                    : dragOverTarget.position === 'before'
                    ? 'border-t-2 border-indigo-500 shadow-xs'
                    : 'border-b-2 border-indigo-500 shadow-xs'
                  : '';

                return (
                  <div key={sec.id} className="space-y-0.5">
                    {/* Section Header Row */}
                    <div
                      onClick={() => {
                        if (!isEditingThis) {
                          onSelectSection(sec.id);
                          setManualExpandedState((prev: Record<string, boolean>) => ({ ...prev, [sec.id]: true }));
                          setMobileTab('list');
                        }
                      }}
                      onDoubleClick={(e) => startEditSection(sec, e)}
                      onDragOver={(e) => {
                        if (!draggedItem) return;
                        if (draggedItem.type === 'section' && (draggedItem.id === sec.id || isRoot)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (draggedItem.type === 'section') {
                          const pos = calculateDropPosition(e, true);
                          setDragOverTarget({ type: 'section', id: sec.id, position: pos });
                        } else if (draggedItem.type === 'parent') {
                          setDragOverTarget({ type: 'section', id: sec.id, position: 'inside' });
                        } else if (draggedItem.type === 'child') {
                          setDragOverTarget({ type: 'section', id: sec.id, position: 'inside' });
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverTarget?.id === sec.id) {
                          setDragOverTarget(null);
                        }
                      }}
                      onDrop={(e) => {
                        if (!draggedItem) return;
                        const pos = draggedItem.type === 'section' ? calculateDropPosition(e, true) : 'inside';
                        handleSectionDrop(e, sec, pos);
                      }}
                      className={`group py-1.5 px-2 rounded-lg cursor-pointer flex items-center justify-between transition border-l-3 select-none ${secDropIndicatorClass} ${
                        isActive
                          ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-600 text-indigo-900 dark:text-indigo-200 font-semibold shadow-2xs'
                          : 'border-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      {isEditingThis ? (
                        <div
                          className="flex items-center gap-1.5 w-full"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editingSectionTitle}
                            onChange={(e) => setEditingSectionTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditSection(sec.id);
                              if (e.key === 'Escape') cancelEditSection();
                            }}
                            autoFocus
                            className="flex-1 text-xs bg-white dark:bg-slate-800 border border-indigo-500 rounded px-2 py-1 font-semibold focus:outline-hidden ring-1 ring-indigo-500 text-slate-900 dark:text-slate-100"
                          />
                          <button
                            type="button"
                            onClick={() => saveEditSection(sec.id)}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded cursor-pointer"
                            title="저장 (Enter)"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditSection}
                            className="p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer"
                            title="취소 (Esc)"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 truncate pr-1.5 min-w-0">
                            {!isRoot && !sec.id.endsWith('_s00') && !sec.id.endsWith('_root') && (
                              <span
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  setDraggedItem({
                                    type: 'section',
                                    id: sec.id,
                                    parentId: sec.parent_section_id,
                                  });
                                  e.dataTransfer.setData(
                                    'application/json',
                                    JSON.stringify({ type: 'section', id: sec.id })
                                  );
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => {
                                  setDraggedItem(null);
                                  setDragOverTarget(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="cursor-grab active:cursor-grabbing text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-300 -ml-1 mr-0.5 p-0.5 opacity-0 group-hover:opacity-100 transition rounded hover:bg-indigo-100 dark:hover:bg-indigo-950/60 shrink-0"
                                title="드래그하여 섹션 순서 변경 또는 다른 섹션의 하위로 이동"
                              >
                                <GripVertical className="w-3 h-3" />
                              </span>
                            )}

                            {/* Accordion Expand/Collapse Button */}
                            {hasSubTree ? (
                              <button
                                type="button"
                                onClick={(e) => toggleExpandSection(sec.id, e)}
                                className="p-0.5 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded hover:bg-slate-200/60 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                                title={isExpanded ? '하위 접기' : '하위 펼치기'}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                )}
                              </button>
                            ) : (
                              <span className="w-3.5 h-3.5 inline-block shrink-0" />
                            )}

                            {isRoot ? (
                              <BookOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            ) : sCount > 0 ? (
                              <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            ) : sec.level <= 2 ? (
                              <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                            <span
                              className={`truncate ${
                                isRoot
                                  ? 'font-bold text-slate-900 dark:text-slate-100'
                                  : sCount > 0
                                  ? 'font-semibold text-slate-900 dark:text-slate-100'
                                  : ''
                              }`}
                              title={sec.title}
                            >
                              {sec.title}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Hover add Parent chunk trigger */}
                            {onAddParent && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTargetSectionIdForAddParent(sec.id);
                                  setIsAddParentModalOpen(true);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200 transition p-0.5 rounded hover:bg-purple-100 dark:hover:bg-purple-950/60 cursor-pointer"
                                title="이 섹션에 새 Parent 청크 추가"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}

                            {/* Section hierarchy & order controls */}
                            {!isRoot && (
                              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition">
                                {/* Move section order triggers (Up/Down) */}
                                {onMoveSection && (() => {
                                  const siblingSecs = (parentSections as ParentSection[]).filter((s: ParentSection) => {
                                    if (s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')) return false;
                                    return (s.parent_section_id || '') === (sec.parent_section_id || '');
                                  });
                                  const sIdx = siblingSecs.findIndex((s: ParentSection) => s.id === sec.id);
                                  const isFirstSec = sIdx <= 0;
                                  const isLastSec = sIdx === siblingSecs.length - 1;

                                  if (siblingSecs.length <= 1) return null;

                                  return (
                                    <>
                                      <button
                                        type="button"
                                        disabled={isFirstSec}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onMoveSection(sec.id, 'up');
                                        }}
                                        className={`p-0.5 rounded transition ${
                                          isFirstSec
                                            ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                            : 'text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 cursor-pointer'
                                        }`}
                                        title={isFirstSec ? '계층 내 첫 번째 섹션입니다' : '섹션 위로 이동'}
                                      >
                                        <ChevronUp className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isLastSec}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onMoveSection(sec.id, 'down');
                                        }}
                                        className={`p-0.5 rounded transition ${
                                          isLastSec
                                            ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                            : 'text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 cursor-pointer'
                                        }`}
                                        title={isLastSec ? '계층 내 마지막 섹션입니다' : '섹션 아래로 이동'}
                                      >
                                        <ChevronDown className="w-3 h-3" />
                                      </button>
                                    </>
                                  );
                                })()}

                                {/* Outdent (내어쓰기) */}
                                {onOutdentSection && (() => {
                                  const rootSec = (parentSections as ParentSection[]).find(
                                    (s: ParentSection) => s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')
                                  );
                                  const canOutdent = Boolean(
                                    sec.parent_section_id &&
                                      sec.parent_section_id !== rootSec?.id &&
                                      sec.level > 1
                                  );
                                  return (
                                    <button
                                      type="button"
                                      disabled={!canOutdent}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOutdentSection(sec.id);
                                      }}
                                      className={`p-0.5 rounded transition ${
                                        !canOutdent
                                          ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                          : 'text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 cursor-pointer'
                                      }`}
                                      title={canOutdent ? '상위 계층으로 내어쓰기 (승격)' : '이미 최상위 계층입니다'}
                                    >
                                      <CornerUpLeft className="w-3 h-3" />
                                    </button>
                                  );
                                })()}

                                {/* Indent (들여쓰기) */}
                                {onIndentSection && (() => {
                                  const siblingSecs = (parentSections as ParentSection[]).filter((s: ParentSection) => {
                                    if (s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')) return false;
                                    return (s.parent_section_id || '') === (sec.parent_section_id || '');
                                  });
                                  const sIdx = siblingSecs.findIndex((s: ParentSection) => s.id === sec.id);
                                  const canIndent = sIdx > 0;
                                  return (
                                    <button
                                      type="button"
                                      disabled={!canIndent}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onIndentSection(sec.id);
                                      }}
                                      className={`p-0.5 rounded transition ${
                                        !canIndent
                                          ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                          : 'text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 cursor-pointer'
                                      }`}
                                      title={
                                        canIndent
                                          ? `이전 섹션('${siblingSecs[sIdx - 1]?.title}')의 하위 섹션으로 들여쓰기`
                                          : '들여쓰기할 이전 형제 섹션이 없습니다'
                                      }
                                    >
                                      <CornerDownRight className="w-3 h-3" />
                                    </button>
                                  );
                                })()}

                                {/* Reparent Modal Trigger */}
                                {onReparentSection && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setReparentModalSection(sec);
                                      setIsReparentModalOpen(true);
                                    }}
                                    className="p-0.5 rounded transition text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 cursor-pointer"
                                    title="상위 섹션 변경 (모달)"
                                  >
                                    <FolderTree className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Hover inline edit trigger */}
                            <button
                              type="button"
                              onClick={(e) => startEditSection(sec, e)}
                              className="opacity-0 group-hover:opacity-100 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition p-0.5 rounded hover:bg-slate-200/50 dark:hover:bg-slate-800 cursor-pointer"
                              title="섹션 제목 수정"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>

                            {/* Delete section trigger */}
                            {onDeleteSection && (() => {
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteSectionClick(sec, e)}
                                  className={`transition p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer ${
                                    isLeafEmpty
                                      ? 'opacity-80 text-amber-500 hover:text-rose-600'
                                      : 'opacity-0 group-hover:opacity-100 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400'
                                  }`}
                                  title={
                                    isLeafEmpty
                                      ? '빈 섹션 삭제'
                                      : sCount > 0
                                      ? `섹션(하위 섹션 ${sCount}개 포함) 삭제`
                                      : `섹션 및 소속 청크(${sec.child_chunk_ids.length}개) 삭제`
                                  }
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              );
                            })()}

                            {/* Badges */}
                            <div className="flex items-center gap-1 font-mono text-[10px]">
                              {isLeafEmpty ? (
                                <span
                                  className="bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 font-semibold border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded"
                                  title="청크와 하위 섹션이 없는 빈 섹션"
                                >
                                  빈 섹션
                                </span>
                              ) : (
                                <>
                                  {sCount > 0 && (
                                    <span
                                      className="px-1.5 py-0.5 rounded font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800"
                                      title={`하위 섹션: ${sCount}개`}
                                    >
                                      S {sCount}
                                    </span>
                                  )}
                                  {(pCount > 0 || cCount > 0 || sCount === 0) && (
                                    <>
                                      <span
                                        className={`px-1.5 py-0.5 rounded font-semibold ${
                                          isActive
                                            ? 'bg-indigo-200 dark:bg-indigo-900 text-indigo-950 dark:text-indigo-200 font-bold'
                                            : 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800'
                                        }`}
                                        title={`소속 Parent 청크: ${pCount}개`}
                                      >
                                        P {pCount}
                                      </span>
                                      <span
                                        className={`px-1.5 py-0.5 rounded ${
                                          isActive
                                            ? 'bg-indigo-300/70 dark:bg-indigo-800 text-indigo-950 dark:text-indigo-100 font-bold'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                        }`}
                                        title={`소속 Child 청크: ${cCount}개`}
                                      >
                                        C {cCount}
                                      </span>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Sub-Tree: Nested Sub-sections & Chunks with Tree Guide Line */}
                    {isExpanded && hasSubTree && (
                      <div className="ml-3 pl-2.5 border-l-2 border-slate-200/80 dark:border-slate-800 space-y-1 my-0.5 transition-all">
                        {/* 1. Sub-sections (Recursive) */}
                        {childSecs.map((childSec: ParentSection) => renderSectionNode(childSec, depth + 1, nextVisited))}

                        {/* 2. Direct Chunks in this Section */}
                        {renderSectionChunks(sec)}
                      </div>
                    )}
                  </div>
                );
              };

              return visibleTopLevelSections.map((sec: ParentSection) => renderSectionNode(sec, 0));
            })()}
          </div>
        </section>
  );
}

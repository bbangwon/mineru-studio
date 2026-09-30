import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FolderTree,
  CornerDownRight,
  Check,
  Search,
  ChevronRight,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Folder,
  BookOpen,
  FileText,
  Info,
} from 'lucide-react';
import type { ParentSection, ParentChunk } from '../types';
import { CopyableBadge } from './CopyableBadge';

interface ReassignParentSectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetParent: ParentChunk | null;
  parentSections: ParentSection[];
  onReassign: (parentChunkId: string, newSectionId: string) => void;
}

export const ReassignParentSectionModal: React.FC<ReassignParentSectionModalProps> = ({
  isOpen,
  onClose,
  targetParent,
  parentSections,
  onReassign,
}) => {
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>('');

  const currentSectionId = targetParent?.section_id || '';
  const parentId = targetParent ? targetParent.parent_chunk_id || targetParent.id || '' : '';

  // Section lookup map
  const sectionMap = useMemo(() => {
    const map = new Map<string, ParentSection>();
    parentSections.forEach((s) => map.set(s.id, s));
    return map;
  }, [parentSections]);

  // Current and destination section
  const currentSection = useMemo(
    () => sectionMap.get(currentSectionId) || null,
    [sectionMap, currentSectionId]
  );
  const destSection = useMemo(
    () => sectionMap.get(selectedSectionId) || null,
    [sectionMap, selectedSectionId]
  );

  // Map of parent_section_id -> child sections
  const childSectionsMap = useMemo(() => {
    const map = new Map<string, ParentSection[]>();
    parentSections.forEach((s) => {
      if (s.parent_section_id) {
        const list = map.get(s.parent_section_id) || [];
        list.push(s);
        map.set(s.parent_section_id, list);
      }
    });
    return map;
  }, [parentSections]);

  // Top-level sections (level === 0, or no parent_section_id, or parent not in map)
  const topLevelSections = useMemo(() => {
    const allSecIds = new Set(parentSections.map((s) => s.id));
    return parentSections.filter((s) => {
      if (s.level === 0) return true;
      if (!s.parent_section_id) return true;
      if (!allSecIds.has(s.parent_section_id)) return true;
      return false;
    });
  }, [parentSections]);

  // Filter sections based on search query (title, breadcrumbs, id)
  const matchedSectionIds = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase().trim();
    const matched = new Set<string>();

    for (const sec of parentSections) {
      const matchTitle = sec.title.toLowerCase().includes(q);
      const matchId = sec.id.toLowerCase().includes(q);
      const matchBcs = sec.breadcrumbs?.some((b) => b.toLowerCase().includes(q));

      if (matchTitle || matchId || matchBcs) {
        matched.add(sec.id);
      }
    }

    // Include ancestors so hierarchy tree doesn't break
    const visible = new Set<string>(matched);
    for (const id of matched) {
      let curr = sectionMap.get(id);
      while (curr && curr.parent_section_id && sectionMap.has(curr.parent_section_id)) {
        visible.add(curr.parent_section_id);
        curr = sectionMap.get(curr.parent_section_id);
      }
    }
    return visible;
  }, [parentSections, searchQuery, sectionMap]);

  // Count of directly matched sections
  const matchCount = useMemo(() => {
    if (!searchQuery.trim()) return 0;
    const q = searchQuery.toLowerCase().trim();
    return parentSections.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.breadcrumbs?.some((b) => b.toLowerCase().includes(q))
    ).length;
  }, [parentSections, searchQuery]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && targetParent) {
      setSelectedSectionId(targetParent.section_id || '');
      setSearchQuery('');
      setError('');

      // Auto-expand all top-level sections and the path to the current section
      const initialExpanded = new Set<string>(topLevelSections.map((s) => s.id));
      let curr = sectionMap.get(targetParent.section_id);
      while (curr) {
        initialExpanded.add(curr.id);
        if (curr.parent_section_id) {
          curr = sectionMap.get(curr.parent_section_id);
        } else {
          break;
        }
      }
      setExpandedSectionIds(initialExpanded);
    }
  }, [isOpen, targetParent, topLevelSections, sectionMap]);

  // Auto-expand all matched paths on search
  useEffect(() => {
    if (matchedSectionIds && matchedSectionIds.size > 0) {
      setExpandedSectionIds((prev) => new Set([...prev, ...matchedSectionIds]));
    }
  }, [matchedSectionIds]);

  if (!isOpen || !targetParent) return null;

  // Toggle expand/collapse of a section node
  const toggleSection = (sectionId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedSectionIds(new Set(parentSections.map((s) => s.id)));
  };

  const handleCollapseAll = () => {
    setExpandedSectionIds(new Set());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSectionId) {
      setError('이동할 대상 섹션을 선택해주세요.');
      return;
    }
    if (selectedSectionId === currentSectionId) {
      setError('이미 현재 속해 있는 섹션입니다. 다른 섹션을 선택해주세요.');
      return;
    }

    onReassign(parentId, selectedSectionId);
    onClose();
  };

  // Associated child chunks count
  const affectedChildCount = targetParent.child_chunk_ids?.length || 0;

  // Destination breadcrumbs preview
  const destBreadcrumbs = destSection
    ? destSection.breadcrumbs && destSection.breadcrumbs.length > 0
      ? destSection.breadcrumbs
      : [destSection.title]
    : [];

  const currentBreadcrumbs = currentSection
    ? currentSection.breadcrumbs && currentSection.breadcrumbs.length > 0
      ? currentSection.breadcrumbs
      : [currentSection.title]
    : [];

  // Recursive tree node renderer
  const renderTreeNode = (sec: ParentSection, depth = 0, visited = new Set<string>()): React.ReactNode => {
    if (visited.has(sec.id)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(sec.id);

    // If searching, only display if section is in matchedSectionIds
    if (matchedSectionIds && !matchedSectionIds.has(sec.id)) {
      return null;
    }

    const rawChildSecs = childSectionsMap.get(sec.id) || [];
    const childSecs = matchedSectionIds
      ? rawChildSecs.filter((s) => matchedSectionIds.has(s.id))
      : rawChildSecs;
    const hasChildren = childSecs.length > 0;
    const isExpanded = expandedSectionIds.has(sec.id);
    const isSelected = selectedSectionId === sec.id;
    const isCurrent = currentSectionId === sec.id;
    const isRoot = sec.level === 0;

    // Level Badge Colors
    const getLevelBadge = (level: number) => {
      switch (level) {
        case 0:
          return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800';
        case 1:
          return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800';
        case 2:
          return 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300 border-teal-200 dark:border-teal-800';
        case 3:
          return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800';
        default:
          return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
      }
    };

    return (
      <div key={sec.id} className="select-none">
        <div
          onClick={() => {
            setSelectedSectionId(sec.id);
            setError('');
          }}
          className={`flex items-center justify-between py-1.5 px-2.5 rounded-xl cursor-pointer transition text-xs group ${
            isSelected
              ? 'bg-indigo-600 text-white font-semibold shadow-xs'
              : isCurrent
              ? 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
          }`}
          style={{ paddingLeft: `${Math.max(8, depth * 18 + 8)}px` }}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
            {/* Expand / Collapse Icon */}
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => toggleSection(sec.id, e)}
                className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition cursor-pointer shrink-0 ${
                  isSelected ? 'text-white' : 'text-slate-400 dark:text-slate-500'
                }`}
                title={isExpanded ? '하위 섹션 접기' : '하위 섹션 펼치기'}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-3.5 h-3.5 shrink-0" />
            )}

            {/* Folder / Document Icon */}
            {isRoot ? (
              <BookOpen
                className={`w-3.5 h-3.5 shrink-0 ${
                  isSelected ? 'text-white' : 'text-indigo-500 dark:text-indigo-400'
                }`}
              />
            ) : hasChildren ? (
              <Folder
                className={`w-3.5 h-3.5 shrink-0 ${
                  isSelected ? 'text-white' : 'text-amber-500 dark:text-amber-400'
                }`}
              />
            ) : (
              <FileText
                className={`w-3.5 h-3.5 shrink-0 ${
                  isSelected ? 'text-white' : 'text-slate-400 dark:text-slate-500'
                }`}
              />
            )}

            {/* Level Badge */}
            <span
              className={`text-[9px] font-mono px-1 py-0.2 rounded border font-semibold shrink-0 ${
                isSelected
                  ? 'bg-white/20 text-white border-white/30'
                  : getLevelBadge(sec.level)
              }`}
            >
              L{sec.level}
            </span>

            {/* Section Title */}
            <span className="truncate" title={sec.title}>
              {sec.title}
            </span>

            {/* Current Section Marker */}
            {isCurrent && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium shrink-0 ${
                  isSelected
                    ? 'bg-white/25 text-white'
                    : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-semibold'
                }`}
              >
                현재 소속
              </span>
            )}
          </div>

          {/* Right badges: Parent & Child chunk counts */}
          <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
            <span
              className={`px-1.5 py-0.2 rounded ${
                isSelected
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
              title={`소속 Parent 청크 ${sec.parent_chunk_ids?.length || 0}개`}
            >
              P: {sec.parent_chunk_ids?.length || 0}
            </span>
            <span
              className={`px-1.5 py-0.2 rounded ${
                isSelected
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
              title={`소속 Child 청크 ${sec.child_chunk_ids?.length || 0}개`}
            >
              C: {sec.child_chunk_ids?.length || 0}
            </span>
          </div>
        </div>

        {/* Children Subtree */}
        {hasChildren && isExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {childSecs.map((childSec) => renderTreeNode(childSec, depth + 1, nextVisited))}
          </div>
        )}
      </div>
    );
  };

  const visibleTopSections = matchedSectionIds
    ? topLevelSections.filter((s) => matchedSectionIds.has(s.id))
    : topLevelSections;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Parent 청크의 소속 섹션 재배치
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                문서 트리를 탐색하여 부모 문맥 단위와 소속 자식 청크를 다른 섹션으로 이동합니다.
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

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Target Parent Info Box */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/60 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  이동할 대상 Parent:
                </span>
                <CopyableBadge
                  id={parentId}
                  type="parent"
                  titlePrefix="Parent ID"
                  className="text-xs font-mono px-1.5 py-0.5 bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 rounded border border-indigo-200 dark:border-indigo-800"
                />
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                소속 Child 청크 {affectedChildCount}개 (~{targetParent.token_estimate || 0} tok)
              </span>
            </div>
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
              {targetParent.title || '(제목 없는 부모 청크)'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-1.5">
              <span>현재 소속 섹션:</span>
              <strong className="text-slate-700 dark:text-slate-300">
                {currentSection?.title || currentSectionId}
              </strong>
              {currentSection?.breadcrumbs && currentSection.breadcrumbs.length > 0 && (
                <span className="text-slate-400 dark:text-slate-500">
                  ({currentSection.breadcrumbs.join(' > ')})
                </span>
              )}
            </div>
          </div>

          {/* Search & Tree Controls Toolbar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <span>이동할 대상 섹션 선택 (Tree)</span>
                {matchCount > 0 && searchQuery && (
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">
                    ({matchCount}개 검색됨)
                  </span>
                )}
              </label>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  onClick={handleExpandAll}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
                  title="모든 섹션 펼치기"
                >
                  <ChevronsDown className="w-3 h-3" />
                  <span>모두 펼치기</span>
                </button>
                <span>|</span>
                <button
                  type="button"
                  onClick={handleCollapseAll}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
                  title="모든 섹션 접기"
                >
                  <ChevronsUp className="w-3 h-3" />
                  <span>모두 접기</span>
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="섹션 제목 또는 경로 검색..."
                className="w-full text-xs pl-8 pr-8 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Tree View Box */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50/50 dark:bg-slate-950/40 max-h-56 overflow-y-auto space-y-0.5 font-sans">
              {visibleTopSections.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400 dark:text-slate-500">
                  {searchQuery ? '일치하는 섹션이 없습니다.' : '표시할 섹션이 없습니다.'}
                </div>
              ) : (
                visibleTopSections.map((sec) => renderTreeNode(sec, 0))
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 text-xs bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 rounded-xl flex items-center gap-1.5">
              <span>{error}</span>
            </div>
          )}

          {/* Impact Preview Card */}
          {destSection && destSection.id !== currentSectionId && (
            <div className="p-3.5 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 rounded-xl space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-indigo-900 dark:text-indigo-200">
                <span className="flex items-center gap-1.5">
                  <CornerDownRight className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>섹션 재배치 미리보기</span>
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-bold">
                  Level {destSection.level}
                </span>
              </div>

              {/* Path Transition */}
              <div className="space-y-1 text-[11px]">
                <div className="flex items-start gap-2">
                  <span className="text-slate-400 shrink-0 font-medium">이전:</span>
                  <span className="text-slate-600 dark:text-slate-400 line-through">
                    {currentBreadcrumbs.length > 0
                      ? currentBreadcrumbs.join(' > ')
                      : currentSection?.title || currentSectionId}
                  </span>
                </div>
                <div className="flex items-start gap-2 font-medium">
                  <span className="text-indigo-600 dark:text-indigo-400 shrink-0 font-bold">
                    신규:
                  </span>
                  <span className="text-indigo-800 dark:text-indigo-200 font-semibold">
                    {destBreadcrumbs.length > 0
                      ? destBreadcrumbs.join(' > ')
                      : destSection.title}
                  </span>
                </div>
              </div>

              {/* Cascading Notice */}
              <div className="flex items-center gap-1.5 text-[11px] text-indigo-600 dark:text-indigo-400 pt-1 border-t border-indigo-100 dark:border-indigo-900/50">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>
                  소속된 Child 청크 <strong>{affectedChildCount}개</strong>의 섹션 및 브레드크럼이 함께 연쇄 동기화됩니다.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedSectionId || selectedSectionId === currentSectionId}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>섹션 이동 적용</span>
          </button>
        </div>
      </div>
    </div>
  );
};

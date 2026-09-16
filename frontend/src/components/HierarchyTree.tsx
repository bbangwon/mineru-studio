import React, { useState, useMemo, useEffect } from 'react';
import { Network, BookOpen, Folder, FileText, Info, Search, ChevronRight, ChevronDown, Layers, ChevronsDown, ChevronsUp } from 'lucide-react';
import type { ParentSection, ParentChunk } from '../types';

interface HierarchyTreeProps {
  sections: ParentSection[];
  parentChunks?: ParentChunk[];
  selectedSectionId: string | null;
  selectedParentChunkId?: string | null;
  onSelectSection: (id: string | null) => void;
  onSelectParentChunk?: (parentId: string | null, sectionId?: string | null) => void;
  isLoading: boolean;
}

export const HierarchyTree: React.FC<HierarchyTreeProps> = ({
  sections,
  parentChunks = [],
  selectedSectionId,
  selectedParentChunkId = null,
  onSelectSection,
  onSelectParentChunk,
  isLoading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(new Set());

  // Section ID -> ParentChunk[] 매핑
  const parentChunksBySection = useMemo(() => {
    const map = new Map<string, ParentChunk[]>();
    parentChunks.forEach((p) => {
      const sId = p.section_id || '';
      if (!map.has(sId)) {
        map.set(sId, []);
      }
      map.get(sId)!.push(p);
    });
    return map;
  }, [parentChunks]);

  // 선택된 섹션이나 부모 청크가 변경될 때 해당 섹션 자동 펼치기
  useEffect(() => {
    if (selectedSectionId) {
      setExpandedSectionIds((prev) => {
        const next = new Set(prev);
        next.add(selectedSectionId);
        return next;
      });
    }
  }, [selectedSectionId]);

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

  const expandAll = () => {
    setExpandedSectionIds(new Set(sections.map((s) => s.id)));
  };

  const collapseAll = () => {
    setExpandedSectionIds(new Set());
  };

  // 검색 필터링 (섹션 제목 또는 소속 Parent Chunk의 제목/텍스트 일치)
  const filteredSections = useMemo(() => {
    if (!searchTerm.trim()) return sections;
    const term = searchTerm.toLowerCase();

    return sections.filter((s) => {
      if (s.title.toLowerCase().includes(term)) return true;
      const parents = parentChunksBySection.get(s.id) || [];
      return parents.some(
        (p) =>
          (p.title && p.title.toLowerCase().includes(term)) ||
          (p.parent_chunk_id && p.parent_chunk_id.toLowerCase().includes(term)) ||
          (p.text && p.text.toLowerCase().includes(term))
      );
    });
  }, [sections, searchTerm, parentChunksBySection]);

  // 검색 시 검색어가 있는 섹션들은 자동 확장
  useEffect(() => {
    if (searchTerm.trim()) {
      const matchedIds = new Set<string>();
      filteredSections.forEach((s) => matchedIds.add(s.id));
      setExpandedSectionIds(matchedIds);
    }
  }, [searchTerm, filteredSections]);

  const handleClearAll = () => {
    onSelectSection(null);
    if (onSelectParentChunk) {
      onSelectParentChunk(null, null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col h-[780px]">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50 rounded-t-xl">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-indigo-600" />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            문서 계층 구조 (Tree)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="text-[11px] text-slate-500 hover:text-slate-800 transition cursor-pointer p-0.5"
            title="모두 펼치기"
          >
            <ChevronsDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="text-[11px] text-slate-500 hover:text-slate-800 transition cursor-pointer p-0.5"
            title="모두 접기"
          >
            <ChevronsUp className="w-3.5 h-3.5" />
          </button>
          <span className="text-slate-300">|</span>
          <button
            type="button"
            onClick={handleClearAll}
            className={`text-[11px] font-medium transition cursor-pointer ${
              selectedSectionId === null && selectedParentChunkId === null
                ? 'text-slate-400 cursor-default'
                : 'text-indigo-600 hover:underline'
            }`}
          >
            전체 보기
          </button>
        </div>
      </div>

      {/* Info sub-bar */}
      <div className="p-2.5 border-b border-slate-100 bg-slate-50 flex items-center text-[11px] text-slate-500 gap-1.5">
        <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="truncate">
          섹션 또는 <strong className="text-purple-700 font-medium">Parent 청크</strong>를 클릭하면 해당 문맥의 자식 청크만 필터링됩니다.
        </span>
      </div>

      {/* Search within tree */}
      <div className="p-2 border-b border-slate-100 bg-white">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="제목 / Parent 문맥 검색..."
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none placeholder-slate-400"
          />
        </div>
      </div>

      {/* Tree list */}
      <div className="p-2 overflow-y-auto flex-1 space-y-1 text-xs font-medium">
        {isLoading ? (
          <div className="text-slate-400 text-center py-16">계층 구조를 분석하는 중...</div>
        ) : filteredSections.length === 0 ? (
          <div className="text-slate-400 text-center py-16">표시할 섹션이 없습니다.</div>
        ) : (
          filteredSections.map((sec) => {
            const isRoot = sec.level === 0;
            const parents = parentChunksBySection.get(sec.id) || [];
            const hasParents = parents.length > 0;
            const isExpanded = expandedSectionIds.has(sec.id);
            const isSectionActive = selectedSectionId === sec.id && !selectedParentChunkId;

            const indentClass =
              sec.level === 0
                ? 'pl-2'
                : sec.level === 1
                ? 'pl-3'
                : sec.level === 2
                ? 'pl-5'
                : 'pl-7';

            return (
              <div key={sec.id} className="space-y-0.5">
                {/* Level 1: Section Node */}
                <div
                  onClick={() => {
                    onSelectSection(sec.id);
                    if (onSelectParentChunk) onSelectParentChunk(null, sec.id);
                    if (!isExpanded && hasParents) {
                      toggleSection(sec.id);
                    }
                  }}
                  className={`py-1.5 px-2 rounded-lg cursor-pointer flex items-center justify-between transition border-l-3 ${indentClass} ${
                    isSectionActive
                      ? 'bg-indigo-50/80 border-indigo-600 text-indigo-900 font-semibold shadow-xs'
                      : 'border-transparent text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate pr-2">
                    {/* Expand/Collapse Toggle Button */}
                    {hasParents ? (
                      <button
                        type="button"
                        onClick={(e) => toggleSection(sec.id, e)}
                        className="p-0.5 -ml-1 text-slate-400 hover:text-slate-700 transition cursor-pointer"
                        title={isExpanded ? '접기' : '하위 Parent 펼치기'}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-indigo-600" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-3.5 h-3.5 shrink-0" />
                    )}

                    {isRoot ? (
                      <BookOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    ) : sec.level <= 2 ? (
                      <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <span className={`truncate ${isRoot ? 'font-bold text-slate-900' : ''}`}>
                      {sec.title}
                    </span>
                  </div>

                  {(() => {
                    const pCount =
                      sec.parent_chunk_ids && sec.parent_chunk_ids.length > 0
                        ? sec.parent_chunk_ids.length
                        : parents.length;
                    const cCount = sec.child_chunk_ids?.length || 0;
                    const isEmpty = pCount === 0 && cCount === 0;

                    return (
                      <div className="flex items-center gap-1 shrink-0 font-mono text-[10px]">
                        {isEmpty ? (
                          <span
                            className="bg-amber-50 text-amber-700 font-semibold border border-amber-200 px-1.5 py-0.5 rounded"
                            title="청크가 없는 빈 섹션"
                          >
                            빈 섹션
                          </span>
                        ) : (
                          <>
                            <span
                              className={`px-1.5 py-0.5 rounded font-semibold ${
                                isSectionActive
                                  ? 'bg-indigo-200 text-indigo-950'
                                  : 'bg-indigo-50 text-indigo-700 border border-indigo-200/60'
                              }`}
                              title={`소속 Parent 청크: ${pCount}개`}
                            >
                              P {pCount}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded ${
                                isSectionActive
                                  ? 'bg-indigo-300/60 text-indigo-950 font-bold'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                              title={`소속 Child 청크: ${cCount}개`}
                            >
                              C {cCount}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Level 2: Sub-tree of Parent Chunks */}
                {isExpanded && hasParents && (
                  <div className="ml-5 pl-2.5 border-l-2 border-indigo-100 space-y-0.5 my-1">
                    {parents.map((p) => {
                      const pId = p.parent_chunk_id || p.id || '';
                      const isParentActive = selectedParentChunkId === pId;
                      const cCount = p.child_chunk_ids?.length || 0;
                      const shortId = pId.includes('_p') ? 'P' + pId.split('_p')[1] : pId;

                      return (
                        <div
                          key={pId}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectParentChunk) {
                              onSelectParentChunk(pId, sec.id);
                            }
                          }}
                          className={`py-1.5 px-2 rounded-md cursor-pointer flex items-center justify-between transition text-[11px] ${
                            isParentActive
                              ? 'bg-purple-100 text-purple-950 font-semibold border border-purple-300 shadow-xs'
                              : 'text-slate-600 hover:bg-purple-50/50 hover:text-slate-900'
                          }`}
                          title={`${p.title || pId}\n토큰: ${p.token_estimate || 0}T | 자식 청크: ${cCount}개\n${p.text?.slice(0, 100)}...`}
                        >
                          <div className="flex items-center gap-1.5 truncate pr-1">
                            <Layers
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isParentActive ? 'text-purple-600' : 'text-purple-400'
                              }`}
                            />
                            <span className="font-mono text-[10px] text-purple-700 font-bold shrink-0">
                              [{shortId}]
                            </span>
                            <span className="truncate">
                              {p.title || (p.text ? p.text.trim().split('\n')[0] : '무제 부모 청크')}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0 font-mono text-[9px]">
                            <span
                              className={`px-1 py-0.5 rounded ${
                                (p.token_estimate || 0) > 2048
                                  ? 'bg-rose-100 text-rose-700 font-bold'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                              title={`토큰 수: ${p.token_estimate || 0}`}
                            >
                              {p.token_estimate || 0}T
                            </span>
                            <span
                              className={`px-1 py-0.5 rounded font-semibold ${
                                isParentActive
                                  ? 'bg-purple-200 text-purple-900'
                                  : 'bg-purple-50 text-purple-700 border border-purple-200/60'
                              }`}
                              title={`소속 Child 청크: ${cCount}개`}
                            >
                              C {cCount}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

import React, { useState, useMemo } from 'react';
import { Layers, Table2, AlignLeft, Filter, Search, X, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import type { ChildChunk, ParentSection, ParentChunk } from '../types';
import { ChunkCard } from './ChunkCard';
import { formatDisplayParentId } from '../utils/idUtils';
import { CopyableBadge } from './CopyableBadge';

interface ChunkExplorerProps {
  chunks: ChildChunk[];
  parentSections: ParentSection[];
  parentChunks?: ParentChunk[];
  selectedSectionId: string | null;
  selectedParentChunkId?: string | null;
  onClearSectionFilter: () => void;
  onClearParentFilter?: () => void;
  onOpenJsonlModal: (chunk: ChildChunk) => void;
  onEditChunk?: (chunk: ChildChunk) => void;
  onDeleteChunk?: (chunkId: string) => void;
  onRefineChunk?: (chunk: ChildChunk) => void;
  isLoading: boolean;
}

export const ChunkExplorer: React.FC<ChunkExplorerProps> = ({
  chunks,
  parentSections,
  parentChunks = [],
  selectedSectionId,
  selectedParentChunkId = null,
  onClearSectionFilter,
  onClearParentFilter,
  onOpenJsonlModal,
  onEditChunk,
  onDeleteChunk,
  onRefineChunk,
  isLoading,
}) => {
  const [typeFilter, setTypeFilter] = useState<'all' | 'table' | 'paragraph'>('all');
  const [query, setQuery] = useState('');
  const [isParentContextExpanded, setIsParentContextExpanded] = useState(true);

  const parentSectionMap = useMemo(() => {
    const map = new Map<string, ParentSection>();
    parentSections.forEach((p) => map.set(p.id, p));
    return map;
  }, [parentSections]);

  const parentChunkMap = useMemo(() => {
    const map = new Map<string, ParentChunk>();
    parentChunks.forEach((p) => {
      const pid = p.parent_chunk_id || p.id;
      if (pid) map.set(pid, p);
    });
    return map;
  }, [parentChunks]);

  const activeSection = selectedSectionId ? parentSectionMap.get(selectedSectionId) : null;
  const activeParentChunk = selectedParentChunkId ? parentChunkMap.get(selectedParentChunkId) : null;

  const filteredChunks = useMemo(() => {
    let result = chunks;

    // 1. Filter by selected parent chunk (우선순위 높음)
    if (selectedParentChunkId) {
      result = result.filter(
        (c) => (c.parent_chunk_id || c.parent_id) === selectedParentChunkId
      );
    } else if (selectedSectionId) {
      // 2. Filter by selected parent section
      result = result.filter(
        (c) => c.section_id === selectedSectionId || c.parent_id === selectedSectionId
      );
    }

    // Filter by type
    if (typeFilter !== 'all') {
      result = result.filter((c) => c.chunk_type === typeFilter);
    }

    // Filter by query text
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (c) =>
          c.text.toLowerCase().includes(q) ||
          c.chunk_id.toLowerCase().includes(q) ||
          (c.table_caption && c.table_caption.toLowerCase().includes(q))
      );
    }

    return result;
  }, [chunks, selectedSectionId, selectedParentChunkId, typeFilter, query]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col h-[780px]">
      {/* Top Header */}
      <div className="p-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50/50 rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-indigo-600" />
            <span>청크 뷰어 (Chunk Viewer)</span>
          </h3>

          {/* Active section badge */}
          {activeSection && (
            <span className="inline-flex items-center gap-1 text-[11px] bg-indigo-100 text-indigo-800 font-semibold px-2 py-0.5 rounded border border-indigo-200">
              <span className="max-w-[160px] truncate">섹션: {activeSection.title}</span>
              <button
                type="button"
                onClick={onClearSectionFilter}
                className="hover:text-indigo-950 cursor-pointer"
                title="섹션 필터 해제"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {/* Active Parent Chunk badge */}
          {activeParentChunk && (
            <span className="inline-flex items-center gap-1 text-[11px] bg-purple-100 text-purple-800 font-semibold px-2 py-0.5 rounded border border-purple-200">
              <Layers className="w-3 h-3 text-purple-600" />
              <span className="max-w-[200px] truncate" title={activeParentChunk.parent_chunk_id}>
                Parent: {activeParentChunk.title || formatDisplayParentId(activeParentChunk.parent_chunk_id)}
              </span>
              {onClearParentFilter && (
                <button
                  type="button"
                  onClick={onClearParentFilter}
                  className="hover:text-purple-950 cursor-pointer"
                  title="Parent 청크 필터 해제"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          )}

          {!activeSection && !activeParentChunk && (
            <span className="text-[11px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">
              전체 청크
            </span>
          )}
        </div>

        {/* Type Filter Buttons */}
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition cursor-pointer ${
              typeFilter === 'all'
                ? 'bg-indigo-100 text-indigo-800 font-semibold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter('table')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition flex items-center gap-1 cursor-pointer ${
              typeFilter === 'table'
                ? 'bg-indigo-100 text-indigo-800 font-semibold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Table2 className="w-3.5 h-3.5 text-indigo-600" />
            <span>표만 보기</span>
          </button>
          <button
            type="button"
            onClick={() => setTypeFilter('paragraph')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition flex items-center gap-1 cursor-pointer ${
              typeFilter === 'paragraph'
                ? 'bg-indigo-100 text-indigo-800 font-semibold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <AlignLeft className="w-3.5 h-3.5 text-slate-400" />
            <span>문단만 보기</span>
          </button>
        </div>
      </div>

      {/* Filter / Search Sub-bar */}
      <div className="p-2.5 border-b border-slate-100 bg-white flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="청크 내용 검색..."
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none placeholder-slate-400"
          />
        </div>
        <div className="text-[11px] text-slate-500 font-mono">
          총 <strong className="text-slate-800">{filteredChunks.length}</strong>개 청크
        </div>
      </div>

      {/* Chunk List Container */}
      <div className="p-4 overflow-y-auto flex-1 space-y-4 bg-slate-50/50">
        {/* Parent Chunk Context Banner (Parent가 선택되었을 때 표시) */}
        {activeParentChunk && (
          <div className="bg-white rounded-xl border-2 border-purple-200/80 shadow-xs overflow-hidden transition">
            <div
              className="p-3 bg-purple-50/70 border-b border-purple-100 flex items-center justify-between cursor-pointer"
              onClick={() => setIsParentContextExpanded(!isParentContextExpanded)}
            >
              <div className="flex items-center gap-2">
                <div className="p-1 bg-purple-600 text-white rounded">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <CopyableBadge
                      id={activeParentChunk.parent_chunk_id || activeParentChunk.id}
                      type="parent"
                      prefix="["
                      suffix="]"
                      titlePrefix="전체 Parent ID"
                      className="text-xs font-bold text-purple-900 shrink-0"
                    />
                    <span className="text-xs font-semibold text-slate-800">
                      {activeParentChunk.title || '상위 부모 문맥 (Parent Context)'}
                    </span>
                  </div>
                  <div className="text-[10px] text-purple-700 flex items-center gap-2 mt-0.5 font-mono">
                    <span>토큰: {activeParentChunk.token_estimate || 0}T</span>
                    <span>•</span>
                    <span>
                      페이지: p.{activeParentChunk.page_range?.[0] ?? 1}
                      {activeParentChunk.page_range?.[1] && activeParentChunk.page_range[1] !== activeParentChunk.page_range[0]
                        ? ` ~ p.${activeParentChunk.page_range[1]}`
                        : ''}
                    </span>
                    <span>•</span>
                    <span>자식 청크: {filteredChunks.length}개</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-purple-700 font-medium">
                <span>{isParentContextExpanded ? '문맥 접기' : 'LLM 주입 문맥 보기'}</span>
                {isParentContextExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </div>

            {isParentContextExpanded && (
              <div className="p-3.5 bg-purple-50/20 text-xs text-slate-700 leading-relaxed font-sans max-h-56 overflow-y-auto border-t border-purple-100/50 whitespace-pre-wrap selection:bg-purple-100">
                <div className="text-[11px] font-semibold text-purple-900 mb-1.5 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5 text-purple-600" />
                  <span>LLM 답변 생성 시 주입되는 전체 Parent 문맥 (~2048 토큰):</span>
                </div>
                <p className="text-slate-800 bg-white p-2.5 rounded-lg border border-purple-100 font-mono text-[11px] leading-relaxed">
                  {activeParentChunk.text}
                </p>
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="text-slate-400 text-center py-20">청크 데이터를 불러오는 중...</div>
        ) : filteredChunks.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
            <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">조건에 일치하는 청크가 없습니다.</p>
          </div>
        ) : (
          filteredChunks.map((chunk) => (
            <ChunkCard
              key={chunk.chunk_id}
              chunk={chunk}
              parentSection={parentSectionMap.get(chunk.section_id || chunk.parent_id || '')}
              onOpenJsonlModal={onOpenJsonlModal}
              onEditChunk={onEditChunk}
              onDeleteChunk={onDeleteChunk}
              onRefineChunk={onRefineChunk}
            />
          ))
        )}
      </div>
    </div>
  );
};

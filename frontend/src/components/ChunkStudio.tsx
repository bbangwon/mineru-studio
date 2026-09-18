import React, { useState, useMemo, useEffect } from 'react';
import {
  Network,
  BookOpen,
  Folder,
  FileText,
  Search,
  Layers,
  Table2,
  AlignLeft,
  Scale,
  EyeOff,
  Eye,
  CheckCircle2,
  Edit2,
  Check,
  X,
  FileCode2,
  Tag,
  Plus,
  AlertTriangle,
  FolderTree,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Sparkles,
  Info,
  Scissors,
  Merge,
  Square,
  CheckSquare,
  Trash2,
  ListOrdered,
  Loader2,
  Copy,
  ClipboardPaste,
  Download,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Globe,
  CornerDownRight,
  CornerUpLeft,
} from 'lucide-react';
import type { ChildChunk, ParentSection, ParentChunk, LLMRefineResponse, SectionInsertPosition, ReparentChildChunkParams, EmbeddedTableItem, AddChildData } from '../types';
import { ChunkSplitModal } from './ChunkSplitModal';
import { ChunkMergeModal } from './ChunkMergeModal';
import { AddSectionModal } from './AddSectionModal';
import { AddParentModal } from './AddParentModal';
import { AddChildModal } from './AddChildModal';
import { EditParentModal } from './EditParentModal';
import { BulkMetadataModal } from './BulkMetadataModal';
import { ReparentSectionModal } from './ReparentSectionModal';
import { ReparentChildModal } from './ReparentChildModal';
import { TableEditorModal } from './TableEditorModal';
import {
  deleteTableFromChunk,
  addTableToChunk,
  updateTableInChunk,
  type TableGrid,
} from '../utils/tableChunkUtils';
import {
  formatChunkPage,
  formatChunkPageFull,
  extractCustomMetadata,
  mergeMetadataWithPage,
  getAllCustomMetadataKeys,
  RESERVED_METADATA_KEYS,
  computeTableMetadata,
  reconstructCompositeHtml,
} from '../utils/pageUtils';
import {
  estimateKoreanTokens,
  formatDisplayChunkId,
  formatDisplayParentId,
} from '../utils/idUtils';
import {
  getChunkKind,
  getChunkKindLabel,
  hasTableData,
} from '../utils/chunkKindUtils';
import { refineChunkText } from '../api/client';
import { RefineDiffModal } from './RefineDiffModal';
import { CopyableBadge } from './CopyableBadge';

interface ChunkStudioProps {
  parentSections: ParentSection[];
  childChunks: ChildChunk[];
  parentChunks?: ParentChunk[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onUpdateChunk: (updatedChunk: ChildChunk, silent?: boolean) => void;
  onUpdateSectionTitle: (sectionId: string, newTitle: string) => void;
  onDeleteSection?: (sectionId: string, deleteChunks: boolean) => void;
  onAddSection?: (sectionData: {
    title: string;
    parentSectionId?: string;
    level: number;
    insertPosition?: SectionInsertPosition;
  }) => void;
  onMoveSection?: (sectionId: string, direction: 'up' | 'down') => void;
  onReparentSection?: (sectionId: string, newParentSectionId: string | null) => void;
  onIndentSection?: (sectionId: string) => void;
  onOutdentSection?: (sectionId: string) => void;
  onAddParent?: (data: {
    sectionId: string;
    title: string;
    pageNumber: number;
    initialChildText: string;
    chunkType: 'paragraph' | 'table' | 'article_clause' | 'article';
    inheritMetadata?: boolean;
  }) => void;
  onAddChild?: (data: AddChildData) => void;
  onUpdateParent?: (
    parentChunkId: string,
    updates: { title: string; sectionId: string }
  ) => void;
  onDeleteParent?: (parentChunkId: string) => void;
  onMoveParent?: (parentChunkId: string, direction: 'up' | 'down') => void;
  onBatchCleanEmptySections?: () => void;
  onToggleIgnoreChunk: (chunkId: string) => void;
  onOpenJsonlModal: (chunk: ChildChunk) => void;
  onSplitChunk?: (
    chunkId: string,
    part1Text: string,
    part2Text: string,
    page1?: number,
    page2?: number
  ) => void;
  onMergeChunks?: (
    chunkIds: string[],
    mergedText: string,
    customMergedId?: string,
    pageStart?: number,
    pageEnd?: number
  ) => void;
  onDeleteChunks?: (chunkIds: string[]) => void;
  onReassignParentSection?: (parentChunkId: string, newSectionId: string) => void;
  onReparentChildChunk?: (params: ReparentChildChunkParams) => void;
  onBatchCleanEmptyChunks?: () => void;
  onReindexIds?: () => void;
  onBulkUpdateMetadata?: (params: {
    mode: 'add_tag' | 'apply_batch' | 'delete_tag';
    key?: string;
    value?: any;
    tags?: Record<string, any>;
    scope: 'all' | 'section';
    sectionId?: string;
    overwrite?: boolean;
  }) => void;
  isLoading: boolean;
}

export const ChunkStudio: React.FC<ChunkStudioProps> = ({
  parentSections,
  childChunks,
  parentChunks,
  selectedSectionId,
  onSelectSection,
  onUpdateChunk,
  onUpdateSectionTitle,
  onDeleteSection,
  onAddSection,
  onMoveSection,
  onReparentSection,
  onIndentSection,
  onOutdentSection,
  onAddParent,
  onAddChild,
  onUpdateParent,
  onDeleteParent,
  onMoveParent,
  onBatchCleanEmptySections,
  onToggleIgnoreChunk,
  onOpenJsonlModal,
  onSplitChunk,
  onMergeChunks,
  onDeleteChunks,
  onReassignParentSection,
  onReparentChildChunk,
  onBatchCleanEmptyChunks,
  onReindexIds,
  onBulkUpdateMetadata,
  isLoading,
}) => {
  // Modal states for Parent & Child CRUD
  const [isAddParentModalOpen, setIsAddParentModalOpen] = useState(false);
  const [targetSectionIdForAddParent, setTargetSectionIdForAddParent] = useState<string | null>(null);

  const [isAddChildModalOpen, setIsAddChildModalOpen] = useState(false);
  const [targetParentForAddChild, setTargetParentForAddChild] = useState<ParentChunk | null>(null);
  const [targetInsertAfterChunkId, setTargetInsertAfterChunkId] = useState<string | undefined>(undefined);

  const [reparentModalSection, setReparentModalSection] = useState<ParentSection | null>(null);
  const [isReparentModalOpen, setIsReparentModalOpen] = useState(false);

  const [isReparentChildModalOpen, setIsReparentChildModalOpen] = useState(false);
  const [reparentTargetChunks, setReparentTargetChunks] = useState<ChildChunk[]>([]);

  const handleOpenReparentSingleChunk = (chunk: ChildChunk, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setReparentTargetChunks([chunk]);
    setIsReparentChildModalOpen(true);
  };

  const handleOpenReparentSelectedChunks = () => {
    const selectedList = childChunks.filter((c) => selectedChunkIds.has(c.chunk_id));
    if (selectedList.length === 0) return;
    setReparentTargetChunks(selectedList);
    setIsReparentChildModalOpen(true);
  };

  const [isEditParentModalOpen, setIsEditParentModalOpen] = useState(false);
  const [targetParentForEdit, setTargetParentForEdit] = useState<ParentChunk | null>(null);

  // Bulk Metadata Modal State
  const [isBulkMetaModalOpen, setIsBulkMetaModalOpen] = useState(false);

  // 1. Column 1 State (Hierarchy Tree)
  const [sectionSearch, setSectionSearch] = useState('');
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionTitle, setEditingSectionTitle] = useState('');
  const [manualExpandedState, setManualExpandedState] = useState<Record<string, boolean>>({});
  const [manualParentExpandedState, setManualParentExpandedState] = useState<Record<string, boolean>>({});

  // 2. Column 2 State (Chunk Timeline & Selection & Linter)
  const [chunkQuery, setChunkQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'table' | 'paragraph' | 'article'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'edited' | 'ignored' | 'linter' | 'empty'>('all');
  const [selectedChunkIds, setSelectedChunkIds] = useState<Set<string>>(new Set());

  // 3. Modals State
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isAddSectionModalOpen, setIsAddSectionModalOpen] = useState(false);

  // 4. Column 3 State (Focus Editor)
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<'text' | 'raw_html' | 'preview'>('text');
  const [newMetaKey, setNewMetaKey] = useState('');
  const [newMetaVal, setNewMetaVal] = useState('');
  const [pageStartInput, setPageStartInput] = useState<string>('');
  const [pageEndInput, setPageEndInput] = useState<string>('');

  // Table Editor & Delete Confirmation States
  const [tableEditorTarget, setTableEditorTarget] = useState<{
    chunk: ChildChunk;
    tableIndex: number;
    initialHtml?: string;
    initialMarkdown?: string;
    caption?: string;
    footnote?: string;
  } | null>(null);

  const [tableDeleteConfirm, setTableDeleteConfirm] = useState<{
    chunk: ChildChunk;
    tableIndex: number;
    tableName: string;
    isLastTable: boolean;
  } | null>(null);

  // Custom Metadata Clipboard & Notice States
  const [metadataClipboard, setMetadataClipboard] = useState<Record<string, any> | null>(() => {
    try {
      const stored = localStorage.getItem('mineru_copied_meta');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [metaNotice, setMetaNotice] = useState<string | null>(null);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [editingMetaKey, setEditingMetaKey] = useState<string | null>(null);
  const [editingMetaVal, setEditingMetaVal] = useState<string>('');

  // Responsive Layout States for Mobile / Small Screens & Desktop Collapse
  const [mobileTab, setMobileTab] = useState<'tree' | 'list' | 'editor'>('list');
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);

  // Parent Section Quick Lookup Map
  const parentMap = useMemo(() => {
    const map = new Map<string, ParentSection>();
    parentSections.forEach((p) => map.set(p.id, p));
    return map;
  }, [parentSections]);

  // Section ID -> ParentChunk[] 매핑
  const parentChunksBySection = useMemo(() => {
    const map = new Map<string, ParentChunk[]>();
    (parentChunks || []).forEach((p) => {
      const sId = p.section_id || '';
      if (!map.has(sId)) {
        map.set(sId, []);
      }
      map.get(sId)!.push(p);
    });
    return map;
  }, [parentChunks]);

  // Child chunks grouped by section ID
  const childChunksBySection = useMemo(() => {
    const map = new Map<string, ChildChunk[]>();
    for (const chunk of childChunks) {
      const secId = chunk.section_id || chunk.parent_id || '';
      if (!secId) continue;
      const list = map.get(secId);
      if (list) {
        list.push(chunk);
      } else {
        map.set(secId, [chunk]);
      }
    }
    return map;
  }, [childChunks]);

  // Child chunks grouped by Parent Chunk ID
  const childChunksByParent = useMemo(() => {
    const map = new Map<string, ChildChunk[]>();
    for (const chunk of childChunks) {
      const pid = chunk.parent_chunk_id || chunk.parent_id || 'unassigned';
      if (!map.has(pid)) {
        map.set(pid, []);
      }
      map.get(pid)!.push(chunk);
    }
    return map;
  }, [childChunks]);

  // Filtered Sections for Search: matches section title OR child chunk id/text/table_caption OR parent title/text, and includes ancestors
  const matchedSectionIdSet = useMemo(() => {
    if (!sectionSearch.trim()) return null;
    const term = sectionSearch.toLowerCase();

    const matched = new Set<string>();
    for (const s of parentSections) {
      const titleMatch = s.title.toLowerCase().includes(term);
      const parents = parentChunksBySection.get(s.id) || [];
      const parentMatch = parents.some(
        (p) =>
          (p.title && p.title.toLowerCase().includes(term)) ||
          (p.parent_chunk_id && p.parent_chunk_id.toLowerCase().includes(term)) ||
          (p.text && p.text.toLowerCase().includes(term))
      );
      const children = childChunksBySection.get(s.id) || [];
      const chunkMatch = children.some(
        (c) =>
          c.chunk_id.toLowerCase().includes(term) ||
          (c.text && c.text.toLowerCase().includes(term)) ||
          Boolean(c.tables?.some((t) => (t.caption && t.caption.toLowerCase().includes(term)) || (t.footnote && t.footnote.toLowerCase().includes(term)))) ||
          Boolean(c.table_caption && c.table_caption.toLowerCase().includes(term))
      );
      if (titleMatch || parentMatch || chunkMatch) {
        matched.add(s.id);
      }
    }

    // Include ancestors so hierarchy tree doesn't break
    const visible = new Set<string>(matched);
    const secMap = new Map(parentSections.map((s) => [s.id, s]));
    for (const id of matched) {
      let curr = secMap.get(id);
      while (curr && curr.parent_section_id && secMap.has(curr.parent_section_id)) {
        visible.add(curr.parent_section_id);
        curr = secMap.get(curr.parent_section_id);
      }
    }
    return visible;
  }, [parentSections, sectionSearch, parentChunksBySection, childChunksBySection]);

  // Top-level sections (level === 0, or no parent_section_id, or parent section not in list)
  const topLevelSections = useMemo(() => {
    const allSecIds = new Set(parentSections.map((s) => s.id));
    return parentSections.filter((s) => {
      if (s.level === 0) return true;
      if (!s.parent_section_id) return true;
      if (!allSecIds.has(s.parent_section_id)) return true;
      return false;
    });
  }, [parentSections]);

  const visibleTopLevelSections = useMemo(() => {
    if (!matchedSectionIdSet) return topLevelSections;
    return topLevelSections.filter((s) => matchedSectionIdSet.has(s.id));
  }, [topLevelSections, matchedSectionIdSet]);

  const isSectionExpanded = React.useCallback(
    (sectionId: string) => {
      if (manualExpandedState[sectionId] !== undefined) {
        return manualExpandedState[sectionId];
      }
      // Search active or currently selected section defaults to expanded
      if (sectionSearch.trim()) return true;
      if (selectedSectionId === sectionId) return true;
      // Default to expanded so nested hierarchy is immediately visible
      return true;
    },
    [manualExpandedState, sectionSearch, selectedSectionId]
  );

  const toggleExpandSection = (sectionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const current = isSectionExpanded(sectionId);
    setManualExpandedState((prev) => ({
      ...prev,
      [sectionId]: !current,
    }));
  };

  const isParentExpanded = React.useCallback(
    (parentId: string) => {
      if (manualParentExpandedState[parentId] !== undefined) {
        return manualParentExpandedState[parentId];
      }
      if (sectionSearch.trim()) return true;
      return true; // 기본 펼침 상태
    },
    [manualParentExpandedState, sectionSearch]
  );

  const toggleExpandParent = (parentId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const current = isParentExpanded(parentId);
    setManualParentExpandedState((prev) => ({
      ...prev,
      [parentId]: !current,
    }));
  };

  const expandAllSections = () => {
    const next: Record<string, boolean> = {};
    parentSections.forEach((s) => {
      next[s.id] = true;
    });
    setManualExpandedState(next);

    const nextP: Record<string, boolean> = {};
    (parentChunks || []).forEach((p) => {
      const pid = p.parent_chunk_id || p.id;
      if (pid) nextP[pid] = true;
    });
    setManualParentExpandedState(nextP);
  };

  const collapseAllSections = () => {
    const next: Record<string, boolean> = {};
    parentSections.forEach((s) => {
      next[s.id] = false;
    });
    setManualExpandedState(next);

    const nextP: Record<string, boolean> = {};
    (parentChunks || []).forEach((p) => {
      const pid = p.parent_chunk_id || p.id;
      if (pid) nextP[pid] = false;
    });
    setManualParentExpandedState(nextP);
  };

  const isAnySectionExpanded = useMemo(() => {
    return parentSections.some((s) => isSectionExpanded(s.id));
  }, [parentSections, isSectionExpanded]);

  const handleSelectParentChunkFromTree = (sectionId: string, parentId: string) => {
    if (selectedSectionId !== sectionId) {
      onSelectSection(sectionId);
    }
    // 2열의 해당 Parent 컨테이너 박스로 스크롤
    setTimeout(() => {
      const boxEl = document.getElementById(`parent-box-${parentId}`);
      if (boxEl) {
        boxEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);

    // 해당 Parent의 첫 번째 Child 청크 활성화
    const children = childChunksByParent.get(parentId) || [];
    if (children.length > 0) {
      setSelectedChunkId(children[0].chunk_id);
    }
    setMobileTab('list');
  };

  const handleSelectChildChunkFromTree = (sectionId: string, chunkId: string) => {
    if (selectedSectionId !== sectionId) {
      onSelectSection(sectionId);
    }
    setSelectedChunkId(chunkId);
    setMobileTab('editor');

    // Smooth scroll into view in Column 2
    setTimeout(() => {
      const cardEl = document.getElementById(`chunk-card-${chunkId}`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 60);
  };

  const renderChildChunkItem = (secId: string, chunk: ChildChunk) => {
    const isChildSelected = activeChunkId === chunk.chunk_id;
    const tableList = chunk.tables || chunk.metadata?.tables || [];
    const chunkKind = getChunkKind(chunk);
    const isComposite = chunkKind === 'composite';
    const isTable = chunkKind === 'table';
    const isArticle = chunkKind === 'article';
    const isIgnored = Boolean(chunk.is_ignored);
    const isEdited = Boolean(chunk.is_edited);
    const pageNum = chunk.page_number || 1;

    let preview = '';
    if (isComposite) {
      preview = `[복합: 표${tableList.length || 1}] ${chunk.text?.slice(0, 24) || ''}`;
    } else if (isTable) {
      const tableCap = tableList[0]?.caption || chunk.table_caption;
      preview = tableCap ? `[표] ${tableCap}` : '[원형 표]';
    } else if (isArticle) {
      const artNo = chunk.metadata?.article_no || '조문';
      const firstLine = chunk.text?.trim().split('\n')[0] || '';
      preview = `[${artNo}] ${firstLine.length > 24 ? firstLine.slice(0, 24) + '…' : firstLine}`;
    } else if (chunk.text) {
      const firstLine = chunk.text.trim().split('\n')[0] || '';
      preview = firstLine.length > 28 ? firstLine.slice(0, 28) + '…' : firstLine;
    } else if (chunk.raw_html) {
      preview = '[HTML 표/데이터]';
    } else {
      preview = '(내용 없음)';
    }

    const shortId = formatDisplayChunkId(chunk.chunk_id);

    return (
      <div
        key={chunk.chunk_id}
        onClick={(e) => {
          e.stopPropagation();
          handleSelectChildChunkFromTree(secId, chunk.chunk_id);
        }}
        className={`group/child py-1 px-2 rounded-md cursor-pointer flex items-center justify-between text-[11px] transition select-none ${
          isChildSelected
            ? 'bg-indigo-600 text-white font-medium shadow-2xs ring-1 ring-indigo-500'
            : isIgnored
            ? 'text-slate-400 dark:text-slate-500 bg-slate-50/60 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-60'
            : 'text-slate-600 dark:text-slate-300 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/60 hover:text-slate-900 dark:hover:text-white'
        }`}
        title={`${chunk.chunk_id} (p.${pageNum})\n${chunk.text?.slice(0, 200) || ''}`}
      >
        <div className="flex items-center gap-1.5 truncate min-w-0 pr-1">
          {isComposite ? (
            <Layers
              className={`w-3.5 h-3.5 shrink-0 ${
                isChildSelected ? 'text-teal-200' : 'text-teal-600 dark:text-teal-400'
              }`}
            />
          ) : isTable ? (
            <Table2
              className={`w-3.5 h-3.5 shrink-0 ${
                isChildSelected ? 'text-amber-200' : 'text-amber-500 dark:text-amber-400'
              }`}
            />
          ) : isArticle ? (
            <Scale
              className={`w-3.5 h-3.5 shrink-0 ${
                isChildSelected ? 'text-indigo-200' : 'text-indigo-500 dark:text-indigo-400'
              }`}
            />
          ) : (
            <AlignLeft
              className={`w-3.5 h-3.5 shrink-0 ${
                isChildSelected ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'
              }`}
            />
          )}
          <span
            className={`font-mono text-[9px] px-1 py-0.2 rounded shrink-0 ${
              isChildSelected
                ? 'bg-indigo-700/90 text-indigo-100 font-semibold'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
            }`}
          >
            p.{pageNum}
          </span>
          <span className="truncate text-xs">
            {preview}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 font-mono text-[9px]">
          {isEdited && (
            <span
              className={`px-1 py-0.2 rounded font-semibold ${
                isChildSelected
                  ? 'bg-indigo-700 text-emerald-300'
                  : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-transparent dark:border-emerald-800'
              }`}
            >
              수정
            </span>
          )}
          {isIgnored && (
            <span
              className={`px-1 py-0.2 rounded ${
                isChildSelected
                  ? 'bg-indigo-700 text-rose-300'
                  : 'bg-rose-50 dark:bg-rose-950/80 text-rose-600 dark:text-rose-300 border border-transparent dark:border-rose-800'
              }`}
            >
              제외
            </span>
          )}
          <span
            className={`text-[10px] ${
              isChildSelected ? 'text-indigo-200 font-bold' : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {shortId}
          </span>
        </div>
      </div>
    );
  };

  // Linter statistics for the entire document (Child 512 / Parent 2048 standards)
  const linterStats = useMemo(() => {
    let emptyCount = 0;
    let overCount = 0;
    let underCount = 0;
    for (const c of childChunks) {
      const isTable = c.chunk_type === 'table' || Boolean(c.is_atomic_table);
      const words = c.token_estimate || (c.text ? estimateKoreanTokens(c.text) : 0);
      const isEmpty = (!c.text || !c.text.trim()) && (!c.raw_html || !c.raw_html.trim());
      if (isEmpty) {
        emptyCount++;
      } else if (!isTable && words > 512) {
        overCount++;
      } else if (!isTable && words > 0 && words < 20) {
        underCount++;
      }
    }
    const parentOverCount = (parentChunks || []).filter((p) => (p.token_estimate || 0) > 2048).length;
    return {
      emptyCount,
      overCount,
      underCount,
      parentOverCount,
      totalWarnings: emptyCount + overCount + underCount + parentOverCount,
    };
  }, [childChunks, parentChunks]);

  // Filtered Chunks for Column 2
  const filteredChunks = useMemo(() => {
    let result = childChunks;

    if (selectedSectionId) {
      result = result.filter(
        (c) => c.section_id === selectedSectionId || c.parent_id === selectedSectionId
      );
    }

    if (typeFilter !== 'all') {
      result = result.filter((c) => getChunkKind(c) === typeFilter);
    }

    if (statusFilter === 'edited') {
      result = result.filter((c) => Boolean(c.is_edited));
    } else if (statusFilter === 'ignored') {
      result = result.filter((c) => Boolean(c.is_ignored));
    } else if (statusFilter === 'linter') {
      result = result.filter((c) => {
        const isTable = hasTableData(c);
        const words = c.token_estimate || (c.text ? estimateKoreanTokens(c.text) : 0);
        const isEmpty = (!c.text || !c.text.trim()) && (!c.raw_html || !c.raw_html.trim());
        return (!isTable && words > 512) || (!isTable && !isEmpty && words > 0 && words < 20) || isEmpty;
      });
    } else if (statusFilter === 'empty') {
      result = result.filter((c) => (!c.text || !c.text.trim()) && (!c.raw_html || !c.raw_html.trim()));
    }

    if (chunkQuery.trim()) {
      const q = chunkQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.text.toLowerCase().includes(q) ||
          c.chunk_id.toLowerCase().includes(q) ||
          Boolean(c.tables?.some((t) => (t.caption && t.caption.toLowerCase().includes(q)) || (t.footnote && t.footnote.toLowerCase().includes(q)))) ||
          Boolean(c.table_caption && c.table_caption.toLowerCase().includes(q))
      );
    }

    return result;
  }, [childChunks, selectedSectionId, typeFilter, statusFilter, chunkQuery]);

  // Multi-selection methods
  const toggleSelectChunk = (chunkId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedChunkIds((prev) => {
      const next = new Set(prev);
      if (next.has(chunkId)) {
        next.delete(chunkId);
      } else {
        next.add(chunkId);
      }
      return next;
    });
  };

  const clearSelectedChunks = () => {
    setSelectedChunkIds(new Set());
  };

  const selectAllFilteredChunks = () => {
    const next = new Set(selectedChunkIds);
    filteredChunks.forEach((c) => next.add(c.chunk_id));
    setSelectedChunkIds(next);
  };

  // Selected chunks sorted by original childChunks index order
  const selectedChunksList = useMemo(() => {
    return childChunks.filter((c) => selectedChunkIds.has(c.chunk_id));
  }, [childChunks, selectedChunkIds]);

  // Derived active chunk ID: fallback to first chunk in filtered list if not selected or filtered out
  const activeChunkId = selectedChunkId && filteredChunks.some((c) => c.chunk_id === selectedChunkId)
    ? selectedChunkId
    : filteredChunks[0]?.chunk_id || null;

  // Selected Chunk object for Column 3
  const activeChunk = useMemo(() => {
    if (!activeChunkId) return null;
    return childChunks.find((c) => c.chunk_id === activeChunkId) || null;
  }, [childChunks, activeChunkId]);

  // Active Parent Chunk for Column 3 and context
  const activeParentChunk = useMemo(() => {
    if (!activeChunk) return null;
    const pid = activeChunk.parent_chunk_id || activeChunk.parent_id;
    return (parentChunks || []).find((p) => (p.parent_chunk_id || p.id) === pid) || null;
  }, [activeChunk, parentChunks]);

  // Synchronize Column 3 page inputs with active chunk
  useEffect(() => {
    if (activeChunk) {
      setPageStartInput(String(activeChunk.page_number || 1));
      setPageEndInput(activeChunk.page_end ? String(activeChunk.page_end) : '');
    }
  }, [activeChunk?.chunk_id, activeChunk?.page_number, activeChunk?.page_end]);

  // 복합(composite) 청크의 raw_html에 문단 태그가 누락된 구버전 데이터 자동 복원
  useEffect(() => {
    if (activeChunk) {
      const isComposite =
        activeChunk.chunk_type === 'composite' ||
        Boolean((activeChunk.tables || activeChunk.metadata?.tables || []).length && activeChunk.chunk_type !== 'table');
      if (isComposite) {
        const raw = activeChunk.raw_html || '';
        if (!raw || !/<p\b|<div\b|<span\b/i.test(raw)) {
          const healedRaw = reconstructCompositeHtml(activeChunk);
          if (healedRaw && healedRaw !== raw) {
            onUpdateChunk({ ...activeChunk, raw_html: healedRaw, is_edited: true }, true);
          }
        }
      }
    }
  }, [activeChunk?.chunk_id]);

  // Column 2 Parent Groups (Parent Chunk 단위 그룹화)
  const parentGroups = useMemo(() => {
    const childByParent = new Map<string, ChildChunk[]>();
    for (const c of filteredChunks) {
      const pid = c.parent_chunk_id || c.parent_id || 'unassigned';
      const list = childByParent.get(pid) || [];
      list.push(c);
      childByParent.set(pid, list);
    }

    const groups: { parent: ParentChunk; children: ChildChunk[] }[] = [];
    const processedPids = new Set<string>();

    (parentChunks || []).forEach((p) => {
      const pid = p.parent_chunk_id || p.id || '';
      const children = childByParent.get(pid);
      if (children && children.length > 0) {
        groups.push({ parent: p, children });
        processedPids.add(pid);
      }
    });

    childByParent.forEach((children, pid) => {
      if (!processedPids.has(pid)) {
        const first = children[0];
        const fallbackParent: ParentChunk = {
          parent_chunk_id: pid,
          section_id: first.section_id || first.parent_id || '',
          title: '독립 / 미분류 그룹',
          text: children.map((c) => c.text).join('\n\n'),
          token_estimate: children.reduce((acc, c) => acc + (c.token_estimate || 0), 0),
          child_chunk_ids: children.map((c) => c.chunk_id),
          page_range: [
            Math.min(...children.map((c) => c.page_number || 1)),
            Math.max(...children.map((c) => c.page_end || c.page_number || 1)),
          ],
        };
        groups.push({ parent: fallbackParent, children });
      }
    });

    return groups;
  }, [filteredChunks, parentChunks]);

  // Display limit for smooth rendering of 1000+ chunks in Column 2
  const [displayLimit, setDisplayLimit] = useState(50);

  const { visibleGroups, displayedChildCount } = useMemo(() => {
    let count = 0;
    const groups: { parent: ParentChunk; children: ChildChunk[] }[] = [];

    for (const g of parentGroups) {
      if (count >= displayLimit) break;
      const remaining = displayLimit - count;
      const slicedChildren = g.children.slice(0, remaining);
      groups.push({
        parent: g.parent,
        children: slicedChildren,
      });
      count += slicedChildren.length;
    }

    return { visibleGroups: groups, displayedChildCount: count };
  }, [parentGroups, displayLimit]);

  // Handle section title inline editing
  const startEditSection = (sec: ParentSection, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingSectionId(sec.id);
    setEditingSectionTitle(sec.title);
  };

  const saveEditSection = (sectionId: string) => {
    if (editingSectionTitle.trim()) {
      onUpdateSectionTitle(sectionId, editingSectionTitle.trim());
    }
    setEditingSectionId(null);
  };

  const cancelEditSection = () => {
    setEditingSectionId(null);
  };

  // Map of parent section ID -> child sections
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

  // Count empty sections (0 child chunks AND 0 child sections)
  const emptySectionsCount = useMemo(() => {
    return parentSections.filter((s) => {
      const hasChunks = s.child_chunk_ids && s.child_chunk_ids.length > 0;
      const hasChildSections = childSectionsMap.has(s.id);
      return !hasChunks && !hasChildSections;
    }).length;
  }, [parentSections, childSectionsMap]);

  // Handle section deletion with safety confirmation
  const handleDeleteSectionClick = (sec: ParentSection, e: React.MouseEvent) => {
    e.stopPropagation();
    const chunkCount = sec.child_chunk_ids.length;
    const childSecs = childSectionsMap.get(sec.id) || [];
    const childSecCount = childSecs.length;

    if (chunkCount === 0 && childSecCount === 0) {
      // 1) 리프 빈 섹션
      const ok = window.confirm(`'${sec.title}' 섹션을 삭제하시겠습니까?`);
      if (ok) {
        onDeleteSection?.(sec.id, false);
      }
    } else if (childSecCount > 0) {
      // 2) 하위 섹션이 존재하는 상위 섹션
      const ok = window.confirm(
        `⚠️ 주의: '${sec.title}' 섹션에는 ${childSecCount}개의 하위 섹션` +
          (chunkCount > 0 ? ` 및 ${chunkCount}개의 소속 청크` : '') +
          `이 존재합니다.\n\n` +
          (chunkCount > 0 ? `• 소속된 ${chunkCount}개의 청크는 함께 영구 삭제됩니다.\n` : '') +
          `• ${childSecCount}개의 하위 섹션은 상위 계층으로 승격됩니다.\n\n` +
          `정말 삭제하시겠습니까?`
      );
      if (ok) {
        onDeleteSection?.(sec.id, chunkCount > 0);
      }
    } else {
      // 3) 하위 섹션은 없으나 청크가 포함된 섹션
      const ok = window.confirm(
        `⚠️ 경고: '${sec.title}' 섹션에는 ${chunkCount}개의 청크가 포함되어 있습니다.\n\n` +
          `섹션을 삭제하면 소속된 ${chunkCount}개의 청크도 함께 영구 삭제됩니다.\n\n` +
          `정말 삭제하시겠습니까?`
      );
      if (ok) {
        onDeleteSection?.(sec.id, true);
      }
    }
  };

  // Handle multi-chunk deletion with safety confirmation
  const handleDeleteSelectedChunks = () => {
    if (!onDeleteChunks || selectedChunkIds.size === 0) return;
    const count = selectedChunkIds.size;
    const ok = window.confirm(
      `선택한 ${count}개의 청크를 정말 삭제하시겠습니까?\n\n` +
      `• 소속된 상위 Parent의 본문 문맥도 남은 청크 기준으로 자동 축소됩니다.\n` +
      `• 자식 청크가 모두 삭제된 Parent가 있다면 해당 Parent도 함께 자동 정리됩니다.\n\n` +
      `삭제를 진행하시겠습니까?`
    );
    if (ok) {
      onDeleteChunks(Array.from(selectedChunkIds));
      clearSelectedChunks();
    }
  };

  // Handle single chunk deletion with safety confirmation
  const handleDeleteSingleChunk = (chunkId: string) => {
    if (!onDeleteChunks) return;
    const ok = window.confirm(
      `청크 '${chunkId}'를 정말 삭제하시겠습니까?\n\n` +
      `• 소속된 상위 Parent의 본문 문맥도 남은 청크 기준으로 자동 축소됩니다.\n` +
      `• 만약 이 청크가 해당 Parent의 마지막 청크라면 Parent도 함께 자동 정리됩니다.\n\n` +
      `삭제를 진행하시겠습니까?`
    );
    if (ok) {
      onDeleteChunks([chunkId]);
      if (selectedChunkIds.has(chunkId)) {
        setSelectedChunkIds((prev) => {
          const next = new Set(prev);
          next.delete(chunkId);
          return next;
        });
      }
    }
  };

  // Column 3 real-time field updater
  const handleFieldChange = (field: keyof ChildChunk, value: any) => {
    if (!activeChunk) return;

    let updated: ChildChunk = {
      ...activeChunk,
      [field]: value,
      is_edited: true,
    };

    // If parent_id changed, recompute breadcrumbs
    if (field === 'parent_id') {
      const targetParent = parentSections.find((p) => p.id === value);
      if (targetParent) {
        updated.breadcrumbs = [...(targetParent.breadcrumbs || [targetParent.title])];
      }
    }

    // Recompute word/token estimate if text or raw_html changed
    if (field === 'text' || field === 'raw_html') {
      const textToCount = field === 'text' ? value : updated.text;
      const count = textToCount && typeof textToCount === 'string' && textToCount.trim()
        ? estimateKoreanTokens(textToCount)
        : 0;
      updated.token_estimate = count;
    }

    onUpdateChunk(updated, true);
  };

  // Update caption or footnote of a specific table inside a chunk (both atomic and composite)
  const handleTableItemFieldChange = (
    tableIndex: number,
    field: 'caption' | 'footnote',
    value: string
  ) => {
    if (!activeChunk) return;
    let currentTables: EmbeddedTableItem[] = [
      ...(activeChunk.tables || activeChunk.metadata?.tables || []),
    ];
    if (currentTables.length === 0) {
      currentTables = [{
        table_index: 0,
        table_id: `${activeChunk.chunk_id}_t1`,
        raw_html: activeChunk.raw_html || '',
        caption: '',
        footnote: '',
      }];
    }
    if (tableIndex < 0 || tableIndex >= currentTables.length) return;

    currentTables[tableIndex] = {
      ...currentTables[tableIndex],
      [field]: value,
    };

    const updated: ChildChunk = {
      ...activeChunk,
      tables: currentTables,
      table_caption: undefined,
      table_footnote: undefined,
      is_edited: true,
      metadata: {
        ...(activeChunk.metadata || {}),
        tables: currentTables,
      },
    };
    if (updated.metadata) {
      delete updated.metadata.table_caption;
      delete updated.metadata.table_footnote;
    }

    onUpdateChunk(updated, true);
  };

  const handleCompositeTableFieldChange = handleTableItemFieldChange;

  // Open table editor modal
  const handleOpenTableEditor = (
    chunk: ChildChunk,
    tableIndex: number,
    html?: string,
    caption?: string,
    footnote?: string
  ) => {
    const chunkTables = chunk.tables || chunk.metadata?.tables || [];
    const targetTable = chunkTables[tableIndex];
    setTableEditorTarget({
      chunk,
      tableIndex,
      initialHtml: html || targetTable?.raw_html || (chunk.chunk_type === 'table' ? chunk.raw_html : undefined),
      initialMarkdown: chunk.text,
      caption: caption ?? targetTable?.caption ?? chunk.table_caption,
      footnote: footnote ?? targetTable?.footnote ?? chunk.table_footnote,
    });
  };

  // Save table editor changes with 3-way synchronization
  const handleSaveTableEditor = (data: {
    grid: TableGrid;
    html: string;
    markdown: string;
    caption?: string;
    footnote?: string;
  }) => {
    if (!tableEditorTarget) return;
    const { chunk, tableIndex } = tableEditorTarget;
    const updated = updateTableInChunk(
      chunk,
      tableIndex,
      data.grid,
      data.caption,
      data.footnote
    );
    onUpdateChunk(updated, true);
    setMetaNotice('표 데이터 및 셀 병합 상태가 성공적으로 저장·동기화되었습니다.');
    setTimeout(() => setMetaNotice(null), 3000);
    setTableEditorTarget(null);
  };

  // Add new table to chunk (auto-promotes to composite chunk)
  const handleAddTable = (chunk: ChildChunk) => {
    const updated = addTableToChunk(chunk);
    onUpdateChunk(updated, true);
    setMetaNotice('새 표가 추가되었습니다. [내용/병합 편집]을 통해 셀 데이터 및 병합을 수정하세요.');
    setTimeout(() => setMetaNotice(null), 4000);
  };

  // Trigger table delete confirmation
  const handleDeleteTableClick = (chunk: ChildChunk, tableIndex: number, tableName: string) => {
    const currentTables = chunk.tables || chunk.metadata?.tables || [];
    const isLastTable = chunk.chunk_type === 'table' || currentTables.length <= 1;
    setTableDeleteConfirm({
      chunk,
      tableIndex,
      tableName,
      isLastTable,
    });
  };

  // Confirm and execute table deletion
  const handleConfirmDeleteTable = () => {
    if (!tableDeleteConfirm) return;
    const { chunk, tableIndex, isLastTable } = tableDeleteConfirm;
    const updated = deleteTableFromChunk(chunk, tableIndex);
    onUpdateChunk(updated, true);
    setTableDeleteConfirm(null);
    if (isLastTable) {
      setMetaNotice('모든 표가 삭제되어 해당 청크가 일반 문단(paragraph)으로 자동 전환되었습니다.');
    } else {
      setMetaNotice('해당 표가 삭제되고 남은 표 목록이 재정렬되었습니다.');
    }
    setTimeout(() => setMetaNotice(null), 3500);
  };

  // Add custom metadata tag
  const handleAddMetaTag = () => {
    if (!activeChunk || !newMetaKey.trim()) return;
    const trimmedKey = newMetaKey.trim();
    if (RESERVED_METADATA_KEYS.has(trimmedKey)) {
      setMetaNotice(`'${trimmedKey}'는 시스템 예약어(유형/출처/표/페이지/식별자 등)이므로 커스텀 태그로 사용할 수 없습니다.`);
      setTimeout(() => setMetaNotice(null), 3000);
      return;
    }
    const currentMeta = activeChunk.metadata || {};
    const updatedMeta = {
      ...currentMeta,
      [trimmedKey]: newMetaVal.trim(),
    };
    handleFieldChange('metadata', updatedMeta);
    setNewMetaKey('');
    setNewMetaVal('');
  };

  // Delete custom metadata tag
  const handleDeleteMetaTag = (key: string) => {
    if (!activeChunk || !activeChunk.metadata) return;
    const updatedMeta = { ...activeChunk.metadata };
    delete updatedMeta[key];
    handleFieldChange('metadata', updatedMeta);
    if (editingMetaKey === key) {
      setEditingMetaKey(null);
      setEditingMetaVal('');
    }
  };

  // Start inline editing metadata tag value
  const handleStartEditMetaTag = (key: string, val: any) => {
    setEditingMetaKey(key);
    setEditingMetaVal(String(val ?? ''));
  };

  // Save inline edited metadata tag value
  const handleSaveEditMetaTag = () => {
    if (!activeChunk || !editingMetaKey) return;
    const currentMeta = activeChunk.metadata || {};
    const updatedMeta = {
      ...currentMeta,
      [editingMetaKey]: editingMetaVal.trim(),
    };
    handleFieldChange('metadata', updatedMeta);
    setMetaNotice(`'${editingMetaKey}' 태그 값이 수정되었습니다.`);
    setTimeout(() => setMetaNotice(null), 2500);
    setEditingMetaKey(null);
    setEditingMetaVal('');
  };

  // Cancel inline editing
  const handleCancelEditMetaTag = () => {
    setEditingMetaKey(null);
    setEditingMetaVal('');
  };

  // Quick fill input form from existing tag
  const handleFillMetaForm = (key: string, val: any) => {
    setNewMetaKey(key);
    setNewMetaVal(String(val ?? ''));
  };

  // Copy custom metadata (excluding page info)
  const handleCopyMeta = () => {
    if (!activeChunk) return;
    const custom = extractCustomMetadata(activeChunk.metadata);
    if (Object.keys(custom).length === 0) {
      setMetaNotice('복사할 커스텀 메타데이터가 없습니다.');
      setTimeout(() => setMetaNotice(null), 2500);
      return;
    }
    setMetadataClipboard(custom);
    try {
      localStorage.setItem('mineru_copied_meta', JSON.stringify(custom));
    } catch (e) {}
    setMetaNotice(`커스텀 메타데이터 ${Object.keys(custom).length}개가 복사되었습니다.`);
    setTimeout(() => setMetaNotice(null), 2500);
  };

  // Paste custom metadata (safely preserving current chunk's page info)
  const handlePasteMeta = () => {
    if (!activeChunk) return;
    let toPaste = metadataClipboard;
    if (!toPaste) {
      try {
        const stored = localStorage.getItem('mineru_copied_meta');
        if (stored) toPaste = JSON.parse(stored);
      } catch (e) {}
    }
    if (!toPaste || Object.keys(toPaste).length === 0) {
      setMetaNotice('붙여넣을 메타데이터가 없습니다. 먼저 [복사]를 해주세요.');
      setTimeout(() => setMetaNotice(null), 2500);
      return;
    }
    const merged = mergeMetadataWithPage(
      activeChunk.metadata,
      toPaste,
      activeChunk.page_number,
      activeChunk.page_end
    );
    handleFieldChange('metadata', merged);
    setMetaNotice(`메타데이터 ${Object.keys(toPaste).length}개를 붙여넣었습니다. (페이지 번호 유지)`);
    setTimeout(() => setMetaNotice(null), 2500);
  };

  // Candidate sources for metadata import
  const importSources = useMemo(() => {
    if (!activeChunk || childChunks.length === 0) return [];
    const activeId = activeChunk.chunk_id;
    const currentIdx = childChunks.findIndex((c) => c.chunk_id === activeId);
    const sources: Array<{ label: string; subLabel: string; chunk: ChildChunk; count: number }> = [];

    // 1. 직전 청크
    if (currentIdx > 0) {
      const prev = childChunks[currentIdx - 1];
      const prevCustom = extractCustomMetadata(prev.metadata);
      if (Object.keys(prevCustom).length > 0) {
        const rawId = prev.chunk_id || '';
        const shortId = rawId.includes('_c') ? 'C' + rawId.split('_c')[1] : rawId;
        sources.push({
          label: `직전 청크 (${shortId})`,
          subLabel: Object.keys(prevCustom).slice(0, 3).join(', ') + (Object.keys(prevCustom).length > 3 ? '...' : ''),
          chunk: prev,
          count: Object.keys(prevCustom).length,
        });
      }
    }

    // 2. 동일 섹션 첫 청크
    const secFirst = childChunks.find(
      (c) => c.section_id === activeChunk.section_id && c.chunk_id !== activeId
    );
    if (secFirst) {
      const secCustom = extractCustomMetadata(secFirst.metadata);
      if (Object.keys(secCustom).length > 0) {
        const rawId = secFirst.chunk_id || '';
        const shortId = rawId.includes('_c') ? 'C' + rawId.split('_c')[1] : rawId;
        if (!sources.some((s) => s.chunk.chunk_id === secFirst.chunk_id)) {
          sources.push({
            label: `동일 섹션 청크 (${shortId})`,
            subLabel: Object.keys(secCustom).slice(0, 3).join(', ') + (Object.keys(secCustom).length > 3 ? '...' : ''),
            chunk: secFirst,
            count: Object.keys(secCustom).length,
          });
        }
      }
    }

    // 3. 문서 첫 청크 (대표 메타데이터)
    if (childChunks.length > 0) {
      const docFirst = childChunks[0];
      if (docFirst.chunk_id !== activeId) {
        const docCustom = extractCustomMetadata(docFirst.metadata);
        if (Object.keys(docCustom).length > 0 && !sources.some((s) => s.chunk.chunk_id === docFirst.chunk_id)) {
          sources.push({
            label: `문서 첫 청크 (대표 메타)`,
            subLabel: Object.keys(docCustom).slice(0, 3).join(', ') + (Object.keys(docCustom).length > 3 ? '...' : ''),
            chunk: docFirst,
            count: Object.keys(docCustom).length,
          });
        }
      }
    }

    return sources;
  }, [activeChunk, childChunks]);

  // Import custom metadata from another chunk
  const handleImportFromSource = (sourceChunk: ChildChunk) => {
    if (!activeChunk) return;
    const custom = extractCustomMetadata(sourceChunk.metadata);
    if (Object.keys(custom).length === 0) {
      setMetaNotice('해당 청크에 가져올 커스텀 메타데이터가 없습니다.');
      setTimeout(() => setMetaNotice(null), 2500);
      setIsImportMenuOpen(false);
      return;
    }
    const merged = mergeMetadataWithPage(
      activeChunk.metadata,
      custom,
      activeChunk.page_number,
      activeChunk.page_end
    );
    handleFieldChange('metadata', merged);
    setIsImportMenuOpen(false);
    setMetaNotice(`메타데이터 ${Object.keys(custom).length}개를 가져왔습니다. (페이지 번호 유지)`);
    setTimeout(() => setMetaNotice(null), 2500);
  };

  // Existing custom metadata keys across entire document
  const existingDocCustomKeys = useMemo(
    () => getAllCustomMetadataKeys(childChunks),
    [childChunks]
  );

  // Quick propagate single tag to all document chunks
  const handleQuickApplyToAll = (key: string, val: any) => {
    if (!onBulkUpdateMetadata) return;
    if (
      window.confirm(
        `'${key}: ${val}' 메타데이터를 문서 전체 청크(${childChunks.length}개)에 일괄 적용하시겠습니까?`
      )
    ) {
      onBulkUpdateMetadata({
        mode: 'add_tag',
        key,
        value: val,
        scope: 'all',
        overwrite: true,
      });
    }
  };

  // Active section name for breadcrumb/filter
  const activeParent = activeChunk ? parentMap.get(activeChunk.section_id || activeChunk.parent_id || '') : null;
  const filterParent = selectedSectionId ? parentMap.get(selectedSectionId) : null;

  // Real-time character & token count
  const isTableChunk = activeChunk?.chunk_type === 'table' || Boolean(activeChunk?.is_atomic_table);
  const activeCharCount = activeChunk?.text?.length || 0;
  const activeWordCount = activeChunk?.token_estimate || 0;
  const isOverTokenLimit = !isTableChunk && activeWordCount > 512;
  const isUnderTokenLimit = !isTableChunk && activeWordCount > 0 && activeWordCount < 20;

  // AI Refinement State (Studio Focus Editor)
  const [isStudioRefining, setIsStudioRefining] = useState(false);
  const [refineError, setRefineError] = useState<{ chunkId: string; message: string } | null>(null);
  // 청크 ID별 AI 교정 결과 맵 (특정 청크 교정 후 다른 미교정 청크 선택 시 Diff 보기 버튼이 잘못 노출되는 현상 방지)
  const [studioDiffDataByChunk, setStudioDiffDataByChunk] = useState<Record<string, LLMRefineResponse>>({});
  const [openDiffChunkId, setOpenDiffChunkId] = useState<string | null>(null);

  // 현재 활성 청크의 교정 Diff 데이터 (교정 이력이 있는 경우에만 유효)
  const studioDiffData = activeChunk ? studioDiffDataByChunk[activeChunk.chunk_id] || null : null;
  // 활성 청크의 Diff 모달 열림 여부
  const isStudioDiffOpen = Boolean(activeChunk && openDiffChunkId === activeChunk.chunk_id && studioDiffData);
  // 활성 청크의 에러 메시지
  const studioRefineError = activeChunk && refineError?.chunkId === activeChunk.chunk_id ? refineError.message : null;

  const handleStudioRunAiRefine = async () => {
    if (!activeChunk) return;
    const currentChunkId = activeChunk.chunk_id;
    const targetText = editorTab === 'raw_html' ? (activeChunk.raw_html || '') : (activeChunk.text || '');
    if (!targetText.trim()) {
      setRefineError({ chunkId: currentChunkId, message: '교정할 본문 텍스트가 비어 있습니다.' });
      return;
    }
    setIsStudioRefining(true);
    setRefineError(null);
    try {
      const res = await refineChunkText(targetText);
      setStudioDiffDataByChunk((prev) => ({
        ...prev,
        [currentChunkId]: res,
      }));
      setOpenDiffChunkId(currentChunkId);
    } catch (err: any) {
      setRefineError({ chunkId: currentChunkId, message: err.message || 'AI 교정 중 오류가 발생했습니다.' });
    } finally {
      setIsStudioRefining(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-100/70 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden transition-colors">
      {/* Mobile/Tablet Responsive Tab Bar (< lg) */}
      <div className="lg:hidden flex items-center border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-2 shrink-0 gap-1.5 select-none shadow-2xs">
        <button
          type="button"
          onClick={() => setMobileTab('tree')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            mobileTab === 'tree'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Network className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">1. 계층구조</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('list')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            mobileTab === 'list'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">2. 목록 ({filteredChunks.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('editor')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            mobileTab === 'editor'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Edit2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">3. 에디터 {activeChunk ? `(${formatDisplayChunkId(activeChunk.chunk_id)})` : ''}</span>
        </button>
      </div>

      {/* Studio Workspace 3-Column Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800 min-h-0 overflow-hidden">
        
        {/* ======================================================== */}
        {/* COLUMN 1: 문서 위계 구조 (Hierarchy Tree Panel)         */}
        {/* ======================================================== */}
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
                  secParents.forEach((p) => {
                    (p.child_chunk_ids || []).forEach((cid) => assignedChildIds.add(cid));
                  });
                  const unassignedChildren = sectionChildren.filter(
                    (c) =>
                      !assignedChildIds.has(c.chunk_id) &&
                      (!c.parent_chunk_id || c.parent_chunk_id === 'unassigned')
                  );

                  return (
                    <div className="space-y-1 mt-0.5">
                      {secParents.map((parent, parentIdx) => {
                        const pid = parent.parent_chunk_id || parent.id || '';
                        const isFirstParent = parentIdx === 0;
                        const isLastParent = parentIdx === secParents.length - 1;
                        const pExpanded = isParentExpanded(pid);
                        const pChildren =
                          childChunksByParent.get(pid) ||
                          sectionChildren.filter(
                            (c) => (c.parent_chunk_id || c.parent_id) === pid
                          );
                        const hasPChildren = pChildren.length > 0;
                        const shortPid = formatDisplayParentId(pid);
                        const isParentActive = activeParentChunk?.parent_chunk_id === pid;

                        return (
                          <div key={pid} className="space-y-0.5">
                            {/* Level 2: Parent Chunk Node */}
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectParentChunkFromTree(sec.id, pid);
                              }}
                              className={`group/parent py-1 px-1.5 rounded-md cursor-pointer flex items-center justify-between text-[11px] transition select-none ${
                                isParentActive
                                  ? 'bg-purple-100/90 dark:bg-purple-950/70 text-purple-950 dark:text-purple-200 font-semibold border border-purple-300 dark:border-purple-800 shadow-2xs'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-purple-50/70 dark:hover:bg-purple-950/40 hover:text-purple-950 dark:hover:text-purple-200'
                              }`}
                              title={`[${pid}] ${parent.title || ''}\n토큰: ${parent.token_estimate || 0}T | 자식 청크: ${pChildren.length}개\n${parent.text?.slice(0, 100) || ''}...`}
                            >
                              <div className="flex items-center gap-1.5 truncate min-w-0 pr-1">
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
                                {pChildren.map((chunk) => renderChildChunkItem(sec.id, chunk))}
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
                            {unassignedChildren.map((chunk) => renderChildChunkItem(sec.id, chunk))}
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
                      {sectionChildren.map((chunk) => renderChildChunkItem(sec.id, chunk))}
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
                  ? rawChildSecs.filter((s) => matchedSectionIdSet.has(s.id))
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

                return (
                  <div key={sec.id} className="space-y-0.5">
                    {/* Section Header Row */}
                    <div
                      onClick={() => {
                        if (!isEditingThis) {
                          onSelectSection(sec.id);
                          setManualExpandedState((prev) => ({ ...prev, [sec.id]: true }));
                          setMobileTab('list');
                        }
                      }}
                      onDoubleClick={(e) => startEditSection(sec, e)}
                      className={`group py-1.5 px-2 rounded-lg cursor-pointer flex items-center justify-between transition border-l-3 select-none ${
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
                                  const siblingSecs = parentSections.filter((s) => {
                                    if (s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')) return false;
                                    return (s.parent_section_id || '') === (sec.parent_section_id || '');
                                  });
                                  const sIdx = siblingSecs.findIndex((s) => s.id === sec.id);
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
                                  const rootSec = parentSections.find(
                                    (s) => s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')
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
                                  const siblingSecs = parentSections.filter((s) => {
                                    if (s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')) return false;
                                    return (s.parent_section_id || '') === (sec.parent_section_id || '');
                                  });
                                  const sIdx = siblingSecs.findIndex((s) => s.id === sec.id);
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
                        {childSecs.map((childSec) => renderSectionNode(childSec, depth + 1, nextVisited))}

                        {/* 2. Direct Chunks in this Section */}
                        {renderSectionChunks(sec)}
                      </div>
                    )}
                  </div>
                );
              };

              return visibleTopLevelSections.map((sec) => renderSectionNode(sec, 0));
            })()}
          </div>
        </section>

        {/* ======================================================== */}
        {/* COLUMN 2: 청크 타임라인 목록 (Chunk Timeline List)      */}
        {/* ======================================================== */}
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
              visibleGroups.map((group) => {
                const parent = group.parent;
                const pid = parent.parent_chunk_id || parent.id || '';
                const pWords = parent.token_estimate || 0;
                const isParentOver = pWords > 2048;
                const parentSec = parentMap.get(parent.section_id);
                const secPids = parentSec?.parent_chunk_ids && parentSec.parent_chunk_ids.length > 0
                  ? parentSec.parent_chunk_ids
                  : (parentChunksBySection.get(parent.section_id) || []).map((p) => p.parent_chunk_id || p.id || '');
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

                        {/* Fast Section Reassign Dropdown */}
                        <div
                          className="flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-0.5 shadow-2xs"
                          title="이 Parent 및 소속 Child 청크의 상위 섹션 빠른 재지정"
                        >
                          <FolderTree className="w-3 h-3 text-indigo-600 dark:text-indigo-400 shrink-0" />
                          <select
                            value={parent.section_id}
                            onChange={(e) => {
                              const newSecId = e.target.value;
                              if (onReassignParentSection && newSecId !== parent.section_id) {
                                onReassignParentSection(pid, newSecId);
                              }
                            }}
                            className="text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-transparent focus:outline-hidden cursor-pointer max-w-[130px] truncate"
                          >
                            {parentSections.map((sec) => (
                              <option key={sec.id} value={sec.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                                {sec.title} (L{sec.level})
                              </option>
                            ))}
                          </select>
                        </div>

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
                        group.children.map((chunk) => {
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

                        return (
                          <div
                            key={chunk.chunk_id}
                            id={`chunk-card-${chunk.chunk_id}`}
                            onClick={() => {
                              setSelectedChunkId(chunk.chunk_id);
                              setMobileTab('editor');
                            }}
                            className={`p-3 rounded-xl border transition-all cursor-pointer select-none text-xs relative ${
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
                    onClick={() => setDisplayLimit((prev) => prev + 50)}
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

        {/* ======================================================== */}
        {/* COLUMN 3: 포커스 에디터 패널 (Focus Editor Panel)       */}
        {/* ======================================================== */}
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
                      activeChunk.breadcrumbs.map((b, idx) => (
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
                            : (parentChunksBySection.get(activeParentChunk.section_id) || []).map((p) => p.parent_chunk_id || p.id || '');
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

                  {/* (3) Parent 단위 Section 재할당 드롭다운 */}
                  <div className="flex items-center gap-2 pt-1 border-t border-indigo-100/80 dark:border-indigo-900/50">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                      <FolderTree className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <span>Parent 소속 섹션 변경:</span>
                    </label>
                    <select
                      value={activeChunk.section_id || activeChunk.parent_id}
                      onChange={(e) => {
                        const newSecId = e.target.value;
                        const pid = activeChunk.parent_chunk_id || activeChunk.parent_id;
                        if (onReassignParentSection && pid) {
                          onReassignParentSection(pid, newSecId);
                        } else {
                          handleFieldChange('parent_id', newSecId);
                        }
                      }}
                      className="flex-1 min-w-0 text-xs font-medium bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 truncate cursor-pointer shadow-2xs"
                      title="소속된 상위 Parent 청크 전체의 섹션을 변경합니다."
                    >
                      {parentSections.map((sec) => (
                        <option key={sec.id} value={sec.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                          {sec.title} (L{sec.level})
                        </option>
                      ))}
                    </select>
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
                                  onClick={() => handleOpenTableEditor(activeChunk, 0, activeChunk.raw_html, activeTableList[0]?.caption, activeTableList[0]?.footnote)}
                                  className="text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 cursor-pointer transition shadow-2xs"
                                  title="표 셀 편집 및 가로/세로 셀 병합 창 열기"
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

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">표 제목 (Caption)</label>
                                <input
                                  type="text"
                                  value={activeTableList[0]?.caption || ''}
                                  onChange={(e) => handleTableItemFieldChange(0, 'caption', e.target.value)}
                                  placeholder="예: [표 1] 세부기준"
                                  className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">표 각주 (Footnote)</label>
                                <input
                                  type="text"
                                  value={activeTableList[0]?.footnote || ''}
                                  onChange={(e) => handleTableItemFieldChange(0, 'footnote', e.target.value)}
                                  placeholder="예: ※ 기준치 초과 시 재검사"
                                  className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                                />
                              </div>
                            </div>

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
                                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                                  수정 시 상위 메타 자동 반영
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
                                        title="표 셀 편집 및 가로/세로 셀 병합 창 열기"
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
                                    <div>
                                      <label className="block text-[10px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                                        표 {idx + 1} 제목 (Caption)
                                      </label>
                                      <input
                                        type="text"
                                        value={tbl.caption || ''}
                                        onChange={(e) => handleCompositeTableFieldChange(idx, 'caption', e.target.value)}
                                        placeholder={`예: [표 ${idx + 1}] 세부 내역`}
                                        className="w-full text-xs bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1 text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-900 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden transition"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-medium text-slate-600 dark:text-slate-400 mb-0.5">
                                        표 {idx + 1} 각주 (Footnote)
                                      </label>
                                      <input
                                        type="text"
                                        value={tbl.footnote || ''}
                                        onChange={(e) => handleCompositeTableFieldChange(idx, 'footnote', e.target.value)}
                                        placeholder="예: ※ 기준치 초과 시 재검사"
                                        className="w-full text-xs bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1 text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-900 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden transition"
                                      />
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
                  ) : (activeChunk.chunk_type === 'table' || activeChunk.chunk_type === 'composite' || Boolean(activeChunk.raw_html)) && editorTab === 'raw_html' ? (
                    <textarea
                      value={
                        activeChunk.raw_html ||
                        (activeChunk.chunk_type === 'composite' || Boolean((activeChunk.tables || activeChunk.metadata?.tables || []).length && activeChunk.chunk_type !== 'table')
                          ? reconstructCompositeHtml(activeChunk)
                          : '')
                      }
                      onChange={(e) => handleFieldChange('raw_html', e.target.value)}
                      rows={11}
                      className="w-full font-mono text-xs p-3.5 bg-slate-900 text-emerald-400 rounded-xl border border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y"
                      placeholder="<table>...</table>"
                    />
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
                            {importSources.map((s, idx) => (
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
                    const docTitle = activeChunk.metadata?.doc_title;
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
                                className="bg-white dark:bg-slate-900 border border-indigo-400 dark:border-indigo-600 rounded px-1.5 py-0.5 text-xs text-slate-900 dark:text-slate-100 font-sans focus:outline-hidden focus:ring-1 focus:ring-indigo-500 w-32"
                              />
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
                      <>
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="text"
                            value={newMetaKey}
                            onChange={(e) => setNewMetaKey(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddMetaTag();
                            }}
                            placeholder="Key (예: category)"
                            className="w-1/3 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                          />
                          <input
                            type="text"
                            value={newMetaVal}
                            onChange={(e) => setNewMetaVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddMetaTag();
                            }}
                            placeholder="Value (예: safety_rules)"
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
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 pt-0.5">
                          ※ doc_title, page, table(표) 관련 속성은 시스템이 본문과 동기화하여 자동 관리하므로 커스텀 태그로 등록할 수 없습니다.
                        </div>
                      </>
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
      </div>

      {/* Chunk Split Modal */}
      {isSplitModalOpen && activeChunk && onSplitChunk && (
        <ChunkSplitModal
          chunk={activeChunk}
          onClose={() => setIsSplitModalOpen(false)}
          onConfirmSplit={(id, p1, p2, page1, page2) => {
            onSplitChunk(id, p1, p2, page1, page2);
            setIsSplitModalOpen(false);
          }}
        />
      )}

      {/* Chunk Merge Modal */}
      {isMergeModalOpen && selectedChunksList.length >= 2 && onMergeChunks && (
        <ChunkMergeModal
          selectedChunks={selectedChunksList}
          parentSections={parentSections}
          onClose={() => setIsMergeModalOpen(false)}
          onConfirmMerge={(ids, text, newId, pageStart, pageEnd) => {
            onMergeChunks(ids, text, newId, pageStart, pageEnd);
            clearSelectedChunks();
            setIsMergeModalOpen(false);
          }}
        />
      )}

      {/* Add Section Modal */}
      {onAddSection && (
        <AddSectionModal
          isOpen={isAddSectionModalOpen}
          onClose={() => setIsAddSectionModalOpen(false)}
          parentSections={parentSections}
          onAddSection={onAddSection}
        />
      )}

      {/* Add Parent Modal */}
      {onAddParent && (
        <AddParentModal
          isOpen={isAddParentModalOpen}
          onClose={() => setIsAddParentModalOpen(false)}
          sections={parentSections}
          parentChunks={parentChunks}
          childChunks={childChunks}
          defaultSectionId={targetSectionIdForAddParent || selectedSectionId}
          onAddParent={onAddParent}
        />
      )}

      {/* Add Child Modal */}
      {onAddChild && (
        <AddChildModal
          isOpen={isAddChildModalOpen}
          onClose={() => {
            setIsAddChildModalOpen(false);
            setTargetParentForAddChild(null);
            setTargetInsertAfterChunkId(undefined);
          }}
          parentChunk={targetParentForAddChild}
          parentChildren={
            targetParentForAddChild
              ? childChunks.filter(
                  (c) =>
                    (c.parent_chunk_id || c.parent_id) ===
                    (targetParentForAddChild.parent_chunk_id || targetParentForAddChild.id)
                )
              : []
          }
          initialInsertAfterChunkId={targetInsertAfterChunkId}
          sectionTitle={
            targetParentForAddChild
              ? parentMap.get(targetParentForAddChild.section_id)?.title
              : undefined
          }
          onAddChild={onAddChild}
        />
      )}

      {/* Edit Parent Modal */}
      {onUpdateParent && (
        <EditParentModal
          isOpen={isEditParentModalOpen}
          onClose={() => {
            setIsEditParentModalOpen(false);
            setTargetParentForEdit(null);
          }}
          parentChunk={targetParentForEdit}
          sections={parentSections}
          onUpdateParent={onUpdateParent}
          onDeleteParent={onDeleteParent}
        />
      )}

      {/* AI Refine Diff View Modal for Studio */}
      <RefineDiffModal
        isOpen={isStudioDiffOpen}
        diffData={studioDiffData}
        onClose={() => setOpenDiffChunkId(null)}
        onApply={(refined) => {
          if (editorTab === 'raw_html') {
            handleFieldChange('raw_html', refined);
          } else {
            handleFieldChange('text', refined);
          }
        }}
      />

      {/* Bulk Custom Metadata Modal */}
      {isBulkMetaModalOpen && (
        <BulkMetadataModal
          isOpen={isBulkMetaModalOpen}
          onClose={() => setIsBulkMetaModalOpen(false)}
          totalChunksCount={childChunks.length}
          currentSectionId={selectedSectionId || undefined}
          currentSectionTitle={filterParent?.title || undefined}
          currentSectionChunksCount={
            childChunks.filter(
              (c) => (c.section_id || c.parent_id) === selectedSectionId
            ).length
          }
          activeChunkId={activeChunk?.chunk_id}
          activeChunkMetadata={activeChunk?.metadata}
          existingDocCustomKeys={existingDocCustomKeys}
          onApply={(params) => {
            if (onBulkUpdateMetadata) {
              onBulkUpdateMetadata(params);
            }
          }}
        />
      )}

      {/* Reparent Section (Change Parent / Nesting) Modal */}
      {isReparentModalOpen && reparentModalSection && (
        <ReparentSectionModal
          isOpen={isReparentModalOpen}
          onClose={() => {
            setIsReparentModalOpen(false);
            setReparentModalSection(null);
          }}
          targetSection={reparentModalSection}
          parentSections={parentSections}
          onReparent={(secId, newParentId) => {
            if (onReparentSection) {
              onReparentSection(secId, newParentId);
            }
          }}
        />
      )}

      {/* Reparent Child Chunk Modal */}
      {isReparentChildModalOpen && reparentTargetChunks.length > 0 && (
        <ReparentChildModal
          isOpen={isReparentChildModalOpen}
          onClose={() => {
            setIsReparentChildModalOpen(false);
            setReparentTargetChunks([]);
          }}
          targetChunks={reparentTargetChunks}
          parentSections={parentSections}
          parentChunks={parentChunks || []}
          childChunks={childChunks}
          onReparent={(params) => {
            if (onReparentChildChunk) {
              onReparentChildChunk(params);
            }
          }}
        />
      )}

      {/* Table Editor Modal */}
      {tableEditorTarget && (
        <TableEditorModal
          isOpen={Boolean(tableEditorTarget)}
          onClose={() => setTableEditorTarget(null)}
          initialHtml={tableEditorTarget.initialHtml}
          initialMarkdown={tableEditorTarget.initialMarkdown}
          caption={tableEditorTarget.caption}
          footnote={tableEditorTarget.footnote}
          tableIndex={tableEditorTarget.tableIndex}
          onSave={handleSaveTableEditor}
        />
      )}

      {/* Table Delete Confirmation Dialog */}
      {tableDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 max-w-md w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {tableDeleteConfirm.tableName} 삭제 확인
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {tableDeleteConfirm.isLastTable
                    ? '이 청크의 마지막 표입니다. 삭제 시 청크가 일반 문단(paragraph)으로 자동 전환됩니다.'
                    : '이 표를 청크에서 제거하고 남은 표들의 순서를 재정렬합니다.'}
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1">
              <div className="font-semibold text-slate-700 dark:text-slate-300">삭제 시 수행되는 작업:</div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                <li>청크 내 표 메타데이터 및 원형 HTML에서 해당 표 제거</li>
                <li>RAG 임베딩 본문 텍스트에서 해당 표 마크다운 블록 제거</li>
                {tableDeleteConfirm.isLastTable && (
                  <li className="text-rose-600 dark:text-rose-400 font-semibold">
                    청크 타입을 일반 문단(paragraph)으로 안전하게 강등
                  </li>
                )}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTableDeleteConfirm(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTable}
                className="px-4 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer shadow-xs transition"
              >
                삭제 실행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

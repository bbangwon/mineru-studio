import React, { useState, useMemo, useEffect } from 'react';
import {
  Network,
  Layers,
  Table2,
  AlignLeft,
  Scale,
  Edit2,
  GripVertical,
} from 'lucide-react';
import type {
  ChildChunk,
  ParentSection,
  ParentChunk,
  LLMRefineResponse,
  SectionInsertPosition,
  ReparentChildChunkParams,
  AddChildData,
  DragItemPayload,
  DropTargetInfo,
  DropPosition,
} from '../types';
import { ChunkEditorPane } from './chunk-studio/ChunkEditorPane';
import { HierarchyPane } from './chunk-studio/HierarchyPane';
import { ChunkListPane } from './chunk-studio/ChunkListPane';
import { ChunkStudioProvider } from './chunk-studio/ChunkStudioContext';
import { ChunkStudioModals } from './chunk-studio/ChunkStudioModals';
import {
  deleteTableFromChunk,
  addTableToChunk,
  updateTableInChunk,
  type TableGrid,
} from '../utils/tableChunkUtils';
import {
  extractCustomMetadata,
  mergeMetadataWithPage,
  getAllCustomMetadataKeys,
  RESERVED_METADATA_KEYS,
  reconstructCompositeHtml,
  parseCustomMetaValue,
} from '../utils/pageUtils';
import {
  estimateKoreanTokens,
  formatDisplayChunkId,
} from '../utils/idUtils';
import {
  getChunkKind,
  hasTableData,
} from '../utils/chunkKindUtils';
import { refineChunkText } from '../api/client';

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
    valueType?: 'text' | 'array';
    mergeStrategy?: 'overwrite' | 'append' | 'skip';
    tags?: Record<string, any>;
    scope: 'all' | 'section';
    sectionId?: string;
    overwrite?: boolean;
  }) => void;
  onReorderSections?: (sourceSectionId: string, targetSectionId: string, position: 'before' | 'after') => void;
  onReparentSectionTo?: (sourceSectionId: string, targetParentSectionId: string | null) => void;
  onReorderParents?: (sourceParentId: string, targetParentId: string, position: 'before' | 'after') => void;
  onMoveParentToSection?: (sourceParentId: string, targetSectionId: string, targetParentId?: string, position?: 'before' | 'after') => void;
  onReorderChildren?: (sourceChildId: string, targetChildId: string, position: 'before' | 'after') => void;
  onMoveChildToParent?: (sourceChildId: string, targetParentId: string, targetChildId?: string, position?: 'before' | 'after') => void;
  docTitle?: string;
  isLoading: boolean;
}

export const ChunkStudio: React.FC<ChunkStudioProps> = ({
  parentSections,
  childChunks,
  parentChunks,
  selectedSectionId,
  docTitle: docTitleProp,
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
  onReorderSections,
  onReparentSectionTo,
  onReorderParents,
  onMoveParentToSection,
  onReorderChildren,
  onMoveChildToParent,
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

  // Reassign Parent Section Modal State (Tree Picker)
  const [reassignSectionTargetParent, setReassignSectionTargetParent] = useState<ParentChunk | null>(null);
  const [isReassignParentSectionModalOpen, setIsReassignParentSectionModalOpen] = useState(false);

  const handleOpenReassignParentSectionModal = (parent: ParentChunk, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setReassignSectionTargetParent(parent);
    setIsReassignParentSectionModalOpen(true);
  };

  const [isEditParentModalOpen, setIsEditParentModalOpen] = useState(false);
  const [targetParentForEdit, setTargetParentForEdit] = useState<ParentChunk | null>(null);

  // Bulk Metadata Modal State
  const [isBulkMetaModalOpen, setIsBulkMetaModalOpen] = useState(false);

  // Drag & Drop State
  const [draggedItem, setDraggedItem] = useState<DragItemPayload | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DropTargetInfo | null>(null);

  // Quick Reparent to Section Modal State (Child -> Section 드롭 시 팝업)
  const [quickReparentModal, setQuickReparentModal] = useState<{
    isOpen: boolean;
    childChunk: ChildChunk | null;
    targetSection: ParentSection | null;
  }>({
    isOpen: false,
    childChunk: null,
    targetSection: null,
  });

  // DnD Helper: Calculate drop position based on mouse Y offset within target element
  const calculateDropPosition = (
    e: React.DragEvent<HTMLElement>,
    allowInside: boolean
  ): DropPosition => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;
    if (allowInside) {
      if (relY < 0.25) return 'before';
      if (relY > 0.75) return 'after';
      return 'inside';
    }
    return relY < 0.5 ? 'before' : 'after';
  };

  // DnD: Section Node Drop Handler
  const handleSectionDrop = (
    e: React.DragEvent<HTMLElement>,
    targetSec: ParentSection,
    position: DropPosition
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;

    if (draggedItem.type === 'section') {
      if (draggedItem.id === targetSec.id) return;
      if (position === 'inside') {
        onReparentSectionTo?.(draggedItem.id, targetSec.id);
      } else {
        onReorderSections?.(draggedItem.id, targetSec.id, position);
      }
    } else if (draggedItem.type === 'parent') {
      onMoveParentToSection?.(draggedItem.id, targetSec.id);
    } else if (draggedItem.type === 'child') {
      const childObj = childChunks.find((c) => c.chunk_id === draggedItem.id);
      if (childObj) {
        setQuickReparentModal({
          isOpen: true,
          childChunk: childObj,
          targetSection: targetSec,
        });
      }
    }

    setDraggedItem(null);
    setDragOverTarget(null);
  };

  // DnD: Parent Node Drop Handler
  const handleParentDrop = (
    e: React.DragEvent<HTMLElement>,
    targetParent: ParentChunk,
    position: DropPosition
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem) return;

    const targetPid = targetParent.parent_chunk_id || targetParent.id || '';

    if (draggedItem.type === 'parent') {
      if (draggedItem.id === targetPid) return;
      onReorderParents?.(draggedItem.id, targetPid, position === 'inside' ? 'after' : position);
    } else if (draggedItem.type === 'child') {
      onMoveChildToParent?.(draggedItem.id, targetPid);
    }

    setDraggedItem(null);
    setDragOverTarget(null);
  };

  // DnD: Child Node Drop Handler
  const handleChildDrop = (
    e: React.DragEvent<HTMLElement>,
    targetChild: ChildChunk,
    position: DropPosition
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem || draggedItem.type !== 'child') return;
    if (draggedItem.id === targetChild.chunk_id) return;

    onReorderChildren?.(
      draggedItem.id,
      targetChild.chunk_id,
      position === 'inside' ? 'after' : position
    );

    setDraggedItem(null);
    setDragOverTarget(null);
  };

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
  const [newMetaType, setNewMetaType] = useState<'text' | 'array'>('text');
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
  const [editingMetaType, setEditingMetaType] = useState<'text' | 'array'>('text');

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
    const isTarget = dragOverTarget?.id === chunk.chunk_id;
    const dropIndicatorClass = isTarget
      ? dragOverTarget.position === 'before'
        ? 'border-t-2 border-indigo-500 shadow-xs'
        : 'border-b-2 border-indigo-500 shadow-xs'
      : '';

    return (
      <div
        key={chunk.chunk_id}
        onClick={(e) => {
          e.stopPropagation();
          handleSelectChildChunkFromTree(secId, chunk.chunk_id);
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
        className={`group/child py-1 px-2 rounded-md cursor-pointer flex items-center justify-between text-[11px] transition select-none ${dropIndicatorClass} ${
          isChildSelected
            ? 'bg-indigo-600 text-white font-medium shadow-2xs ring-1 ring-indigo-500'
            : isIgnored
            ? 'text-slate-400 dark:text-slate-500 bg-slate-50/60 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-60'
            : 'text-slate-600 dark:text-slate-300 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/60 hover:text-slate-900 dark:hover:text-white'
        }`}
        title={`${chunk.chunk_id} (p.${pageNum})\n${chunk.text?.slice(0, 200) || ''}`}
      >
        <div className="flex items-center gap-1.5 truncate min-w-0 pr-1">
          <span
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDraggedItem({
                type: 'child',
                id: chunk.chunk_id,
                parentId: chunk.parent_chunk_id || chunk.parent_id,
                sectionId: secId,
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
            className="cursor-grab active:cursor-grabbing text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 -ml-1 mr-0.5 p-0.5 opacity-0 group-hover/child:opacity-100 transition rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
            title="드래그하여 같은 Parent 내 순서 변경 또는 다른 Parent/Section으로 이동"
          >
            <GripVertical className="w-3 h-3" />
          </span>

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
  // 단독 표(table) 청크가 <p> 태그로 오염된 경우 순수 tables[0].raw_html로 자가 복구
  useEffect(() => {
    if (activeChunk) {
      const kind = getChunkKind(activeChunk);
      if (kind === 'composite') {
        const raw = activeChunk.raw_html || '';
        if (!raw || !/<p\b|<div\b|<span\b/i.test(raw)) {
          const healedRaw = reconstructCompositeHtml(activeChunk);
          if (healedRaw && healedRaw !== raw) {
            onUpdateChunk({ ...activeChunk, raw_html: healedRaw, is_edited: true }, true);
          }
        }
      } else if (kind === 'table') {
        const tables = activeChunk.tables || activeChunk.metadata?.tables || [];
        const cleanHtml = tables[0]?.raw_html;
        const currentRaw = activeChunk.raw_html || '';
        if (cleanHtml && currentRaw && /<p\b|<div\b|<span\b/i.test(currentRaw)) {
          onUpdateChunk({ ...activeChunk, raw_html: cleanHtml, is_edited: true }, true);
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

    // 복합/표 청크인 경우, 본문 텍스트 수정 시 원형 표(colspan/rowspan)를 보존하여 raw_html 자동 실시간 동기화
    if (field === 'text' && hasTableData(activeChunk)) {
      updated.raw_html = reconstructCompositeHtml(
        { ...updated, text: value },
        true
      );
    }

    onUpdateChunk(updated, true);
  };

  // Re-synchronize composite raw_html from text manually
  const handleSyncRawHtmlFromText = () => {
    if (!activeChunk) return;
    const synced = reconstructCompositeHtml(activeChunk, true);
    handleFieldChange('raw_html', synced);
    setMetaNotice('본문 텍스트 내용을 바탕으로 원형 표를 보존한 통합 HTML을 성공적으로 동기화했습니다.');
    setTimeout(() => setMetaNotice(null), 3000);
  };


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
    const parsedVal = parseCustomMetaValue(newMetaVal, newMetaType);

    const updatedMeta = {
      ...currentMeta,
      [trimmedKey]: parsedVal,
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

  // Delete a single tag element from an array value
  const handleDeleteMetaTagElement = (key: string, elementIndex: number) => {
    if (!activeChunk || !activeChunk.metadata) return;
    const currentMeta = activeChunk.metadata;
    const currentVal = currentMeta[key];
    if (!Array.isArray(currentVal)) return;

    const nextArr = currentVal.filter((_, idx) => idx !== elementIndex);
    const updatedMeta = { ...currentMeta };
    if (nextArr.length === 0) {
      delete updatedMeta[key];
      setMetaNotice(`'${key}'의 모든 태그가 삭제되어 키가 제거되었습니다.`);
    } else {
      updatedMeta[key] = nextArr;
      setMetaNotice(`'${key}' 태그가 삭제되었습니다.`);
    }
    setTimeout(() => setMetaNotice(null), 2000);
    handleFieldChange('metadata', updatedMeta);
  };

  // Start inline editing metadata tag value
  const handleStartEditMetaTag = (key: string, val: any) => {
    setEditingMetaKey(key);
    const isArr = Array.isArray(val);
    setEditingMetaType(isArr ? 'array' : 'text');
    setEditingMetaVal(isArr ? val.join(', ') : String(val ?? ''));
  };

  // Save inline edited metadata tag value
  const handleSaveEditMetaTag = () => {
    if (!activeChunk || !editingMetaKey) return;
    const currentMeta = activeChunk.metadata || {};
    const parsedVal = parseCustomMetaValue(editingMetaVal, editingMetaType);

    const updatedMeta = {
      ...currentMeta,
      [editingMetaKey]: parsedVal,
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
    const isArr = Array.isArray(val);
    setNewMetaType(isArr ? 'array' : 'text');
    setNewMetaVal(isArr ? val.join(', ') : String(val ?? ''));
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
    } catch {}
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
      } catch {}
    }
    if (!toPaste || Object.keys(toPaste).length === 0) {
      setMetaNotice('붙여넣을 메타데이터가 없습니다. 먼저 [복사]를 해주세요.');
      setTimeout(() => setMetaNotice(null), 2500);
      return;
    }
    const currentDocTitle = activeChunk.metadata?.doc_title || docTitleProp;
    const merged = mergeMetadataWithPage(
      activeChunk.metadata,
      toPaste,
      activeChunk.page_number,
      activeChunk.page_end,
      currentDocTitle
    );
    handleFieldChange('metadata', merged);
    setMetaNotice(`메타데이터 ${Object.keys(toPaste).length}개를 붙여넣었습니다. (문서/페이지 정보 유지)`);
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
    const currentDocTitle = activeChunk.metadata?.doc_title || docTitleProp;
    const merged = mergeMetadataWithPage(
      activeChunk.metadata,
      custom,
      activeChunk.page_number,
      activeChunk.page_end,
      currentDocTitle
    );
    handleFieldChange('metadata', merged);
    setIsImportMenuOpen(false);
    setMetaNotice(`메타데이터 ${Object.keys(custom).length}개를 가져왔습니다. (문서/페이지 정보 유지)`);
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
    const isArr = Array.isArray(val);
    const displayVal = isArr ? val.join(', ') : String(val);
    if (
      window.confirm(
        `'${key}: ${displayVal}' 메타데이터를 문서 전체 청크(${childChunks.length}개)에 일괄 적용하시겠습니까?`
      )
    ) {
      onBulkUpdateMetadata({
        mode: 'add_tag',
        key,
        value: isArr ? [...val] : val,
        valueType: isArr ? 'array' : 'text',
        mergeStrategy: isArr ? 'append' : 'overwrite',
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

  const studioContextValue = {
    mobileTab,
    setMobileTab,
    isTreeCollapsed,
    setIsTreeCollapsed,
    activeChunk,
    activeParentChunk,
    activeParent,
    docTitle: docTitleProp,
    onSplitChunk,
    onReparentChildChunk,
    onUpdateChunk,
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
    parentSections,
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
    setRefineError,
    setIsBulkMetaModalOpen,
    isAnySectionExpanded,
    collapseAllSections,
    expandAllSections,
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
    childChunksByParent,
    childSectionsMap,
    isParentExpanded,
    toggleExpandParent,
    isSectionExpanded,
    toggleExpandSection,
    dragOverTarget,
    setDragOverTarget,
    draggedItem,
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
    setTargetParentForAddChild,
    setTargetInsertAfterChunkId,
    setIsAddChildModalOpen,
    setReparentModalSection,
    setIsReparentModalOpen,
    setTargetSectionIdForAddParent,
    setIsAddParentModalOpen,
    renderChildChunkItem,
    matchedSectionIdSet,
    setManualExpandedState,
    setDraggedItem,
    onAddParent,
    onAddChild,
    onDeleteParent,
    onReparentSection,
    onDeleteSection,
    filteredChunks,
    activeChunkId,
    setSelectedChunkId,
    filterParent,
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
    handleDeleteSelectedChunks,
    handleOpenReparentSelectedChunks,
    onMergeChunks,
    visibleGroups,
    toggleSelectChunk,
    handleChildDrop,
    onToggleIgnoreChunk,
    displayLimit,
    setDisplayLimit,
    displayedChildCount,
  };

  return (
    <ChunkStudioProvider value={studioContextValue}>
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
        <HierarchyPane />

        {/* ======================================================== */}
        {/* COLUMN 2: 청크 타임라인 목록 (ChunkListPane)            */}
        {/* ======================================================== */}
        <ChunkListPane />

        {/* ======================================================== */}
        {/* COLUMN 3: 포커스 에디터 패널 (ChunkEditorPane)          */}
        {/* ======================================================== */}
        <ChunkEditorPane />
      </div>

      <ChunkStudioModals
        isSplitModalOpen={isSplitModalOpen}
        setIsSplitModalOpen={setIsSplitModalOpen}
        activeChunk={activeChunk}
        onSplitChunk={onSplitChunk}
        isMergeModalOpen={isMergeModalOpen}
        setIsMergeModalOpen={setIsMergeModalOpen}
        selectedChunksList={selectedChunksList}
        parentSections={parentSections}
        onMergeChunks={onMergeChunks}
        clearSelectedChunks={clearSelectedChunks}
        onAddSection={onAddSection}
        isAddSectionModalOpen={isAddSectionModalOpen}
        setIsAddSectionModalOpen={setIsAddSectionModalOpen}
        onAddParent={onAddParent}
        isAddParentModalOpen={isAddParentModalOpen}
        setIsAddParentModalOpen={setIsAddParentModalOpen}
        parentChunks={parentChunks}
        childChunks={childChunks}
        targetSectionIdForAddParent={targetSectionIdForAddParent}
        selectedSectionId={selectedSectionId}
        onAddChild={onAddChild}
        isAddChildModalOpen={isAddChildModalOpen}
        setIsAddChildModalOpen={setIsAddChildModalOpen}
        targetParentForAddChild={targetParentForAddChild}
        setTargetParentForAddChild={setTargetParentForAddChild}
        targetInsertAfterChunkId={targetInsertAfterChunkId}
        setTargetInsertAfterChunkId={setTargetInsertAfterChunkId}
        parentMap={parentMap}
        onUpdateParent={onUpdateParent}
        onDeleteParent={onDeleteParent}
        isEditParentModalOpen={isEditParentModalOpen}
        setIsEditParentModalOpen={setIsEditParentModalOpen}
        targetParentForEdit={targetParentForEdit}
        setTargetParentForEdit={setTargetParentForEdit}
        isStudioDiffOpen={isStudioDiffOpen}
        studioDiffData={studioDiffData}
        setOpenDiffChunkId={setOpenDiffChunkId}
        editorTab={editorTab}
        handleFieldChange={handleFieldChange}
        isBulkMetaModalOpen={isBulkMetaModalOpen}
        setIsBulkMetaModalOpen={setIsBulkMetaModalOpen}
        filterParent={filterParent}
        existingDocCustomKeys={existingDocCustomKeys}
        onBulkUpdateMetadata={onBulkUpdateMetadata}
        isReparentModalOpen={isReparentModalOpen}
        setIsReparentModalOpen={setIsReparentModalOpen}
        reparentModalSection={reparentModalSection}
        setReparentModalSection={setReparentModalSection}
        onReparentSection={onReparentSection}
        isReparentChildModalOpen={isReparentChildModalOpen}
        setIsReparentChildModalOpen={setIsReparentChildModalOpen}
        reparentTargetChunks={reparentTargetChunks}
        setReparentTargetChunks={setReparentTargetChunks}
        onReparentChildChunk={onReparentChildChunk}
        isReassignParentSectionModalOpen={isReassignParentSectionModalOpen}
        setIsReassignParentSectionModalOpen={setIsReassignParentSectionModalOpen}
        reassignSectionTargetParent={reassignSectionTargetParent}
        setReassignSectionTargetParent={setReassignSectionTargetParent}
        onReassignParentSection={onReassignParentSection}
        quickReparentModal={quickReparentModal}
        setQuickReparentModal={setQuickReparentModal}
        tableEditorTarget={tableEditorTarget}
        setTableEditorTarget={setTableEditorTarget}
        handleSaveTableEditor={handleSaveTableEditor}
        tableDeleteConfirm={tableDeleteConfirm}
        setTableDeleteConfirm={setTableDeleteConfirm}
        handleConfirmDeleteTable={handleConfirmDeleteTable}
      />
    </div>
    </ChunkStudioProvider>
  );
};

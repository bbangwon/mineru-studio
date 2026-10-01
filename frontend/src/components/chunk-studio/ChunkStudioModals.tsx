import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type {
  ChildChunk,
  ParentSection,
  ParentChunk,
  LLMRefineResponse,
  SectionInsertPosition,
  ReparentChildChunkParams,
  AddChildData,
} from '../../types';
import { ChunkSplitModal } from '../ChunkSplitModal';
import { ChunkMergeModal } from '../ChunkMergeModal';
import { AddSectionModal } from '../AddSectionModal';
import { AddParentModal } from '../AddParentModal';
import { AddChildModal } from '../AddChildModal';
import { EditParentModal } from '../EditParentModal';
import { BulkMetadataModal } from '../BulkMetadataModal';
import { ReparentSectionModal } from '../ReparentSectionModal';
import { ReparentChildModal } from '../ReparentChildModal';
import { ReassignParentSectionModal } from '../ReassignParentSectionModal';
import { QuickReparentToSectionModal } from '../QuickReparentToSectionModal';
import { TableEditorModal } from '../TableEditorModal';
import { RefineDiffModal } from '../RefineDiffModal';

export interface ChunkStudioModalsProps {
  isSplitModalOpen: boolean;
  setIsSplitModalOpen: (open: boolean) => void;
  activeChunk: ChildChunk | null;
  onSplitChunk?: (
    chunkId: string,
    part1Text: string,
    part2Text: string,
    page1?: number,
    page2?: number
  ) => void;

  isMergeModalOpen: boolean;
  setIsMergeModalOpen: (open: boolean) => void;
  selectedChunksList: ChildChunk[];
  parentSections: ParentSection[];
  onMergeChunks?: (
    chunkIds: string[],
    mergedText: string,
    newChunkId?: string,
    pageStart?: number,
    pageEnd?: number
  ) => void;
  clearSelectedChunks: () => void;

  onAddSection?: (sectionData: {
    title: string;
    parentSectionId?: string;
    level: number;
    insertPosition?: SectionInsertPosition;
  }) => void;
  isAddSectionModalOpen: boolean;
  setIsAddSectionModalOpen: (open: boolean) => void;

  onAddParent?: (data: {
    sectionId: string;
    title: string;
    pageNumber: number;
    initialChildText: string;
    chunkType: 'paragraph' | 'table' | 'article_clause' | 'article';
    inheritMetadata?: boolean;
  }) => void;
  isAddParentModalOpen: boolean;
  setIsAddParentModalOpen: (open: boolean) => void;
  parentChunks?: ParentChunk[];
  childChunks: ChildChunk[];
  targetSectionIdForAddParent?: string | null;
  selectedSectionId: string | null;

  onAddChild?: (data: AddChildData) => void;
  isAddChildModalOpen: boolean;
  setIsAddChildModalOpen: (open: boolean) => void;
  targetParentForAddChild: ParentChunk | null;
  setTargetParentForAddChild: (parent: ParentChunk | null) => void;
  targetInsertAfterChunkId?: string;
  setTargetInsertAfterChunkId: (id?: string) => void;
  parentMap: Map<string, ParentSection>;

  onUpdateParent?: (
    parentChunkId: string,
    updates: { title: string; sectionId: string }
  ) => void;
  onDeleteParent?: (parentChunkId: string) => void;
  isEditParentModalOpen: boolean;
  setIsEditParentModalOpen: (open: boolean) => void;
  targetParentForEdit: ParentChunk | null;
  setTargetParentForEdit: (parent: ParentChunk | null) => void;

  isStudioDiffOpen: boolean;
  studioDiffData: LLMRefineResponse | null;
  setOpenDiffChunkId: (id: string | null) => void;
  editorTab: 'text' | 'raw_html' | 'preview';
  handleFieldChange: (field: keyof ChildChunk, value: any) => void;

  isBulkMetaModalOpen: boolean;
  setIsBulkMetaModalOpen: (open: boolean) => void;
  filterParent?: ParentSection | null;
  existingDocCustomKeys: string[];
  onBulkUpdateMetadata?: (params: {
    mode: 'add_tag' | 'apply_batch' | 'delete_tag';
    key?: string;
    value?: any;
    valueType?: 'text' | 'array';
    mergeStrategy?: any;
    tags?: Record<string, any>;
    scope: 'all' | 'section';
    sectionId?: string;
    overwrite?: boolean;
  }) => void;

  isReparentModalOpen: boolean;
  setIsReparentModalOpen: (open: boolean) => void;
  reparentModalSection: ParentSection | null;
  setReparentModalSection: (section: ParentSection | null) => void;
  onReparentSection?: (sectionId: string, newParentSectionId: string | null) => void;

  isReparentChildModalOpen: boolean;
  setIsReparentChildModalOpen: (open: boolean) => void;
  reparentTargetChunks: ChildChunk[];
  setReparentTargetChunks: (chunks: ChildChunk[]) => void;
  onReparentChildChunk?: (params: ReparentChildChunkParams) => void;

  isReassignParentSectionModalOpen: boolean;
  setIsReassignParentSectionModalOpen: (open: boolean) => void;
  reassignSectionTargetParent: ParentChunk | null;
  setReassignSectionTargetParent: (parent: ParentChunk | null) => void;
  onReassignParentSection?: (parentChunkId: string, newSectionId: string) => void;

  quickReparentModal: {
    isOpen: boolean;
    childChunk: ChildChunk | null;
    targetSection: ParentSection | null;
  };
  setQuickReparentModal: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    childChunk: ChildChunk | null;
    targetSection: ParentSection | null;
  }>>;

  tableEditorTarget: {
    chunk: ChildChunk;
    tableIndex: number;
    initialHtml?: string;
    initialMarkdown?: string;
    caption?: string;
    footnote?: string;
  } | null;
  setTableEditorTarget: (target: any) => void;
  handleSaveTableEditor: (saved: any) => void;

  tableDeleteConfirm: {
    chunk: ChildChunk;
    tableIndex: number;
    tableName: string;
    isLastTable: boolean;
  } | null;
  setTableDeleteConfirm: (target: any) => void;
  handleConfirmDeleteTable: () => void;
}

export function ChunkStudioModals(props: ChunkStudioModalsProps) {
  const {
    isSplitModalOpen,
    setIsSplitModalOpen,
    activeChunk,
    onSplitChunk,

    isMergeModalOpen,
    setIsMergeModalOpen,
    selectedChunksList,
    parentSections,
    onMergeChunks,
    clearSelectedChunks,

    onAddSection,
    isAddSectionModalOpen,
    setIsAddSectionModalOpen,

    onAddParent,
    isAddParentModalOpen,
    setIsAddParentModalOpen,
    parentChunks,
    childChunks,
    targetSectionIdForAddParent,
    selectedSectionId,

    onAddChild,
    isAddChildModalOpen,
    setIsAddChildModalOpen,
    targetParentForAddChild,
    setTargetParentForAddChild,
    targetInsertAfterChunkId,
    setTargetInsertAfterChunkId,
    parentMap,

    onUpdateParent,
    onDeleteParent,
    isEditParentModalOpen,
    setIsEditParentModalOpen,
    targetParentForEdit,
    setTargetParentForEdit,

    isStudioDiffOpen,
    studioDiffData,
    setOpenDiffChunkId,
    editorTab,
    handleFieldChange,

    isBulkMetaModalOpen,
    setIsBulkMetaModalOpen,
    filterParent,
    existingDocCustomKeys,
    onBulkUpdateMetadata,

    isReparentModalOpen,
    setIsReparentModalOpen,
    reparentModalSection,
    setReparentModalSection,
    onReparentSection,

    isReparentChildModalOpen,
    setIsReparentChildModalOpen,
    reparentTargetChunks,
    setReparentTargetChunks,
    onReparentChildChunk,

    isReassignParentSectionModalOpen,
    setIsReassignParentSectionModalOpen,
    reassignSectionTargetParent,
    setReassignSectionTargetParent,
    onReassignParentSection,

    quickReparentModal,
    setQuickReparentModal,

    tableEditorTarget,
    setTableEditorTarget,
    handleSaveTableEditor,

    tableDeleteConfirm,
    setTableDeleteConfirm,
    handleConfirmDeleteTable,
  } = props;

  return (
    <>
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

      {/* Reassign Parent Section (Tree Picker) Modal */}
      {isReassignParentSectionModalOpen && reassignSectionTargetParent && (
        <ReassignParentSectionModal
          isOpen={isReassignParentSectionModalOpen}
          onClose={() => {
            setIsReassignParentSectionModalOpen(false);
            setReassignSectionTargetParent(null);
          }}
          targetParent={reassignSectionTargetParent}
          parentSections={parentSections}
          onReassign={(parentChunkId, newSectionId) => {
            if (onReassignParentSection) {
              onReassignParentSection(parentChunkId, newSectionId);
            }
          }}
        />
      )}

      {/* Quick Reparent to Section Modal (Child -> Section DnD) */}
      {quickReparentModal.isOpen && quickReparentModal.childChunk && quickReparentModal.targetSection && (
        <QuickReparentToSectionModal
          isOpen={quickReparentModal.isOpen}
          onClose={() =>
            setQuickReparentModal({ isOpen: false, childChunk: null, targetSection: null })
          }
          childChunk={quickReparentModal.childChunk}
          targetSection={quickReparentModal.targetSection}
          availableParents={
            (parentChunks || []).filter(
              (p) => p.section_id === quickReparentModal.targetSection?.id
            )
          }
          onConfirm={(params) => {
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
    </>
  );
}

import React, { useState } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  FolderPlus,
  Loader2,
  Inbox,
} from 'lucide-react';
import type { FolderNode } from '../types';

interface FolderTreePaneProps {
  rootNode: FolderNode | null;
  selectedFolder: string | null; // null = 전체 보기 (All), "" = 루트(문서) 직속, "a/b" = 서브폴더
  onSelectFolder: (path: string | null) => void;
  onCreateFolder: (parentPath: string, newFolderName: string) => Promise<void>;
  onDeleteFolder: (folderPath: string) => Promise<void>;
  onDropFiles: (filenames: string[], targetFolder: string) => Promise<void>;
  isLoading?: boolean;
}

export const FolderTreePane: React.FC<FolderTreePaneProps> = ({
  rootNode,
  selectedFolder,
  onSelectFolder,
  onCreateFolder,
  onDeleteFolder,
  onDropFiles,
  isLoading = false,
}) => {
  // 접기/펼치기 상태 관리 (기본적으로 상위는 열림)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['']));
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  // 인라인 새 폴더 생성 상태
  const [creatingParentPath, setCreatingParentPath] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 폴더 삭제 확인 모달/상태
  const [deletingFolder, setDeletingFolder] = useState<FolderNode | null>(null);

  const toggleExpand = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleStartCreate = (parentPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCreatingParentPath(parentPath);
    setNewFolderName('');
    // 부모 폴더 자동 펼치기
    setExpandedPaths((prev) => new Set(prev).add(parentPath));
  };

  const handleCancelCreate = () => {
    setCreatingParentPath(null);
    setNewFolderName('');
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || creatingParentPath === null) return;
    try {
      setIsSubmitting(true);
      await onCreateFolder(creatingParentPath, newFolderName.trim());
      setCreatingParentPath(null);
      setNewFolderName('');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Drag & Drop 처리
  const handleDragOver = (e: React.DragEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverFolder !== path) {
      setDragOverFolder(path);
    }
  };

  const handleDragLeave = (e: React.DragEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragOverFolder === path) {
      setDragOverFolder(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetFolder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);

    try {
      const rawData = e.dataTransfer.getData('application/json');
      if (!rawData) return;
      const parsed = JSON.parse(rawData);
      const filenames: string[] = Array.isArray(parsed.filenames) ? parsed.filenames : [];
      if (filenames.length > 0) {
        await onDropFiles(filenames, targetFolder);
      }
    } catch (err) {
      console.error('Drag drop parse failed:', err);
    }
  };

  // 재귀적 폴더 노드 렌더러
  const renderFolderItem = (node: FolderNode) => {
    const isRoot = node.path === '';
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedFolder === node.path;
    const isDragOver = dragOverFolder === node.path;
    const hasChildren = node.subfolders && node.subfolders.length > 0;
    const isCreatingHere = creatingParentPath === node.path;

    return (
      <div key={node.path || '__root__'} className="select-none text-xs">
        {/* 폴더 행 */}
        <div
          onClick={() => onSelectFolder(node.path)}
          onDragOver={(e) => handleDragOver(e, node.path)}
          onDragLeave={(e) => handleDragLeave(e, node.path)}
          onDrop={(e) => handleDrop(e, node.path)}
          style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
          className={`group flex items-center justify-between py-1.5 pr-2 rounded-xl cursor-pointer transition-all ${
            isDragOver
              ? 'bg-indigo-100 dark:bg-indigo-950/80 ring-2 ring-indigo-500 text-indigo-700 dark:text-indigo-300 font-bold'
              : isSelected
              ? 'bg-indigo-50/90 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold'
              : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
          }`}
          title={`${node.name} (${node.total_doc_count}개 문서)`}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {/* 펼치기/접기 화살표 */}
            <button
              type="button"
              onClick={(e) => toggleExpand(node.path, e)}
              className={`p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors ${
                !hasChildren && !isRoot ? 'invisible' : ''
              }`}
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>

            {/* 폴더 아이콘 */}
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
            )}

            {/* 폴더 이름 */}
            <span className="truncate">{node.name}</span>
          </div>

          {/* 우측 뱃지 및 액션 버튼들 */}
          <div className="flex items-center gap-1 shrink-0 ml-1">
            {/* 문서 수 뱃지 */}
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                isSelected
                  ? 'bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200 font-bold'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              {node.total_doc_count}
            </span>

            {/* 호버 시 노출되는 액션 버튼 (+ 하위 폴더, 삭제) */}
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
              <button
                type="button"
                onClick={(e) => handleStartCreate(node.path, e)}
                className="p-1 rounded-md text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                title={`${node.name} 아래에 하위 폴더 생성`}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>

              {!isRoot && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingFolder(node);
                  }}
                  className="p-1 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                  title="폴더 삭제"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 인라인 신규 서브폴더 생성 폼 */}
        {isCreatingHere && (
          <form
            onSubmit={handleSubmitCreate}
            style={{ paddingLeft: `${(node.depth + 1) * 14 + 8}px` }}
            className="my-1 pr-2 flex items-center gap-1.5"
          >
            <FolderPlus className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="폴더명..."
              disabled={isSubmitting}
              className="flex-1 bg-white dark:bg-slate-900 border border-indigo-400 dark:border-indigo-600 rounded-lg px-2 py-0.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
            />
            <button
              type="submit"
              disabled={isSubmitting || !newFolderName.trim()}
              className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : '확인'}
            </button>
            <button
              type="button"
              onClick={handleCancelCreate}
              disabled={isSubmitting}
              className="px-1.5 py-0.5 text-slate-500 hover:text-slate-800 dark:hover:text-white rounded-lg text-[10px]"
            >
              취소
            </button>
          </form>
        )}

        {/* 자식 서브폴더 목록 렌더링 */}
        {isExpanded && hasChildren && (
          <div className="space-y-0.5">
            {node.subfolders.map((child) => renderFolderItem(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-2xs flex flex-col h-full transition-colors">
      {/* 트리 헤더 */}
      <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-1.5">
          <Folder className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
            폴더 디렉터리
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => handleStartCreate('', e)}
          className="p-1 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
          title="최상위 새 폴더 생성"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>새 폴더</span>
        </button>
      </div>

      {/* 폴더 트리 본체 */}
      <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5 scrollbar-thin">
        {/* 1. 전체 문서 (All) 가상 탭 */}
        <div
          onClick={() => onSelectFolder(null)}
          className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl cursor-pointer text-xs transition-all ${
            selectedFolder === null
              ? 'bg-indigo-600 text-white font-bold shadow-2xs'
              : 'hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300 font-medium'
          }`}
        >
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 shrink-0" />
            <span>전체 문서</span>
          </div>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              selectedFolder === null
                ? 'bg-white/20 text-white font-bold'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
            }`}
          >
            {rootNode?.total_doc_count ?? 0}
          </span>
        </div>

        {/* 2. 최상위 루트 '문서' 및 계층 트리 */}
        {isLoading && !rootNode ? (
          <div className="py-6 flex items-center justify-center text-slate-400 gap-2 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>폴더 로딩 중...</span>
          </div>
        ) : rootNode ? (
          renderFolderItem(rootNode)
        ) : null}
      </div>

      {/* 드래그 앤 드롭 안내 팁 */}
      <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
        <span>💡 문서를 드래그하여 원하는 폴더에 넣거나 뺄 수 있습니다.</span>
      </div>

      {/* 폴더 삭제 확인 모달 */}
      {deletingFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 max-w-sm w-full shadow-xl">
            <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400 font-bold mb-2 text-sm">
              <Trash2 className="w-4 h-4" />
              <span>폴더 삭제 확인</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mb-2 leading-relaxed">
              <span className="font-bold text-slate-900 dark:text-white">'{deletingFolder.name}'</span> 폴더를 삭제하시겠습니까?
            </p>
            {deletingFolder.total_doc_count > 0 && (
              <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 mb-4">
                ⚠️ 폴더 내 <span className="font-bold">{deletingFolder.total_doc_count}개 문서</span>는 유실되지 않고 안전하게 최상위 <strong>'문서'</strong>로 자동 이동됩니다.
              </div>
            )}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setDeletingFolder(null)}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-medium"
              >
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  const path = deletingFolder.path;
                  setDeletingFolder(null);
                  await onDeleteFolder(path);
                }}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-xl shadow-xs"
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

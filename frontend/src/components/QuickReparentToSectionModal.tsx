import React, { useState, useEffect } from 'react';
import { X, Layers, Plus, FolderTree, Check } from 'lucide-react';
import type { ChildChunk, ParentSection, ParentChunk, ReparentChildChunkParams } from '../types';
import { formatDisplayChunkId } from '../utils/idUtils';

interface QuickReparentToSectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  childChunk: ChildChunk | null;
  targetSection: ParentSection | null;
  availableParents: ParentChunk[];
  onConfirm: (params: ReparentChildChunkParams) => void;
}

export const QuickReparentToSectionModal: React.FC<QuickReparentToSectionModalProps> = ({
  isOpen,
  onClose,
  childChunk,
  targetSection,
  availableParents,
  onConfirm,
}) => {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [newParentTitle, setNewParentTitle] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');

  useEffect(() => {
    if (isOpen && childChunk && targetSection) {
      // 제안할 제목 추출 (청크 첫 줄 또는 기본 서브 제목)
      const firstLine = (childChunk.text || '').trim().split('\n')[0].replace(/^#+\s*/, '');
      const defaultTitle = firstLine ? (firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine) : `${targetSection.title} 문맥`;
      setNewParentTitle(defaultTitle);

      if (availableParents.length > 0) {
        setSelectedParentId(availableParents[0].parent_chunk_id || availableParents[0].id || '');
      } else {
        setMode('new');
      }
    }
  }, [isOpen, childChunk, targetSection, availableParents]);

  if (!isOpen || !childChunk || !targetSection) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'new') {
      if (!newParentTitle.trim()) return;
      onConfirm({
        chunkIds: [childChunk.chunk_id],
        targetParentChunkId: null,
        createNewParent: {
          sectionId: targetSection.id,
          title: newParentTitle.trim(),
          insertPosition: { type: 'end' },
        },
      });
    } else {
      if (!selectedParentId) return;
      onConfirm({
        chunkIds: [childChunk.chunk_id],
        targetParentChunkId: selectedParentId,
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900/80">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Child 청크를 섹션으로 이동
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                청크를 배속할 Parent 방식을 선택하세요
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Target Section Info */}
          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-1">
            <div className="text-slate-500 dark:text-slate-400 font-medium">대상 섹션</div>
            <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
              {targetSection.title}
            </div>
            <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-mono">
              이동할 청크: [{formatDisplayChunkId(childChunk.chunk_id)}]
            </div>
          </div>

          {/* Mode Selector */}
          <div className="space-y-2">
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                mode === 'new'
                  ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 dark:border-indigo-500'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <input
                type="radio"
                name="reparentMode"
                checked={mode === 'new'}
                onChange={() => setMode('new')}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  새 Parent 청크 생성 후 배속 (권장)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  이 섹션 아래에 새로운 부모 문맥 단위를 만들어 이 청크를 첫 자식으로 넣습니다.
                </div>
                {mode === 'new' && (
                  <div className="mt-2.5">
                    <input
                      type="text"
                      value={newParentTitle}
                      onChange={(e) => setNewParentTitle(e.target.value)}
                      placeholder="새 Parent 청크 제목 (예: 제1조 목적)"
                      className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            </label>

            {availableParents.length > 0 && (
              <label
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                  mode === 'existing'
                    ? 'border-purple-600 bg-purple-50/50 dark:bg-purple-950/40 dark:border-purple-500'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <input
                  type="radio"
                  name="reparentMode"
                  checked={mode === 'existing'}
                  onChange={() => setMode('existing')}
                  className="mt-0.5 text-purple-600 focus:ring-purple-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    섹션 내 기존 Parent 청크에 추가
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    이미 존재하는 {availableParents.length}개 Parent 중 하나를 선택합니다.
                  </div>
                  {mode === 'existing' && (
                    <div className="mt-2.5">
                      <select
                        value={selectedParentId}
                        onChange={(e) => setSelectedParentId(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-purple-500 focus:outline-hidden"
                      >
                        {availableParents.map((p) => {
                          const pid = p.parent_chunk_id || p.id || '';
                          return (
                            <option key={pid} value={pid}>
                              [{pid}] {p.title || p.text?.slice(0, 30) || '무제 부모'}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                </div>
              </label>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>확인 및 이동</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { X, Edit3, FolderTree, AlertCircle, Trash2 } from 'lucide-react';
import type { ParentChunk, SectionNode } from '../types';
import { CopyableBadge } from './CopyableBadge';

interface EditParentModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentChunk: ParentChunk | null;
  sections: SectionNode[];
  onUpdateParent: (
    parentChunkId: string,
    updates: { title: string; sectionId: string }
  ) => void;
  onDeleteParent?: (parentChunkId: string) => void;
}

export const EditParentModal: React.FC<EditParentModalProps> = ({
  isOpen,
  onClose,
  parentChunk,
  sections,
  onUpdateParent,
  onDeleteParent,
}) => {
  const [title, setTitle] = useState<string>('');
  const [sectionId, setSectionId] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (isOpen && parentChunk) {
      setTitle(parentChunk.title || '');
      setSectionId(parentChunk.section_id || '');
      setError('');
    }
  }, [isOpen, parentChunk]);

  if (!isOpen || !parentChunk) return null;

  const pid = parentChunk.parent_chunk_id || parentChunk.id || '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('부모 청크 제목을 입력해주세요.');
      return;
    }
    if (!sectionId) {
      setError('소속될 섹션을 선택해주세요.');
      return;
    }

    onUpdateParent(pid, {
      title: trimmedTitle,
      sectionId,
    });
    onClose();
  };

  const handleDelete = () => {
    if (!onDeleteParent) return;
    const childCount = parentChunk.child_chunk_ids?.length || 0;
    const confirmed = window.confirm(
      `정말로 '${parentChunk.title || pid}' 부모 청크를 삭제하시겠습니까?\n소속된 ${childCount}개의 자식 청크도 함께 삭제됩니다.`
    );
    if (confirmed) {
      onDeleteParent(pid);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Parent(부모 청크) 수정</h3>
              <div className="mt-0.5">
                <CopyableBadge
                  id={pid}
                  type="parent"
                  prefix="ID: "
                  titlePrefix="전체 Parent ID"
                  className="text-xs text-slate-500 hover:text-indigo-600 px-1 py-0.2 rounded hover:bg-slate-100"
                />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">
              부모 문맥 제목 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError('');
              }}
              placeholder="예: 제3조 (용어의 정의)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 font-medium"
              autoFocus
            />
          </div>

          {/* Target Section */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5 text-indigo-600" />
              소속 섹션 변경
            </label>
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-medium cursor-pointer"
            >
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.breadcrumbs && sec.breadcrumbs.length > 0
                    ? sec.breadcrumbs.join(' > ')
                    : sec.title} (L{sec.level})
                </option>
              ))}
            </select>
          </div>

          {/* Metadata summary */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-slate-600 font-mono text-[11px]">
            <div className="flex justify-between">
              <span>소속 자식 청크:</span>
              <strong className="text-slate-900">{parentChunk.child_chunk_ids?.length || 0}개</strong>
            </div>
            <div className="flex justify-between">
              <span>추정 토큰 수:</span>
              <strong className="text-slate-900">~{parentChunk.token_estimate || 0} tok</strong>
            </div>
            <div className="flex justify-between">
              <span>페이지 범위:</span>
              <strong className="text-slate-900">
                p.{parentChunk.page_range?.[0] || 1}{parentChunk.page_range?.[1] && parentChunk.page_range[1] > (parentChunk.page_range[0] || 1) ? `~${parentChunk.page_range[1]}` : ''}
              </strong>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex items-center justify-between border-t border-slate-100">
            {onDeleteParent ? (
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer flex items-center gap-1"
                title="Parent 청크 및 소속 자식 청크 삭제"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>삭제</span>
              </button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition cursor-pointer"
              >
                변경 저장
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

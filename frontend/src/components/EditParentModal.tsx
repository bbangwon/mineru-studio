import React, { useState, useEffect, useMemo } from 'react';
import { X, Edit3, FolderTree, AlertCircle, Trash2, Sparkles, Loader2, RefreshCw, FileText } from 'lucide-react';
import type { ParentChunk, SectionNode } from '../types';
import { CopyableBadge } from './CopyableBadge';
import { summarizeChunkText } from '../api/client';

interface EditParentModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentChunk: ParentChunk | null;
  sections: SectionNode[];
  onUpdateParent: (
    parentChunkId: string,
    updates: { title?: string; sectionId?: string; summary?: string }
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
  const [summary, setSummary] = useState<string>('');
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [summarizeError, setSummarizeError] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (isOpen && parentChunk) {
      setTitle(parentChunk.title || '');
      setSectionId(parentChunk.section_id || '');
      setSummary(parentChunk.summary || '');
      setIsSummarizing(false);
      setSummarizeError('');
      setError('');
    }
  }, [isOpen, parentChunk]);

  const tokenEstimate = parentChunk?.token_estimate || 0;

  const adaptiveGuide = useMemo(() => {
    if (tokenEstimate <= 512) {
      return {
        label: '소형 문맥 (~512 tok)',
        detail: '권장: 2~3문장 (약 150자)',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    } else if (tokenEstimate <= 1500) {
      return {
        label: '표준 부모 문맥 (~1,500 tok)',
        detail: '권장: 3~5문장 (약 280자)',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
      };
    } else if (tokenEstimate <= 2500) {
      return {
        label: '대형 부모 문맥 (~2,500 tok)',
        detail: '권장: 5~7문장 (약 450자)',
        badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      };
    } else {
      return {
        label: '초대형 부모 문맥 (2,500+ tok)',
        detail: '권장: 7~10문장 (약 650자, 단락 분리)',
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
      };
    }
  }, [tokenEstimate]);

  if (!isOpen || !parentChunk) return null;

  const pid = parentChunk.parent_chunk_id || parentChunk.id || '';

  const handleRunAiSummary = async () => {
    const targetText = parentChunk.text || '';
    if (!targetText.trim()) {
      setSummarizeError('부모 청크 본문 텍스트가 비어 있습니다.');
      return;
    }

    setIsSummarizing(true);
    setSummarizeError('');
    try {
      const res = await summarizeChunkText(targetText, undefined, true);
      setSummary(res.summary_text);
    } catch (err: any) {
      setSummarizeError(err.message || 'AI 부모 요약 생성에 실패했습니다.');
    } finally {
      setIsSummarizing(false);
    }
  };

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
      summary: summary,
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
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Parent(부모 청크) 수정 & AI 요약</h3>
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
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
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

          {/* Metadata summary & Token Guide */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-slate-600 font-mono text-[11px]">
            <div className="flex justify-between items-center">
              <span>소속 자식 청크:</span>
              <strong className="text-slate-900 font-semibold">{parentChunk.child_chunk_ids?.length || 0}개</strong>
            </div>
            <div className="flex justify-between items-center">
              <span>추정 토큰 수:</span>
              <div className="flex items-center gap-1.5">
                <strong className={tokenEstimate > 2048 ? 'text-amber-600 font-bold' : 'text-slate-900 font-semibold'}>
                  ~{tokenEstimate} tok
                </strong>
                <span className={`text-[10px] px-1.5 py-0.2 rounded border font-sans font-medium ${adaptiveGuide.badgeClass}`}>
                  {adaptiveGuide.label}
                </span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span>페이지 범위:</span>
              <strong className="text-slate-900 font-semibold">
                p.{parentChunk.page_range?.[0] || 1}{parentChunk.page_range?.[1] && parentChunk.page_range[1] > (parentChunk.page_range[0] || 1) ? `~${parentChunk.page_range[1]}` : ''}
              </strong>
            </div>
          </div>

          {/* Parent AI Summary Section */}
          <div className="p-3.5 bg-purple-50/50 rounded-xl border border-purple-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span className="text-xs font-bold text-purple-900">
                  부모 핵심 요약 (Parent Summary)
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 font-semibold">
                  {(summary || '').length}자
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleRunAiSummary}
                  disabled={isSummarizing}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-2xs flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                  title="로컬 LLM을 호출하여 부모 문맥 전체를 집약 요약합니다"
                >
                  {isSummarizing ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>요약 중...</span>
                    </>
                  ) : summary ? (
                    <>
                      <RefreshCw className="w-3 h-3" />
                      <span>재요약</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 text-pink-200" />
                      <span>✨ AI 요약 생성</span>
                    </>
                  )}
                </button>
                {summary && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('부모 청크 요약을 삭제하시겠습니까?')) {
                        setSummary('');
                      }
                    }}
                    className="text-[10px] font-semibold px-1.5 py-1 rounded bg-white hover:bg-rose-50 text-rose-600 border border-purple-200 flex items-center gap-0.5 cursor-pointer transition"
                    title="요약 삭제"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    <span>삭제</span>
                  </button>
                )}
              </div>
            </div>

            {/* Token-based Length Guide Banner */}
            <div className="flex items-center justify-between text-[11px] text-purple-700 bg-purple-100/60 px-2 py-1 rounded-lg">
              <span className="font-medium flex items-center gap-1">
                <FileText className="w-3 h-3 text-purple-500" />
                <span>토큰 맞춤 권장 분량:</span>
              </span>
              <span className="font-bold">{adaptiveGuide.detail}</span>
            </div>

            {summarizeError && (
              <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center justify-between">
                <span>{summarizeError}</span>
                <button
                  type="button"
                  onClick={() => setSummarizeError('')}
                  className="text-rose-400 hover:text-rose-600 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              className="w-full text-xs p-2.5 bg-white rounded-lg border border-purple-200 focus:outline-hidden focus:ring-2 focus:ring-purple-500 leading-relaxed text-slate-800 resize-y font-sans shadow-2xs placeholder-purple-300"
              placeholder="부모 청크의 핵심 요약문이 여기에 표시됩니다... (AI 생성 또는 직접 입력 가능)"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-3 flex items-center justify-between border-t border-slate-100 shrink-0">
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

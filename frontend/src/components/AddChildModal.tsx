import React, { useState, useEffect } from 'react';
import { X, Plus, HelpCircle, FileText, BookOpen, AlertCircle } from 'lucide-react';
import type { ParentChunk } from '../types';
import { CopyableBadge } from './CopyableBadge';

interface AddChildModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentChunk: ParentChunk | null;
  sectionTitle?: string;
  onAddChild: (data: {
    parentChunkId: string;
    text: string;
    chunkType: 'paragraph' | 'table' | 'article_clause' | 'article';
    pageNumber: number;
    pageEnd?: number;
    rawHtml?: string;
  }) => void;
}

export const AddChildModal: React.FC<AddChildModalProps> = ({
  isOpen,
  onClose,
  parentChunk,
  sectionTitle,
  onAddChild,
}) => {
  const [text, setText] = useState<string>('');
  const [chunkType, setChunkType] = useState<'paragraph' | 'article' | 'article_clause' | 'table'>('paragraph');
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageEnd, setPageEnd] = useState<string>('');
  const [rawHtml, setRawHtml] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (isOpen && parentChunk) {
      setText('');
      setChunkType('paragraph');
      const startPage = parentChunk.page_range?.[0] || 1;
      const endP = parentChunk.page_range?.[1];
      setPageNumber(startPage);
      setPageEnd(endP && endP > startPage ? String(endP) : '');
      setRawHtml('');
      setError('');
    }
  }, [isOpen, parentChunk]);

  if (!isOpen || !parentChunk) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText) {
      setError('자식 청크 본문 내용을 입력해주세요.');
      return;
    }
    if (pageNumber < 1) {
      setError('시작 페이지 번호는 1 이상이어야 합니다.');
      return;
    }

    const endPageNum = pageEnd ? parseInt(pageEnd, 10) : undefined;
    if (endPageNum && endPageNum < pageNumber) {
      setError('끝 페이지는 시작 페이지보다 크거나 같아야 합니다.');
      return;
    }

    const pid = parentChunk.parent_chunk_id || parentChunk.id || '';
    onAddChild({
      parentChunkId: pid,
      text: trimmedText,
      chunkType,
      pageNumber,
      pageEnd: endPageNum && endPageNum >= pageNumber ? endPageNum : undefined,
      rawHtml: chunkType === 'table' && rawHtml.trim() ? rawHtml.trim() : undefined,
    });

    onClose();
  };

  const pid = parentChunk.parent_chunk_id || parentChunk.id || '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-indigo-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">새 Child(자식 청크) 추가</h3>
              <p className="text-xs text-slate-500">
                선택한 Parent 문맥 아래에 검색용 단위 청크를 추가합니다.
              </p>
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

          {/* Target Parent Info Banner */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-500 text-[11px]">대상 부모:</span>
                <CopyableBadge
                  id={pid}
                  type="parent"
                  titlePrefix="전체 Parent ID"
                  className="font-mono text-indigo-700 font-bold bg-white px-1.5 py-0.5 rounded border border-indigo-200 shrink-0"
                />
                <span className="font-bold text-slate-800">
                  {parentChunk.title || '제목 없음'}
                </span>
              </div>
              {sectionTitle && (
                <p className="text-[11px] text-slate-400 truncate max-w-sm">
                  소속 섹션: {sectionTitle}
                </p>
              )}
            </div>
            <span className="text-[11px] font-mono text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">
              현재 자식: {parentChunk.child_chunk_ids?.length || 0}개
            </span>
          </div>

          {/* Chunk Type Selector */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">청크 유형</label>
            <div className="flex items-center gap-2">
              {[
                { id: 'paragraph', label: '일반 문단' },
                { id: 'article', label: '조항/규정' },
                { id: 'table', label: '표/테이블' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setChunkType(t.id as any)}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                    chunkType === t.id
                      ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Page Range */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700 flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 text-slate-500" />
              페이지 번호 (시작 ~ 끝)
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  min="1"
                  value={pageNumber}
                  onChange={(e) => setPageNumber(parseInt(e.target.value, 10) || 1)}
                  placeholder="시작 페이지"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 font-mono font-medium"
                />
              </div>
              <span className="text-slate-400 font-bold">~</span>
              <div className="flex-1">
                <input
                  type="number"
                  min={pageNumber}
                  value={pageEnd}
                  onChange={(e) => setPageEnd(e.target.value)}
                  placeholder="끝 페이지 (선택)"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 font-mono font-medium"
                />
              </div>
            </div>
          </div>

          {/* Child Chunk Text */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-slate-700 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                청크 내용 (검색 및 임베딩 텍스트) <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] text-slate-400 font-mono">
                {text.length}자
              </span>
            </div>
            <textarea
              rows={5}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError('');
              }}
              placeholder="추가할 자식 청크의 본문 내용을 입력하세요..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 placeholder-slate-400 font-sans leading-relaxed text-xs resize-y"
              autoFocus
            />
          </div>

          {/* Raw HTML for Table */}
          {chunkType === 'table' && (
            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-700">
                표 원형 HTML (선택사항)
              </label>
              <textarea
                rows={3}
                value={rawHtml}
                onChange={(e) => setRawHtml(e.target.value)}
                placeholder="<table>...</table> 태그 형태의 원본 HTML이 있다면 입력하세요."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 placeholder-slate-400 font-mono text-[11px] resize-y"
              />
            </div>
          )}

          <p className="text-[11px] text-slate-400 flex items-center gap-1">
            <HelpCircle className="w-3 h-3 shrink-0" />
            자식 청크가 추가되면 상위 Parent의 문맥 텍스트와 누적 토큰 수가 자동으로 재계산됩니다.
          </p>

          {/* Action Buttons */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Child 추가</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

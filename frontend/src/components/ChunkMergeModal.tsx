import React, { useState, useEffect, useMemo } from 'react';
import {
  Merge,
  X,
  Check,
  AlertTriangle,
  Info,
  Layers,
  ArrowDown,
  Table2,
  Scale,
  AlignLeft,
} from 'lucide-react';
import type { ChildChunk, ParentSection } from '../types';
import { estimateKoreanTokens } from '../utils/idUtils';
import { mergeChunkAssets } from '../utils/tableChunkUtils';
import { CopyableBadge } from './CopyableBadge';

interface ChunkMergeModalProps {
  selectedChunks: ChildChunk[];
  parentSections: ParentSection[];
  onClose: () => void;
  onConfirmMerge: (
    chunkIds: string[],
    mergedText: string,
    customChunkId?: string,
    pageStart?: number,
    pageEnd?: number
  ) => void;
}

export const ChunkMergeModal: React.FC<ChunkMergeModalProps> = ({
  selectedChunks,
  parentSections,
  onClose,
  onConfirmMerge,
}) => {
  const [separator, setSeparator] = useState<string>('\n\n');
  const [mergedText, setMergedText] = useState<string>('');
  const [customChunkId, setCustomChunkId] = useState<string>('');

  const minPageCalculated = useMemo(() => {
    if (selectedChunks.length === 0) return 1;
    return Math.min(...selectedChunks.map((c) => c.page_number || 1));
  }, [selectedChunks]);

  const maxPageCalculated = useMemo(() => {
    if (selectedChunks.length === 0) return 1;
    return Math.max(...selectedChunks.map((c) => (c as any).page_end || c.page_number || 1));
  }, [selectedChunks]);

  const [pageStart, setPageStart] = useState<number>(minPageCalculated);
  const [pageEnd, setPageEnd] = useState<number | ''>(
    maxPageCalculated > minPageCalculated ? maxPageCalculated : ''
  );

  const countWords = (text: string) => {
    return estimateKoreanTokens(text);
  };

  const parentMap = useMemo(
    () => new Map(parentSections.map((p) => [p.id, p])),
    [parentSections]
  );

  const firstChunk = selectedChunks[0];
  const defaultMergedId = firstChunk?.chunk_id || '';

  // Synchronize combined text when selected chunks change
  useEffect(() => {
    if (selectedChunks.length === 0) return;
    const combined = selectedChunks
      .map((c) => (c.text || '').trim())
      .filter(Boolean)
      .join(separator);
    setMergedText(combined);
    setCustomChunkId(defaultMergedId);
    setPageStart(minPageCalculated);
    setPageEnd(maxPageCalculated > minPageCalculated ? maxPageCalculated : '');
  }, [selectedChunks, separator, defaultMergedId, minPageCalculated, maxPageCalculated]);

  if (selectedChunks.length < 2) return null;

  const totalWords = countWords(mergedText);
  const totalChars = mergedText.length;
  const isOverLimit = totalWords > 512;
  const isUnderLimit = totalWords < 20;

  const pageDisplay = pageEnd && pageEnd > pageStart ? `p.${pageStart}~p.${pageEnd}` : `p.${pageStart}`;

  const primaryParent = firstChunk ? parentMap.get(firstChunk.section_id || firstChunk.parent_id || '') : null;

  // 병합 후 예상 타입 및 표 자산 계산
  const expectedAssets = useMemo(() => mergeChunkAssets(selectedChunks), [selectedChunks]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergedText.trim()) return;
    const chunkIds = selectedChunks.map((c) => c.chunk_id);
    const finalStart = Math.max(1, pageStart);
    const finalEnd = typeof pageEnd === 'number' && pageEnd > finalStart ? pageEnd : undefined;
    onConfirmMerge(
      chunkIds,
      mergedText.trim(),
      customChunkId.trim() || defaultMergedId,
      finalStart,
      finalEnd
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-100 text-indigo-800 rounded-xl">
              <Merge className="w-5 h-5 text-indigo-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">청크 병합 (Merge Chunks)</h3>
                <span className="font-mono text-xs font-bold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-md">
                  {selectedChunks.length}개 청크 선택됨
                </span>
                {expectedAssets.chunk_type === 'composite' ? (
                  <span className="text-xs font-bold px-2 py-0.5 bg-purple-100 text-purple-800 rounded-md flex items-center gap-1 border border-purple-200">
                    <Layers className="w-3 h-3 text-purple-600" />
                    병합 후: 복합 청크 (문단+표 결합)
                  </span>
                ) : (
                  <span className="text-xs font-bold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md flex items-center gap-1">
                    <AlignLeft className="w-3 h-3 text-slate-500" />
                    병합 후: 일반 문단
                  </span>
                )}
                <span className="text-xs text-slate-400 font-mono">{pageDisplay}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {expectedAssets.chunk_type === 'composite'
                  ? '문단과 표가 결합되어 복합 청크로 승격되며, 표 원형 HTML과 메타데이터가 보존됩니다.'
                  : '선택한 인접 청크들을 하나의 청크로 결합하고 텍스트 및 토큰 수를 합산합니다.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition cursor-pointer"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Selected Chunks Sequence */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 shrink-0">
          <label className="text-[11px] font-bold text-slate-600 block mb-1.5 flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>병합 대상 청크 순서 (원문 등장 순):</span>
          </label>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {selectedChunks.map((c, idx) => (
              <React.Fragment key={c.chunk_id}>
                <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1 shrink-0 shadow-2xs font-mono">
                  {c.chunk_type === 'table' ? (
                    <Table2 className="w-3 h-3 text-indigo-600" />
                  ) : c.chunk_type === 'article' ? (
                    <Scale className="w-3 h-3 text-purple-600" />
                  ) : (
                    <AlignLeft className="w-3 h-3 text-slate-400" />
                  )}
                  <CopyableBadge
                    id={c.chunk_id}
                    type="chunk"
                    titlePrefix="전체 청크 ID"
                    className="font-semibold text-slate-800"
                  />
                  <span className="text-[10px] text-slate-400">~{c.token_estimate || countWords(c.text)}w</span>
                </div>
                {idx < selectedChunks.length - 1 && (
                  <ArrowDown className="w-3 h-3 text-slate-400 -rotate-90 shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Merge Settings Row */}
        <div className="px-5 py-3 bg-indigo-50/30 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Separator selection */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">텍스트 연결 구분자:</span>
            <div className="flex items-center bg-white border border-slate-300 rounded-lg p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => setSeparator('\n\n')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                  separator === '\n\n'
                    ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                줄바꿈 2번 (`\n\n`)
              </button>
              <button
                type="button"
                onClick={() => setSeparator('\n')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                  separator === '\n'
                    ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                줄바꿈 1번 (`\n`)
              </button>
              <button
                type="button"
                onClick={() => setSeparator(' ')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                  separator === ' '
                    ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                공백 1칸 (` `)
              </button>
            </div>
          </div>

          {/* New Chunk ID */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">신규 청크 ID:</span>
            <input
              type="text"
              value={customChunkId}
              onChange={(e) => setCustomChunkId(e.target.value)}
              placeholder={defaultMergedId}
              className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 font-mono text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 w-44"
            />
          </div>

          {/* Page Range */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">페이지 범위:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                value={pageStart}
                onChange={(e) => setPageStart(parseInt(e.target.value, 10) || 1)}
                className="w-16 bg-white border border-slate-300 rounded-lg px-2 py-1 font-mono text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                title="시작 페이지"
              />
              <span className="text-slate-400 font-bold">~</span>
              <input
                type="number"
                min={pageStart}
                value={pageEnd}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  setPageEnd(val ? parseInt(val, 10) : '');
                }}
                placeholder="끝"
                className="w-16 bg-white border border-slate-300 rounded-lg px-2 py-1 font-mono text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                title="끝 페이지 (선택)"
              />
            </div>
          </div>
        </div>

        {/* Merged Content Editor */}
        <div className="flex-1 p-5 overflow-y-auto space-y-3">
          {/* Quality & Token Banner */}
          <div className="flex items-center justify-between text-xs bg-slate-100 p-2.5 rounded-xl border border-slate-200 font-mono">
            <div className="flex items-center gap-3">
              <span>
                병합 후 추정 토큰: <strong className="text-indigo-600 font-semibold">~{totalWords}</strong> tokens
              </span>
              <span>
                글자 수: <strong className="text-slate-800 font-semibold">{totalChars}</strong>자
              </span>
              <span className="text-slate-500">
                소속 섹션: <strong className="text-slate-700">{primaryParent?.title || firstChunk?.parent_id}</strong>
              </span>
            </div>

            {isOverLimit ? (
              <span className="text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-sans text-[11px] flex items-center gap-1 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                512 토큰 초과 (분할 권장)
              </span>
            ) : isUnderLimit ? (
              <span className="text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded font-sans text-[11px] flex items-center gap-1 font-medium">
                <Info className="w-3.5 h-3.5 text-sky-600" />
                20 토큰 미만 (병합 권장)
              </span>
            ) : (
              <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-sans text-[11px] flex items-center gap-1 font-medium">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                임베딩 최적 크기
              </span>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-slate-800 block mb-1">
              병합 청크 텍스트 편집 및 검토
            </label>
            <textarea
              value={mergedText}
              onChange={(e) => setMergedText(e.target.value)}
              rows={12}
              className="w-full p-3.5 text-xs bg-white rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed text-slate-800 font-sans shadow-2xs resize-y"
              placeholder="병합된 텍스트를 입력하세요..."
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Info className="w-4 h-4 text-indigo-500 shrink-0" />
            <span>선택된 기존 {selectedChunks.length}개 청크는 단일 병합 청크로 통합 대체됩니다.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/70 rounded-xl transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!mergedText.trim()}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
            >
              <Merge className="w-4 h-4" />
              <span>병합 실행</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

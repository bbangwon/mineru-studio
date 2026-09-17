import React, { useState, useEffect, useMemo } from 'react';
import {
  Scissors,
  X,
  Check,
  AlertTriangle,
  Info,
  Sparkles,
  Split,
  RotateCcw,
  Table2,
  AlignLeft,
  Layers,
  ShieldCheck,
  Scale,
} from 'lucide-react';
import type { ChildChunk } from '../types';
import { estimateKoreanTokens } from '../utils/idUtils';
import { CopyableBadge } from './CopyableBadge';
import {
  hasMarkdownTable,
  isInsideTable,
  findNearestTableBoundary,
  findBlockSeparationIndex,
  deriveChunkTypeAndTables,
} from '../utils/tableChunkUtils';
import { getChunkKind, getChunkKindLabel, hasTableData } from '../utils/chunkKindUtils';

interface ChunkSplitModalProps {
  chunk: ChildChunk | null;
  onClose: () => void;
  onConfirmSplit: (
    chunkId: string,
    part1Text: string,
    part2Text: string,
    page1?: number,
    page2?: number
  ) => void;
}

export const ChunkSplitModal: React.FC<ChunkSplitModalProps> = ({
  chunk,
  onClose,
  onConfirmSplit,
}) => {
  const [part1, setPart1] = useState('');
  const [part2, setPart2] = useState('');
  const [page1, setPage1] = useState<number>(chunk?.page_number || 1);
  const [page2, setPage2] = useState<number>(chunk?.page_end || chunk?.page_number || 1);

  // Helper: Calculate Korean-aware token estimate
  const countWords = (text: string) => {
    return estimateKoreanTokens(text);
  };

  const fullOriginalText = chunk?.text || '';
  const hasTable = useMemo(() => {
    if (!chunk) return false;
    return hasTableData(chunk) || hasMarkdownTable(fullOriginalText);
  }, [chunk, fullOriginalText]);

  // Preset: Split at delimiter closest to text midpoint (with Table Guard)
  const splitAtDelimiter = (fullText: string, delimiter: string) => {
    if (!fullText) return;
    const parts = fullText.split(delimiter);
    if (parts.length <= 1) return;

    const midChar = fullText.length / 2;
    let bestIndex = 1;
    let minDiff = Infinity;
    let accumulated = 0;

    for (let i = 0; i < parts.length - 1; i++) {
      accumulated += parts[i].length + delimiter.length;
      const diff = Math.abs(accumulated - midChar);
      if (diff < minDiff) {
        minDiff = diff;
        bestIndex = i + 1;
      }
    }

    let p1 = parts.slice(0, bestIndex).join(delimiter).trim();
    let p2 = parts.slice(bestIndex).join(delimiter).trim();

    // Table Guard: 만약 분할 지점이 표 내부라면 안전 경계로 스냅
    if (hasTable && isInsideTable(p1.length, fullText)) {
      const safeIndex = findNearestTableBoundary(p1.length, fullText);
      p1 = fullText.slice(0, safeIndex).trim();
      p2 = fullText.slice(safeIndex).trim();
    }

    setPart1(p1);
    setPart2(p2);
  };

  // Preset: 50:50 character split at word boundary (with Table Guard)
  const splitAtMidpoint = (fullText: string) => {
    if (!fullText) return;
    const mid = Math.floor(fullText.length / 2);
    const leftSpace = fullText.lastIndexOf(' ', mid);
    const rightSpace = fullText.indexOf(' ', mid);

    let splitIndex = mid;
    if (leftSpace !== -1 && rightSpace !== -1) {
      splitIndex = mid - leftSpace < rightSpace - mid ? leftSpace : rightSpace;
    } else if (leftSpace !== -1) {
      splitIndex = leftSpace;
    } else if (rightSpace !== -1) {
      splitIndex = rightSpace;
    }

    // Table Guard: 만약 50:50 지점이 표 내부라면 표 경계로 스냅
    if (hasTable && isInsideTable(splitIndex, fullText)) {
      splitIndex = findNearestTableBoundary(splitIndex, fullText);
    }

    setPart1(fullText.slice(0, splitIndex).trim());
    setPart2(fullText.slice(splitIndex).trim());
  };

  // Preset: 문단 ↔ 표 블록 단위 분리 (복합 청크 전용)
  const splitAtBlockBoundary = (fullText: string) => {
    if (!fullText) return;
    const splitIndex = findBlockSeparationIndex(fullText);
    if (splitIndex !== null && splitIndex > 0 && splitIndex < fullText.length) {
      setPart1(fullText.slice(0, splitIndex).trim());
      setPart2(fullText.slice(splitIndex).trim());
    } else {
      splitAtDelimiter(fullText, '\n\n');
    }
  };

  // Initialize split values whenever chunk opens
  useEffect(() => {
    if (!chunk) return;
    const fullText = chunk.text || '';
    setPage1(chunk.page_number || 1);
    setPage2(chunk.page_end || chunk.page_number || 1);

    // 복합 청크거나 표가 포함된 경우 블록 단위 분리를 우선 시도
    if (hasMarkdownTable(fullText) || chunk.chunk_type === 'composite') {
      const blockIdx = findBlockSeparationIndex(fullText);
      if (blockIdx !== null && blockIdx > 0 && blockIdx < fullText.length) {
        setPart1(fullText.slice(0, blockIdx).trim());
        setPart2(fullText.slice(blockIdx).trim());
        return;
      }
    }

    if (fullText.includes('\n\n')) {
      splitAtDelimiter(fullText, '\n\n');
    } else if (fullText.includes('\n')) {
      splitAtDelimiter(fullText, '\n');
    } else if (fullText.includes('. ')) {
      splitAtDelimiter(fullText, '. ');
    } else {
      splitAtMidpoint(fullText);
    }
  }, [chunk]);

  if (!chunk) return null;

  const originalWords = chunk.token_estimate || countWords(chunk.text);
  const part1Words = countWords(part1);
  const part2Words = countWords(part2);

  const isPart1Valid = part1.trim().length > 0;
  const isPart2Valid = part2.trim().length > 0;
  const canSplit = isPart1Valid && isPart2Valid;

  // 실시간 표 침범(절단) 감지:
  // part1 끝자락 또는 part2 시작부에서 마크다운 표가 불완전하게 잘렸는지 검사
  const isTableCutting = useMemo(() => {
    if (!hasTable) return false;
    // fullOriginalText 상에서 part1과 일치하는 오프셋 찾기
    const cutPos = part1.length;
    return isInsideTable(cutPos, fullOriginalText);
  }, [hasTable, part1, fullOriginalText]);

  // 안전 스냅 핸들러
  const handleSnapToTableBoundary = () => {
    if (!fullOriginalText) return;
    const safeIndex = findNearestTableBoundary(part1.length, fullOriginalText);
    setPart1(fullOriginalText.slice(0, safeIndex).trim());
    setPart2(fullOriginalText.slice(safeIndex).trim());
  };

  // 실시간 예상 청크 타입 파생
  const p1Asset = useMemo(() => deriveChunkTypeAndTables(part1, chunk), [part1, chunk]);
  const p2Asset = useMemo(() => deriveChunkTypeAndTables(part2, chunk), [part2, chunk]);

  const chunkId1 = chunk.chunk_id;
  const chunkId2 = `${chunk.chunk_id} + 신규 번호`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSplit) return;
    onConfirmSplit(chunk.chunk_id, part1.trim(), part2.trim(), Math.max(1, page1), Math.max(1, page2));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
              <Scissors className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">청크 분할 (Split Chunk)</h3>
                <CopyableBadge
                  id={chunk.chunk_id}
                  type="chunk"
                  titlePrefix="전체 청크 ID"
                  className="text-xs font-bold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md border border-slate-300 shrink-0"
                />
                {(() => {
                  const kind = getChunkKind(chunk);
                  if (kind === 'composite') {
                    return (
                      <span className="text-[11px] font-bold px-2 py-0.5 bg-purple-100 text-purple-800 rounded-md flex items-center gap-1">
                        <Layers className="w-3 h-3 text-purple-600" />
                        복합 청크 (문단+표)
                      </span>
                    );
                  }
                  if (kind === 'table') {
                    return (
                      <span className="text-[11px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md flex items-center gap-1">
                        <Table2 className="w-3 h-3 text-emerald-600" />
                        표 청크
                      </span>
                    );
                  }
                  if (kind === 'article') {
                    return (
                      <span className="text-[11px] font-bold px-2 py-0.5 bg-purple-100 text-purple-800 rounded-md flex items-center gap-1">
                        <Scale className="w-3 h-3 text-purple-600" />
                        조문 청크
                      </span>
                    );
                  }
                  return null;
                })()}
                <span className="text-xs text-slate-400 font-mono">
                  {chunk.page_end && chunk.page_end > chunk.page_number
                    ? `p.${chunk.page_number}~p.${chunk.page_end}`
                    : `p.${chunk.page_number}`}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                토큰 한도를 초과하거나 긴 청크를 2개의 독립 청크로 분리합니다. (청크 1: 기존 ID 유지, 청크 2: 다음 순번 채번)
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

        {/* Preset Split Toolbar */}
        <div className="px-5 py-3 bg-indigo-50/40 border-b border-indigo-100/70 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-700 flex-wrap">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="font-semibold text-slate-800">자동 분할 프리셋:</span>

            {/* 표 또는 복합 청크인 경우: 블록 분리 프리셋 최우선 노출 */}
            {hasTable && (
              <button
                type="button"
                onClick={() => splitAtBlockBoundary(fullOriginalText)}
                className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-md shadow-2xs text-xs transition flex items-center gap-1 cursor-pointer"
                title="문단과 표 블록 경계로 안전하게 분할"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>문단 ↔ 표 블록 분리</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => splitAtDelimiter(chunk.text || '', '\n\n')}
              className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-700 font-medium rounded-md border border-indigo-200 text-xs transition cursor-pointer"
            >
              문단 기준 (`\n\n`)
            </button>
            <button
              type="button"
              onClick={() => splitAtDelimiter(chunk.text || '', '\n')}
              className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-700 font-medium rounded-md border border-indigo-200 text-xs transition cursor-pointer"
            >
              줄바꿈 기준 (`\n`)
            </button>
            <button
              type="button"
              onClick={() => splitAtDelimiter(chunk.text || '', '. ')}
              className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-700 font-medium rounded-md border border-indigo-200 text-xs transition cursor-pointer"
            >
              문장 기준 (`. `)
            </button>
            <button
              type="button"
              onClick={() => splitAtMidpoint(chunk.text || '')}
              className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-700 font-medium rounded-md border border-indigo-200 text-xs transition cursor-pointer"
            >
              50:50 균등 분할
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (hasTable) {
                splitAtBlockBoundary(fullOriginalText);
              } else if (fullOriginalText.includes('\n\n')) {
                splitAtDelimiter(fullOriginalText, '\n\n');
              } else {
                splitAtMidpoint(fullOriginalText);
              }
            }}
            className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
            title="초기 분할 위치로 리셋"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>초기화</span>
          </button>
        </div>

        {/* Table Guard Alert Banner */}
        {isTableCutting && (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3 shrink-0 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>표 내부 절단 감지:</strong> 표의 행이나 열 중간이 절단되었습니다. 이대로 분할하면 표 구조가 깨져 RAG 임베딩 및 검색 품질이 저하될 수 있습니다.
              </span>
            </div>
            <button
              type="button"
              onClick={handleSnapToTableBoundary}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-md shrink-0 shadow-2xs transition flex items-center gap-1 cursor-pointer"
              title="가장 가까운 표 시작 또는 끝 경계로 이동"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>표 경계로 안전 스냅</span>
            </button>
          </div>
        )}

        {/* Split Content Comparison: 2 Columns */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {/* Status info bar */}
          <div className="flex items-center justify-between text-xs bg-slate-100 p-2.5 rounded-xl border border-slate-200">
            <span className="text-slate-600">
              원본 청크 단어 수: <strong className="font-mono text-slate-900">~{originalWords}</strong> words ({chunk.text?.length || 0}자)
            </span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-slate-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                분할 1: <strong className="font-mono text-slate-900">~{part1Words}</strong> words
              </span>
              <span className="text-slate-400">+</span>
              <span className="flex items-center gap-1 text-slate-700">
                <span className="w-2 h-2 rounded-full bg-indigo-500" />
                분할 2: <strong className="font-mono text-slate-900">~{part2Words}</strong> words
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Split Part 1 */}
            <div className="flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
              <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <h4 className="text-xs font-bold text-slate-800">청크 1</h4>
                  <span className="font-mono text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                    {chunkId1}
                  </span>

                  {/* 실시간 타입 뱃지 */}
                  {(() => {
                    const kind1 = getChunkKind({ text: part1, tables: p1Asset.tables, raw_html: p1Asset.raw_html, metadata: chunk?.metadata });
                    return (
                      <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5 ${
                        kind1 === 'table'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : kind1 === 'composite'
                          ? 'bg-purple-100 text-purple-800 border border-purple-300'
                          : kind1 === 'article'
                          ? 'bg-purple-100 text-purple-800 border border-purple-300'
                          : 'bg-slate-200 text-slate-700 border border-slate-300'
                      }`}>
                        {kind1 === 'table' ? (
                          <Table2 className="w-2.5 h-2.5" />
                        ) : kind1 === 'composite' ? (
                          <Layers className="w-2.5 h-2.5" />
                        ) : kind1 === 'article' ? (
                          <Scale className="w-2.5 h-2.5" />
                        ) : (
                          <AlignLeft className="w-2.5 h-2.5" />
                        )}
                        {getChunkKindLabel(kind1)}
                      </span>
                    );
                  })()}

                  <div className="flex items-center gap-1 ml-1">
                    <span className="text-[11px] text-slate-500 font-semibold">Page</span>
                    <input
                      type="number"
                      min="1"
                      value={page1}
                      onChange={(e) => setPage1(parseInt(e.target.value, 10) || 1)}
                      className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-800"
                      title="청크 1 페이지 번호"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-500">
                    ~{part1Words} tokens ({part1.length}자)
                  </span>
                  {part1Words > 512 ? (
                    <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      512+ tokens
                    </span>
                  ) : part1Words < 20 && part1Words > 0 ? (
                    <span className="text-[10px] bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                      <Info className="w-3 h-3 text-sky-600" />
                      &lt;20 tokens
                    </span>
                  ) : part1Words >= 20 ? (
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                      <Check className="w-3 h-3 text-emerald-600" />
                      최적
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="p-2.5 flex-1 flex flex-col">
                <textarea
                  value={part1}
                  onChange={(e) => setPart1(e.target.value)}
                  rows={10}
                  placeholder="청크 1 본문을 입력하거나 직접 조정하세요..."
                  className="w-full flex-1 p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-sans leading-relaxed resize-y"
                />
              </div>
            </div>

            {/* Split Part 2 */}
            <div className="flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
              <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                  <h4 className="text-xs font-bold text-slate-800">청크 2</h4>
                  <span className="font-mono text-[10px] font-semibold bg-indigo-100 text-indigo-800 px-1.5 py-0.2 rounded">
                    {chunkId2}
                  </span>

                  {/* 실시간 타입 뱃지 */}
                  {(() => {
                    const kind2 = getChunkKind({ text: part2, tables: p2Asset.tables, raw_html: p2Asset.raw_html, metadata: chunk?.metadata });
                    return (
                      <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5 ${
                        kind2 === 'table'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : kind2 === 'composite'
                          ? 'bg-purple-100 text-purple-800 border border-purple-300'
                          : kind2 === 'article'
                          ? 'bg-purple-100 text-purple-800 border border-purple-300'
                          : 'bg-slate-200 text-slate-700 border border-slate-300'
                      }`}>
                        {kind2 === 'table' ? (
                          <Table2 className="w-2.5 h-2.5" />
                        ) : kind2 === 'composite' ? (
                          <Layers className="w-2.5 h-2.5" />
                        ) : kind2 === 'article' ? (
                          <Scale className="w-2.5 h-2.5" />
                        ) : (
                          <AlignLeft className="w-2.5 h-2.5" />
                        )}
                        {getChunkKindLabel(kind2)}
                      </span>
                    );
                  })()}

                  <div className="flex items-center gap-1 ml-1">
                    <span className="text-[11px] text-slate-500 font-semibold">Page</span>
                    <input
                      type="number"
                      min="1"
                      value={page2}
                      onChange={(e) => setPage2(parseInt(e.target.value, 10) || 1)}
                      className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-800"
                      title="청크 2 페이지 번호"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-500">
                    ~{part2Words} tokens ({part2.length}자)
                  </span>
                  {part2Words > 512 ? (
                    <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                      512+ tokens
                    </span>
                  ) : part2Words < 20 && part2Words > 0 ? (
                    <span className="text-[10px] bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                      <Info className="w-3 h-3 text-sky-600" />
                      &lt;20 tokens
                    </span>
                  ) : part2Words >= 20 ? (
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                      <Check className="w-3 h-3 text-emerald-600" />
                      최적
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="p-2.5 flex-1 flex flex-col">
                <textarea
                  value={part2}
                  onChange={(e) => setPart2(e.target.value)}
                  rows={10}
                  placeholder="청크 2 본문을 입력하거나 직접 조정하세요..."
                  className="w-full flex-1 p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-sans leading-relaxed resize-y"
                />
              </div>
            </div>
          </div>

          {!canSplit && (
            <p className="text-xs text-rose-600 font-semibold flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />
              두 분할 청크 모두 최소 1자 이상의 텍스트가 입력되어야 합니다.
            </p>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Info className="w-4 h-4 text-indigo-500 shrink-0" />
            <span>부모 섹션의 자식 청크 목록(`child_chunk_ids`)이 두 청크로 자동 교체되며, 표 자산이 안전하게 재할당됩니다.</span>
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
              disabled={!canSplit}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-sm cursor-pointer"
            >
              <Split className="w-4 h-4" />
              <span>분할 완료 및 적용</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

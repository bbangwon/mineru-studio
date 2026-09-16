import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  Sparkles,
  X,
  Check,
  Columns2,
  ListFilter,
  CornerDownLeft,
  ArrowRight,
  Info,
} from 'lucide-react';
import { computeWordDiff } from '../utils/diffUtils';

export interface RefineDiffData {
  original_text: string;
  refined_text: string;
  original_chars: number;
  refined_chars: number;
  elapsed_seconds: number;
}

export interface RefineDiffModalProps {
  isOpen: boolean;
  diffData: RefineDiffData | null;
  onClose: () => void;
  onApply: (refinedText: string) => void;
  title?: string;
}

export const RefineDiffModal: React.FC<RefineDiffModalProps> = ({
  isOpen,
  diffData,
  onClose,
  onApply,
  title = 'AI 텍스트 교정 결과 비교',
}) => {
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [showLineBreakBadges, setShowLineBreakBadges] = useState(true);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);

  // 단어/공백 단위 Diff 계산 및 통계 추출
  const { changes, stats } = useMemo(() => {
    if (!diffData) {
      return {
        changes: [],
        stats: {
          originalChars: 0,
          refinedChars: 0,
          charDelta: 0,
          addedChars: 0,
          removedChars: 0,
          modifiedSegments: 0,
        },
      };
    }
    return computeWordDiff(diffData.original_text, diffData.refined_text);
  }, [diffData]);

  // 좌우 패널 동기화 스크롤 핸들러
  const handleScroll = useCallback((source: 'left' | 'right') => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    const sourceEl = source === 'left' ? leftScrollRef.current : rightScrollRef.current;
    const targetEl = source === 'left' ? rightScrollRef.current : leftScrollRef.current;

    if (sourceEl && targetEl) {
      const scrollRatio =
        sourceEl.scrollTop / (sourceEl.scrollHeight - sourceEl.clientHeight || 1);
      targetEl.scrollTop = scrollRatio * (targetEl.scrollHeight - targetEl.clientHeight);
    }

    requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  }, []);

  if (!isOpen || !diffData) return null;

  /**
   * 문자열 내 개행문자(\n)를 보존하면서 줄바꿈 기호(↵) 뱃지를 렌더링하는 헬퍼
   */
  const renderTextWithBreaks = (
    text: string,
    isRemovedBreak: boolean = false,
    keyPrefix: string = ''
  ) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => (
      <React.Fragment key={`${keyPrefix}-line-${idx}`}>
        {line}
        {idx < lines.length - 1 && (
          <>
            {showLineBreakBadges && isRemovedBreak ? (
              <span
                title="병합된 줄바꿈"
                className="inline-flex items-center gap-0.5 px-1 py-0.2 text-[10px] font-mono bg-rose-200/90 text-rose-800 rounded font-bold border border-rose-300 mx-0.5 select-none"
              >
                <CornerDownLeft className="w-2.5 h-2.5" />
                줄바꿈
              </span>
            ) : null}
            {'\n'}
          </>
        )}
      </React.Fragment>
    ));
  };

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-200">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-800">{title}</h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                  {diffData.elapsed_seconds}s 소요
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-semibold">
                  변경 영역 {stats.modifiedSegments}개소
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                원문 내용을 보존하며 비정상 개행(줄바꿈) 병합, 띄어쓰기 및 맞춤법 교정 사항을 하이라이트로 비교합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Diff Toolbar & Stats Bar */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          {/* Stats Badges */}
          <div className="flex items-center gap-3 font-mono">
            <span className="text-slate-600">
              원문: <strong className="text-slate-900">{diffData.original_chars}</strong>자
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-600">
              교정본: <strong className="text-emerald-700">{diffData.refined_chars}</strong>자
            </span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded border font-semibold ${
                stats.charDelta > 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : stats.charDelta < 0
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              변화: {stats.charDelta >= 0 ? `+${stats.charDelta}` : `${stats.charDelta}`}자
            </span>
            {stats.removedChars > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-medium">
                삭제: -{stats.removedChars}자
              </span>
            )}
            {stats.addedChars > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                추가: +{stats.addedChars}자
              </span>
            )}
          </div>

          {/* View Mode & Toggles */}
          <div className="flex items-center gap-2">
            {/* 줄바꿈 표시 토글 */}
            <label className="flex items-center gap-1.5 px-2 py-1 rounded bg-white border border-slate-200 text-slate-600 hover:text-slate-900 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showLineBreakBadges}
                onChange={(e) => setShowLineBreakBadges(e.target.checked)}
                className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 w-3.5 h-3.5 cursor-pointer"
              />
              <span className="flex items-center gap-1">
                <CornerDownLeft className="w-3 h-3 text-slate-500" />
                줄바꿈 기호(↵) 표시
              </span>
            </label>

            {/* View Mode Buttons */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                  viewMode === 'split'
                    ? 'bg-white text-slate-800 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Columns2 className="w-3.5 h-3.5" />
                <span>나란히 비교</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('unified')}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                  viewMode === 'unified'
                    ? 'bg-white text-slate-800 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <ListFilter className="w-3.5 h-3.5" />
                <span>통합 인라인 비교</span>
              </button>
            </div>
          </div>
        </div>

        {/* Legend Notice Bar */}
        <div className="px-6 py-1.5 bg-slate-100/60 border-b border-slate-200/80 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-medium text-slate-600">범례:</span>
            <span className="flex items-center gap-1">
              <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 border border-rose-200 line-through rounded font-semibold text-[10px]">
                삭제/수정 전 텍스트
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-900 border border-emerald-300 font-semibold rounded text-[10px]">
                추가/교정 완료 텍스트
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="px-1 py-0.5 bg-rose-200 text-rose-800 rounded font-mono font-bold text-[10px]">
                ↵ 줄바꿈
              </span>
              <span>병합되어 제거된 줄바꿈</span>
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-slate-400">
            <Info className="w-3.5 h-3.5" />
            <span>좌우 패널은 스크롤이 자동으로 동기화됩니다.</span>
          </div>
        </div>

        {/* Diff Body Content */}
        <div className="p-6 flex-1 overflow-hidden bg-slate-100/40">
          {viewMode === 'split' ? (
            /* Side-by-Side Split View */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
              {/* Left Column: Original (Before) */}
              <div className="flex flex-col h-full border border-rose-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                <div className="px-4 py-2.5 bg-rose-50/80 border-b border-rose-200 flex items-center justify-between shrink-0">
                  <span className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-rose-200" />
                    원문 (Before / 교정 전)
                  </span>
                  <span className="text-[11px] text-rose-700 font-medium">
                    삭제/수정될 부분이 붉은색으로 강조됩니다
                  </span>
                </div>
                <div
                  ref={leftScrollRef}
                  onScroll={() => handleScroll('left')}
                  className="p-5 overflow-y-auto flex-1 font-sans text-xs text-slate-700 leading-relaxed whitespace-pre-wrap select-text"
                >
                  {changes.map((change, idx) => {
                    if (change.added) {
                      // 교정본에만 추가된 내용은 원문 패널에 표시하지 않음
                      return null;
                    }
                    if (change.removed) {
                      return (
                        <mark
                          key={`orig-${idx}`}
                          className="bg-rose-100 text-rose-900 border-b border-rose-300 line-through rounded-xs px-1 py-0.2 mx-0.5 inline font-medium decoration-rose-500"
                        >
                          {renderTextWithBreaks(change.value, true, `orig-${idx}`)}
                        </mark>
                      );
                    }
                    return (
                      <span key={`orig-${idx}`}>
                        {renderTextWithBreaks(change.value, false, `orig-${idx}`)}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Refined (After) */}
              <div className="flex flex-col h-full border border-emerald-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                <div className="px-4 py-2.5 bg-emerald-50/80 border-b border-emerald-200 flex items-center justify-between shrink-0">
                  <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
                    AI 교정본 (After / 정제 완료)
                  </span>
                  <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    새로 적용/개선된 부분이 초록색으로 강조됩니다
                  </span>
                </div>
                <div
                  ref={rightScrollRef}
                  onScroll={() => handleScroll('right')}
                  className="p-5 overflow-y-auto flex-1 font-sans text-xs text-slate-800 leading-relaxed whitespace-pre-wrap select-text"
                >
                  {changes.map((change, idx) => {
                    if (change.removed) {
                      // 삭제된 내용은 교정본 패널에 표시하지 않음
                      return null;
                    }
                    if (change.added) {
                      return (
                        <mark
                          key={`refined-${idx}`}
                          className="bg-emerald-100 text-emerald-900 border-b-2 border-emerald-500 rounded-xs px-1 py-0.2 mx-0.5 inline font-semibold"
                        >
                          {renderTextWithBreaks(change.value, false, `refined-${idx}`)}
                        </mark>
                      );
                    }
                    return (
                      <span key={`refined-${idx}`}>
                        {renderTextWithBreaks(change.value, false, `refined-${idx}`)}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* Unified (Inline) View */
            <div className="h-full flex flex-col border border-slate-300 rounded-xl overflow-hidden bg-white shadow-2xs">
              <div className="px-4 py-2.5 bg-slate-100/90 border-b border-slate-200 flex items-center justify-between shrink-0">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <ListFilter className="w-4 h-4 text-purple-600" />
                  통합 인라인 비교 (Unified Diff View)
                </span>
                <span className="text-[11px] text-slate-500">
                  원문과 교정본의 차이를 문맥 흐름대로 연속 표시합니다
                </span>
              </div>
              <div className="p-5 overflow-y-auto flex-1 font-sans text-xs text-slate-800 leading-relaxed whitespace-pre-wrap select-text">
                {changes.map((change, idx) => {
                  if (change.removed) {
                    return (
                      <mark
                        key={`unified-${idx}`}
                        className="bg-rose-100 text-rose-900 border-b border-rose-300 line-through rounded-xs px-1 py-0.2 mx-0.5 inline font-medium decoration-rose-500"
                      >
                        {renderTextWithBreaks(change.value, true, `unified-rem-${idx}`)}
                      </mark>
                    );
                  }
                  if (change.added) {
                    return (
                      <mark
                        key={`unified-${idx}`}
                        className="bg-emerald-100 text-emerald-900 border-b-2 border-emerald-500 font-semibold rounded-xs px-1 py-0.2 mx-0.5 inline"
                      >
                        {renderTextWithBreaks(change.value, false, `unified-add-${idx}`)}
                      </mark>
                    );
                  }
                  return (
                    <span key={`unified-${idx}`}>
                      {renderTextWithBreaks(change.value, false, `unified-same-${idx}`)}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Diff Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>원문의 의미와 서식을 보존하며 개행과 띄어쓰기 결함이 정제되었습니다.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition cursor-pointer"
            >
              취소 (Discard)
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(diffData.refined_text);
                onClose();
              }}
              className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg shadow-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>교정본 적용 (Accept)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default RefineDiffModal;

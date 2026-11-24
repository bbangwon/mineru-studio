import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Hand,
  Link2,
  Loader2,
  RotateCcw,
  Unlink2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getOriginalPdfUrl, getPdfPageImageUrl } from '../../api/client';

export interface PdfHighlightBbox {
  bbox: number[];
  label?: string;
}

export interface PdfViewerPaneProps {
  filename?: string;
  currentPage: number;
  totalPages?: number;
  onPageChange: (page: number) => void;
  isPageSynced: boolean;
  onTogglePageSync: () => void;
  activeChunkPageStart?: number;
  activeChunkPageEnd?: number;
  onClose?: () => void;
  highlightBboxes?: PdfHighlightBbox[];
  disableShortcuts?: boolean;
  className?: string;
}

type ZoomOption = 'fit' | 75 | 100 | 125 | 150 | 200;

const NUMERIC_ZOOM_STEPS: readonly (75 | 100 | 125 | 150 | 200)[] = [
  75,
  100,
  125,
  150,
  200,
];

export const PdfViewerPane: React.FC<PdfViewerPaneProps> = ({
  filename,
  currentPage,
  totalPages,
  onPageChange,
  isPageSynced,
  onTogglePageSync,
  activeChunkPageStart,
  activeChunkPageEnd,
  onClose,
  highlightBboxes,
  disableShortcuts = false,
  className = '',
}) => {
  const [zoom, setZoom] = useState<ZoomOption>('fit');
  const [draftPageInput, setDraftPageInput] = useState<string | null>(null);
  const [displayedUrl, setDisplayedUrl] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  const [isHandMode, setIsHandMode] = useState<boolean>(true);
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const isHandActive = isHandMode || isSpacePressed;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isPointerOverViewportRef = useRef<boolean>(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
  const prevPageRef = useRef<number>(currentPage);
  const prevFilenameRef = useRef<string | undefined>(filename);

  const maxPage = totalPages && totalPages >= 1 ? totalPages : undefined;

  const safePage = useMemo(() => {
    const raw = Number.isFinite(currentPage) ? Math.max(1, Math.floor(currentPage)) : 1;
    return maxPage ? Math.min(raw, maxPage) : raw;
  }, [currentPage, maxPage]);

  const targetDpi = typeof zoom === 'number' && zoom >= 150 ? 220 : 150;

  const targetUrl = useMemo(() => {
    if (!filename) return null;
    const base = getPdfPageImageUrl({
      filename,
      page: safePage,
      dpi: targetDpi,
      fmt: 'webp',
    });
    return retryNonce > 0 ? `${base}&_r=${retryNonce}` : base;
  }, [filename, safePage, targetDpi, retryNonce]);

  useEffect(() => {
    if (prevFilenameRef.current !== filename) {
      prevFilenameRef.current = filename;
      setDraftPageInput(null);
      setDisplayedUrl(null);
      setLoadError(null);
      viewportRef.current?.scrollTo({ top: 0, left: 0 });
    }
  }, [filename]);

  useEffect(() => {
    if (!targetUrl) {
      setDisplayedUrl(null);
      setIsLoadingImage(false);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingImage(true);
    setLoadError(null);

    const img = new Image();

    const handleLoaded = () => {
      if (cancelled) return;
      setDisplayedUrl(targetUrl);
      setIsLoadingImage(false);
      setLoadError(null);
      if (prevPageRef.current !== safePage) {
        prevPageRef.current = safePage;
        viewportRef.current?.scrollTo({ top: 0 });
      }
    };

    const handleFailed = () => {
      if (cancelled) return;
      setIsLoadingImage(false);
      setLoadError(`${safePage}페이지 이미지를 불러오지 못했습니다.`);
    };

    img.onload = handleLoaded;
    img.onerror = handleFailed;
    img.src = targetUrl;

    if (img.complete && img.naturalWidth > 0) {
      handleLoaded();
    }

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [targetUrl, safePage]);

  // 인접 페이지(p+1, p-1) 백그라운드 프리페치
  useEffect(() => {
    if (!filename || isLoadingImage || loadError) return;
    const candidates: number[] = [];
    if (!maxPage || safePage + 1 <= maxPage) {
      candidates.push(safePage + 1);
    }
    if (safePage - 1 >= 1) {
      candidates.push(safePage - 1);
    }

    for (const p of candidates) {
      const preImg = new Image();
      preImg.src = getPdfPageImageUrl({
        filename,
        page: p,
        dpi: targetDpi,
        fmt: 'webp',
      });
    }
  }, [filename, safePage, maxPage, targetDpi, isLoadingImage, loadError]);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => {
      if (prev === 'fit') return 75;
      const idx = NUMERIC_ZOOM_STEPS.indexOf(prev);
      return idx > 0 ? NUMERIC_ZOOM_STEPS[idx - 1] : prev;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => {
      if (prev === 'fit') return 125;
      const idx = NUMERIC_ZOOM_STEPS.indexOf(prev);
      return idx !== -1 && idx < NUMERIC_ZOOM_STEPS.length - 1
        ? NUMERIC_ZOOM_STEPS[idx + 1]
        : prev;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!viewportRef.current || viewportRef.current.offsetParent === null) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (filename && !disableShortcuts && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault();
          handleZoomIn();
          return;
        }
        if (!e.shiftKey && (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract')) {
          e.preventDefault();
          handleZoomOut();
          return;
        }
      }

      if ((e.code !== 'Space' && e.key !== ' ') || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      if (target?.closest('button, a, [role="button"]') && !isPointerOverViewportRef.current) {
        return;
      }

      e.preventDefault();
      if (!e.repeat) {
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        setIsSpacePressed(false);
      }
    };

    const handleBlur = () => {
      setIsSpacePressed(false);
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [filename, disableShortcuts, handleZoomIn, handleZoomOut]);

  const endPanDrag = (pointerId?: number) => {
    const currentDrag = dragStateRef.current;
    if (!currentDrag) return;
    if (pointerId !== undefined && currentDrag.pointerId !== pointerId) return;

    try {
      if (viewportRef.current?.hasPointerCapture(currentDrag.pointerId)) {
        viewportRef.current.releasePointerCapture(currentDrag.pointerId);
      }
    } catch {
      // Ignore if pointer capture was already released
    }

    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!displayedUrl || e.pointerType === 'touch') return;

    const isAllowedButton =
      (e.button === 0 && isHandActive) || e.button === 1;
    if (!isAllowedButton) return;

    if ((e.target as HTMLElement | null)?.closest('button, a, input, select')) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const onVerticalScrollbar =
      e.clientX >= rect.left + viewport.clientLeft + viewport.clientWidth;
    const onHorizontalScrollbar =
      e.clientY >= rect.top + viewport.clientTop + viewport.clientHeight;
    if (onVerticalScrollbar || onHorizontalScrollbar) return;

    e.preventDefault();
    viewport.focus({ preventScroll: true });

    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };

    try {
      viewport.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported
    }
    setIsDragging(true);
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const currentDrag = dragStateRef.current;
    const viewport = viewportRef.current;
    if (!currentDrag || currentDrag.pointerId !== e.pointerId || !viewport) return;

    viewport.scrollLeft = currentDrag.startScrollLeft - (e.clientX - currentDrag.startX);
    viewport.scrollTop = currentDrag.startScrollTop - (e.clientY - currentDrag.startY);
  };

  const commitPageInput = () => {
    const raw = draftPageInput ?? String(safePage);
    const parsed = parseInt(raw, 10);
    setDraftPageInput(null);
    if (isNaN(parsed)) {
      return;
    }
    const clamped = maxPage
      ? Math.min(Math.max(1, parsed), maxPage)
      : Math.max(1, parsed);
    if (clamped !== safePage) {
      onPageChange(clamped);
    }
  };

  const canZoomOut = zoom === 'fit' || zoom > 75;
  const canZoomIn = zoom === 'fit' || zoom < 200;

  // 다중 페이지 청크 점프 칩 계산 (6개 초과 시 축약)
  const chunkPageChips = useMemo<Array<number | 'ellipsis'>>(() => {
    if (
      !activeChunkPageStart ||
      !activeChunkPageEnd ||
      activeChunkPageEnd <= activeChunkPageStart
    ) {
      return [];
    }
    const start = Math.max(1, activeChunkPageStart);
    const end = maxPage ? Math.min(activeChunkPageEnd, maxPage) : activeChunkPageEnd;
    if (end <= start) return [];

    const totalRange = end - start + 1;
    if (totalRange <= 6) {
      return Array.from({ length: totalRange }, (_, i) => start + i);
    }
    return [start, start + 1, start + 2, start + 3, start + 4, 'ellipsis', end];
  }, [activeChunkPageStart, activeChunkPageEnd, maxPage]);

  const isAwayFromActiveChunk = Boolean(
    activeChunkPageStart &&
      (safePage < activeChunkPageStart ||
        safePage > (activeChunkPageEnd || activeChunkPageStart))
  );

  const showContextBar = chunkPageChips.length > 0 || isAwayFromActiveChunk;

  const canGoPrev = safePage > 1;
  const canGoNext = maxPage ? safePage < maxPage : true;

  return (
    <section
      className={`flex flex-col bg-slate-100 dark:bg-slate-950 min-h-0 overflow-hidden ${className}`}
    >
      {/* 1행: 메인 툴바 */}
      <div className="px-2.5 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 flex-wrap shrink-0">
        {/* 좌측: 페이지 네비게이션 */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={!filename || !canGoPrev}
            onClick={() => onPageChange(Math.max(1, safePage - 1))}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            title="이전 페이지"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-1 text-xs font-mono">
            <input
              type="number"
              min={1}
              max={maxPage}
              disabled={!filename}
              value={draftPageInput ?? String(safePage)}
              onChange={(e) => setDraftPageInput(e.target.value)}
              onBlur={commitPageInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitPageInput();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              aria-label="PDF 페이지 번호"
              className="w-12 text-center text-xs font-mono font-semibold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-1 text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            />
            <span className="text-slate-500 dark:text-slate-400 select-none">
              / {maxPage ?? '?'}
            </span>
          </div>

          <button
            type="button"
            disabled={!filename || !canGoNext}
            onClick={() => onPageChange(safePage + 1)}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            title="다음 페이지"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 우측: 줌, 청크 연동, 새 탭 원본, 닫기 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 줌 컨트롤 */}
          <div className="flex items-center gap-0.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5">
            <button
              type="button"
              disabled={!filename || !canZoomOut}
              onClick={handleZoomOut}
              className="p-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              title="축소 (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <select
              value={String(zoom)}
              disabled={!filename}
              onChange={(e) => {
                const val = e.target.value;
                setZoom(val === 'fit' ? 'fit' : (Number(val) as 75 | 100 | 125 | 150 | 200));
              }}
              aria-label="PDF 확대 배율"
              className="text-[11px] font-semibold bg-transparent text-slate-700 dark:text-slate-200 px-1 py-0.5 focus:outline-hidden cursor-pointer disabled:opacity-50"
            >
              <option value="fit" className="bg-white dark:bg-slate-900">폭 맞춤</option>
              <option value="75" className="bg-white dark:bg-slate-900">75%</option>
              <option value="100" className="bg-white dark:bg-slate-900">100%</option>
              <option value="125" className="bg-white dark:bg-slate-900">125%</option>
              <option value="150" className="bg-white dark:bg-slate-900">150%</option>
              <option value="200" className="bg-white dark:bg-slate-900">200%</option>
            </select>
            <button
              type="button"
              disabled={!filename || !canZoomIn}
              onClick={handleZoomIn}
              className="p-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              title="확대 (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {targetDpi === 220 && (
            <span
              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
              title="고해상도 220 DPI 렌더링 활성"
            >
              HD
            </span>
          )}

          {/* 손 도구(화면 드래그 이동) 토글 */}
          <button
            type="button"
            disabled={!filename}
            onClick={() => setIsHandMode((v) => !v)}
            aria-pressed={isHandActive}
            className={`px-2 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              isHandActive
                ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
            title={
              isHandActive
                ? '손 도구 활성: PDF 화면을 클릭해 드래그 이동 (Space 누른 상태 또는 휠 클릭 드래그로도 사용 가능)'
                : '손 도구 꺼짐 (클릭하여 켜기, 또는 Space를 누른 채 드래그 / 휠 클릭 드래그)'
            }
          >
            <Hand className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">손 도구</span>
          </button>

          {/* 청크 자동 연동 토글 */}
          <button
            type="button"
            onClick={onTogglePageSync}
            className={`px-2 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer ${
              isPageSynced
                ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
            title={
              isPageSynced
                ? '청크 선택 시 해당 페이지로 자동 이동 (클릭하여 해제)'
                : '자동 페이지 연동 꺼짐 (클릭하여 다시 연동)'
            }
          >
            {isPageSynced ? (
              <Link2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Unlink2 className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="hidden sm:inline">{isPageSynced ? '연동' : '자유'}</span>
          </button>

          {/* 새 탭에서 원본 PDF 열기 */}
          {filename ? (
            <a
              href={getOriginalPdfUrl(filename, safePage)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1 transition"
              title="새 브라우저 탭에서 원본 PDF 열기 (텍스트 복사 및 Ctrl+F 검색)"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">새 탭</span>
            </a>
          ) : (
            <span
              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-[11px] font-semibold text-slate-400 flex items-center gap-1 opacity-50 cursor-not-allowed"
              title="선택된 PDF 문서가 없습니다"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">새 탭</span>
            </span>
          )}

          {/* 닫기 버튼 */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/60 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 transition cursor-pointer"
              title="원본 PDF 뷰어 닫기 (Alt+P)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2행: 다중 페이지 청크 점프 칩 & 수동 이탈 복귀 바 */}
      {showContextBar && (
        <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/80 flex items-center justify-between gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-1 flex-wrap">
            {chunkPageChips.length > 0 && (
              <>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mr-0.5">
                  청크 범위:
                </span>
                {chunkPageChips.map((item, idx) =>
                  typeof item !== 'number' ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="text-[11px] text-slate-400 px-1 select-none"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onPageChange(item)}
                      className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border transition cursor-pointer ${
                        item === safePage
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300'
                      }`}
                    >
                      p.{item}
                    </button>
                  )
                )}
              </>
            )}
          </div>

          {isAwayFromActiveChunk && activeChunkPageStart && (
            <button
              type="button"
              onClick={() => onPageChange(activeChunkPageStart)}
              className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/70 transition cursor-pointer"
              title="현재 편집 중인 청크 시작 페이지로 복귀"
            >
              현재 청크(p.{activeChunkPageStart})로
            </button>
          )}
        </div>
      )}

      {/* 뷰포트: 스크롤 가능한 페이지 캔버스 */}
      <div
        ref={viewportRef}
        tabIndex={-1}
        onPointerEnter={() => {
          isPointerOverViewportRef.current = true;
        }}
        onPointerLeave={() => {
          isPointerOverViewportRef.current = false;
        }}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={(e) => endPanDrag(e.pointerId)}
        onPointerCancel={(e) => endPanDrag(e.pointerId)}
        onLostPointerCapture={(e) => endPanDrag(e.pointerId)}
        onMouseDown={(e) => {
          if (e.button === 1 && displayedUrl) {
            e.preventDefault();
          }
        }}
        className={`flex-1 overflow-auto bg-slate-200/70 dark:bg-slate-950 p-3 sm:p-4 relative outline-none ${
          displayedUrl
            ? isDragging
              ? 'cursor-grabbing select-none'
              : isHandActive
                ? 'cursor-grab'
                : ''
            : ''
        }`}
      >
        {!filename ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 dark:text-slate-400">
            <FileText className="w-10 h-10 text-slate-300 dark:text-slate-700 mb-2" />
            <p className="text-xs font-semibold">표시할 원본 PDF 문서가 선택되지 않았습니다.</p>
          </div>
        ) : loadError && !displayedUrl ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <div className="max-w-xs bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded-xl p-4 shadow-xs space-y-2.5">
              <AlertCircle className="w-7 h-7 text-rose-500 mx-auto" />
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {loadError}
              </p>
              <button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>다시 시도</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="min-h-full">
            {loadError && displayedUrl && (
              <div className="mb-2 px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{loadError}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setRetryNonce((n) => n + 1)}
                  className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>다시 시도</span>
                </button>
              </div>
            )}

            {/* CSS 블록 mx-auto 구조 유지 (확대 시 좌측 잘림 없이 가로 스크롤 가능) */}
            <div
              className="relative mx-auto bg-white shadow-md rounded-md overflow-hidden border border-slate-300/80 dark:border-slate-700"
              style={zoom === 'fit' ? { width: '100%' } : { width: `${zoom}%` }}
            >
              {displayedUrl ? (
                <img
                  src={displayedUrl}
                  alt={`${filename} - ${safePage}페이지`}
                  draggable={false}
                  className={`block w-full h-auto select-none transition-opacity duration-150 ${
                    isLoadingImage ? 'opacity-60' : 'opacity-100'
                  }`}
                />
              ) : (
                <div className="w-full aspect-[1/1.414] flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                  <span className="text-xs font-medium">
                    {safePage}페이지 렌더링 중...
                  </span>
                </div>
              )}

              {/* 향후 bbox 하이라이트 오버레이 확장 포인트 (0~1000 정규화 좌표) */}
              {highlightBboxes && highlightBboxes.length > 0 && displayedUrl && (
                <div className="absolute inset-0 pointer-events-none">
                  {highlightBboxes.map((item, idx) => {
                    if (!Array.isArray(item.bbox) || item.bbox.length < 4) return null;
                    const [x0, y0, x1, y1] = item.bbox;
                    const left = Math.max(0, Math.min(100, x0 / 10));
                    const top = Math.max(0, Math.min(100, y0 / 10));
                    const width = Math.max(0, Math.min(100 - left, (x1 - x0) / 10));
                    const height = Math.max(0, Math.min(100 - top, (y1 - y0) / 10));
                    return (
                      <div
                        key={idx}
                        className="absolute border-2 border-indigo-500 bg-indigo-500/15 rounded-xs"
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          width: `${width}%`,
                          height: `${height}%`,
                        }}
                      >
                        {item.label && (
                          <span className="absolute -top-5 left-0 px-1.5 py-0.2 rounded bg-indigo-600 text-white text-[10px] font-semibold whitespace-nowrap shadow-xs">
                            {item.label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 전환 로딩 중 우상단 미니 스피너 */}
              {isLoadingImage && displayedUrl && (
                <div className="absolute top-2.5 right-2.5 px-2 py-1 rounded-full bg-slate-900/75 text-white text-[11px] font-medium flex items-center gap-1.5 shadow-md pointer-events-none">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{safePage}p</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

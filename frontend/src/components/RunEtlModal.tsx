import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Play,
  FileText,
  SlidersHorizontal,
  Layers,
  BookOpen,
  Cpu,
  Bookmark,
  GitMerge,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import type { PdfItem, ParseRequestParams, PartsStatusInfo } from '../types';
import { MINERU_TIER_OPTIONS, normalizeMineruTier } from '../utils/etlUtils';
import { getEtlPartsStatus, clearEtlParts } from '../api/client';

interface RunEtlModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetItem: PdfItem | null;
  // Default values from top bar/dashboard
  defaultEngine: string;
  defaultMethod: string;
  defaultFormula: boolean;
  defaultStrategy: string;
  defaultAllPages: boolean;
  defaultStartPage: number;
  defaultEndPage: number;
  defaultPreserveNewlines?: boolean;
  onRun: (params: ParseRequestParams, saveAsDefault?: boolean) => Promise<void>;
  isParsing: boolean;
}

export const RunEtlModal: React.FC<RunEtlModalProps> = ({
  isOpen,
  onClose,
  targetItem,
  defaultEngine,
  defaultMethod,
  defaultFormula,
  defaultStrategy,
  defaultAllPages,
  defaultStartPage,
  defaultEndPage,
  defaultPreserveNewlines = true,
  onRun,
  isParsing,
}) => {
  const [engine, setEngine] = useState(normalizeMineruTier(defaultEngine));
  const [method, setMethod] = useState(defaultMethod);
  const [formula, setFormula] = useState(defaultFormula);
  const [strategy, setStrategy] = useState(defaultStrategy);
  const [allPages, setAllPages] = useState(defaultAllPages);
  const [startPage, setStartPage] = useState(defaultStartPage);
  const [endPage, setEndPage] = useState(defaultEndPage);
  const [preserveNewlines, setPreserveNewlines] = useState(defaultPreserveNewlines);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [execMode, setExecMode] = useState<'full' | 'part'>('full');
  const [partsStatus, setPartsStatus] = useState<PartsStatusInfo | null>(null);
  const [isLoadingParts, setIsLoadingParts] = useState(false);

  const findNextUnparsedRange = useCallback((parsedPages: number[], totalP: number, batchSize: number): [number, number] => {
    const parsedSet = new Set(parsedPages);
    const maxIdx = Math.max(0, totalP - 1);
    let firstMissing = 0;
    while (firstMissing <= maxIdx && parsedSet.has(firstMissing)) {
      firstMissing++;
    }
    if (firstMissing > maxIdx) {
      return [0, Math.min(maxIdx, batchSize - 1)];
    }
    let endIdx = firstMissing;
    while (endIdx + 1 <= maxIdx && !parsedSet.has(endIdx + 1) && (endIdx - firstMissing + 1) < batchSize) {
      endIdx++;
    }
    return [firstMissing, endIdx];
  }, []);

  const refreshPartsStatus = useCallback(async (filename: string, tier: string, ocrMethod: string, totalP: number, autoSelectNext: boolean = false) => {
    setIsLoadingParts(true);
    try {
      const res = await getEtlPartsStatus(filename, tier, ocrMethod);
      setPartsStatus(res.parts_status);
      if (autoSelectNext && res.parts_status && res.parts_status.parsed_count > 0) {
        const [ns, ne] = findNextUnparsedRange(res.parts_status.parsed_pages, totalP, 10);
        setStartPage(ns);
        setEndPage(ne);
      }
    } catch {
      setPartsStatus(null);
    } finally {
      setIsLoadingParts(false);
    }
  }, [findNextUnparsedRange]);

  // Whenever modal opens or target item changes, sync with default or previous doc settings
  useEffect(() => {
    if (isOpen && targetItem) {
      const initEngine = normalizeMineruTier(targetItem.backend || defaultEngine);
      const initMethod = targetItem.method || defaultMethod || 'auto';
      setEngine(initEngine);
      setMethod(initMethod);
      setStrategy(targetItem.strategy || defaultStrategy || 'general');
      setFormula(defaultFormula);
      setPreserveNewlines(defaultPreserveNewlines);
      setSaveAsDefault(false);

      const isPartialDoc = targetItem.etl_status === 'partial' || (targetItem.parts_info && targetItem.parts_info.parsed_count > 0);
      const maxPage = Math.max(0, targetItem.total_pages - 1);

      if (targetItem.etl_status === 'partial') {
        setExecMode('part');
        setAllPages(false);
        const parsed = targetItem.parts_info?.parsed_pages || [];
        const [ns, ne] = findNextUnparsedRange(parsed, targetItem.total_pages, 10);
        setStartPage(ns);
        setEndPage(ne);
      } else {
        setExecMode('full');
        setAllPages(defaultAllPages);
        setStartPage(Math.min(defaultStartPage, maxPage));
        setEndPage(defaultAllPages ? maxPage : Math.min(defaultEndPage, maxPage));
      }

      refreshPartsStatus(targetItem.filename, initEngine, initMethod, targetItem.total_pages, Boolean(isPartialDoc && targetItem.etl_status === 'partial'));
    }
  }, [isOpen, targetItem, defaultEngine, defaultMethod, defaultFormula, defaultStrategy, defaultAllPages, defaultStartPage, defaultEndPage, defaultPreserveNewlines, findNextUnparsedRange, refreshPartsStatus]);

  useEffect(() => {
    if (isOpen && targetItem) {
      refreshPartsStatus(targetItem.filename, engine, method, targetItem.total_pages, false);
    }
  }, [engine, method]);

  if (!isOpen || !targetItem) return null;

  const totalPages = targetItem.total_pages || 0;
  const maxPageIndex = Math.max(0, totalPages - 1);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleExecute = async () => {
    const params: ParseRequestParams = {
      filename: targetItem.filename,
      backend: engine,
      method: method,
      strategy: strategy,
      formula: formula,
      all_pages: execMode === 'part' ? false : allPages,
      start_page: (execMode === 'part' || !allPages) ? startPage : null,
      end_page: (execMode === 'part' || !allPages) ? endPage : null,
      preserve_newlines: preserveNewlines,
      mode: execMode,
      lang: 'korean',
    };

    await onRun(params, saveAsDefault);
    onClose();
  };

  const handleMergeAndChunk = async () => {
    const params: ParseRequestParams = {
      filename: targetItem.filename,
      backend: engine,
      method: method,
      strategy: strategy,
      formula: formula,
      all_pages: true,
      preserve_newlines: preserveNewlines,
      mode: 'merge_chunk',
      lang: 'korean',
    };
    await onRun(params, saveAsDefault);
    onClose();
  };

  const handleClearParts = async () => {
    if (!window.confirm('저장된 분할 파싱 임시 데이터를 모두 초기화하시겠습니까?')) return;
    try {
      await clearEtlParts(targetItem.filename, engine, method);
      setPartsStatus(null);
    } catch (err) {
      console.error('Failed to clear parts:', err);
    }
  };

  const handleSelectNextBatch = (batchSize: number) => {
    setExecMode('part');
    setAllPages(false);
    const parsed = partsStatus?.parsed_pages || [];
    const [ns, ne] = findNextUnparsedRange(parsed, totalPages, batchSize);
    setStartPage(ns);
    setEndPage(ne);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh] transition-colors"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0 shadow-2xs">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                ETL 파싱 실행 설정 확인
                {targetItem.etl_status === 'completed' && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                    재파싱
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                기본 파서 설정값을 확인하고, 필요 시 본 문서에 맞게 조정 후 실행합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 overflow-y-auto min-h-0 flex-1">
          {/* Target Document Summary Card */}
          <div className="bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-xl p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 rounded-lg shadow-2xs shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate" title={targetItem.filename}>
                  {targetItem.filename}
                </p>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>총 {totalPages} 페이지</span>
                  <span>•</span>
                  <span>{formatBytes(targetItem.size_bytes)}</span>
                  {targetItem.etl_status === 'completed' && (
                    <>
                      <span>•</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">이전 완료됨 ({targetItem.stats?.total_chunks || 0} 청크)</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <span
              className={`shrink-0 px-2 py-1 rounded-lg text-xs font-semibold border ${
                targetItem.etl_status === 'completed'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                  : targetItem.etl_status === 'running'
                  ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                  : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
              }`}
            >
              {targetItem.etl_status === 'completed' ? '기존 산출물 존재' : targetItem.etl_status === 'running' ? '파싱 진행 중' : '미파싱'}
            </span>
          </div>

          {/* Options Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 1. Engine (Tier) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                <span>MinerU 파싱 티어 (Tier)</span>
              </label>
              <select
                value={engine}
                onChange={(e) => setEngine(normalizeMineruTier(e.target.value))}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              >
                {MINERU_TIER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                일반 PDF에는 Basic이 빠르고 안정적이며, 복잡한 레이아웃은 Standard/Advanced를 권장합니다.
              </p>
            </div>

            {/* 2. OCR Method */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
                  <span>추출 방식 (OCR 모드)</span>
                </label>
                {method === 'ocr' && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.2 rounded border border-amber-200 dark:border-amber-800">
                    강제 OCR
                  </span>
                )}
              </div>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium transition-colors ${
                  method === 'ocr'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-semibold'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white'
                }`}
              >
                <option value="auto">Auto (자동 판별 - 일반 디지털 PDF)</option>
                <option value="ocr">OCR (강제 광학 인식 - 숫자/괄호/표 보존)</option>
                <option value="txt">Txt (순수 텍스트 레이어 직접 추출)</option>
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                숫자·특수기호 누락 시 'OCR'을 권장합니다.
              </p>
            </div>

            {/* 3. Chunking Strategy */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-indigo-500" />
                <span>계층 청킹 전략 (Strategy)</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label
                  className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all ${
                    strategy === 'general'
                      ? 'bg-indigo-50/80 dark:bg-indigo-950/50 border-indigo-400 dark:border-indigo-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="modal_chunk_strategy"
                    value="general"
                    checked={strategy === 'general'}
                    onChange={(e) => setStrategy(e.target.value)}
                    className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                      일반 문서 (General Markdown)
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug block mt-0.5">
                      제목(H1~H4)과 본문 구조에 맞춰 유연한 3계층 목차 및 청크 구성
                    </span>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all ${
                    strategy === 'legal'
                      ? 'bg-purple-50/80 dark:bg-purple-950/50 border-purple-400 dark:border-purple-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="modal_chunk_strategy"
                    value="legal"
                    checked={strategy === 'legal'}
                    onChange={(e) => setStrategy(e.target.value)}
                    className="mt-0.5 text-purple-600 focus:ring-purple-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-purple-900 dark:text-purple-300 block">
                      ⚖️ 규정 및 법률 (장·조·항 완결형)
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug block mt-0.5">
                      사규, 조례, 법령 등 제n조/제n항 단위로 문맥이 분절되지 않는 정밀 청킹
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* 4. Formula Toggle */}
            <div className="sm:col-span-2 bg-slate-50 dark:bg-slate-950/70 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                  LaTeX 수식 인식 활성화
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  수학/과학 논문 외 일반 문서의 경우 해제 시 괄호·숫자 왜곡을 방지할 수 있습니다.
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formula}
                  onChange={(e) => setFormula(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {/* 4.5. Preserve Newlines & Soft-wrap Repair Toggle */}
            <div className="sm:col-span-2 bg-slate-50 dark:bg-slate-950/70 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                  문장/파싱 단위 줄바꿈 보존 (Soft-wrap 자동 보정)
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  PDF 너비로 인해 끊긴 단순 개행은 연결하고, 조항 및 문장 종결 단위로 줄바꿈하여 청크 가독성을 높입니다.
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={preserveNewlines}
                  onChange={(e) => setPreserveNewlines(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {/* 5. Execution Mode & Page Range */}
            <div className="sm:col-span-2 bg-slate-50 dark:bg-slate-950/70 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              {/* Execution Mode Toggle */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  실행 방식
                </span>
                <div className="inline-flex rounded-xl bg-slate-200/70 dark:bg-slate-900 p-0.5 border border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setExecMode('full')}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                      execMode === 'full'
                        ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    일괄 파싱 + 청킹
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExecMode('part');
                      setAllPages(false);
                    }}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                      execMode === 'part'
                        ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    분할 파싱 (틈틈히 부분 저장)
                  </button>
                </div>
              </div>

              {/* Split Parse Progress Card */}
              {(execMode === 'part' || (partsStatus && partsStatus.parsed_count > 0)) && (
                <div className="bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-800/60 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                        분할 파싱 진행 현황 ({engine} / {method})
                      </span>
                      {isLoadingParts && <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />}
                    </div>
                    {partsStatus && partsStatus.parsed_count > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono font-bold text-amber-700 dark:text-amber-300">
                          {partsStatus.parsed_count} / {partsStatus.total_pages || totalPages}p (
                          {Math.round((partsStatus.parsed_count / Math.max(1, partsStatus.total_pages || totalPages)) * 100)}%)
                        </span>
                        <button
                          type="button"
                          onClick={handleClearParts}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                          title="분할 파싱 임시 데이터 초기화"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  {partsStatus && partsStatus.parsed_count > 0 ? (
                    <>
                      <div className="w-full h-2 bg-amber-200/60 dark:bg-amber-900/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 dark:bg-amber-400 transition-all duration-300"
                          style={{
                            width: `${Math.min(100, Math.round((partsStatus.parsed_count / Math.max(1, partsStatus.total_pages || totalPages)) * 100))}%`,
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="text-amber-800 dark:text-amber-300 font-semibold">완료 구간:</span>
                        {partsStatus.parsed_ranges.map(([s, e], idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-900/80 border border-amber-200 dark:border-amber-800 font-mono text-amber-800 dark:text-amber-200"
                          >
                            {s === e ? `${s}p` : `${s}~${e}p`}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                      아직 분할 저장된 페이지가 없습니다. 원하는 페이지 구간만 먼저 파싱해 두고, 나중에 최종 병합·청킹할 수 있습니다.
                    </p>
                  )}

                  {/* Quick Next Batch Buttons + Merge & Chunk Button */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">빠른 구간 선택:</span>
                      {[5, 10, 20].map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => handleSelectNextBatch(size)}
                          className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors cursor-pointer"
                        >
                          다음 {size}p
                        </button>
                      ))}
                    </div>

                    {partsStatus && partsStatus.parsed_count > 0 && (
                      <button
                        type="button"
                        onClick={handleMergeAndChunk}
                        disabled={isParsing}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                      >
                        <GitMerge className="w-3.5 h-3.5" />
                        <span>파싱본 병합 & 청킹 ({partsStatus.parsed_count}p)</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    파싱 대상 페이지 범위
                  </span>
                </div>
                {execMode === 'full' && (
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-indigo-700 dark:text-indigo-400">
                    <input
                      type="checkbox"
                      checked={allPages}
                      onChange={(e) => setAllPages(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                    />
                    <span>전체 페이지 파싱 (0 ~ {maxPageIndex}p)</span>
                  </label>
                )}
              </div>

              {(execMode === 'part' || !allPages) && (
                <div className="flex items-center gap-3 pt-1 text-xs">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-slate-500 font-medium whitespace-nowrap">시작 페이지:</span>
                    <input
                      type="number"
                      min={0}
                      max={maxPageIndex}
                      value={startPage}
                      onChange={(e) => setStartPage(Math.max(0, Math.min(maxPageIndex, parseInt(e.target.value) || 0)))}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-center font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-slate-400 font-bold">~</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-slate-500 font-medium whitespace-nowrap">종료 페이지:</span>
                    <input
                      type="number"
                      min={0}
                      max={maxPageIndex}
                      value={endPage}
                      onChange={(e) => setEndPage(Math.max(0, Math.min(maxPageIndex, parseInt(e.target.value) || 0)))}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-center font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0 font-mono">
                    (총 {totalPages}p 중 {Math.max(0, endPage - startPage + 1)}p)
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
            />
            <span>현재 설정을 기본 파서 옵션으로 저장</span>
          </label>

          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleExecute}
              disabled={isParsing}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>
                {execMode === 'part'
                  ? `분할 파싱 실행 (${startPage}~${endPage}p)`
                  : targetItem.etl_status === 'completed'
                  ? '재파싱 실행'
                  : 'ETL 파싱 시작'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

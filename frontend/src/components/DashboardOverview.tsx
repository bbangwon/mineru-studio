import React, { useState, useMemo, useRef } from 'react';
import {
  FileText,
  CheckCircle2,
  Layers,
  Database,
  Search,
  UploadCloud,
  RefreshCw,
  SlidersHorizontal,
  Play,
  Download,
  Clock,
  Table as TableIcon,
  Sparkles,
  AlertCircle,
  FolderOpen,
  Check,
  FileCode2,
  ChevronRight,
  Settings2,
  Trash2,
  AlertTriangle,
  X,
  Save,
  RotateCcw,
  Loader2,
  Archive,
} from 'lucide-react';
import type { PdfItem, GlobalStats, JobStatusResponse, ParseRequestParams } from '../types';
import { RunEtlModal } from './RunEtlModal';

interface DashboardOverviewProps {
  pdfList: PdfItem[];
  globalStats?: GlobalStats;
  selectedPdf: string;
  onSelectPdf: (filename: string) => Promise<void>;
  onSelectAndOpenStudio: (filename: string) => Promise<void>;
  onUploadPdf: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDropUploadPdf: (file: File) => Promise<void>;
  isUploading: boolean;
  onRunEtl: (params?: string | Partial<ParseRequestParams>, saveAsDefault?: boolean) => Promise<void>;
  isParsing: boolean;
  activeJob: JobStatusResponse | null;
  onRefreshList: () => Promise<void>;
  onOpenQdrantModal: () => void;
  onOpenBackup?: () => void;
  onDeletePdf?: (filename: string, deleteVectors: boolean) => Promise<void>;
  onResetEtl?: (filename: string, deleteVectors: boolean) => Promise<void>;
  // Parser settings pass-through
  engine: string;
  setEngine: (v: string) => void;
  method: string;
  setMethod: (v: string) => void;
  formula: boolean;
  setFormula: (v: boolean) => void;
  strategy: string;
  setStrategy: (v: string) => void;
  allPages: boolean;
  setAllPages: (v: boolean) => void;
  startPage: number;
  setStartPage: (v: number) => void;
  endPage: number;
  setEndPage: (v: number) => void;
  preserveNewlines: boolean;
  setPreserveNewlines: (v: boolean) => void;
  onSaveParserConfig?: () => Promise<void>;
  onResetParserConfig?: () => Promise<void>;
  isSavingParserConfig?: boolean;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  pdfList,
  globalStats,
  selectedPdf,
  onSelectPdf,
  onSelectAndOpenStudio,
  onUploadPdf,
  onDropUploadPdf,
  isUploading,
  onRunEtl,
  isParsing,
  activeJob,
  onRefreshList,
  onOpenQdrantModal,
  onOpenBackup,
  onDeletePdf,
  onResetEtl,
  engine,
  setEngine,
  method,
  setMethod,
  formula,
  setFormula,
  strategy,
  setStrategy,
  allPages,
  setAllPages,
  startPage,
  setStartPage,
  endPage,
  setEndPage,
  preserveNewlines,
  setPreserveNewlines,
  onSaveParserConfig,
  onResetParserConfig,
  isSavingParserConfig = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'running' | 'not_started' | 'embedded'>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteTargetItem, setDeleteTargetItem] = useState<PdfItem | null>(null);
  const [deleteMode, setDeleteMode] = useState<'full' | 'reset'>('full');
  const [deleteVectors, setDeleteVectors] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [etlTargetItem, setEtlTargetItem] = useState<PdfItem | null>(null);
  const [isEtlModalOpen, setIsEtlModalOpen] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [isExportingMerged, setIsExportingMerged] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File size formatter
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Filtered documents
  const filteredList = useMemo(() => {
    return pdfList.filter((item) => {
      const matchName = item.filename.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchName) return false;

      if (statusFilter === 'all') return true;
      if (statusFilter === 'completed') return item.etl_status === 'completed';
      if (statusFilter === 'running') return item.etl_status === 'running';
      if (statusFilter === 'not_started') return item.etl_status === 'not_started';
      if (statusFilter === 'embedded') return !!item.is_embedded;
      return true;
    });
  }, [pdfList, searchQuery, statusFilter]);

  // 파싱 완료된 대상 파일 목록 (필터된 목록 기준)
  const completedDocsInFiltered = useMemo(() => {
    return filteredList.filter((item) => item.etl_status === 'completed').map((item) => item.filename);
  }, [filteredList]);

  // 완료 문서 전체 선택 여부
  const isAllCompletedSelected = useMemo(() => {
    return completedDocsInFiltered.length > 0 && completedDocsInFiltered.every((f) => selectedDocs.has(f));
  }, [completedDocsInFiltered, selectedDocs]);

  // 개별 문서 선택 토글
  const handleToggleSelectDoc = (filename: string) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  // 파싱 완료 문서 전체 선택 / 전체 해제 토글
  const handleToggleSelectAll = () => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (isAllCompletedSelected) {
        completedDocsInFiltered.forEach((f) => next.delete(f));
      } else {
        completedDocsInFiltered.forEach((f) => next.add(f));
      }
      return next;
    });
  };

  // 선택 해제
  const handleClearSelectedDocs = () => {
    setSelectedDocs(new Set());
  };

  // 선택 문서 통합 JSONL 다운로드
  const handleDownloadMergedJsonl = async () => {
    if (selectedDocs.size === 0) return;
    try {
      setIsExportingMerged(true);
      const res = await fetch('/api/etl/export/jsonl/merged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames: Array.from(selectedDocs) }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: '다운로드 실패' }));
        throw new Error(errData.detail || '통합 JSONL 파일 생성에 실패했습니다.');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `merged_rag_chunks_${selectedDocs.size}docs.jsonl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || '통합 JSONL 다운로드 중 오류가 발생했습니다.');
    } finally {
      setIsExportingMerged(false);
    }
  };

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.pdf')) {
        await onDropUploadPdf(file);
      }
    }
  };

  // Aggregated KPIs
  const metrics = useMemo(() => {
    const totalPdfs = pdfList.length;
    const parsedPdfs = pdfList.filter((p) => p.etl_status === 'completed').length;
    const embeddedPdfs = pdfList.filter((p) => p.is_embedded).length;
    const totalChunks = globalStats?.total_chunks ?? pdfList.reduce((acc, cur) => acc + (cur.stats?.total_chunks || 0), 0);
    const totalSections = pdfList.reduce((acc, cur) => acc + (cur.stats?.parent_sections || 0), 0);

    return {
      totalPdfs,
      parsedPdfs,
      embeddedPdfs,
      totalChunks,
      totalSections,
    };
  }, [pdfList, globalStats]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 relative transition-colors"
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={onUploadPdf}
        disabled={isUploading}
      />

      {/* Drag overlay notice */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-indigo-950/80 backdrop-blur-sm border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center text-white pointer-events-none animate-in fade-in duration-150">
          <UploadCloud className="w-16 h-16 text-indigo-400 animate-bounce mb-3" />
          <p className="text-xl font-bold">PDF 문서를 이곳에 놓아 즉시 업로드하세요</p>
          <p className="text-sm text-indigo-200 mt-1">자동으로 파일이 등록되며 ETL 파이프라인에 추가됩니다.</p>
        </div>
      )}

      {/* Top Banner: Header + Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xs transition-colors">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                문서 ETL & RAG 파이프라인 현황
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                MinerU 파싱, 계층 청킹 정제 및 Qdrant 하이브리드 벡터 색인 통합 관제
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all flex items-center gap-2 cursor-pointer shadow-2xs ${
              showSettings
                ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
            title="신규 파싱 시 적용될 기본 파라미터 템플릿 설정"
          >
            <Settings2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>기본 파서 옵션</span>
          </button>

          {onOpenBackup && (
            <button
              type="button"
              onClick={onOpenBackup}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all flex items-center gap-2 cursor-pointer shadow-2xs"
              title="작업공간 및 데이터 스냅샷 백업 & 원복 관리"
            >
              <Archive className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>백업 & 원복</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onRefreshList()}
            className="p-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors cursor-pointer shadow-2xs"
            title="상태 새로고침"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
          >
            <UploadCloud className="w-4 h-4" />
            <span>{isUploading ? '업로드 중...' : '신규 PDF 등록'}</span>
          </button>
        </div>
      </div>

      {/* Parser Settings Panel (Collapsible) */}
      {showSettings && (
        <div className="bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/30 rounded-2xl p-4 sm:p-5 shadow-md transition-colors animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 font-semibold">
            <span className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <SlidersHorizontal className="w-4 h-4" />
              신규 파싱 기본 옵션 (Default Parser Settings)
            </span>
            <span className="text-[11px] text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md font-normal">
              💡 각 문서의 'ETL 실행' 클릭 시 본 설정값이 팝업에 기본으로 채워지며, 실행 전 변경 가능합니다.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* 1. Engine */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">MinerU 엔진</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="pipeline">Pipeline (MLX / 고속 파이프라인)</option>
                <option value="hybrid-engine">Hybrid-Engine (VLM 레이아웃)</option>
              </select>
            </div>

            {/* 2. Extraction Method (Auto / OCR / Txt) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  추출 방식 (OCR 모드)
                </label>
                {method === 'ocr' && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800/60">
                    강제 OCR 활성
                  </span>
                )}
              </div>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={`w-full border rounded-xl px-3 py-2 focus:outline-none font-medium transition-colors ${
                  method === 'ocr'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700/70 text-amber-900 dark:text-amber-200 font-semibold focus:border-amber-500'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:border-indigo-500'
                }`}
                title="CMap 결함으로 숫자나 괄호가 누락될 경우 'OCR' 모드를 선택하세요"
              >
                <option value="auto">Auto (자동 판별 - 일반 디지털 PDF)</option>
                <option value="ocr">OCR (강제 광학 인식 - 숫자/괄호/표 보존)</option>
                <option value="txt">Txt (순수 텍스트 레이어 직접 추출)</option>
              </select>
            </div>

            {/* 3. Chunking Strategy */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">청킹 전략 (Strategy)</label>
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="general">일반 문서 (General Markdown/Structure)</option>
                <option value="legal">⚖️ 규정 및 법률 문서 (조/항/호 계층 파싱)</option>
                <option value="report">학술/기술 보고서 (표/수식 집중)</option>
              </select>
            </div>

            {/* 4. Formula Parsing Toggle */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">수식(LaTeX) 파싱</label>
              <div className="flex items-center gap-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formula}
                    onChange={(e) => setFormula(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700"
                  />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">
                    LaTeX 수식 인식 활성화
                  </span>
                </label>
              </div>
            </div>

            {/* 4.5. Preserve Newlines Toggle */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">문장 단위 줄바꿈</label>
              <div className="flex items-center gap-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={preserveNewlines}
                    onChange={(e) => setPreserveNewlines(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700"
                  />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">
                    문장/파싱 단위 줄바꿈 보존
                  </span>
                </label>
              </div>
            </div>

            {/* 5. Page Range Mode */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">페이지 범위 모드</label>
              <div className="flex items-center gap-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allPages}
                    onChange={(e) => setAllPages(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700"
                  />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">문서 전체 파싱 (권장)</span>
                </label>
              </div>
            </div>

            {/* 6. Page Range Inputs */}
            {!allPages ? (
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">페이지 범위 (0-indexed)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={startPage}
                    onChange={(e) => setStartPage(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-center font-medium"
                    placeholder="시작"
                  />
                  <span className="text-slate-400">~</span>
                  <input
                    type="number"
                    min={startPage}
                    value={endPage}
                    onChange={(e) => setEndPage(Math.max(startPage, parseInt(e.target.value) || 0))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-center font-medium"
                    placeholder="끝"
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-end pb-2 text-slate-500 dark:text-slate-400 text-[11px]">
                <span>문서의 1페이지부터 마지막 페이지까지 전체를 파싱합니다.</span>
              </div>
            )}
          </div>

          {/* Action Bar: Save to Backend & Reset */}
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
              <span>💾 설정을 저장하면 서버(output/parser_config.json)에 영구 보존되어 새로고침 후에도 유지됩니다.</span>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              {onResetParserConfig && (
                <button
                  type="button"
                  onClick={onResetParserConfig}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="초기 기본 권장 옵션으로 되돌립니다"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>기본값 리셋</span>
                </button>
              )}

              {onSaveParserConfig && (
                <button
                  type="button"
                  onClick={onSaveParserConfig}
                  disabled={isSavingParserConfig}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl shadow-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  title="현재 선택된 옵션들을 서버 기본 파서 옵션으로 저장합니다"
                >
                  {isSavingParserConfig ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>{isSavingParserConfig ? '저장 중...' : '기본 설정 저장'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Global KPI Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Total PDFs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 shadow-2xs transition-colors">
          <div className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">전체 등록 문서</p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-mono">{metrics.totalPdfs}</span>
              <span className="text-xs text-slate-500">개 PDF</span>
            </div>
          </div>
        </div>

        {/* Card 2: Parsed PDFs */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 shadow-2xs transition-colors">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">ETL 파싱 완료</p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{metrics.parsedPdfs}</span>
              <span className="text-xs text-slate-500">/ {metrics.totalPdfs} 문서</span>
            </div>
          </div>
        </div>

        {/* Card 3: Total Extracted Chunks */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center gap-3.5 shadow-2xs transition-colors">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">총 생성 청크 수</p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-bold text-indigo-600 dark:text-indigo-300 font-mono">
                {metrics.totalChunks.toLocaleString()}
              </span>
              <span className="text-xs text-slate-500">개 자식 청크</span>
            </div>
          </div>
        </div>

        {/* Card 4: Qdrant Indexed */}
        <div
          onClick={onOpenQdrantModal}
          className={`bg-white dark:bg-slate-900 border ${
            globalStats?.qdrant_connected === false
              ? 'border-amber-400 dark:border-amber-600/70 hover:border-amber-500'
              : 'border-slate-200 dark:border-slate-800 hover:border-amber-500/50'
          } rounded-2xl p-4 flex items-center gap-3.5 shadow-2xs cursor-pointer transition-all group`}
          title={
            globalStats?.qdrant_connected === false
              ? 'Qdrant 접속 불가 (로컬 캐시 기준 표시 중) - 클릭하여 설정 확인'
              : 'Qdrant 연결 및 컬렉션 설정 열기'
          }
        >
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 group-hover:bg-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 transition-colors">
            <Database className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Qdrant 색인</p>
              {globalStats?.qdrant_connected === false ? (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  캐시 모드
                </span>
              ) : globalStats?.qdrant_connected === true ? (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  정상 연결
                </span>
              ) : null}
            </div>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl sm:text-2xl font-bold text-amber-600 dark:text-amber-300 font-mono">{metrics.embeddedPdfs}</span>
              <span className="text-xs text-slate-500">개 문서 색인됨</span>
            </div>
          </div>
        </div>
      </div>

      {/* Active Job Real-time Monitor Banner */}
      {(isParsing || (activeJob && (activeJob.status === 'running' || activeJob.status === 'pending'))) && (
        <div className="bg-gradient-to-r from-indigo-50 dark:from-indigo-950 via-slate-50 dark:via-slate-900 to-indigo-50 dark:to-indigo-950 border border-indigo-200 dark:border-indigo-500/40 rounded-2xl p-4 sm:p-5 shadow-md relative overflow-hidden transition-colors">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-600/20 dark:bg-indigo-600/30 border border-indigo-400/50 flex items-center justify-center text-indigo-600 dark:text-indigo-300 shrink-0 animate-pulse">
                <RefreshCw className="w-4 h-4 animate-spin" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                    백그라운드 ETL 작업 실행 중
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 rounded font-mono border border-indigo-500/30">
                    {activeJob?.task_id || 'Task in progress'}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                  {activeJob?.filename || selectedPdf}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                  <span>{activeJob?.progress_msg || 'MinerU 파이프라인 엔진으로 문서 파싱 중...'}</span>
                  {activeJob?.elapsed_time ? (
                    <span className="text-slate-500 dark:text-slate-400 font-mono">({activeJob.elapsed_time}s 경과)</span>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <span className="text-xs text-indigo-600 dark:text-indigo-300 font-mono font-semibold animate-pulse">
                파싱 및 계층 청킹 진행 중...
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Document Pipeline Management Table Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs transition-colors">
        {/* Table Toolbar & Filters */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3.5">
          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              전체 ({pdfList.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('completed')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'completed'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              파싱 완료 ({pdfList.filter((p) => p.etl_status === 'completed').length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('embedded')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'embedded'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Qdrant 색인됨 ({pdfList.filter((p) => p.is_embedded).length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('not_started')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === 'not_started'
                  ? 'bg-slate-700 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              미변환 ({pdfList.filter((p) => p.etl_status === 'not_started').length})
            </button>
          </div>

          {/* Search Input & Mobile Hint */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative w-full md:w-64 shrink-0">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="문서명 검색..."
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-medium"
              />
            </div>
            <span className="lg:hidden text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap hidden sm:inline-block">
              ↔ 가로 스크롤 가능
            </span>
          </div>
        </div>

        {/* Bulk Actions Banner (When 1 or more documents are selected) */}
        {selectedDocs.size > 0 && (
          <div className="mx-4 sm:mx-6 mb-3 p-3 bg-indigo-50/90 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/80 rounded-2xl flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-200 shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-2xs">
                {selectedDocs.size}
              </span>
              <div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {selectedDocs.size}개 문서 선택됨
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  128-bit UUID 고유 식별자(A안)로 충돌 없이 안전하게 단일 JSONL로 병합됩니다.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClearSelectedDocs}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                선택 해제
              </button>
              <button
                type="button"
                onClick={handleDownloadMergedJsonl}
                disabled={isExportingMerged}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                {isExportingMerged ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>병합 생성 중...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>선택 문서 통합 JSONL 다운로드 ({selectedDocs.size})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800 select-none">
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllCompletedSelected}
                    onChange={handleToggleSelectAll}
                    disabled={completedDocsInFiltered.length === 0}
                    title={
                      completedDocsInFiltered.length === 0
                        ? '선택 가능한 파싱 완료 문서가 없습니다'
                        : isAllCompletedSelected
                        ? '전체 선택 해제'
                        : '파싱 완료 문서 전체 선택'
                    }
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-40 align-middle"
                  />
                </th>
                <th className="py-3 px-4 w-2/5">PDF 문서 정보</th>
                <th className="py-3 px-3">ETL 파싱 상태</th>
                <th className="py-3 px-3">추출 청크 & 구조</th>
                <th className="py-3 px-3">검수/저장</th>
                <th className="py-3 px-3">Qdrant 색인</th>
                <th className="py-3 px-4 text-right">파이프라인 액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">검색 조건에 맞는 PDF 문서가 없습니다.</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">상단의 '신규 PDF 등록' 버튼을 눌러 새 문서를 추가하세요.</p>
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => {
                  const isCurrent = item.filename === selectedPdf;
                  const isRunningThis =
                    isParsing && activeJob?.filename === item.filename;

                  return (
                    <tr
                      key={item.filename}
                      className={`group transition-colors ${
                        selectedDocs.has(item.filename)
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/30'
                          : isCurrent
                          ? 'bg-indigo-50/40 dark:bg-indigo-950/15 hover:bg-indigo-50 dark:hover:bg-indigo-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                      }`}
                    >
                      {/* Selection Checkbox */}
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedDocs.has(item.filename)}
                          onChange={() => handleToggleSelectDoc(item.filename)}
                          disabled={item.etl_status !== 'completed'}
                          title={
                            item.etl_status !== 'completed'
                              ? '파싱 완료된 문서만 선택할 수 있습니다'
                              : '통합 JSONL 다운로드 대상 선택'
                          }
                          className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed align-middle"
                        />
                      </td>
                      {/* 1. PDF Info */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                              isCurrent
                                ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => onSelectPdf(item.filename)}
                                className={`font-semibold truncate max-w-sm sm:max-w-md text-left cursor-pointer hover:underline ${
                                  isCurrent ? 'text-indigo-600 dark:text-indigo-300 font-bold' : 'text-slate-900 dark:text-slate-200'
                                }`}
                                title={`${item.filename} (클릭하여 현재 작업 문서로 선택)`}
                              >
                                {item.filename}
                              </button>
                              {isCurrent && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 font-semibold shrink-0">
                                  현재 작업 중
                                </span>
                              )}
                            </div>

                            {/* 추출 방식 & 청킹 전략 태그 뱃지 */}
                            {(item.method || item.strategy || item.backend) && (
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {item.method && (
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                      item.method === 'ocr'
                                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                        : item.method === 'txt'
                                        ? 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30'
                                        : 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30'
                                    }`}
                                    title={`MinerU 파싱 방식: ${item.method.toUpperCase()} (${item.backend || 'pipeline'})`}
                                  >
                                    {item.method === 'ocr'
                                      ? 'OCR 강제인식'
                                      : item.method === 'txt'
                                      ? 'Txt 직접추출'
                                      : 'Auto 자동판별'}
                                  </span>
                                )}

                                {item.strategy && (
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                      item.strategy === 'legal'
                                        ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30'
                                        : item.strategy === 'report'
                                        ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30'
                                        : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                    }`}
                                    title={`청킹 전략: ${item.strategy}`}
                                  >
                                    {item.strategy === 'legal'
                                      ? '⚖️ 조문 계층(법률)'
                                      : item.strategy === 'report'
                                      ? '기술/수식 보고서'
                                      : '일반 문서'}
                                  </span>
                                )}

                                {item.backend && item.backend !== 'pipeline' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-medium">
                                    {item.backend}
                                  </span>
                                )}
                              </div>
                            )}

                            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              <span>{formatBytes(item.size_bytes)}</span>
                              <span>•</span>
                              <span>{item.total_pages} 페이지</span>
                              {item.last_modified && (
                                <>
                                  <span>•</span>
                                  <span className="text-slate-400 dark:text-slate-500">수정 {item.last_modified}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. ETL Parsing Status */}
                      <td className="py-3.5 px-3">
                        {isRunningThis || item.etl_status === 'running' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 animate-pulse">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            파싱 중...
                          </span>
                        ) : item.etl_status === 'completed' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                            <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            파싱 완료
                          </span>
                        ) : item.etl_status === 'failed' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                            <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                            파싱 실패
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            미변환 (대기)
                          </span>
                        )}
                      </td>

                      {/* 3. Extracted Chunks & Hierarchy */}
                      <td className="py-3.5 px-3">
                        {item.stats ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-200">
                                {item.stats.total_chunks}
                              </span>
                              <span className="text-slate-500 dark:text-slate-400 text-[11px]">청크</span>
                              {item.stats.tables_count > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                  <TableIcon className="w-2.5 h-2.5" />
                                  표 {item.stats.tables_count}개
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500">
                              {item.stats.parent_sections}개 섹션 • ~{item.stats.estimated_tokens.toLocaleString()} 토큰
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">-</span>
                        )}
                      </td>

                      {/* 4. Edit / Review Status */}
                      <td className="py-3.5 px-3">
                        {item.has_saved_edit ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 font-semibold">
                            <FileCode2 className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                            수정본 저장됨
                          </span>
                        ) : item.etl_status === 'completed' ? (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">기본 파싱 원형</span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">-</span>
                        )}
                      </td>

                      {/* 5. Qdrant Indexed Status */}
                      <td className="py-3.5 px-3">
                        {item.is_embedded ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            색인 완료
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                            <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700 inline-block" />
                            미색인
                          </span>
                        )}
                      </td>

                      {/* 6. Pipeline Action Buttons */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Open in Studio Button (Primary) */}
                          <button
                            type="button"
                            onClick={() => onSelectAndOpenStudio(item.filename)}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-2xs flex items-center gap-1 transition-all cursor-pointer"
                            title="이 문서의 계층 트리와 청크를 에디터에서 열기"
                          >
                            <span>스튜디오에서 열기</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>

                          {/* ETL Parse Button */}
                          <button
                            type="button"
                            onClick={() => {
                              setEtlTargetItem(item);
                              setIsEtlModalOpen(true);
                            }}
                            disabled={isParsing}
                            className={`p-1.5 rounded-xl border transition-all cursor-pointer disabled:opacity-40 shadow-2xs ${
                              item.etl_status === 'completed'
                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'
                                : 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-500'
                            }`}
                            title={item.etl_status === 'completed' ? '파싱 옵션 확인 및 재파싱 실행' : '파싱 옵션 확인 및 ETL 파싱 시작'}
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>

                          {/* Direct JSONL Export Button */}
                          {item.etl_status === 'completed' && (
                            <a
                              href={`/api/etl/export/jsonl?filename=${encodeURIComponent(item.filename)}`}
                              className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors shadow-2xs"
                              title="RAG 표준 JSONL 다운로드"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          )}

                          {/* Delete Document or Reset ETL Button */}
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteTargetItem(item);
                              setDeleteMode('full');
                              setDeleteVectors(!!item.is_embedded);
                            }}
                            disabled={isRunningThis}
                            className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-slate-200 dark:border-slate-700 transition-colors shadow-2xs cursor-pointer disabled:opacity-30"
                            title={isRunningThis ? '파싱 작업 진행 중에는 삭제할 수 없습니다' : '문서 삭제 또는 파싱 초기화'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete / Reset Confirmation Modal */}
      {deleteTargetItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    문서 삭제 및 파싱 초기화
                  </h3>
                  <p className="text-xs text-slate-500">대시보드 목록에서 문서를 삭제하거나 파싱을 리셋합니다.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTargetItem(null)}
                disabled={isDeleting}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Document Info */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate" title={deleteTargetItem.filename}>
                    {deleteTargetItem.filename}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <span>{formatBytes(deleteTargetItem.size_bytes)}</span>
                    <span>•</span>
                    <span>{deleteTargetItem.total_pages} 페이지</span>
                    <span>•</span>
                    <span className={deleteTargetItem.etl_status === 'completed' ? 'text-emerald-600 font-medium' : ''}>
                      {deleteTargetItem.etl_status === 'completed' ? '파싱 완료됨' : '미변환'}
                    </span>
                    {deleteTargetItem.is_embedded && (
                      <>
                        <span>•</span>
                        <span className="text-amber-600 font-medium">Qdrant 색인됨</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Body Options */}
            <div className="p-6 space-y-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">삭제 작업 선택</p>

              <div className="space-y-2.5">
                {/* Option 1: Full Delete */}
                <label
                  className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                    deleteMode === 'full'
                      ? 'border-rose-500/50 bg-rose-50/50 dark:bg-rose-950/20 text-rose-950 dark:text-rose-200 shadow-2xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="deleteMode"
                    value="full"
                    checked={deleteMode === 'full'}
                    onChange={() => setDeleteMode('full')}
                    className="mt-1 text-rose-600 focus:ring-rose-500"
                  />
                  <div className="flex-1 text-xs">
                    <span className="font-bold text-sm block mb-0.5 text-slate-900 dark:text-white">
                      문서 완전 삭제 (추천)
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 leading-relaxed block">
                      원본 PDF 파일과 모든 파싱 산출물을 디스크에서 완전히 영구 삭제합니다. 대시보드 목록에서 제거되며, 필요 시 언제든 상단의 <strong>[신규 PDF 등록]</strong>으로 다시 가져올(Re-import) 수 있습니다.
                    </span>
                  </div>
                </label>

                {/* Option 2: Reset ETL Only */}
                <label
                  className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                    deleteMode === 'reset'
                      ? 'border-indigo-500/50 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-950 dark:text-indigo-200 shadow-2xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="deleteMode"
                    value="reset"
                    checked={deleteMode === 'reset'}
                    onChange={() => setDeleteMode('reset')}
                    className="mt-1 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="flex-1 text-xs">
                    <span className="font-bold text-sm block mb-0.5 text-slate-900 dark:text-white">
                      파싱 산출물만 초기화 (PDF 원본 유지)
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 leading-relaxed block">
                      PDF 원본 파일은 그대로 유지하고, 생성된 파싱 청크 및 마크다운 산출물만 지워 <strong>'미변환 (대기)'</strong> 초기 상태로 되돌립니다.
                    </span>
                  </div>
                </label>
              </div>

              {/* Vector Sync Checkbox (if embedded or always allowed) */}
              <div className="pt-2">
                <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteVectors}
                    onChange={(e) => setDeleteVectors(e.target.checked)}
                    className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-slate-300 dark:border-slate-700"
                  />
                  <span>Qdrant 벡터 DB 색인 포인트 및 임베딩 캐시 함께 삭제 (권장)</span>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
              <button
                type="button"
                onClick={() => setDeleteTargetItem(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-xl transition-all cursor-pointer disabled:opacity-50"
              >
                취소
              </button>

              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  if (!deleteTargetItem) return;
                  setIsDeleting(true);
                  try {
                    if (deleteMode === 'full') {
                      if (onDeletePdf) {
                        await onDeletePdf(deleteTargetItem.filename, deleteVectors);
                      }
                    } else {
                      if (onResetEtl) {
                        await onResetEtl(deleteTargetItem.filename, deleteVectors);
                      }
                    }
                    setDeleteTargetItem(null);
                  } catch (e) {
                    console.error('Action failed:', e);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className={`px-4 py-2 text-xs font-semibold rounded-xl text-white shadow-sm flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${
                  deleteMode === 'full'
                    ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700'
                    : 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700'
                }`}
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>처리 중...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{deleteMode === 'full' ? '문서 완전 삭제 실행' : '파싱 초기화 실행'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ETL Execution Confirmation & Parameter Modal */}
      <RunEtlModal
        isOpen={isEtlModalOpen}
        onClose={() => {
          setIsEtlModalOpen(false);
          setEtlTargetItem(null);
        }}
        targetItem={etlTargetItem}
        defaultEngine={engine}
        defaultMethod={method}
        defaultFormula={formula}
        defaultStrategy={strategy}
        defaultAllPages={allPages}
        defaultStartPage={startPage}
        defaultEndPage={endPage}
        defaultPreserveNewlines={preserveNewlines}
        onRun={async (params, saveAsDefault) => {
          await onRunEtl(params, saveAsDefault);
        }}
        isParsing={isParsing}
      />
    </div>
  );
};

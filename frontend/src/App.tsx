import { useState, useEffect, useCallback } from 'react';
import { useTheme } from './utils/useTheme';
import { Header } from './components/Header';
import { SidebarNav } from './components/SidebarNav';
import type { ActiveTab } from './components/SidebarNav';
import { FileText, LayoutDashboard, Sparkles } from 'lucide-react';
import { DashboardOverview } from './components/DashboardOverview';
import { ChunkStudio } from './components/ChunkStudio';
import { JsonlModal } from './components/JsonlModal';
import { QdrantConfigModal } from './components/QdrantConfigModal';
import { LLMConfigModal } from './components/LLMConfigModal';
import { BackupRestoreModal } from './components/BackupRestoreModal';
import { RetrievalPlayground } from './components/RetrievalPlayground';
import {
  getPdfList,
  selectPdf,
  uploadPdf,
  getEtlSample,
  startEtlJob,
  getJobStatus,
  getActiveJob,
  saveEtlResult,
  resetEtlResult,
  startEmbedJob,
  getEmbedStatus,
  getQdrantConfig,
  deletePdfDocument,
  resetEtlByFilename,
  getParserConfig,
  saveParserConfig,
  resetParserConfig,
  reindexEtlResult,
} from './api/client';
import {
  getNextChunkId,
  getNextParentChunkId,
  generateDocId,
  reindexEtlData,
  syncHierarchyOrder,
  estimateKoreanTokens,
  formatDisplayChunkId,
} from './utils/idUtils';
import { syncChunkPageMetadata, extractCustomMetadata, applyBulkCustomMetadata } from './utils/pageUtils';
import { deriveChunkTypeAndTables, mergeChunkAssets } from './utils/tableChunkUtils';
import type {
  PdfItem,
  GlobalStats,
  HierarchicalEtlResult,
  ChildChunk,
  ParentChunk,
  SectionNode,
  SectionInsertPosition,
  ParentInsertPosition,
  JobStatusResponse,
  ParseRequestParams,
  ReparentChildChunkParams,
} from './types';

/**
 * 백엔드 또는 이전 스키마 데이터를 3단계 정규 계층(Section - Parent - Child) 구조로 보정
 */
function normalizeEtlData(data: any): HierarchicalEtlResult {
  if (!data) return data;
  const sections: SectionNode[] = data.sections || data.parent_sections || [];
  const parent_chunks: ParentChunk[] = data.parent_chunks || [];
  const child_chunks: ChildChunk[] = (data.child_chunks || []).map((c: any) => ({
    ...c,
    parent_chunk_id: c.parent_chunk_id || c.parent_id || '',
    parent_id: c.parent_chunk_id || c.parent_id || '',
    section_id: c.section_id || '',
  }));
  return {
    ...data,
    sections,
    parent_sections: sections,
    parent_chunks,
    child_chunks,
  };
}

export function App() {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [pdfList, setPdfList] = useState<PdfItem[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | undefined>(undefined);
  const [selectedPdf, setSelectedPdf] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);

  const [engine, setEngine] = useState('pipeline');
  const [method, setMethod] = useState('auto');
  const [formula, setFormula] = useState(true);
  const [strategy, setStrategy] = useState<string>('general');
  const [allPages, setAllPages] = useState(true);
  const [startPage, setStartPage] = useState(0);
  const [endPage, setEndPage] = useState(2);
  const [preserveNewlines, setPreserveNewlines] = useState(true);
  const [isSavingParserConfig, setIsSavingParserConfig] = useState(false);

  const [isParsing, setIsParsing] = useState(false);
  const [activeJob, setActiveJob] = useState<JobStatusResponse | null>(null);
  const [isLoadingEtl, setIsLoadingEtl] = useState(true);
  const [etlData, setEtlData] = useState<HierarchicalEtlResult | null>(null);

  // Edit and Persistence States
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedParentChunkId, setSelectedParentChunkId] = useState<string | null>(null);
  void selectedParentChunkId;
  const [activeModalChunk, setActiveModalChunk] = useState<ChildChunk | null>(null);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);

  // LLM Refine & Config States
  const [isLLMConfigOpen, setIsLLMConfigOpen] = useState(false);

  // Backup & Restore State
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  // Qdrant & Indexing States
  const [isQdrantConfigOpen, setIsQdrantConfigOpen] = useState(false);
  const [qdrantCollection, setQdrantCollection] = useState<string>('');
  const [isIndexingQdrant, setIsIndexingQdrant] = useState(false);
  const [qdrantIndexProgress, setQdrantIndexProgress] = useState<{ msg: string; pct: number } | null>(null);

  // Responsive Sidebar States
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 4000);
  };

  const handleIndexQdrant = async () => {
    if (!etlData?.child_chunks || etlData.child_chunks.length === 0) {
      showToast('인덱싱할 청크가 없습니다. 먼저 문서를 파싱해주세요.', true);
      return;
    }

    // 부모 청크 맵 구성 (parent_chunk_id -> parent)
    const pMap = new Map<string, ParentChunk>();
    (etlData.parent_chunks || []).forEach((p) => {
      const pid = p.parent_chunk_id || p.id;
      if (pid) pMap.set(pid, p);
    });

    // is_ignored 청크는 제외하고 parent_text 주입
    const chunksToEmbed = etlData.child_chunks
      .filter((c) => !c.is_ignored)
      .map((c) => {
        const pid = c.parent_chunk_id || c.parent_id || '';
        const parent = pid ? pMap.get(pid) : undefined;
        return {
          ...c,
          parent_text: c.parent_text || parent?.text || '',
        };
      });

    if (chunksToEmbed.length === 0) {
      showToast('임베딩 대상 청크가 모두 제외(ignored) 상태입니다.', true);
      return;
    }

    try {
      setIsIndexingQdrant(true);
      setQdrantIndexProgress({ msg: '인덱싱 작업 요청 중...', pct: 5 });
      const res = await startEmbedJob({
        chunks: chunksToEmbed,
        parent_chunks: etlData.parent_chunks,
      });

      if (!res.success && res.status !== 'running') {
        showToast(res.message || '인덱싱 등록 실패', true);
        setIsIndexingQdrant(false);
        setQdrantIndexProgress(null);
        return;
      }

      showToast('Qdrant 하이브리드 색인 작업이 시작되었습니다.');

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await getEmbedStatus();
          if (statusRes.status === 'running') {
            setQdrantIndexProgress({
              msg: statusRes.progress_msg,
              pct: statusRes.progress_pct,
            });
          } else if (statusRes.status === 'done') {
            clearInterval(pollInterval);
            setIsIndexingQdrant(false);
            setQdrantIndexProgress(null);
            showToast(`Qdrant 색인 완료! (${statusRes.last_result?.upserted_count || 0}개 청크 적재됨)`);
          } else if (statusRes.status === 'error') {
            clearInterval(pollInterval);
            setIsIndexingQdrant(false);
            setQdrantIndexProgress(null);
            showToast(`인덱싱 오류: ${statusRes.error || '알 수 없는 오류'}`, true);
          }
        } catch {
          // ignore polling errors
        }
      }, 1500);
    } catch (err: any) {
      setIsIndexingQdrant(false);
      setQdrantIndexProgress(null);
      showToast(err.message || '인덱싱 시작 실패', true);
    }
  };

  const isLegalDoc = (name: string) => /규정|지침|기준|법률|조례|훈령|전문/.test(name);

  // 1. Initial Data Fetching
  const fetchPdfs = useCallback(async () => {
    try {
      const data = await getPdfList();
      setPdfList(data.pdfs || []);
      if (data.global_stats) {
        setGlobalStats(data.global_stats);
      }
      if (data.current) {
        setSelectedPdf(data.current);
        if (isLegalDoc(data.current)) {
          setStrategy('legal');
        }
        const currentItem = (data.pdfs || []).find((p) => p.filename === data.current);
        if (currentItem) {
          setEndPage(Math.max(0, currentItem.total_pages - 1));
        }
      } else if (data.pdfs && data.pdfs.length > 0) {
        setSelectedPdf(data.pdfs[0].filename);
        if (isLegalDoc(data.pdfs[0].filename)) {
          setStrategy('legal');
        }
        setEndPage(Math.max(0, data.pdfs[0].total_pages - 1));
      }
    } catch (err: any) {
      console.error(err);
      showToast('PDF 목록을 불러오는 중 오류 발생', true);
    }
  }, []);

  const fetchSample = useCallback(async (targetDoc?: string) => {
    setIsLoadingEtl(true);
    const docToFetch = targetDoc || selectedPdf;
    try {
      const data = await getEtlSample(strategy, docToFetch);
      const normalized = normalizeEtlData(data);
      setEtlData(normalized);
      const firstSec = normalized.sections?.find((s) => (s.child_chunk_ids?.length || 0) > 0) || normalized.sections?.[0];
      if (firstSec) {
        setSelectedSectionId(firstSec.id);
      } else {
        setSelectedSectionId(null);
      }
      if (data.active_pdf) {
        setSelectedPdf(data.active_pdf);
      }
      if (data.strategy) {
        setStrategy(data.strategy);
      }
    } catch (err: any) {
      console.warn('ETL 기존 데이터 로드 건너뜀:', err.message);
      // 대상 문서의 파싱 산출물이 없거나 초기화된 경우, 이전 문서의 데이터가 잔존하지 않도록 확실히 리셋
      setEtlData(null);
      setSelectedSectionId(null);
    } finally {
      setIsLoadingEtl(false);
    }
  }, [selectedPdf, strategy]);

  // Check if there is an active background task running on mount
  const checkActiveTask = useCallback(async () => {
    try {
      const runningJob = await getActiveJob();
      if (runningJob && (runningJob.status === 'running' || runningJob.status === 'pending')) {
        setActiveJob(runningJob);
        setIsParsing(true);
        if (runningJob.filename) {
          setSelectedPdf(runningJob.filename);
        }
        showToast(`기존 실행 중인 백그라운드 태스크(${runningJob.task_id})를 연결했습니다.`);
      }
    } catch (err) {
      console.warn('Active task check failed:', err);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const initData = async () => {
      try {
        await fetchPdfs();
      } catch (err) {
        console.warn('Initial fetchPdfs error:', err);
      }
      try {
        await fetchSample();
      } catch (err) {
        console.warn('Initial fetchSample error:', err);
      }
      try {
        await checkActiveTask();
      } catch (err) {
        console.warn('Initial checkActiveTask error:', err);
      }

      getQdrantConfig()
        .then((cfg) => {
          if (isMounted && cfg.collection_name) setQdrantCollection(cfg.collection_name);
        })
        .catch(() => {});

      getParserConfig()
        .then((cfg) => {
          if (!isMounted) return;
          if (cfg.backend) setEngine(cfg.backend);
          if (cfg.method) setMethod(cfg.method);
          if (cfg.formula !== undefined) setFormula(cfg.formula);
          if (cfg.strategy) setStrategy(cfg.strategy);
          if (cfg.all_pages !== undefined) setAllPages(cfg.all_pages);
          if (cfg.start_page !== undefined) setStartPage(cfg.start_page);
          if (cfg.end_page !== undefined) setEndPage(cfg.end_page);
          if (cfg.preserve_newlines !== undefined) setPreserveNewlines(cfg.preserve_newlines);
        })
        .catch((err) => {
          console.warn('Failed to load default parser config:', err);
        });
    };

    initData();

    return () => {
      isMounted = false;
    };
  }, []); // Run only ONCE on mount!

  // Polling loop for active background task
  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'running' && activeJob.status !== 'pending')) {
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        const job = await getJobStatus(activeJob.task_id);
        setActiveJob(job);

        if (job.status === 'completed') {
          setIsParsing(false);
          if (job.result) {
            const normalized = normalizeEtlData(job.result);
            setEtlData(normalized);
            const firstSec = normalized.sections?.find((s) => (s.child_chunk_ids?.length || 0) > 0) || normalized.sections?.[0];
            setSelectedSectionId(firstSec?.id || null);
            showToast(
              `🎉 백그라운드 ETL 완료! (소요: ${job.elapsed_time || 0}초, 청크: ${job.result.stats.total_child_chunks}개)`
            );
          }
          await fetchPdfs();
          clearInterval(intervalId);
        } else if (job.status === 'failed') {
          setIsParsing(false);
          showToast(`❌ 태스크 실패: ${job.error || '파싱 중 오류 발생'}`, true);
          await fetchPdfs();
          clearInterval(intervalId);
        }
      } catch (err: any) {
        console.error('Job polling error:', err);
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [activeJob?.task_id, activeJob?.status, fetchPdfs]);

  // 2. Select PDF Handler
  const handleSelectPdf = async (filename: string) => {
    setSelectedPdf(filename);
    const item = pdfList.find((p) => p.filename === filename);
    if (item) {
      if (item.strategy) {
        setStrategy(item.strategy);
      } else if (isLegalDoc(filename)) {
        setStrategy('legal');
      }
      if (item.method) {
        setMethod(item.method);
      }
      if (item.backend) {
        setEngine(item.backend);
      }
      setEndPage(Math.max(0, item.total_pages - 1));
    } else if (isLegalDoc(filename)) {
      setStrategy('legal');
    }
    try {
      await selectPdf(filename);
      await fetchSample(filename);
    } catch (err: any) {
      console.error(err);
      showToast(err.message, true);
    }
  };

  // Select PDF and Switch directly to Chunk Studio
  const handleSelectAndOpenStudio = async (filename: string) => {
    try {
      await handleSelectPdf(filename);
      setActiveTab('studio');
    } catch (err: any) {
      console.error(err);
      setActiveTab('studio');
    }
  };

  // 3. Upload PDF Handler
  const handleUploadPdf = async (file: File) => {
    setIsUploading(true);
    try {
      const res = await uploadPdf(file);
      showToast(`PDF 업로드 성공: ${res.filename} (${res.total_pages}p)`);
      await fetchPdfs();
      await handleSelectPdf(res.filename);
    } catch (err: any) {
      showToast(err.message || '업로드 실패', true);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDropUploadPdf = async (file: File) => {
    await handleUploadPdf(file);
  };

  // 3-1. Delete PDF Document completely
  const handleDeletePdfDocument = async (filename: string, deleteVectors: boolean = true) => {
    try {
      const res = await deletePdfDocument(filename, deleteVectors);
      showToast(res.message || `문서 '${filename}'이(가) 완전히 삭제되었습니다.`);
      await fetchPdfs();
      if (filename === selectedPdf) {
        if (res.current_selected_pdf) {
          await handleSelectPdf(res.current_selected_pdf);
        } else {
          setSelectedPdf('');
          setEtlData(null);
        }
      }
    } catch (err: any) {
      console.error('Delete document failed:', err);
      showToast(err.message || '문서 삭제 중 오류가 발생했습니다.', true);
      throw err;
    }
  };

  // 3-2. Reset ETL Parsing Results (Keep PDF)
  const handleResetEtlDocument = async (filename: string, deleteVectors: boolean = true) => {
    try {
      const res = await resetEtlByFilename(filename, deleteVectors);
      showToast(res.message || `문서 '${filename}'의 파싱 결과가 초기화되었습니다.`);
      await fetchPdfs();
      if (filename === selectedPdf) {
        setEtlData(null);
        setSelectedSectionId(null);
        await fetchSample(filename);
      }
    } catch (err: any) {
      console.error('Reset ETL failed:', err);
      showToast(err.message || '파싱 초기화 중 오류가 발생했습니다.', true);
      throw err;
    }
  };

  // 3-1. Parser Configuration Handlers
  const handleSaveParserConfig = async (override?: Partial<import('./types').ParserConfig>) => {
    setIsSavingParserConfig(true);
    try {
      const cfgToSave = {
        backend: override?.backend ?? engine,
        method: override?.method ?? method,
        formula: override?.formula ?? formula,
        strategy: override?.strategy ?? strategy,
        all_pages: override?.all_pages ?? allPages,
        start_page: override?.start_page ?? startPage,
        end_page: override?.end_page ?? endPage,
        preserve_newlines: override?.preserve_newlines ?? preserveNewlines,
      };
      await saveParserConfig(cfgToSave);
      showToast('기본 파서 설정이 output/parser_config.json에 저장되었습니다.');
    } catch (err: any) {
      showToast(err.message || '기본 파서 설정 저장 실패', true);
    } finally {
      setIsSavingParserConfig(false);
    }
  };

  const handleResetParserConfig = async () => {
    try {
      const res = await resetParserConfig();
      const cfg = res.config;
      setEngine(cfg.backend);
      setMethod(cfg.method);
      setFormula(cfg.formula);
      setStrategy(cfg.strategy);
      setAllPages(cfg.all_pages);
      setStartPage(cfg.start_page);
      setEndPage(cfg.end_page);
      if (cfg.preserve_newlines !== undefined) setPreserveNewlines(cfg.preserve_newlines);
      showToast('기본 파서 설정이 초기 권장값으로 리셋되었습니다.');
    } catch (err: any) {
      showToast(err.message || '기본 파서 설정 초기화 실패', true);
    }
  };

  // 4. Run ETL Pipeline via Asynchronous Background Task
  const handleRunEtl = async (
    targetOrParams?: string | Partial<ParseRequestParams>,
    saveAsDefault?: boolean
  ) => {
    let docToParse = selectedPdf;
    let overrideBackend = engine;
    let overrideMethod = method;
    let overrideFormula = formula;
    let overrideStrategy = strategy;
    let overrideAllPages = allPages;
    let overrideStartPage: number | null = allPages ? null : startPage;
    let overrideEndPage: number | null = allPages ? null : endPage;
    let overridePreserveNewlines = preserveNewlines;

    if (typeof targetOrParams === 'string') {
      docToParse = targetOrParams;
    } else if (targetOrParams && typeof targetOrParams === 'object') {
      if (targetOrParams.filename) docToParse = targetOrParams.filename;
      if (targetOrParams.backend !== undefined) overrideBackend = targetOrParams.backend;
      if (targetOrParams.method !== undefined) overrideMethod = targetOrParams.method;
      if (targetOrParams.formula !== undefined) overrideFormula = targetOrParams.formula;
      if (targetOrParams.strategy !== undefined) overrideStrategy = targetOrParams.strategy;
      if (targetOrParams.all_pages !== undefined) overrideAllPages = targetOrParams.all_pages;
      if (targetOrParams.start_page !== undefined) overrideStartPage = targetOrParams.start_page;
      if (targetOrParams.end_page !== undefined) overrideEndPage = targetOrParams.end_page;
      if (targetOrParams.preserve_newlines !== undefined) overridePreserveNewlines = targetOrParams.preserve_newlines;
    }

    if (!docToParse) {
      showToast('파싱할 PDF 문서를 선택해주세요.', true);
      return;
    }

    if (docToParse !== selectedPdf) {
      setSelectedPdf(docToParse);
      try {
        await selectPdf(docToParse);
      } catch (err: any) {
        console.error('PDF selection error:', err);
      }
    }

    // 현재 세션의 활성 파싱 옵션을 화면 state에 즉시 동기화 (saveAsDefault 체크 여부와 무관)
    setEngine(overrideBackend);
    setMethod(overrideMethod);
    setFormula(overrideFormula);
    setStrategy(overrideStrategy);
    setAllPages(overrideAllPages);
    if (overrideStartPage !== null) setStartPage(overrideStartPage);
    if (overrideEndPage !== null) setEndPage(overrideEndPage);
    setPreserveNewlines(overridePreserveNewlines);

    if (saveAsDefault) {
      // 백엔드 parser_config.json 에도 영구 저장
      saveParserConfig({
        backend: overrideBackend,
        method: overrideMethod,
        formula: overrideFormula,
        strategy: overrideStrategy,
        all_pages: overrideAllPages,
        start_page: overrideStartPage ?? 0,
        end_page: overrideEndPage ?? 2,
        preserve_newlines: overridePreserveNewlines,
      }).catch((err) => {
        console.warn('Failed to persist parser config on run:', err);
      });
    }

    setIsParsing(true);
    try {
      const res = await startEtlJob({
        filename: docToParse,
        all_pages: overrideAllPages,
        start_page: overrideAllPages ? null : overrideStartPage,
        end_page: overrideAllPages ? null : overrideEndPage,
        backend: overrideBackend,
        method: overrideMethod,
        formula: overrideFormula,
        strategy: overrideStrategy,
        preserve_newlines: overridePreserveNewlines,
        lang: 'korean',
      });

      setActiveJob({
        task_id: res.task_id,
        status: 'running',
        progress_msg: '백그라운드 파싱 대기열 등록됨...',
        elapsed_time: 0,
        filename: docToParse,
      });

      showToast(`[${docToParse}] 백그라운드 ETL 작업 등록됨 (ID: ${res.task_id})`);
      fetchPdfs();
    } catch (err: any) {
      console.error(err);
      setIsParsing(false);
      showToast(err.message || 'ETL 파싱 실행 실패', true);
    }
  };

  // 5. Update Single Chunk Handler
  const handleUpdateChunk = (updatedChunk: ChildChunk, silent = false) => {
    if (!etlData) return;

    const finalChunk: ChildChunk = {
      ...updatedChunk,
      token_estimate: updatedChunk.token_estimate || estimateKoreanTokens(updatedChunk.text),
      parent_id: updatedChunk.parent_chunk_id || updatedChunk.parent_id || '',
      parent_chunk_id: updatedChunk.parent_chunk_id || updatedChunk.parent_id || '',
      metadata: syncChunkPageMetadata(
        updatedChunk.metadata,
        updatedChunk.page_number,
        updatedChunk.page_end
      ),
    };

    // 1) Update child_chunks array
    const updatedChunks = etlData.child_chunks.map((c) =>
      c.chunk_id === finalChunk.chunk_id ? finalChunk : c
    );

    const oldChunk = etlData.child_chunks.find((c) => c.chunk_id === finalChunk.chunk_id);
    const oldPid = oldChunk ? (oldChunk.parent_chunk_id || oldChunk.parent_id) : '';
    const newPid = finalChunk.parent_chunk_id || finalChunk.parent_id;

    // 2) Update parent_chunks
    const chunkMap = new Map<string, ChildChunk>();
    for (const c of updatedChunks) {
      chunkMap.set(c.chunk_id, c);
    }

    let updatedParents = [...(etlData.parent_chunks || [])];
    if (oldPid && oldPid !== newPid) {
      // Moved from old parent to new parent
      updatedParents = updatedParents
        .map((p) => {
          const pid = p.parent_chunk_id || p.id;
          if (pid === oldPid) {
            const filtered = p.child_chunk_ids.filter((id) => id !== finalChunk.chunk_id);
            const childObjects = filtered.map((id) => chunkMap.get(id)).filter(Boolean) as ChildChunk[];
            const pText = childObjects.map((c) => c.text).join('\n\n');
            const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
            const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];
            return {
              ...p,
              child_chunk_ids: filtered,
              text: pText,
              token_estimate: estimateKoreanTokens(pText),
              page_range: [minP, maxP] as [number, number],
              is_edited: true,
            };
          }
          if (pid === newPid) {
            const added = [...p.child_chunk_ids, finalChunk.chunk_id];
            const childObjects = added.map((id) => chunkMap.get(id)).filter(Boolean) as ChildChunk[];
            const pText = childObjects.map((c) => c.text).join('\n\n');
            const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
            const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];
            return {
              ...p,
              child_chunk_ids: added,
              text: pText,
              token_estimate: estimateKoreanTokens(pText),
              page_range: [minP, maxP] as [number, number],
              is_edited: true,
            };
          }
          return p;
        })
        .filter((p) => p.child_chunk_ids.length > 0); // Auto-prune empty parent
    } else if (newPid) {
      // Recompute same parent's text and tokens
      updatedParents = updatedParents.map((p) => {
        const pid = p.parent_chunk_id || p.id;
        if (pid === newPid) {
          const childObjects = p.child_chunk_ids.map((id) => chunkMap.get(id)).filter(Boolean) as ChildChunk[];
          const pText = childObjects.map((c) => c.text).join('\n\n');
          const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
          const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];
          return {
            ...p,
            text: pText,
            token_estimate: estimateKoreanTokens(pText),
            page_range: [minP, maxP] as [number, number],
            is_edited: true,
          };
        }
        return p;
      });
    }

    // 3) Synchronize sections if section_id or parent changed
    const sections = etlData.sections || etlData.parent_sections || [];
    let updatedSections = sections;
    if (oldChunk && (oldChunk.section_id !== finalChunk.section_id || oldChunk.parent_id !== finalChunk.parent_id)) {
      updatedSections = sections.map((sec) => {
        if (sec.id === oldChunk.section_id || sec.id === oldChunk.parent_id) {
          return {
            ...sec,
            child_chunk_ids: (sec.child_chunk_ids || []).filter((id) => id !== finalChunk.chunk_id),
          };
        }
        if (sec.id === finalChunk.section_id || sec.id === finalChunk.parent_id) {
          return {
            ...sec,
            child_chunk_ids: [...(sec.child_chunk_ids || []), finalChunk.chunk_id],
          };
        }
        return sec;
      });
    }

    // 4) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: updatedParents.length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_chunks: updatedParents,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });

    setIsDirty(true);
    if (!silent) {
      showToast(`청크(${formatDisplayChunkId(updatedChunk.chunk_id)}) 수정이 적용되었습니다.`);
    }
  };

  // 5-1. Bulk Custom Metadata Updater (Entire Document or Specific Section)
  const handleBulkUpdateMetadata = (params: {
    mode: 'add_tag' | 'apply_batch' | 'delete_tag';
    key?: string;
    value?: any;
    tags?: Record<string, any>;
    scope: 'all' | 'section';
    sectionId?: string;
    overwrite?: boolean;
  }) => {
    if (!etlData) return;

    const { updatedChunks, affectedCount } = applyBulkCustomMetadata({
      chunks: etlData.child_chunks,
      mode: params.mode,
      key: params.key,
      value: params.value,
      tags: params.tags,
      scope: params.scope,
      sectionId: params.sectionId || selectedSectionId || undefined,
      overwrite: params.overwrite ?? true,
    });

    if (affectedCount === 0) {
      showToast('변경되거나 적용된 청크가 없습니다.');
      return;
    }

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
    });
    setIsDirty(true);

    if (params.mode === 'delete_tag') {
      showToast(
        `메타데이터 [${params.key}] 키가 ${affectedCount}개 청크에서 삭제되었습니다.`
      );
    } else if (params.mode === 'add_tag') {
      showToast(
        `메타데이터 [${params.key}: ${params.value}]이(가) ${affectedCount}개 청크에 일괄 적용되었습니다.`
      );
    } else {
      showToast(
        `메타데이터 ${Object.keys(params.tags || {}).length}개 태그가 ${affectedCount}개 청크에 일괄 적용되었습니다.`
      );
    }
  };

  // 6. Inline Section Title Updater (Column 1)
  const handleUpdateSectionTitle = (sectionId: string, newTitle: string) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const oldSection = sections.find((s) => s.id === sectionId);
    if (!oldSection || oldSection.title === newTitle.trim()) return;

    const trimmed = newTitle.trim();
    const oldTitle = oldSection.title;

    // 1) Update sections and child breadcrumbs
    const updatedSections = sections.map((s) => {
      if (s.id === sectionId) {
        return { ...s, title: trimmed };
      }
      const newBreadcrumbs = s.breadcrumbs.map((b) => (b === oldTitle ? trimmed : b));
      return { ...s, breadcrumbs: newBreadcrumbs };
    });

    // 2) Update breadcrumbs in child chunks
    const updatedChunks = etlData.child_chunks.map((c) => {
      const newBreadcrumbs = (c.breadcrumbs || []).map((b) => (b === oldTitle ? trimmed : b));
      return { ...c, breadcrumbs: newBreadcrumbs };
    });

    setEtlData({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
      child_chunks: updatedChunks,
    });
    setIsDirty(true);
    showToast(`섹션 제목이 '${trimmed}'(으)로 변경되었습니다.`);
  };

  // 6-1. Delete Section Handler
  const handleDeleteSection = (sectionId: string, deleteChunks: boolean = false) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const targetSection = sections.find((s) => s.id === sectionId);
    if (!targetSection) return;

    // 1) Handle child chunks and parent chunks
    let updatedChunks = [...etlData.child_chunks];
    let updatedParents = [...(etlData.parent_chunks || [])];

    if (deleteChunks) {
      // Remove all chunks belonging to this section
      updatedChunks = updatedChunks.filter(
        (c) => c.section_id !== sectionId && c.parent_id !== sectionId
      );
      updatedParents = updatedParents.filter((p) => p.section_id !== sectionId);
    } else {
      // Reassign to fallback section if available
      const fallbackSection =
        sections.find((s) => s.id === targetSection.parent_section_id) ||
        sections.find((s) => s.id !== sectionId);
      if (fallbackSection) {
        updatedChunks = updatedChunks.map((c) => {
          if (c.section_id === sectionId || c.parent_id === sectionId) {
            return {
              ...c,
              section_id: fallbackSection.id,
              parent_id: fallbackSection.id,
              breadcrumbs: fallbackSection.breadcrumbs,
              is_edited: true,
            };
          }
          return c;
        });
        updatedParents = updatedParents.map((p) => {
          if (p.section_id === sectionId) {
            return {
              ...p,
              section_id: fallbackSection.id,
              is_edited: true,
            };
          }
          return p;
        });
      }
    }

    // 2) Remove section from sections
    const updatedSections = sections
      .filter((s) => s.id !== sectionId)
      .map((s) => {
        if (s.parent_section_id === sectionId) {
          return {
            ...s,
            parent_section_id: targetSection.parent_section_id,
          };
        }
        return s;
      });

    // 3) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_sections: updatedSections.length,
      total_parent_sections: updatedSections.length,
      total_parent_chunks: updatedParents.length,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause').length,
      total_words: totalWords,
    };

    if (selectedSectionId === sectionId) {
      setSelectedSectionId(null);
    }

    setEtlData({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
      parent_chunks: updatedParents,
      child_chunks: updatedChunks,
      stats: updatedStats,
    });
    setIsDirty(true);
    showToast(`'${targetSection.title}' 섹션이 삭제되었습니다.`);
  };

  // 6-2. Add Section Handler
  const handleAddSection = (sectionData: {
    title: string;
    parentSectionId?: string;
    level: number;
    insertPosition?: SectionInsertPosition;
  }) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];

    const parentSec = sectionData.parentSectionId
      ? sections.find((s) => s.id === sectionData.parentSectionId)
      : null;

    const breadcrumbs = parentSec
      ? [...(parentSec.breadcrumbs || [parentSec.title]), sectionData.title]
      : [sectionData.title];

    const newId = `sec_manual_${Date.now()}`;
    const newSection: SectionNode = {
      id: newId,
      title: sectionData.title,
      level: sectionData.level,
      parent_section_id: sectionData.parentSectionId,
      breadcrumbs: breadcrumbs,
      parent_chunk_ids: [],
      child_chunk_ids: [],
      full_text: '',
      page_range: parentSec ? parentSec.page_range : [1, 1],
    };

    let updatedSections: SectionNode[];
    const pos = sectionData.insertPosition;

    if (pos?.type === 'start') {
      const rootIdx = sections.findIndex(
        (s) => s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')
      );
      if (rootIdx !== -1) {
        updatedSections = [
          ...sections.slice(0, rootIdx + 1),
          newSection,
          ...sections.slice(rootIdx + 1),
        ];
      } else {
        updatedSections = [newSection, ...sections];
      }
    } else if (pos?.type === 'after' && pos.sectionId) {
      // 해당 sectionId 및 그 하위 섹션들의 마지막 노드 뒤에 삽입
      const getDescendantIds = (rootId: string): Set<string> => {
        const desc = new Set<string>();
        const queue = [rootId];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          for (const s of sections) {
            if (s.parent_section_id === cur && !desc.has(s.id)) {
              desc.add(s.id);
              queue.push(s.id);
            }
          }
        }
        return desc;
      };

      const descIds = getDescendantIds(pos.sectionId);
      let insertAfterIdx = -1;
      for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].id === pos.sectionId || descIds.has(sections[i].id)) {
          insertAfterIdx = i;
          break;
        }
      }

      if (insertAfterIdx !== -1) {
        updatedSections = [
          ...sections.slice(0, insertAfterIdx + 1),
          newSection,
          ...sections.slice(insertAfterIdx + 1),
        ];
      } else {
        updatedSections = [...sections, newSection];
      }
    } else {
      updatedSections = [...sections, newSection];
    }

    const updatedStats = {
      ...etlData.stats,
      total_sections: updatedSections.length,
      total_parent_sections: updatedSections.length,
    };

    const syncedEtl = syncHierarchyOrder({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });

    setEtlData(syncedEtl);
    setIsDirty(true);
    setSelectedSectionId(newId);
    showToast(`새 섹션 '${newSection.title}'이(가) 추가되었습니다.`);
  };

  // 6-3. Batch Clean Empty Sections Handler (Exclude sections with child sections)
  const handleBatchCleanEmptySections = () => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];

    // 하위 섹션을 보유한 상위 부모 섹션 ID 집합
    const parentIdSet = new Set(
      sections
        .map((s) => s.parent_section_id)
        .filter((id): id is string => Boolean(id))
    );

    // 청크가 없고 AND 하위 섹션도 없는 리프 섹션만 필터링
    const emptySections = sections.filter(
      (s) =>
        (!s.parent_chunk_ids || s.parent_chunk_ids.length === 0) &&
        (!s.child_chunk_ids || s.child_chunk_ids.length === 0) &&
        !parentIdSet.has(s.id)
    );

    if (emptySections.length === 0) {
      showToast('정리할 빈 섹션(하위 섹션 및 청크가 모두 없는 섹션)이 없습니다.');
      return;
    }

    const confirmed = window.confirm(
      `청크와 하위 섹션이 모두 없는 ${emptySections.length}개의 빈 섹션을 일괄 삭제하시겠습니까?\n(하위 섹션을 보유한 상위 섹션은 안전하게 보존됩니다)`
    );
    if (!confirmed) return;

    const emptyIdSet = new Set(emptySections.map((s) => s.id));
    const updatedSections = sections.filter((s) => !emptyIdSet.has(s.id));

    if (selectedSectionId && emptyIdSet.has(selectedSectionId)) {
      setSelectedSectionId(null);
    }

    const updatedStats = {
      ...etlData.stats,
      total_sections: updatedSections.length,
      total_parent_sections: updatedSections.length,
    };

    setEtlData({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);
    showToast(`🧹 ${emptySections.length}개의 빈 섹션이 일괄 삭제되었습니다.`);
  };

  // 7. Toggle Chunk Ignore Status (Column 2 Quick Toggle)
  const handleToggleIgnoreChunk = (chunkId: string) => {
    if (!etlData) return;
    const chunk = etlData.child_chunks.find((c) => c.chunk_id === chunkId);
    if (!chunk) return;

    const updatedChunk: ChildChunk = {
      ...chunk,
      is_ignored: !chunk.is_ignored,
      is_edited: true,
    };
    handleUpdateChunk(updatedChunk, false);
  };

  // 8. Split Chunk Handler (3-Tier Hierarchical)
  const handleSplitChunk = (
    targetChunkId: string,
    part1Text: string,
    part2Text: string,
    page1?: number,
    page2?: number
  ) => {
    if (!etlData) return;
    const targetIndex = etlData.child_chunks.findIndex((c) => c.chunk_id === targetChunkId);
    if (targetIndex === -1) return;
    const target = etlData.child_chunks[targetIndex];

    // 청크 1은 기존 ID 유지, 청크 2는 다음 시퀀스 번호(c043 등) 채번하여 ID 길이 팽창 방지
    const id1 = targetChunkId;
    const id2 = getNextChunkId(etlData.child_chunks, etlData.doc_id);

    const words1 = estimateKoreanTokens(part1Text);
    const words2 = estimateKoreanTokens(part2Text);

    const p1 = page1 || target.page_number || 1;
    const p2 = page2 || target.page_end || target.page_number || 1;

    const cleanMetadata = target.metadata ? { ...target.metadata } : undefined;
    if (cleanMetadata) {
      delete cleanMetadata.is_split;
      delete cleanMetadata.split_from;
      delete cleanMetadata.split_part;
      delete cleanMetadata.is_merged;
      delete cleanMetadata.merged_from;
      delete cleanMetadata.merged_count;
    }

    const chunk1Meta = syncChunkPageMetadata(cleanMetadata, p1);
    const chunk2Meta = syncChunkPageMetadata(cleanMetadata, p2);

    const targetParentId = target.parent_chunk_id || target.parent_id || '';
    const targetSectionId = target.section_id || '';

    // 지능형 청크 타입 및 표 자산 분배 (표 파편화 방지 및 유령 표 메타데이터 제거)
    const p1Asset = deriveChunkTypeAndTables(part1Text, target);
    const p2Asset = deriveChunkTypeAndTables(part2Text, target);

    const chunk1: ChildChunk = {
      ...target,
      chunk_id: id1,
      parent_chunk_id: targetParentId,
      parent_id: targetParentId,
      section_id: targetSectionId,
      chunk_type: p1Asset.chunk_type,
      text: part1Text,
      token_estimate: words1,
      page_number: p1,
      page_end: undefined,
      metadata: chunk1Meta,
      raw_html: p1Asset.raw_html,
      tables: p1Asset.tables,
      table_caption: p1Asset.table_caption,
      table_footnote: p1Asset.table_footnote,
      is_table: p1Asset.is_table,
      is_atomic_table: p1Asset.is_atomic_table,
      is_edited: true,
    };

    const chunk2: ChildChunk = {
      ...target,
      chunk_id: id2,
      parent_chunk_id: targetParentId,
      parent_id: targetParentId,
      section_id: targetSectionId,
      chunk_type: p2Asset.chunk_type,
      text: part2Text,
      token_estimate: words2,
      page_number: p2,
      page_end: undefined,
      metadata: chunk2Meta,
      raw_html: p2Asset.raw_html,
      tables: p2Asset.tables,
      table_caption: p2Asset.table_caption,
      table_footnote: p2Asset.table_footnote,
      is_table: p2Asset.is_table,
      is_atomic_table: p2Asset.is_atomic_table,
      is_edited: true,
    };

    // 1) Replace target chunk in child_chunks with [chunk1, chunk2]
    const updatedChunks = [...etlData.child_chunks];
    updatedChunks.splice(targetIndex, 1, chunk1, chunk2);

    const chunkMap = new Map<string, ChildChunk>();
    for (const c of updatedChunks) {
      chunkMap.set(c.chunk_id, c);
    }

    // 2) Update parent_chunks: inherit parent_chunk_id and recompute parent text & tokens
    const updatedParents = (etlData.parent_chunks || []).map((p) => {
      const pid = p.parent_chunk_id || p.id;
      if (pid === targetParentId) {
        const newChildIds: string[] = [];
        for (const cid of p.child_chunk_ids) {
          if (cid === targetChunkId) {
            newChildIds.push(chunk1.chunk_id, chunk2.chunk_id);
          } else {
            newChildIds.push(cid);
          }
        }
        const childObjects = newChildIds.map((cid) => chunkMap.get(cid)).filter(Boolean) as ChildChunk[];
        const parentText = childObjects.map((c) => c.text).join('\n\n');
        const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
        const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];

        return {
          ...p,
          child_chunk_ids: newChildIds,
          text: parentText,
          token_estimate: estimateKoreanTokens(parentText),
          page_range: [minP, maxP] as [number, number],
          is_edited: true,
        };
      }
      return p;
    });

    // 3) Update sections: update child_chunk_ids if present
    const sectionsToUpdate = etlData.sections || etlData.parent_sections || [];
    const updatedSections = sectionsToUpdate.map((sec) => {
      if (sec.id === targetSectionId || sec.id === target.parent_id) {
        const newIds: string[] = [];
        for (const cid of (sec.child_chunk_ids || [])) {
          if (cid === targetChunkId) {
            newIds.push(chunk1.chunk_id, chunk2.chunk_id);
          } else {
            newIds.push(cid);
          }
        }
        return {
          ...sec,
          child_chunk_ids: newIds,
        };
      }
      return sec;
    });

    // 4) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: updatedParents.length,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      composite_chunks: updatedChunks.filter((c) => c.chunk_type === 'composite').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause').length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_chunks: updatedParents,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);
    showToast(`청크(${targetChunkId})가 2개(p.${chunk1.page_number} / p.${chunk2.page_number})로 분할되고 상위 Parent(${targetParentId})가 실시간 동기화되었습니다.`);
  };

  // 9. Merge Chunks Handler (3-Tier Hierarchical with Auto-pruning)
  const handleMergeChunks = (
    chunkIds: string[],
    mergedText: string,
    customMergedId?: string,
    pageStart?: number,
    pageEnd?: number
  ) => {
    if (!etlData || chunkIds.length < 2) return;

    const selectedChunks = chunkIds
      .map((id) => etlData.child_chunks.find((c) => c.chunk_id === id))
      .filter((c): c is ChildChunk => Boolean(c));

    if (selectedChunks.length < 2) return;

    const firstChunk = selectedChunks[0];
    const primaryParentId = firstChunk.parent_chunk_id || firstChunk.parent_id || '';
    const primarySectionId = firstChunk.section_id || '';

    let mergedId = customMergedId?.trim() || firstChunk.chunk_id;
    if (
      etlData.child_chunks.some(
        (c) => c.chunk_id === mergedId && !chunkIds.includes(c.chunk_id)
      )
    ) {
      mergedId = getNextChunkId(etlData.child_chunks, etlData.doc_id);
    }

    const words = estimateKoreanTokens(mergedText);
    const minPage = pageStart || Math.min(...selectedChunks.map((c) => c.page_number || 1));
    const maxPage = pageEnd || Math.max(...selectedChunks.map((c) => c.page_end || c.page_number || 1));
    const finalEnd = maxPage > minPage ? maxPage : undefined;

    const cleanMetadata = firstChunk.metadata ? { ...firstChunk.metadata } : undefined;
    if (cleanMetadata) {
      delete cleanMetadata.is_merged;
      delete cleanMetadata.merged_from;
      delete cleanMetadata.merged_count;
      delete cleanMetadata.is_split;
      delete cleanMetadata.split_from;
      delete cleanMetadata.split_part;
    }

    const mergedMeta = syncChunkPageMetadata(
      cleanMetadata,
      minPage,
      finalEnd
    );

    // 지능형 병합: 문단+표 병합 시 composite 자동 승격 및 표 원형(HTML), 캡션, 메타데이터 통합
    const mergedAssets = mergeChunkAssets(selectedChunks);

    const mergedChunk: ChildChunk = {
      ...firstChunk,
      chunk_id: mergedId,
      parent_chunk_id: primaryParentId,
      parent_id: primaryParentId,
      section_id: primarySectionId,
      chunk_type: mergedAssets.chunk_type,
      text: mergedText,
      token_estimate: words,
      page_number: minPage,
      page_end: finalEnd,
      metadata: mergedMeta,
      raw_html: mergedAssets.raw_html,
      tables: mergedAssets.tables,
      table_caption: mergedAssets.table_caption,
      table_footnote: mergedAssets.table_footnote,
      is_table: mergedAssets.is_table,
      is_atomic_table: mergedAssets.is_atomic_table,
      is_edited: true,
      is_ignored: false,
    };

    // 1) Replace first chunk with mergedChunk, remove other selected chunks from child_chunks
    const chunkIdsToRemove = new Set(chunkIds.slice(1));
    const updatedChunks: ChildChunk[] = [];
    for (let i = 0; i < etlData.child_chunks.length; i++) {
      const c = etlData.child_chunks[i];
      if (c.chunk_id === firstChunk.chunk_id) {
        updatedChunks.push(mergedChunk);
      } else if (!chunkIdsToRemove.has(c.chunk_id)) {
        updatedChunks.push(c);
      }
    }

    const chunkMap = new Map<string, ChildChunk>();
    for (const c of updatedChunks) {
      chunkMap.set(c.chunk_id, c);
    }

    // 2) Update parent_chunks with Auto-pruning (자식 0개 Parent 자동 삭제)
    const prunedParentIds = new Set<string>();
    const survivingParents: ParentChunk[] = [];

    for (const p of (etlData.parent_chunks || [])) {
      const pid = p.parent_chunk_id || p.id || '';
      let newChildIds = p.child_chunk_ids.filter((cid) => !chunkIdsToRemove.has(cid));

      if (pid === primaryParentId || p.child_chunk_ids.includes(firstChunk.chunk_id)) {
        newChildIds = newChildIds.map((cid) => (cid === firstChunk.chunk_id ? mergedChunk.chunk_id : cid));
        if (!newChildIds.includes(mergedChunk.chunk_id)) {
          newChildIds.push(mergedChunk.chunk_id);
        }
      }

      // Auto-pruning check:
      if (newChildIds.length === 0) {
        prunedParentIds.add(pid);
        continue;
      }

      const childObjects = newChildIds.map((cid) => chunkMap.get(cid)).filter(Boolean) as ChildChunk[];
      const parentText = childObjects.map((c) => c.text).join('\n\n');
      const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
      const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];

      survivingParents.push({
        ...p,
        child_chunk_ids: newChildIds,
        text: parentText,
        token_estimate: estimateKoreanTokens(parentText),
        page_range: [minP, maxP] as [number, number],
        is_edited: true,
      });
    }

    // 3) Update sections: remove prunedParentIds and update child_chunk_ids
    const allSelectedSet = new Set(chunkIds);
    const sectionsToUpdate = etlData.sections || etlData.parent_sections || [];
    const updatedSections = sectionsToUpdate.map((sec) => {
      const newParentIds = (sec.parent_chunk_ids || []).filter((pid) => !prunedParentIds.has(pid));

      let containsFirst = false;
      const filteredChildren = (sec.child_chunk_ids || []).filter((id) => {
        if (id === firstChunk.chunk_id) {
          containsFirst = true;
          return true;
        }
        return !allSelectedSet.has(id);
      });

      let finalChildren = filteredChildren;
      if (containsFirst || sec.id === primarySectionId) {
        const replaced = filteredChildren.map((id) => (id === firstChunk.chunk_id ? mergedChunk.chunk_id : id));
        if (!replaced.includes(mergedChunk.chunk_id)) {
          replaced.push(mergedChunk.chunk_id);
        }
        finalChildren = replaced;
      }

      return {
        ...sec,
        parent_chunk_ids: newParentIds,
        child_chunk_ids: finalChildren,
      };
    });

    // 4) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: survivingParents.length,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      composite_chunks: updatedChunks.filter((c) => c.chunk_type === 'composite').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause').length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_chunks: survivingParents,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);

    const pruneMsg = prunedParentIds.size > 0 ? ` (자식 청크가 0개인 Parent ${prunedParentIds.size}개 자동 정리됨)` : '';
    showToast(`${chunkIds.length}개 청크가 성공적으로 병합되었습니다 (${formatDisplayChunkId(mergedChunk.chunk_id)}).${pruneMsg}`);
  };

  // 9-1. Delete Chunks Handler (Multi-parent Support, Parent Text Shrinking, Auto-pruning)
  const handleDeleteChunks = (chunkIds: string[]) => {
    if (!etlData || chunkIds.length === 0) return;

    const chunkIdsToRemove = new Set(chunkIds);
    const updatedChunks = etlData.child_chunks.filter((c) => !chunkIdsToRemove.has(c.chunk_id));

    const chunkMap = new Map<string, ChildChunk>();
    for (const c of updatedChunks) {
      chunkMap.set(c.chunk_id, c);
    }

    // 2) Update parent_chunks with Auto-pruning & text re-computation
    const prunedParentIds = new Set<string>();
    const survivingParents: ParentChunk[] = [];

    for (const p of (etlData.parent_chunks || [])) {
      const pid = p.parent_chunk_id || p.id || '';
      const newChildIds = p.child_chunk_ids.filter((cid) => !chunkIdsToRemove.has(cid));

      // Auto-pruning: 자식 청크가 0개가 된 Parent는 자동 삭제
      if (newChildIds.length === 0) {
        prunedParentIds.add(pid);
        continue;
      }

      // 자식 청크가 남아있고 일부가 삭제된 경우 본문 텍스트 및 토큰 축소 재계산
      const hasChanged = newChildIds.length !== p.child_chunk_ids.length;
      if (hasChanged) {
        const childObjects = newChildIds.map((cid) => chunkMap.get(cid)).filter(Boolean) as ChildChunk[];
        const parentText = childObjects.map((c) => c.text).join('\n\n');
        const minP = childObjects.length > 0 ? Math.min(...childObjects.map((c) => c.page_number)) : p.page_range[0];
        const maxP = childObjects.length > 0 ? Math.max(...childObjects.map((c) => c.page_end || c.page_number)) : p.page_range[1];

        survivingParents.push({
          ...p,
          child_chunk_ids: newChildIds,
          text: parentText,
          token_estimate: estimateKoreanTokens(parentText),
          page_range: [minP, maxP] as [number, number],
          is_edited: true,
        });
      } else {
        survivingParents.push(p);
      }
    }

    // 3) Update sections: remove prunedParentIds and remove deleted chunkIds
    const sectionsToUpdate = etlData.sections || etlData.parent_sections || [];
    const updatedSections = sectionsToUpdate.map((sec) => {
      const newParentIds = (sec.parent_chunk_ids || []).filter((pid) => !prunedParentIds.has(pid));
      const newChildIds = (sec.child_chunk_ids || []).filter((id) => !chunkIdsToRemove.has(id));

      return {
        ...sec,
        parent_chunk_ids: newParentIds,
        child_chunk_ids: newChildIds,
      };
    });

    // 4) Recalculate stats
    const totalWords = updatedChunks.reduce((acc, c) => acc + (c.token_estimate || 0), 0);
    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: survivingParents.length,
      total_child_chunks: updatedChunks.length,
      paragraph_chunks: updatedChunks.filter((c) => c.chunk_type === 'paragraph').length,
      table_chunks: updatedChunks.filter((c) => c.chunk_type === 'table').length,
      article_chunks: updatedChunks.filter((c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause').length,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
      parent_chunks: survivingParents,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);

    const pruneMsg = prunedParentIds.size > 0 ? ` (빈 Parent ${prunedParentIds.size}개 자동 정리)` : '';
    showToast(`🗑️ ${chunkIds.length}개 청크가 삭제되었습니다.${pruneMsg}`);
  };

  // 10. Parent Reassign Section Handler (Cascading Sync to Children)
  const handleReassignParentSection = (parentChunkId: string, newSectionId: string) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const parentChunks = etlData.parent_chunks || [];
    const childChunks = etlData.child_chunks || [];

    const targetParent = parentChunks.find(
      (p) => (p.parent_chunk_id === parentChunkId) || (p.id === parentChunkId)
    );
    if (!targetParent) {
      showToast(`대상 Parent 청크(${parentChunkId})를 찾을 수 없습니다.`, true);
      return;
    }

    const oldSectionId = targetParent.section_id;
    if (oldSectionId === newSectionId) return;

    const newSection = sections.find((s) => s.id === newSectionId);
    if (!newSection) {
      showToast(`지정할 신규 섹션(${newSectionId})을 찾을 수 없습니다.`, true);
      return;
    }

    const pid = targetParent.parent_chunk_id || targetParent.id || '';

    // 1) Update target parent chunk's section_id
    const updatedParents = parentChunks.map((p) => {
      if ((p.parent_chunk_id || p.id) === pid) {
        return {
          ...p,
          section_id: newSectionId,
          is_edited: true,
        };
      }
      return p;
    });

    // 2) Cascading Sync: Update all child chunks belonging to targetParent
    const targetChildIdSet = new Set(targetParent.child_chunk_ids);
    const updatedChildren = childChunks.map((c) => {
      const belongs =
        targetChildIdSet.has(c.chunk_id) ||
        c.parent_chunk_id === pid ||
        c.parent_id === pid;

      if (belongs) {
        const newBreadcrumbs = targetParent.title
          ? [...(newSection.breadcrumbs || [newSection.title]), targetParent.title]
          : [...(newSection.breadcrumbs || [newSection.title])];

        return {
          ...c,
          section_id: newSectionId,
          breadcrumbs: newBreadcrumbs,
          is_edited: true,
        };
      }
      return c;
    });

    // 3) Update sections: parent_chunk_ids & child_chunk_ids
    const updatedSections = sections.map((sec) => {
      if (sec.id === oldSectionId) {
        return {
          ...sec,
          parent_chunk_ids: (sec.parent_chunk_ids || []).filter((id) => id !== pid),
          child_chunk_ids: (sec.child_chunk_ids || []).filter((id) => !targetChildIdSet.has(id)),
        };
      }
      if (sec.id === newSectionId) {
        const pIds = [...(sec.parent_chunk_ids || [])];
        if (!pIds.includes(pid)) pIds.push(pid);

        const cIds = [...(sec.child_chunk_ids || [])];
        for (const cid of targetParent.child_chunk_ids) {
          if (!cIds.includes(cid)) cIds.push(cid);
        }

        return {
          ...sec,
          parent_chunk_ids: pIds,
          child_chunk_ids: cIds,
        };
      }
      return sec;
    });

    setEtlData({
      ...etlData,
      parent_chunks: updatedParents,
      child_chunks: updatedChildren,
      sections: updatedSections,
      parent_sections: updatedSections,
    });
    setIsDirty(true);
    showToast(
      `Parent(${pid}) 및 하위 ${targetParent.child_chunk_ids.length}개 청크의 상위 섹션이 '${newSection.title}'(으)로 재지정되었습니다.`
    );
  };

  // 10-0b. Reassign Child Chunk Parent Handler (Single or Multi-select Child Reparenting)
  const handleReparentChildChunk = (params: ReparentChildChunkParams) => {
    const { chunkIds, targetParentChunkId, createNewParent } = params;
    if (!etlData || chunkIds.length === 0) return;

    const sections = etlData.sections || etlData.parent_sections || [];
    let parentChunks = [...(etlData.parent_chunks || [])];
    let childChunks = [...(etlData.child_chunks || [])];
    const targetChildIdSet = new Set(chunkIds);
    const targetChildObjs = childChunks.filter((c) => targetChildIdSet.has(c.chunk_id));

    if (targetChildObjs.length === 0) {
      showToast('재할당할 대상 청크를 찾을 수 없습니다.', true);
      return;
    }

    const docId = etlData.doc_id || generateDocId(etlData.doc_title);
    let finalTargetParentId: string = targetParentChunkId || '';
    let finalTargetSectionId: string = '';
    let destParentTitle: string | undefined;

    // 1) Case B: 새 Parent 생성
    let updatedSections = [...sections];
    if (createNewParent) {
      const newPid = getNextParentChunkId(parentChunks, docId);
      finalTargetParentId = newPid;
      finalTargetSectionId = createNewParent.sectionId;
      destParentTitle = createNewParent.title;

      const targetSec = updatedSections.find((s) => s.id === createNewParent.sectionId);
      if (!targetSec) {
        showToast(`대상 섹션(${createNewParent.sectionId})을 찾을 수 없습니다.`, true);
        return;
      }

      const combinedText = targetChildObjs
        .map((c) => c.text)
        .filter(Boolean)
        .join('\n\n');
      const minPage = Math.min(...targetChildObjs.map((c) => c.page_number || 1));
      const maxPage = Math.max(...targetChildObjs.map((c) => c.page_end || c.page_number || 1));

      const newParent: ParentChunk = {
        parent_chunk_id: newPid,
        id: newPid,
        section_id: createNewParent.sectionId,
        title: createNewParent.title,
        text: combinedText,
        token_estimate: estimateKoreanTokens(combinedText),
        child_chunk_ids: [...chunkIds],
        page_range: [minPage, maxPage],
        is_edited: true,
      };
      parentChunks.push(newParent);

      // Section의 parent_chunk_ids에 newPid 삽입
      updatedSections = updatedSections.map((sec) => {
        if (sec.id === createNewParent.sectionId) {
          const oldPids = [...(sec.parent_chunk_ids || [])];
          const pos = createNewParent.insertPosition || { type: 'end' };
          let newPids: string[];
          if (pos.type === 'start') {
            newPids = [newPid, ...oldPids];
          } else if (pos.type === 'after' && pos.parentId) {
            const idx = oldPids.indexOf(pos.parentId);
            if (idx !== -1) {
              newPids = [...oldPids.slice(0, idx + 1), newPid, ...oldPids.slice(idx + 1)];
            } else {
              newPids = [...oldPids, newPid];
            }
          } else {
            newPids = [...oldPids, newPid];
          }
          return {
            ...sec,
            parent_chunk_ids: newPids,
          };
        }
        return sec;
      });
    } else {
      // Case A: 기존 Parent로 이동
      const destParent = parentChunks.find(
        (p) => (p.parent_chunk_id === finalTargetParentId) || (p.id === finalTargetParentId)
      );
      if (!destParent) {
        showToast(`대상 Parent 청크(${finalTargetParentId})를 찾을 수 없습니다.`, true);
        return;
      }
      finalTargetSectionId = destParent.section_id;
      destParentTitle = destParent.title;

      // 대상 Parent에 chunkIds 추가 (중복 방지)
      const mergedChildIds = [...(destParent.child_chunk_ids || [])];
      for (const cid of chunkIds) {
        if (!mergedChildIds.includes(cid)) mergedChildIds.push(cid);
      }

      parentChunks = parentChunks.map((p) => {
        const pid = p.parent_chunk_id || p.id;
        if (pid === finalTargetParentId) {
          return {
            ...p,
            child_chunk_ids: mergedChildIds,
            is_edited: true,
          };
        }
        return p;
      });
    }

    // 2) Source Parents 정리: targetChunks가 빠져나간 기존 부모들의 child_chunk_ids 정리 및 토큰/텍스트/페이지 재계산
    const sourceParentIds = new Set<string>();
    targetChildObjs.forEach((c) => {
      const pid = c.parent_chunk_id || c.parent_id;
      if (pid) sourceParentIds.add(pid);
    });

    const prunedParentIds = new Set<string>();
    parentChunks = parentChunks
      .map((p) => {
        const pid = p.parent_chunk_id || p.id || '';
        // 신규 Parent는 소스 정리에 포함하지 않음
        if (pid === finalTargetParentId) return p;

        if (sourceParentIds.has(pid)) {
          const remainingCids = p.child_chunk_ids.filter((cid) => !targetChildIdSet.has(cid));
          if (remainingCids.length === 0) {
            prunedParentIds.add(pid);
            return null; // Auto-prune empty parent
          }
          const remainingChildObjs = remainingCids
            .map((cid) => childChunks.find((c) => c.chunk_id === cid))
            .filter(Boolean) as ChildChunk[];
          const pText = remainingChildObjs.map((c) => c.text).filter(Boolean).join('\n\n');
          const minP = remainingChildObjs.length > 0 ? Math.min(...remainingChildObjs.map((c) => c.page_number || 1)) : p.page_range[0];
          const maxP = remainingChildObjs.length > 0 ? Math.max(...remainingChildObjs.map((c) => c.page_end || c.page_number || 1)) : p.page_range[1];

          return {
            ...p,
            child_chunk_ids: remainingCids,
            text: pText,
            token_estimate: estimateKoreanTokens(pText),
            page_range: [minP, maxP] as [number, number],
            is_edited: true,
          };
        }
        return p;
      })
      .filter(Boolean) as ParentChunk[];

    // 3) 대상 Parent(destParent) 텍스트, 토큰, 페이지 범위 최종 재계산
    const chunkMap = new Map<string, ChildChunk>();
    for (const c of childChunks) {
      chunkMap.set(c.chunk_id, c);
    }

    parentChunks = parentChunks.map((p) => {
      const pid = p.parent_chunk_id || p.id;
      if (pid === finalTargetParentId) {
        const pChildren = p.child_chunk_ids
          .map((cid) => chunkMap.get(cid))
          .filter(Boolean) as ChildChunk[];
        const pText = pChildren.map((c) => c.text).filter(Boolean).join('\n\n');
        const minP = pChildren.length > 0 ? Math.min(...pChildren.map((c) => c.page_number || 1)) : p.page_range[0];
        const maxP = pChildren.length > 0 ? Math.max(...pChildren.map((c) => c.page_end || c.page_number || 1)) : p.page_range[1];

        return {
          ...p,
          text: pText,
          token_estimate: estimateKoreanTokens(pText),
          page_range: [minP, maxP] as [number, number],
          is_edited: true,
        };
      }
      return p;
    });

    // 4) Sections에서 정리된 Pruned Parent 제거
    if (prunedParentIds.size > 0) {
      updatedSections = updatedSections.map((sec) => {
        const remainingPids = (sec.parent_chunk_ids || []).filter((pid) => !prunedParentIds.has(pid));
        return {
          ...sec,
          parent_chunk_ids: remainingPids,
        };
      });
    }

    // 5) 이동된 Child 청크들의 parent_chunk_id, parent_id, section_id, breadcrumbs 갱신
    const destSec = updatedSections.find((s) => s.id === finalTargetSectionId);
    const baseSecBcs = destSec?.breadcrumbs && destSec.breadcrumbs.length > 0
      ? destSec.breadcrumbs
      : (destSec?.title ? [destSec.title] : []);

    childChunks = childChunks.map((c) => {
      if (targetChildIdSet.has(c.chunk_id)) {
        let newBreadcrumbs = destParentTitle ? [...baseSecBcs, destParentTitle] : [...baseSecBcs];
        const isArticle = c.chunk_type === 'article' || c.chunk_type === 'article_clause';
        if (isArticle && c.metadata?.article_no) {
          const artDisplay = c.metadata?.article_title
            ? `${c.metadata.article_no}(${c.metadata.article_title})`
            : c.metadata.article_no;
          newBreadcrumbs.push(artDisplay);
        }

        return {
          ...c,
          parent_chunk_id: finalTargetParentId,
          parent_id: finalTargetParentId,
          section_id: finalTargetSectionId,
          breadcrumbs: newBreadcrumbs,
          is_edited: true,
        };
      }
      return c;
    });

    // 6) Stats 갱신
    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: parentChunks.length,
      total_child_chunks: childChunks.length,
    };

    // 7) syncHierarchyOrder 일괄 동기화
    const intermediateEtl = {
      ...etlData,
      parent_chunks: parentChunks,
      child_chunks: childChunks,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    };
    const syncedEtl = syncHierarchyOrder(intermediateEtl);

    setEtlData(syncedEtl);
    setIsDirty(true);
    setSelectedParentChunkId(finalTargetParentId);
    if (finalTargetSectionId) setSelectedSectionId(finalTargetSectionId);

    const pruneNote = prunedParentIds.size > 0 ? ` (빈 Parent ${prunedParentIds.size}개 자동 정리)` : '';
    showToast(`청크 ${chunkIds.length}개의 상위 Parent가 '${destParentTitle || finalTargetParentId}'(으)로 재할당되었습니다.${pruneNote}`);
  };

  // 10-1. Add Parent Chunk Handler (with Initial Child Chunk & Insertion Position)
  const handleAddParent = (data: {
    sectionId: string;
    title: string;
    pageNumber: number;
    initialChildText: string;
    chunkType: 'paragraph' | 'table' | 'article_clause' | 'article';
    insertPosition?: ParentInsertPosition;
    inheritMetadata?: boolean;
  }) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const targetSection = sections.find((s) => s.id === data.sectionId);
    if (!targetSection) {
      showToast(`지정된 섹션(${data.sectionId})을 찾을 수 없습니다.`, true);
      return;
    }

    const docId = etlData.doc_id || generateDocId(etlData.doc_title);
    const newParentId = getNextParentChunkId(etlData.parent_chunks || [], docId);
    const newChildId = getNextChunkId(etlData.child_chunks || [], docId);

    const childEstimate = estimateKoreanTokens(data.initialChildText);
    const secBreadcrumbs =
      targetSection.breadcrumbs && targetSection.breadcrumbs.length > 0
        ? targetSection.breadcrumbs
        : [targetSection.title];
    const childBreadcrumbs = [...secBreadcrumbs, data.title];

    // 커스텀 메타데이터 자동 상속 탐색 (페이지 정보는 복사하지 않고 격리)
    let inheritedCustomMeta: Record<string, any> = {};
    if (data.inheritMetadata !== false) {
      const childList = etlData.child_chunks || [];
      const parentList = etlData.parent_chunks || [];
      const pos = data.insertPosition;

      let sourceChunk: ChildChunk | undefined;

      // 1) 특정 Parent 뒤에 삽입하는 경우: 해당 Parent의 마지막 Child 청크에서 탐색
      if (pos?.type === 'after' && pos.parentId) {
        const refParent = parentList.find(
          (p) => (p.parent_chunk_id || p.id) === pos.parentId
        );
        if (refParent?.child_chunk_ids && refParent.child_chunk_ids.length > 0) {
          const lastChildId = refParent.child_chunk_ids[refParent.child_chunk_ids.length - 1];
          sourceChunk = childList.find((c) => c.chunk_id === lastChildId);
        }
      }

      // 2) 동일 섹션 내의 Child 청크 탐색
      if (!sourceChunk) {
        sourceChunk = childList.find((c) => c.section_id === data.sectionId);
      }

      // 3) 섹션에 청크가 없다면 문서 전체의 첫 번째 청크 탐색 (문서 대표 공통 메타데이터)
      if (!sourceChunk && childList.length > 0) {
        sourceChunk = childList[0];
      }

      if (sourceChunk?.metadata) {
        inheritedCustomMeta = extractCustomMetadata(sourceChunk.metadata);
      }
    }

    // 1) 신규 Child 생성 (페이지 정보는 사용자가 입력한 pageNumber로 유지)
    const newChild: ChildChunk = {
      chunk_id: newChildId,
      parent_chunk_id: newParentId,
      parent_id: newParentId,
      section_id: data.sectionId,
      chunk_type: data.chunkType,
      text: data.initialChildText,
      token_estimate: childEstimate,
      page_number: data.pageNumber,
      breadcrumbs: childBreadcrumbs,
      is_edited: true,
      metadata: syncChunkPageMetadata(inheritedCustomMeta, data.pageNumber),
    };

    // 2) 신규 Parent 생성
    const newParent: ParentChunk = {
      parent_chunk_id: newParentId,
      id: newParentId,
      section_id: data.sectionId,
      title: data.title,
      text: data.initialChildText,
      token_estimate: childEstimate,
      child_chunk_ids: [newChildId],
      page_range: [data.pageNumber, data.pageNumber],
      is_edited: true,
    };

    // 3) Section 갱신: parent_chunk_ids 삽입 위치 반영, page_range 확장
    const updatedSections = sections.map((sec) => {
      if (sec.id === data.sectionId) {
        const pRange = sec.page_range || [data.pageNumber, data.pageNumber];
        const newPageRange: [number, number] = [
          Math.min(pRange[0], data.pageNumber),
          Math.max(pRange[1], data.pageNumber),
        ];

        const oldParentIds = [...(sec.parent_chunk_ids || [])];
        const pos = data.insertPosition || { type: 'end' };
        let newParentIds: string[];

        if (pos.type === 'start') {
          newParentIds = [newParentId, ...oldParentIds];
        } else if (pos.type === 'after' && pos.parentId) {
          const afterIdx = oldParentIds.indexOf(pos.parentId);
          if (afterIdx !== -1) {
            newParentIds = [
              ...oldParentIds.slice(0, afterIdx + 1),
              newParentId,
              ...oldParentIds.slice(afterIdx + 1),
            ];
          } else {
            newParentIds = [...oldParentIds, newParentId];
          }
        } else {
          newParentIds = [...oldParentIds, newParentId];
        }

        return {
          ...sec,
          parent_chunk_ids: newParentIds,
          page_range: newPageRange,
        };
      }
      return sec;
    });

    const updatedParents = [...(etlData.parent_chunks || []), newParent];
    const updatedChildren = [...(etlData.child_chunks || []), newChild];

    const totalWords = updatedChildren.reduce(
      (acc, c) => acc + (c.text ? c.text.trim().split(/\s+/).length : 0),
      0
    );
    const paragraphChunks = updatedChildren.filter((c) => c.chunk_type === 'paragraph').length;
    const tableChunks = updatedChildren.filter((c) => c.chunk_type === 'table').length;
    const articleChunks = updatedChildren.filter(
      (c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause'
    ).length;

    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: updatedParents.length,
      total_child_chunks: updatedChildren.length,
      paragraph_chunks: paragraphChunks,
      table_chunks: tableChunks,
      article_chunks: articleChunks,
      total_words: totalWords,
    };

    // 4) syncHierarchyOrder를 통해 전체 parent_chunks, child_chunks 및 sec.child_chunk_ids를 위치에 맞게 일괄 동기화
    const intermediateEtl = {
      ...etlData,
      parent_chunks: updatedParents,
      child_chunks: updatedChildren,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    };
    const syncedEtl = syncHierarchyOrder(intermediateEtl);

    setEtlData(syncedEtl);
    setIsDirty(true);
    setSelectedSectionId(data.sectionId);
    setSelectedParentChunkId(newParentId);
    showToast(`새 Parent '${data.title}' 및 Child 청크가 지정한 위치에 성공적으로 생성되었습니다.`);
  };

  // 10-1b. Move Parent Chunk Order Handler (Swap with adjacent parent in same section)
  const handleMoveParent = (parentChunkId: string, direction: 'up' | 'down') => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const parentChunks = etlData.parent_chunks || [];

    const targetParent = parentChunks.find(
      (p) => p.parent_chunk_id === parentChunkId || p.id === parentChunkId
    );
    if (!targetParent) {
      showToast(`대상 Parent 청크(${parentChunkId})를 찾을 수 없습니다.`, true);
      return;
    }

    const targetSection = sections.find((s) => s.id === targetParent.section_id);
    if (!targetSection) {
      showToast(`소속 섹션을 찾을 수 없습니다.`, true);
      return;
    }

    const secParentIds = targetSection.parent_chunk_ids && targetSection.parent_chunk_ids.length > 0
      ? [...targetSection.parent_chunk_ids]
      : parentChunks
          .filter((p) => p.section_id === targetParent.section_id)
          .map((p) => p.parent_chunk_id || p.id || '');

    const currIdx = secParentIds.indexOf(parentChunkId);
    if (currIdx === -1) {
      showToast(`섹션 내에서 Parent 청크를 찾을 수 없습니다.`, true);
      return;
    }

    const swapIdx = direction === 'up' ? currIdx - 1 : currIdx + 1;
    if (swapIdx < 0 || swapIdx >= secParentIds.length) {
      showToast(
        direction === 'up' ? '이미 섹션의 가장 첫 번째 항목입니다.' : '이미 섹션의 가장 마지막 항목입니다.'
      );
      return;
    }

    // 인접 항목과 순서 맞바꾸기(Swap)
    const swappedPid = secParentIds[swapIdx];
    secParentIds[currIdx] = swappedPid;
    secParentIds[swapIdx] = parentChunkId;

    // 섹션의 parent_chunk_ids 갱신
    const updatedSections = sections.map((sec) => {
      if (sec.id === targetParent.section_id) {
        return {
          ...sec,
          parent_chunk_ids: secParentIds,
        };
      }
      return sec;
    });

    // 계층 일괄 동기화 (parent_chunks, child_chunks, sec.child_chunk_ids)
    const syncedEtl = syncHierarchyOrder({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
    });

    setEtlData(syncedEtl);
    setIsDirty(true);
    showToast(
      `Parent '${targetParent.title || parentChunkId}'의 순서가 ${direction === 'up' ? '위' : '아래'}로 변경되었습니다.`
    );
  };

  // 10-1c. Move Section Order Handler (Swap with adjacent sibling section preserving descendants)
  const handleMoveSection = (sectionId: string, direction: 'up' | 'down') => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];

    const targetSec = sections.find((s) => s.id === sectionId);
    if (!targetSec) {
      showToast(`대상 섹션(${sectionId})을 찾을 수 없습니다.`, true);
      return;
    }

    if (targetSec.level === 0 || targetSec.id.endsWith('_s00') || targetSec.id.endsWith('_root')) {
      showToast('루트 문서 섹션의 순서는 변경할 수 없습니다.', true);
      return;
    }

    // 동일한 상위 섹션을 공유하는 형제 섹션들 탐색
    const siblings = sections.filter((s) => {
      if (s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')) return false;
      const targetParent = targetSec.parent_section_id || '';
      const sParent = s.parent_section_id || '';
      return targetParent === sParent;
    });

    const currIdx = siblings.findIndex((s) => s.id === sectionId);
    if (currIdx === -1) {
      showToast('형제 섹션 목록에서 대상을 찾을 수 없습니다.', true);
      return;
    }

    const swapIdx = direction === 'up' ? currIdx - 1 : currIdx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) {
      showToast(
        direction === 'up'
          ? '해당 계층 내의 가장 첫 번째 섹션입니다.'
          : '해당 계층 내의 가장 마지막 섹션입니다.'
      );
      return;
    }

    const partnerSec = siblings[swapIdx];

    // 각 섹션 및 하위 자손(descendant) ID 집합 수집
    const getSubtreeIds = (rootId: string): Set<string> => {
      const ids = new Set<string>([rootId]);
      let added = true;
      while (added) {
        added = false;
        for (const s of sections) {
          if (s.parent_section_id && ids.has(s.parent_section_id) && !ids.has(s.id)) {
            ids.add(s.id);
            added = true;
          }
        }
      }
      return ids;
    };

    const targetSubtreeIds = getSubtreeIds(targetSec.id);
    const partnerSubtreeIds = getSubtreeIds(partnerSec.id);

    const targetBlock = sections.filter((s) => targetSubtreeIds.has(s.id));
    const remaining = sections.filter((s) => !targetSubtreeIds.has(s.id));

    let updatedSections: SectionNode[];
    if (direction === 'up') {
      // partnerSec의 시작 위치 바로 앞에 targetBlock 삽입
      const insertIdx = remaining.findIndex((s) => s.id === partnerSec.id);
      if (insertIdx !== -1) {
        updatedSections = [
          ...remaining.slice(0, insertIdx),
          ...targetBlock,
          ...remaining.slice(insertIdx),
        ];
      } else {
        updatedSections = sections;
      }
    } else {
      // partnerSec 서브트리의 마지막 노드 바로 뒤에 targetBlock 삽입
      let lastPartnerIdx = -1;
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (partnerSubtreeIds.has(remaining[i].id)) {
          lastPartnerIdx = i;
          break;
        }
      }
      if (lastPartnerIdx !== -1) {
        updatedSections = [
          ...remaining.slice(0, lastPartnerIdx + 1),
          ...targetBlock,
          ...remaining.slice(lastPartnerIdx + 1),
        ];
      } else {
        updatedSections = sections;
      }
    }

    const syncedEtl = syncHierarchyOrder({
      ...etlData,
      sections: updatedSections,
      parent_sections: updatedSections,
    });

    setEtlData(syncedEtl);
    setIsDirty(true);
    showToast(
      `섹션 '${targetSec.title}'의 순서가 ${direction === 'up' ? '위' : '아래'}로 변경되었습니다.`
    );
  };

  // 10-1d. Reparent Section Handler (Move section under another parent or promote to root level)
  const handleReparentSection = (sectionId: string, newParentSectionId: string | null) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const parentChunks = etlData.parent_chunks || [];
    const childChunks = etlData.child_chunks || [];

    const targetSec = sections.find((s) => s.id === sectionId);
    if (!targetSec) {
      showToast(`대상 섹션(${sectionId})을 찾을 수 없습니다.`, true);
      return;
    }

    if (targetSec.level === 0 || targetSec.id.endsWith('_s00') || targetSec.id.endsWith('_root')) {
      showToast('루트 문서 섹션은 이동할 수 없습니다.', true);
      return;
    }

    const rootSec = sections.find(
      (s) => s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')
    );

    // newParentSectionId가 비어있거나 rootSec과 같으면 최상위(level 1)로 설정
    const isTargetRoot = !newParentSectionId || (rootSec && newParentSectionId === rootSec.id);
    const targetParentId = isTargetRoot ? (rootSec ? rootSec.id : undefined) : newParentSectionId;

    if (targetSec.parent_section_id === targetParentId) {
      showToast('이미 해당 상위 섹션에 속해 있습니다.');
      return;
    }

    // 1. 순환 참조 검사: targetSec 및 하위 자손(descendant) ID 집합 추출
    const descendantIds = new Set<string>([sectionId]);
    let added = true;
    while (added) {
      added = false;
      for (const s of sections) {
        if (s.parent_section_id && descendantIds.has(s.parent_section_id) && !descendantIds.has(s.id)) {
          descendantIds.add(s.id);
          added = true;
        }
      }
    }

    if (targetParentId && descendantIds.has(targetParentId)) {
      showToast('자기 자신이나 하위 자손 섹션을 상위 섹션으로 지정할 수 없습니다.', true);
      return;
    }

    const newParentSec = targetParentId ? sections.find((s) => s.id === targetParentId) : null;
    const baseBreadcrumbs = newParentSec
      ? (newParentSec.breadcrumbs || [newParentSec.title])
      : (rootSec ? (rootSec.breadcrumbs || [rootSec.title]) : []);

    // 2. targetSec 및 하위 자손들의 level, breadcrumbs 재계산
    const sectionBreadcrumbsMap = new Map<string, string[]>();
    const sectionLevelMap = new Map<string, number>();

    const newTargetLevel = newParentSec
      ? (newParentSec.level === 0 ? 1 : newParentSec.level + 1)
      : 1;
    const newTargetBreadcrumbs = [...baseBreadcrumbs, targetSec.title];

    sectionBreadcrumbsMap.set(targetSec.id, newTargetBreadcrumbs);
    sectionLevelMap.set(targetSec.id, newTargetLevel);

    const updateDescendants = (parentId: string, parentBreadcrumbs: string[], parentLevel: number) => {
      for (const s of sections) {
        if (s.parent_section_id === parentId && descendantIds.has(s.id)) {
          const nextBreadcrumbs = [...parentBreadcrumbs, s.title];
          const nextLevel = parentLevel + 1;
          sectionBreadcrumbsMap.set(s.id, nextBreadcrumbs);
          sectionLevelMap.set(s.id, nextLevel);
          updateDescendants(s.id, nextBreadcrumbs, nextLevel);
        }
      }
    };
    updateDescendants(targetSec.id, newTargetBreadcrumbs, newTargetLevel);

    // 3. SectionNode 목록 갱신
    const updatedSectionMap = new Map<string, SectionNode>();
    for (const s of sections) {
      if (s.id === targetSec.id) {
        updatedSectionMap.set(s.id, {
          ...s,
          parent_section_id: targetParentId,
          level: newTargetLevel,
          breadcrumbs: newTargetBreadcrumbs,
        });
      } else if (descendantIds.has(s.id)) {
        updatedSectionMap.set(s.id, {
          ...s,
          level: sectionLevelMap.get(s.id) ?? s.level,
          breadcrumbs: sectionBreadcrumbsMap.get(s.id) ?? s.breadcrumbs,
        });
      } else {
        updatedSectionMap.set(s.id, s);
      }
    }

    // 4. 배열 순서 재배치 (newParentSec의 서브트리 바로 뒤로 이동)
    const subtreeNodes: SectionNode[] = [];
    const remainingSections: SectionNode[] = [];

    for (const s of sections) {
      if (descendantIds.has(s.id)) {
        subtreeNodes.push(updatedSectionMap.get(s.id)!);
      } else {
        remainingSections.push(updatedSectionMap.get(s.id)!);
      }
    }

    let finalSections: SectionNode[];
    if (newParentSec && newParentSec.level !== 0 && !newParentSec.id.endsWith('_s00')) {
      const parentDescendantIds = new Set<string>([newParentSec.id]);
      let pAdded = true;
      while (pAdded) {
        pAdded = false;
        for (const s of remainingSections) {
          if (s.parent_section_id && parentDescendantIds.has(s.parent_section_id) && !parentDescendantIds.has(s.id)) {
            parentDescendantIds.add(s.id);
            pAdded = true;
          }
        }
      }
      let lastIdx = -1;
      for (let i = remainingSections.length - 1; i >= 0; i--) {
        if (parentDescendantIds.has(remainingSections[i].id)) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx !== -1) {
        finalSections = [
          ...remainingSections.slice(0, lastIdx + 1),
          ...subtreeNodes,
          ...remainingSections.slice(lastIdx + 1),
        ];
      } else {
        finalSections = [...remainingSections, ...subtreeNodes];
      }
    } else {
      finalSections = [...remainingSections, ...subtreeNodes];
    }

    // 5. 소속 Parent Chunk 및 Child Chunk의 breadcrumbs 연쇄 동기화
    const updatedParentChunks = parentChunks.map((p) => {
      const secId = p.section_id;
      if (secId && sectionBreadcrumbsMap.has(secId)) {
        return {
          ...p,
          breadcrumbs: sectionBreadcrumbsMap.get(secId),
          is_edited: true,
        };
      }
      return p;
    });

    const updatedChildChunks = childChunks.map((c) => {
      const secId = c.section_id;
      if (secId && sectionBreadcrumbsMap.has(secId)) {
        const parentChunk = parentChunks.find((p) => (p.parent_chunk_id || p.id) === (c.parent_chunk_id || c.parent_id));
        const secBcs = sectionBreadcrumbsMap.get(secId)!;
        const childBcs = parentChunk?.title ? [...secBcs, parentChunk.title] : [...secBcs];
        return {
          ...c,
          breadcrumbs: childBcs,
          is_edited: true,
        };
      }
      return c;
    });

    const syncedEtl = syncHierarchyOrder({
      ...etlData,
      sections: finalSections,
      parent_sections: finalSections,
      parent_chunks: updatedParentChunks,
      child_chunks: updatedChildChunks,
    });

    setEtlData(syncedEtl);
    setIsDirty(true);
    showToast(
      newParentSec && newParentSec.level !== 0 && !newParentSec.id.endsWith('_s00')
        ? `'${targetSec.title}' 섹션이 '${newParentSec.title}'의 하위 섹션으로 편입되었습니다.`
        : `'${targetSec.title}' 섹션이 상위 계층으로 승격되었습니다.`
    );
  };

  // 10-1e. Indent Section Handler (Move under previous sibling section)
  const handleIndentSection = (sectionId: string) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const targetSec = sections.find((s) => s.id === sectionId);
    if (!targetSec) return;

    if (targetSec.level === 0 || targetSec.id.endsWith('_s00') || targetSec.id.endsWith('_root')) {
      showToast('루트 문서 섹션은 변경할 수 없습니다.', true);
      return;
    }

    const siblings = sections.filter((s) => {
      if (s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')) return false;
      return (s.parent_section_id || '') === (targetSec.parent_section_id || '');
    });

    const currIdx = siblings.findIndex((s) => s.id === sectionId);
    if (currIdx <= 0) {
      showToast('들여쓰기할 이전 형제 섹션이 없습니다.', true);
      return;
    }

    const prevSibling = siblings[currIdx - 1];
    handleReparentSection(sectionId, prevSibling.id);
  };

  // 10-1f. Outdent Section Handler (Promote to parent's sibling level)
  const handleOutdentSection = (sectionId: string) => {
    if (!etlData) return;
    const sections = etlData.sections || etlData.parent_sections || [];
    const targetSec = sections.find((s) => s.id === sectionId);
    if (!targetSec) return;

    if (targetSec.level === 0 || targetSec.id.endsWith('_s00') || targetSec.id.endsWith('_root')) {
      showToast('루트 문서 섹션은 변경할 수 없습니다.', true);
      return;
    }

    const rootSec = sections.find(
      (s) => s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')
    );

    const currParent = sections.find((s) => s.id === targetSec.parent_section_id);
    if (!currParent || currParent.level === 0 || currParent.id === rootSec?.id) {
      showToast('이미 최상위 계층입니다.', true);
      return;
    }

    const grandParentId = currParent.parent_section_id || (rootSec ? rootSec.id : null);
    handleReparentSection(sectionId, grandParentId);
  };

  // 10-2. Add Child Chunk to Parent Handler
  const handleAddChild = (data: {
    parentChunkId: string;
    text: string;
    chunkType: 'paragraph' | 'table' | 'article_clause' | 'article';
    pageNumber: number;
    pageEnd?: number;
    rawHtml?: string;
  }) => {
    if (!etlData) return;
    const parentChunks = etlData.parent_chunks || [];
    const targetParent = parentChunks.find(
      (p) => p.parent_chunk_id === data.parentChunkId || p.id === data.parentChunkId
    );
    if (!targetParent) {
      showToast(`대상 Parent 청크(${data.parentChunkId})를 찾을 수 없습니다.`, true);
      return;
    }

    const sections = etlData.sections || etlData.parent_sections || [];
    const targetSection = sections.find((s) => s.id === targetParent.section_id);

    const docId = etlData.doc_id || generateDocId(etlData.doc_title);
    const newChildId = getNextChunkId(etlData.child_chunks || [], docId);
    const childEstimate = estimateKoreanTokens(data.text);

    const secBreadcrumbs =
      targetSection?.breadcrumbs || (targetSection?.title ? [targetSection.title] : []);
    const childBreadcrumbs = targetParent.title
      ? [...secBreadcrumbs, targetParent.title]
      : [...secBreadcrumbs];

    // 1) 신규 Child 객체
    const newChild: ChildChunk = {
      chunk_id: newChildId,
      parent_chunk_id: data.parentChunkId,
      parent_id: data.parentChunkId,
      section_id: targetParent.section_id,
      chunk_type: data.chunkType,
      text: data.text,
      token_estimate: childEstimate,
      page_number: data.pageNumber,
      page_end: data.pageEnd,
      raw_html: data.rawHtml,
      is_table: data.chunkType === 'table',
      breadcrumbs: childBreadcrumbs,
      is_edited: true,
      metadata: syncChunkPageMetadata({}, data.pageNumber, data.pageEnd),
    };

    const updatedChildren = [...(etlData.child_chunks || []), newChild];

    // 2) Parent 텍스트, 토큰 및 page_range 재계산
    const parentChildren = updatedChildren.filter(
      (c) => c.parent_chunk_id === data.parentChunkId || c.parent_id === data.parentChunkId
    );
    const parentCombinedText = parentChildren
      .map((c) => c.text)
      .filter(Boolean)
      .join('\n\n');
    const parentTokens = estimateKoreanTokens(parentCombinedText);

    let minPage = data.pageNumber;
    let maxPage = data.pageEnd || data.pageNumber;
    parentChildren.forEach((c) => {
      if (c.page_number) minPage = Math.min(minPage, c.page_number);
      const endP = c.page_end || c.page_number;
      if (endP) maxPage = Math.max(maxPage, endP);
    });

    const updatedParents = parentChunks.map((p) => {
      if (p.parent_chunk_id === data.parentChunkId || p.id === data.parentChunkId) {
        return {
          ...p,
          child_chunk_ids: [...(p.child_chunk_ids || []), newChildId],
          text: parentCombinedText,
          token_estimate: parentTokens,
          page_range: [minPage, maxPage] as [number, number],
          is_edited: true,
        };
      }
      return p;
    });

    // 3) Section 갱신: child_chunk_ids 추가 및 page_range 확장
    const updatedSections = sections.map((sec) => {
      if (sec.id === targetParent.section_id) {
        const pRange = sec.page_range || [minPage, maxPage];
        return {
          ...sec,
          child_chunk_ids: [...(sec.child_chunk_ids || []), newChildId],
          page_range: [Math.min(pRange[0], minPage), Math.max(pRange[1], maxPage)] as [
            number,
            number,
          ],
        };
      }
      return sec;
    });

    const totalWords = updatedChildren.reduce(
      (acc, c) => acc + (c.text ? c.text.trim().split(/\s+/).length : 0),
      0
    );
    const paragraphChunks = updatedChildren.filter((c) => c.chunk_type === 'paragraph').length;
    const tableChunks = updatedChildren.filter((c) => c.chunk_type === 'table').length;
    const articleChunks = updatedChildren.filter(
      (c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause'
    ).length;

    const updatedStats = {
      ...etlData.stats,
      total_child_chunks: updatedChildren.length,
      paragraph_chunks: paragraphChunks,
      table_chunks: tableChunks,
      article_chunks: articleChunks,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      parent_chunks: updatedParents,
      child_chunks: updatedChildren,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);
    setSelectedParentChunkId(data.parentChunkId);
    showToast(`Parent(${data.parentChunkId})에 새 Child 청크(${newChildId})가 추가되었습니다.`);
  };

  // 10-3. Update Parent Chunk Handler
  const handleUpdateParent = (
    parentChunkId: string,
    updates: { title: string; sectionId: string }
  ) => {
    if (!etlData) return;
    const parentChunks = etlData.parent_chunks || [];
    const sections = etlData.sections || etlData.parent_sections || [];
    const targetParent = parentChunks.find(
      (p) => p.parent_chunk_id === parentChunkId || p.id === parentChunkId
    );
    if (!targetParent) {
      showToast(`대상 Parent 청크(${parentChunkId})를 찾을 수 없습니다.`, true);
      return;
    }

    const oldSectionId = targetParent.section_id;
    const newSectionId = updates.sectionId;
    const targetSection = sections.find((s) => s.id === newSectionId);
    if (!targetSection) {
      showToast(`선택한 섹션을 찾을 수 없습니다.`, true);
      return;
    }

    const pid = targetParent.parent_chunk_id || targetParent.id || '';
    const childIdSet = new Set(targetParent.child_chunk_ids || []);

    // 1) Parent 업데이트
    const updatedParents = parentChunks.map((p) => {
      if ((p.parent_chunk_id || p.id) === pid) {
        return {
          ...p,
          title: updates.title,
          section_id: newSectionId,
          is_edited: true,
        };
      }
      return p;
    });

    // 2) Child 청크들 breadcrumbs 및 section_id 동기화
    const secBreadcrumbs =
      targetSection.breadcrumbs && targetSection.breadcrumbs.length > 0
        ? targetSection.breadcrumbs
        : [targetSection.title];
    const newBreadcrumbs = updates.title
      ? [...secBreadcrumbs, updates.title]
      : [...secBreadcrumbs];

    const updatedChildren = (etlData.child_chunks || []).map((c) => {
      if (childIdSet.has(c.chunk_id) || c.parent_chunk_id === pid || c.parent_id === pid) {
        return {
          ...c,
          section_id: newSectionId,
          breadcrumbs: newBreadcrumbs,
          is_edited: true,
        };
      }
      return c;
    });

    // 3) 섹션 변경 시 Sections 배열 동기화
    let updatedSections = sections;
    if (oldSectionId !== newSectionId) {
      updatedSections = sections.map((sec) => {
        if (sec.id === oldSectionId) {
          return {
            ...sec,
            parent_chunk_ids: (sec.parent_chunk_ids || []).filter((id) => id !== pid),
            child_chunk_ids: (sec.child_chunk_ids || []).filter((id) => !childIdSet.has(id)),
          };
        }
        if (sec.id === newSectionId) {
          const pIds = [...(sec.parent_chunk_ids || [])];
          if (!pIds.includes(pid)) pIds.push(pid);
          const cIds = [...(sec.child_chunk_ids || [])];
          (targetParent.child_chunk_ids || []).forEach((cid) => {
            if (!cIds.includes(cid)) cIds.push(cid);
          });
          return {
            ...sec,
            parent_chunk_ids: pIds,
            child_chunk_ids: cIds,
          };
        }
        return sec;
      });
    }

    setEtlData({
      ...etlData,
      parent_chunks: updatedParents,
      child_chunks: updatedChildren,
      sections: updatedSections,
      parent_sections: updatedSections,
    });
    setIsDirty(true);
    showToast(`Parent '${updates.title}' 정보가 수정되었습니다.`);
  };

  // 10-4. Delete Parent Chunk Handler
  const handleDeleteParent = (parentChunkId: string) => {
    if (!etlData) return;
    const parentChunks = etlData.parent_chunks || [];
    const targetParent = parentChunks.find(
      (p) => p.parent_chunk_id === parentChunkId || p.id === parentChunkId
    );
    if (!targetParent) {
      showToast(`대상 Parent 청크(${parentChunkId})를 찾을 수 없습니다.`, true);
      return;
    }

    const pid = targetParent.parent_chunk_id || targetParent.id || '';
    const childIdSet = new Set(targetParent.child_chunk_ids || []);

    // 1) Parent 및 소속 Child 필터링 제거
    const updatedParents = parentChunks.filter(
      (p) => (p.parent_chunk_id || p.id) !== pid
    );
    const updatedChildren = (etlData.child_chunks || []).filter(
      (c) => !childIdSet.has(c.chunk_id) && c.parent_chunk_id !== pid && c.parent_id !== pid
    );

    // 2) Sections에서 제거
    const sections = etlData.sections || etlData.parent_sections || [];
    const updatedSections = sections.map((sec) => ({
      ...sec,
      parent_chunk_ids: (sec.parent_chunk_ids || []).filter((id) => id !== pid),
      child_chunk_ids: (sec.child_chunk_ids || []).filter((id) => !childIdSet.has(id)),
    }));

    // 3) 통계 갱신
    const totalWords = updatedChildren.reduce(
      (acc, c) => acc + (c.text ? c.text.trim().split(/\s+/).length : 0),
      0
    );
    const paragraphChunks = updatedChildren.filter((c) => c.chunk_type === 'paragraph').length;
    const tableChunks = updatedChildren.filter((c) => c.chunk_type === 'table').length;
    const articleChunks = updatedChildren.filter(
      (c) => c.chunk_type === 'article' || c.chunk_type === 'article_clause'
    ).length;

    const updatedStats = {
      ...etlData.stats,
      total_parent_chunks: updatedParents.length,
      total_child_chunks: updatedChildren.length,
      paragraph_chunks: paragraphChunks,
      table_chunks: tableChunks,
      article_chunks: articleChunks,
      total_words: totalWords,
    };

    setEtlData({
      ...etlData,
      parent_chunks: updatedParents,
      child_chunks: updatedChildren,
      sections: updatedSections,
      parent_sections: updatedSections,
      stats: updatedStats,
    });
    setIsDirty(true);
    showToast(`Parent '${targetParent.title || pid}' 및 소속 자식 청크가 삭제되었습니다.`);
  };

  // 11. Batch Clean Empty Chunks Handler (Phase 3)
  const handleBatchCleanEmptyChunks = () => {
    if (!etlData) return;
    const emptyChunks = etlData.child_chunks.filter(
      (c) =>
        (!c.text || !c.text.trim()) &&
        (!c.raw_html || !c.raw_html.trim()) &&
        !c.is_ignored
    );

    if (emptyChunks.length === 0) {
      showToast('정리할 빈 청크가 없습니다.');
      return;
    }

    const confirmed = window.confirm(
      `내용이 없는 ${emptyChunks.length}개의 빈 청크를 임베딩 제외(Ignore) 처리하시겠습니까?`
    );
    if (!confirmed) return;

    const emptyIdSet = new Set(emptyChunks.map((c) => c.chunk_id));
    const updatedChunks = etlData.child_chunks.map((c) => {
      if (emptyIdSet.has(c.chunk_id)) {
        return { ...c, is_ignored: true, is_edited: true };
      }
      return c;
    });

    setEtlData({
      ...etlData,
      child_chunks: updatedChunks,
    });
    setIsDirty(true);
    showToast(`🧹 ${emptyChunks.length}개의 빈 청크를 임베딩 제외 처리했습니다.`);
  };

  // 12. Re-index All IDs Handler (3-Tier ID 일괄 물리적 순서 재정렬 및 128-bit 최신 규격 업그레이드)
  const handleReindexIds = async () => {
    if (!etlData) return;
    const secCount = (etlData.sections || etlData.parent_sections || []).length;
    const parentCount = (etlData.parent_chunks || []).length;
    const childCount = etlData.child_chunks.length;
    const confirmed = window.confirm(
      `전체 계층(Section s00~, Parent p0001~, Child c0001~) ID를 문서 물리적 순서대로 재정렬하시겠습니까?\n(총 ${secCount}개 섹션, ${parentCount}개 Parent, ${childCount}개 Child)\n\n※ 분할/병합/섹션 재지정 후 번호가 깨끗하게 순차적으로 정돈되며, 128-bit 풀 UUID 및 4자리 패딩 규격으로 자동 최신화됩니다.`
    );
    if (!confirmed) return;

    try {
      const payload: any = {
        ...etlData,
        active_pdf: etlData.active_pdf || selectedPdf,
        doc_title: etlData.doc_title || selectedPdf,
      };
      const res = await reindexEtlResult(payload);
      const normalized = normalizeEtlData(res);
      setEtlData(normalized);
      setIsDirty(true);
      showToast('전체 계층 ID가 128-bit 고유 규격으로 성공적으로 재정렬되었습니다.');
    } catch (err: any) {
      console.error('Reindex API error, falling back to local:', err);
      const reindexed = reindexEtlData({
        ...etlData,
        active_pdf: etlData.active_pdf || selectedPdf,
        doc_title: etlData.doc_title || selectedPdf,
      });
      setEtlData(reindexed);
      setIsDirty(true);
      showToast('전체 계층 ID가 재정렬되었습니다.');
    }
  };

  // 13. Save ETL Result to Backend & Disk
  const handleSaveEtl = async () => {
    if (!etlData) return;
    setIsSaving(true);
    try {
      const res = await saveEtlResult(etlData);
      setIsDirty(false);
      showToast(`🎉 ${res.message || '수정본이 파일(rag_chunks_edited.json)에 성공적으로 저장되었습니다.'}`);
    } catch (err: any) {
      console.error('Save error:', err);
      showToast(err.message || '수정본 저장 중 오류가 발생했습니다.', true);
    } finally {
      setIsSaving(false);
    }
  };

  // 14. Reset ETL Result to Original
  const handleResetEtl = async () => {
    const confirmed = window.confirm('모든 수정 내용을 폐기하고 원본 파싱 결과로 복원하시겠습니까?');
    if (!confirmed) return;

    setIsResetting(true);
    try {
      const original = await resetEtlResult(strategy);
      const normalized = normalizeEtlData(original);
      setEtlData(normalized);
      setIsDirty(false);
      const firstSec = normalized.sections?.find((s) => (s.child_chunk_ids?.length || 0) > 0) || normalized.sections?.[0];
      setSelectedSectionId(firstSec?.id || null);
      showToast('🔄 원본 파싱 데이터로 초기화되었습니다.');
    } catch (err: any) {
      console.error('Reset error:', err);
      showToast(err.message || '초기화 중 오류가 발생했습니다.', true);
    } finally {
      setIsResetting(false);
    }
  };

  const totalChunksCount = etlData?.child_chunks.length || 0;
  const editedChunksCount = etlData?.child_chunks.filter((c) => c.is_edited).length || 0;
  const ignoredChunksCount = etlData?.child_chunks.filter((c) => c.is_ignored).length || 0;

  return (
    <div className="bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 h-screen flex font-sans overflow-hidden transition-colors">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 border transition-all animate-bounce ${
            toast.isError
              ? 'bg-rose-50 dark:bg-rose-950/80 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
              : 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          <span>{toast.message}</span>
        </div>
      )}

      {/* Left Slim Navigation Sidebar */}
      <SidebarNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        totalChunks={totalChunksCount}
        editedChunksCount={editedChunksCount}
        ignoredChunksCount={ignoredChunksCount}
        isDirty={isDirty}
        activePdf={selectedPdf}
        theme={theme}
        setTheme={setTheme}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
      />

      {/* Right Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Navbar */}
        <Header
          hasData={!!(etlData && etlData.child_chunks.length > 0)}
          activeTab={activeTab}
          activePdf={selectedPdf}
          isDirty={isDirty}
          isSaving={isSaving}
          isResetting={isResetting}
          isIndexingQdrant={isIndexingQdrant}
          qdrantIndexProgress={qdrantIndexProgress}
          theme={theme}
          setTheme={setTheme}
          onSave={handleSaveEtl}
          onReset={handleResetEtl}
          onReindex={handleReindexIds}
          onOpenLLMConfig={() => setIsLLMConfigOpen(true)}
          onOpenQdrantConfig={() => setIsQdrantConfigOpen(true)}
          onIndexQdrant={handleIndexQdrant}
          onOpenBackup={() => setIsBackupModalOpen(true)}
          onToggleSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        />

        {activeTab === 'dashboard' ? (
          /* Dashboard Mode: Multi-Document ETL & RAG Pipeline Status Board */
          <DashboardOverview
            pdfList={pdfList}
            globalStats={globalStats}
            selectedPdf={selectedPdf}
            onSelectPdf={handleSelectPdf}
            onSelectAndOpenStudio={handleSelectAndOpenStudio}
            onUploadPdf={async (e) => {
              if (e.target.files && e.target.files[0]) {
                await handleUploadPdf(e.target.files[0]);
              }
            }}
            onDropUploadPdf={handleDropUploadPdf}
            isUploading={isUploading}
            onRunEtl={handleRunEtl}
            isParsing={isParsing}
            activeJob={activeJob}
            onRefreshList={fetchPdfs}
            onOpenQdrantModal={() => setIsQdrantConfigOpen(true)}
            onOpenBackup={() => setIsBackupModalOpen(true)}
            engine={engine}
            setEngine={setEngine}
            method={method}
            setMethod={setMethod}
            formula={formula}
            setFormula={setFormula}
            strategy={strategy}
            setStrategy={setStrategy}
            allPages={allPages}
            setAllPages={setAllPages}
            startPage={startPage}
            setStartPage={setStartPage}
            endPage={endPage}
            setEndPage={setEndPage}
            preserveNewlines={preserveNewlines}
            setPreserveNewlines={setPreserveNewlines}
            onSaveParserConfig={handleSaveParserConfig}
            onResetParserConfig={handleResetParserConfig}
            isSavingParserConfig={isSavingParserConfig}
            onDeletePdf={handleDeletePdfDocument}
            onResetEtl={handleResetEtlDocument}
          />
        ) : activeTab === 'studio' ? (
          /* Chunk Studio Mode: 3-Column Focus IDE Workspace */
          <div className="flex-1 overflow-hidden p-3 sm:p-4 flex flex-col min-h-0">
            {!isLoadingEtl && (!etlData || ((!etlData.child_chunks || etlData.child_chunks.length === 0) && (!etlData.sections || etlData.sections.length === 0))) ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 shadow-xs">
                  <FileText className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
                  {selectedPdf ? `'${selectedPdf}' 파싱 산출물이 없습니다` : '선택된 문서가 없습니다'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mb-6 leading-relaxed">
                  {selectedPdf
                    ? '파싱 산출물이 초기화되었거나 아직 분석되지 않은 문서입니다. 파싱 대시보드에서 파싱을 실행하여 계층 구조와 청크를 생성해주세요.'
                    : '파싱 대시보드에서 분석할 PDF 문서를 선택해주세요.'}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('dashboard')}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    <span>대시보드로 이동</span>
                  </button>
                  {selectedPdf && (
                    <button
                      type="button"
                      onClick={() => {
                        handleRunEtl(selectedPdf);
                        setActiveTab('dashboard');
                      }}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>지금 파싱 실행</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <ChunkStudio
                parentSections={etlData?.sections || etlData?.parent_sections || []}
                childChunks={etlData?.child_chunks || []}
                parentChunks={etlData?.parent_chunks || []}
                selectedSectionId={selectedSectionId}
                onSelectSection={setSelectedSectionId}
                onUpdateChunk={handleUpdateChunk}
                onUpdateSectionTitle={handleUpdateSectionTitle}
                onDeleteSection={handleDeleteSection}
                onAddSection={handleAddSection}
                onMoveSection={handleMoveSection}
                onReparentSection={handleReparentSection}
                onIndentSection={handleIndentSection}
                onOutdentSection={handleOutdentSection}
                onAddParent={handleAddParent}
                onAddChild={handleAddChild}
                onUpdateParent={handleUpdateParent}
                onDeleteParent={handleDeleteParent}
                onMoveParent={handleMoveParent}
                onBatchCleanEmptySections={handleBatchCleanEmptySections}
                onToggleIgnoreChunk={handleToggleIgnoreChunk}
                onOpenJsonlModal={setActiveModalChunk}
                onSplitChunk={handleSplitChunk}
                onMergeChunks={handleMergeChunks}
                onDeleteChunks={handleDeleteChunks}
                onReassignParentSection={handleReassignParentSection}
                onReparentChildChunk={handleReparentChildChunk}
                onBatchCleanEmptyChunks={handleBatchCleanEmptyChunks}
                onReindexIds={handleReindexIds}
                onBulkUpdateMetadata={handleBulkUpdateMetadata}
                isLoading={isLoadingEtl}
              />
            )}
          </div>
        ) : (
          /* Hybrid Search Playground Mode */
          <RetrievalPlayground
            collectionName={qdrantCollection || undefined}
            onOpenConfig={() => setIsQdrantConfigOpen(true)}
            onSelectChunk={(chunkId) => {
              // 검색 결과에서 해당 청크를 스튜디오에서 탐색할 수 있도록 탭 전환
              setActiveTab('studio');
              // 해당 청크의 부모 섹션 찾아서 선택
              const targetChunk = etlData?.child_chunks.find((c) => c.chunk_id === chunkId);
              if (targetChunk?.section_id) {
                setSelectedSectionId(targetChunk.section_id);
              }
            }}
          />
        )}
      </div>

      {/* JSONL Record Modal */}
      <JsonlModal
        chunk={activeModalChunk}
        parentSections={etlData?.sections || etlData?.parent_sections || []}
        parentChunks={etlData?.parent_chunks || []}
        onClose={() => setActiveModalChunk(null)}
      />

      {/* Qdrant Configuration Modal */}
      <QdrantConfigModal
        isOpen={isQdrantConfigOpen}
        onClose={() => setIsQdrantConfigOpen(false)}
        onSaved={(cfg) => {
          setQdrantCollection(cfg.collection_name);
          showToast(`Qdrant 설정이 저장되었습니다. (컬렉션: ${cfg.collection_name})`);
        }}
      />

      {/* LLM Configuration Modal */}
      <LLMConfigModal
        isOpen={isLLMConfigOpen}
        onClose={() => setIsLLMConfigOpen(false)}
        onSaved={(cfg) => {
          showToast(`LLM 설정이 저장되었습니다. (모델: ${cfg.model_name})`);
        }}
      />

      {/* Workspace & Document Backup & Restore Modal */}
      <BackupRestoreModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        activePdf={selectedPdf}
        pdfList={pdfList}
        onRestoreSuccess={async () => {
          showToast('작업공간이 성공적으로 복원되었습니다.');
          await fetchPdfs();
          if (selectedPdf) {
            await fetchSample(selectedPdf);
          }
        }}
      />
    </div>
  );
}

export default App;

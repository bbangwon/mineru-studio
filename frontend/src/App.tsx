import { useState, useEffect, useCallback, useRef } from 'react';
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
import { reindexEtlData } from './utils/idUtils';
import { normalizeEtlData, isLegalDoc } from './utils/etlUtils';
import { useHierarchyMutations } from './hooks/useHierarchyMutations';
import type {
  PdfItem,
  GlobalStats,
  HierarchicalEtlResult,
  ChildChunk,
  ParentChunk,
  JobStatusResponse,
  ParseRequestParams,
} from './types';

export function App() {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [pdfList, setPdfList] = useState<PdfItem[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats | undefined>(undefined);
  const [selectedPdf, setSelectedPdf] = useState<string>('');
  const selectedPdfRef = useRef(selectedPdf);
  selectedPdfRef.current = selectedPdf;
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

  // 1. Initial Data Fetching
  const fetchPdfs = useCallback(async () => {
    try {
      const data = await getPdfList();
      setPdfList(data.pdfs || []);
      if (data.global_stats) {
        setGlobalStats(data.global_stats);
      }
      setSelectedPdf((prev) => {
        if (prev && (data.pdfs || []).some((p) => p.filename === prev)) {
          return prev;
        }
        const next = data.current || (data.pdfs && data.pdfs.length > 0 ? data.pdfs[0].filename : '');
        if (next) {
          if (isLegalDoc(next)) {
            setStrategy('legal');
          }
          const currentItem = (data.pdfs || []).find((p) => p.filename === next);
          if (currentItem) {
            setEndPage(Math.max(0, currentItem.total_pages - 1));
          }
        }
        return next;
      });
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
          const isViewingCompletedDoc = !selectedPdfRef.current || selectedPdfRef.current === job.filename;

          if (job.result) {
            if (isViewingCompletedDoc) {
              const normalized = normalizeEtlData(job.result);
              setEtlData(normalized);
              const firstSec = normalized.sections?.find((s) => (s.child_chunk_ids?.length || 0) > 0) || normalized.sections?.[0];
              setSelectedSectionId(firstSec?.id || null);
              showToast(
                `🎉 [${job.filename || '문서'}] 백그라운드 ETL 완료! (소요: ${job.elapsed_time || 0}초, 청크: ${job.result.stats.total_child_chunks}개)`
              );
            } else {
              // 사용자가 다른 문서를 열어 편집 중인 경우: 화면을 덮어쓰지 않고 안내 알림만 표시
              showToast(
                `🎉 [${job.filename || '문서'}] 백그라운드 ETL 완료! 대시보드에서 확인하실 수 있습니다.`
              );
            }
          }
          await fetchPdfs();
          clearInterval(intervalId);
        } else if (job.status === 'failed') {
          setIsParsing(false);
          showToast(`❌ 태스크 실패 [${job.filename || ''}]: ${job.error || '파싱 중 오류 발생'}`, true);
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

  // 5. Hierarchy Mutations (Extracted to custom hook)
  const {
    handleUpdateChunk,
    handleUpdateSectionTitle,
    handleDeleteSection,
    handleAddSection,
    handleMoveSection,
    handleReparentSection,
    handleIndentSection,
    handleOutdentSection,
    handleAddParent,
    handleAddChild,
    handleUpdateParent,
    handleDeleteParent,
    handleMoveParent,
    handleBatchCleanEmptySections,
    handleToggleIgnoreChunk,
    handleSplitChunk,
    handleMergeChunks,
    handleDeleteChunks,
    handleReassignParentSection,
    handleReparentChildChunk,
    handleBatchCleanEmptyChunks,
    handleBulkUpdateMetadata,
    handleReorderSections,
    handleReorderParents,
    handleMoveParentToSection,
    handleReorderChildren,
    handleMoveChildToParent,
  } = useHierarchyMutations({
    etlData,
    setEtlData,
    setIsDirty,
    selectedPdf,
    selectedSectionId,
    setSelectedSectionId,
    setSelectedParentChunkId,
    showToast,
  });

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
      const dataToSave = {
        ...etlData,
        active_pdf: etlData.active_pdf || selectedPdf,
      };
      const res = await saveEtlResult(dataToSave);
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
      const original = await resetEtlResult(strategy, selectedPdf);
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
                docTitle={etlData?.doc_title || selectedPdf}
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
                onReorderSections={handleReorderSections}
                onReparentSectionTo={handleReparentSection}
                onReorderParents={handleReorderParents}
                onMoveParentToSection={handleMoveParentToSection}
                onReorderChildren={handleReorderChildren}
                onMoveChildToParent={handleMoveChildToParent}
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

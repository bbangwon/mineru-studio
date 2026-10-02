import React, { useState, useEffect, useRef } from 'react';
import type { SearchResultItem, SearchTestResponse, RAGStreamState } from '../types';
import { searchTest, getQdrantCollections, getDefaultRAGPrompt, streamRAGQuery } from '../api/client';
import { CopyableBadge } from './CopyableBadge';
import { getChunkKind, getChunkKindLabel, getChunkKindBadgeClass } from '../utils/chunkKindUtils';
import { MarkdownRenderer } from './MarkdownRenderer';

interface RetrievalPlaygroundProps {
  collectionName?: string;
  onOpenConfig?: () => void;
  onOpenLLMConfig?: () => void;
  onSelectChunk?: (chunkId: string) => void;
}

export const RetrievalPlayground: React.FC<RetrievalPlaygroundProps> = ({
  collectionName,
  onOpenConfig,
  onOpenLLMConfig,
  onSelectChunk,
}) => {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(10);
  const [selectedCol, setSelectedCol] = useState<string>(collectionName || '');
  const [availableCollections, setAvailableCollections] = useState<string[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchResponse, setSearchResponse] = useState<SearchTestResponse | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResultItem | null>(null);

  // RAG 질의응답 및 스트리밍 상태
  const [ragState, setRagState] = useState<RAGStreamState>({
    status: 'idle',
    query: '',
    answer: '',
    retrieved_chunks: [],
    used_context: '',
    model_name: '',
    collection_name: '',
  });

  // 프롬프트 및 RAG 설정 상태
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [useParentContext, setUseParentContext] = useState(true);
  const [ragLimit, setRagLimit] = useState(5);
  const [isContextInspectorOpen, setIsContextInspectorOpen] = useState(false);
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  const [highlightedRank, setHighlightedRank] = useState<number | null>(null);
  const [answerViewMode, setAnswerViewMode] = useState<'rendered' | 'raw'>('rendered');
  const [isCopied, setIsCopied] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCopyAnswer = async () => {
    if (!ragState.answer) return;
    try {
      await navigator.clipboard.writeText(ragState.answer);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (e) {
      console.warn('클립보드 복사 실패:', e);
    }
  };

  useEffect(() => {
    loadCollections();
    loadDefaultPrompt();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (collectionName) {
      setSelectedCol(collectionName);
    }
  }, [collectionName]);

  const loadCollections = async () => {
    try {
      const res = await getQdrantCollections();
      if (res.collections && res.collections.length > 0) {
        setAvailableCollections(res.collections);
        setSelectedCol((prev) => prev || res.current_collection || res.collections[0]);
      }
    } catch (e) {
      console.warn('컬렉션 목록 조회 실패:', e);
    }
  };

  const loadDefaultPrompt = async () => {
    try {
      const res = await getDefaultRAGPrompt();
      if (res.default_prompt) {
        setDefaultPrompt(res.default_prompt);
        setSystemPrompt(res.default_prompt);
      }
    } catch (e) {
      console.warn('RAG 기본 프롬프트 조회 실패:', e);
    }
  };

  const sampleQueries = [
    '제27조 자격 요건 및 자문의사 위촉 기준',
    '제7조 최초 요양급여 신청방법 및 제출서류',
    '석면 해체 제거 작업 시 안전 보호구 착용 기준',
    '산재보험 질병별 자료수집 목록',
  ];

  // 1. 단순 하이브리드 검색만 수행
  const handleSearch = async (targetQuery?: string) => {
    const q = (targetQuery !== undefined ? targetQuery : query).trim();
    if (!q) {
      setErrorMsg('검색 질의어를 입력해주세요.');
      return;
    }

    if (targetQuery !== undefined) {
      setQuery(targetQuery);
    }

    setIsLoadingSearch(true);
    setErrorMsg(null);
    setSelectedResult(null);

    const targetCollection = selectedCol || collectionName || undefined;

    try {
      const res = await searchTest(q, limit, targetCollection);
      setSearchResponse(res);
      if (res.results.length === 0) {
        setErrorMsg(
          `컬렉션 '${res.collection_name}'에서 검색된 청크가 없습니다. 질의어를 변경하거나 상단 툴바의 [⚡ Qdrant 색인] 여부를 확인해주세요.`
        );
      }
    } catch (err: any) {
      setErrorMsg(err.message || '하이브리드 검색 중 오류가 발생했습니다.');
      setSearchResponse(null);
    } finally {
      setIsLoadingSearch(false);
    }
  };

  // 2. RAG 실시간 스트리밍 답변 생성
  const handleRAGGenerate = async (targetQuery?: string) => {
    const q = (targetQuery !== undefined ? targetQuery : query).trim();
    if (!q) {
      setErrorMsg('질문 질의어를 입력해주세요.');
      return;
    }

    if (targetQuery !== undefined) {
      setQuery(targetQuery);
    }

    // 기존 스트리밍 진행 중이면 중단
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    setErrorMsg(null);
    setSelectedResult(null);
    setHighlightedRank(null);

    const targetCollection = selectedCol || collectionName || undefined;

    setRagState({
      status: 'searching',
      query: q,
      answer: '',
      retrieved_chunks: [],
      used_context: '',
      model_name: '',
      collection_name: targetCollection || '',
    });

    try {
      await streamRAGQuery(
        {
          query: q,
          collection_name: targetCollection,
          limit: ragLimit,
          use_parent_context: useParentContext,
          system_prompt: systemPrompt || undefined,
        },
        {
          onStart: (startData) => {
            setRagState((prev) => ({
              ...prev,
              status: 'generating',
              collection_name: startData.collection_name,
              search_elapsed_seconds: startData.search_elapsed_seconds,
              retrieved_chunks: startData.retrieved_chunks,
              used_context: startData.used_context,
              model_name: startData.model_name,
            }));

            // 하단 검색 결과 리스트도 동시에 실시간 동기화
            setSearchResponse({
              success: true,
              query: q,
              collection_name: startData.collection_name,
              total_matches: startData.retrieved_chunks.length,
              results: startData.retrieved_chunks,
            });
          },
          onToken: (token) => {
            setRagState((prev) => ({
              ...prev,
              answer: prev.answer + token,
            }));
          },
          onDone: (doneData) => {
            setRagState((prev) => ({
              ...prev,
              status: 'completed',
              llm_elapsed_seconds: doneData.llm_elapsed_seconds,
              total_elapsed_seconds: doneData.total_elapsed_seconds,
            }));
            abortControllerRef.current = null;
          },
          onError: (err) => {
            setRagState((prev) => ({
              ...prev,
              status: 'error',
              error: err.message,
            }));
            setErrorMsg(`RAG 스트리밍 오류: ${err.message}`);
            abortControllerRef.current = null;
          },
        },
        abortCtrl.signal
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setRagState((prev) => ({
          ...prev,
          status: 'error',
          error: err.message,
        }));
        setErrorMsg(err.message || 'RAG 답변 생성 중 오류가 발생했습니다.');
      }
      abortControllerRef.current = null;
    }
  };

  const handleAbortRAG = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setRagState((prev) => ({
        ...prev,
        status: 'completed',
      }));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleRAGGenerate();
    }
  };

  const toggleParentText = (chunkId: string) => {
    setExpandedParents((prev) => ({
      ...prev,
      [chunkId]: !prev[chunkId],
    }));
  };

  const scrollToChunkCard = (rank: number) => {
    setHighlightedRank(rank);
    const element = document.getElementById(`search-chunk-${rank}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const isRagActive = ragState.status === 'searching' || ragState.status === 'generating';

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 transition-colors">
      {/* 헤더 및 검색 바 영역 */}
      <div className="p-5 sm:p-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 backdrop-blur-md shadow-2xs transition-colors shrink-0">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-base sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                <span>🔍 하이브리드 검색 & RAG 플레이그라운드</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 font-semibold">
                  Dense + Kiwi Sparse RRF
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold">
                  ⚡ 실시간 스트리밍 RAG
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                인덱싱된 Qdrant 컬렉션에서 참조 문서를 검색하고, 부모-자식 계층 문맥을 활용하여 LLM 답변을 실시간 생성합니다.
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => setIsPromptOpen(!isPromptOpen)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                  isPromptOpen
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
                title="RAG 시스템 프롬프트 및 참조 문맥 설정"
              >
                <span>📝 프롬프트 설정</span>
                <span className="text-[10px] opacity-70">{isPromptOpen ? '▲' : '▼'}</span>
              </button>
              {onOpenLLMConfig && (
                <button
                  type="button"
                  onClick={onOpenLLMConfig}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="LLM 모델 엔드포인트 및 API Key 설정"
                >
                  <span>🤖 LLM 설정</span>
                </button>
              )}
              {onOpenConfig && (
                <button
                  type="button"
                  onClick={onOpenConfig}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="Qdrant 연결 및 컬렉션 설정"
                >
                  <span>⚙️ Qdrant 설정</span>
                </button>
              )}
            </div>
          </div>

          {/* RAG 프롬프트 및 부모 문맥 설정 패널 (접이식) */}
          {isPromptOpen && (
            <div className="p-4 bg-slate-50 dark:bg-slate-950/70 border border-indigo-200 dark:border-indigo-900/50 rounded-2xl space-y-3 animate-in fade-in duration-200 shadow-inner">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <span className="text-indigo-600 dark:text-indigo-400">📝</span> RAG 시스템 프롬프트 (System Prompt)
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSystemPrompt(defaultPrompt)}
                    className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                    title="기본 프롬프트로 복원"
                  >
                    ↺ 기본값 복원
                  </button>
                </div>
              </div>

              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                placeholder="RAG 답변 생성을 위한 시스템 프롬프트를 입력하세요..."
                className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-hidden focus:border-indigo-500 transition shadow-inner"
              />

              {/* RAG 세부 파라미터 조절 */}
              <div className="flex items-center justify-between flex-wrap gap-4 pt-1 text-xs">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={useParentContext}
                    onChange={(e) => setUseParentContext(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded-sm border-slate-300 dark:border-slate-700 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    ◈ 부모 청크 문맥(Parent Context) 함께 주입
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    (상위 섹션의 전체 맥락을 함께 전달하여 품질 향상)
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">RAG 참조 청크 수:</span>
                  <select
                    value={ragLimit}
                    onChange={(e) => setRagLimit(Number(e.target.value))}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer shadow-2xs"
                  >
                    <option value={3}>Top 3</option>
                    <option value={5}>Top 5 (권장)</option>
                    <option value={10}>Top 10</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* 검색 및 RAG 인풋 그룹 */}
          <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
            {/* 컬렉션 선택 드롭다운 */}
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 shrink-0 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">컬렉션:</span>
              <select
                value={selectedCol}
                onChange={(e) => setSelectedCol(e.target.value)}
                className="bg-transparent text-xs text-indigo-600 dark:text-indigo-400 font-mono font-bold focus:outline-hidden cursor-pointer max-w-[120px] sm:max-w-[140px] truncate"
                title="검색 대상 Qdrant 컬렉션"
              >
                {availableCollections.map((col) => (
                  <option key={col} value={col} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono">
                    {col}
                  </option>
                ))}
                {!availableCollections.includes(selectedCol) && selectedCol && (
                  <option value={selectedCol} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono">
                    {selectedCol} (지정됨)
                  </option>
                )}
              </select>
            </div>

            {/* 자연어 질의 입력창 */}
            <div className="relative flex-1 min-w-[200px]">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="한국어 질문을 입력하세요... (예: 자문의사의 자격 요건은 무엇인가요?)"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition shadow-2xs font-medium"
              />
            </div>

            {/* 검색 Top-K 선택 */}
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-hidden focus:border-indigo-500 cursor-pointer shrink-0 shadow-2xs"
              title="검색 결과 표시 개수"
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
            </select>

            {/* 검색만 실행 버튼 */}
            <button
              type="button"
              onClick={() => handleSearch()}
              disabled={isLoadingSearch || isRagActive}
              className="px-3.5 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 transition disabled:opacity-50 flex items-center gap-1.5 shrink-0 cursor-pointer shadow-2xs"
              title="검색 결과만 빠르게 확인"
            >
              {isLoadingSearch ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>검색 중...</span>
                </>
              ) : (
                <span>검색만 실행</span>
              )}
            </button>

            {/* RAG 스트리밍 답변 생성 메인 버튼 */}
            {isRagActive ? (
              <button
                type="button"
                onClick={handleAbortRAG}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs sm:text-sm font-bold text-white shadow-md shadow-rose-600/20 transition flex items-center gap-2 shrink-0 cursor-pointer animate-pulse"
                title="스트리밍 생성 즉시 중단"
              >
                <span>⏹ 생성 중단</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleRAGGenerate()}
                disabled={isLoadingSearch}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-xs sm:text-sm font-bold text-white shadow-md shadow-indigo-600/25 transition disabled:opacity-50 flex items-center gap-2 shrink-0 cursor-pointer"
                title="참조 청크 검색 후 LLM 스트리밍 답변 생성"
              >
                <span>🤖 RAG 답변 생성</span>
              </button>
            )}
          </div>

          {/* 추천 샘플 질의 */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">추천 질의:</span>
            {sampleQueries.map((sq, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setQuery(sq);
                  handleRAGGenerate(sq);
                }}
                disabled={isRagActive}
                className="text-[11px] px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition cursor-pointer shadow-2xs font-medium disabled:opacity-50"
              >
                {sq}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 메인 스크롤 콘텐츠 영역 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        <div className="max-w-4xl mx-auto space-y-5">
          {errorMsg && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between shadow-2xs">
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 1. 실시간 스트리밍 RAG 답변 패널 */}
          {ragState.status !== 'idle' && (
            <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-white to-indigo-50/30 dark:from-slate-900 dark:to-indigo-950/20 border-2 border-indigo-400/80 dark:border-indigo-500/70 shadow-lg space-y-4 transition-all">
              {/* 답변 헤더 바 */}
              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-indigo-100 dark:border-indigo-900/50 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-sm shadow-md shadow-indigo-600/30">
                    🤖
                  </span>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>RAG 생성 답변</span>
                      {ragState.status === 'searching' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-semibold animate-pulse">
                          참조 문서 검색 중...
                        </span>
                      )}
                      {ragState.status === 'generating' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 font-semibold animate-pulse">
                          답변 스트리밍 생성 중...
                        </span>
                      )}
                      {ragState.status === 'completed' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold">
                          생성 완료
                        </span>
                      )}
                    </h2>
                  </div>
                </div>

                {/* 메타데이터 지연시간 배지 */}
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  {ragState.model_name && (
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 font-mono text-[11px] border border-slate-200 dark:border-slate-700">
                      모델: <strong className="text-indigo-600 dark:text-indigo-400">{ragState.model_name}</strong>
                    </span>
                  )}
                  {ragState.search_elapsed_seconds !== undefined && (
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 text-[11px] border border-slate-200 dark:border-slate-700">
                      검색: <span className="font-mono">{ragState.search_elapsed_seconds}s</span>
                    </span>
                  )}
                  {ragState.llm_elapsed_seconds !== undefined && (
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 text-[11px] border border-slate-200 dark:border-slate-700">
                      LLM: <span className="font-mono">{ragState.llm_elapsed_seconds}s</span>
                    </span>
                  )}
                  {ragState.total_elapsed_seconds !== undefined && (
                    <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg text-indigo-700 dark:text-indigo-300 font-semibold text-[11px] border border-indigo-200 dark:border-indigo-800">
                      총: <span className="font-mono">{ragState.total_elapsed_seconds}s</span>
                    </span>
                  )}
                </div>

                {/* 뷰 모드 토글 및 복사 툴바 */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setAnswerViewMode('rendered')}
                      className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                        answerViewMode === 'rendered'
                          ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-2xs font-bold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                      title="실시간 서식 적용 마크다운 뷰"
                    >
                      서식 뷰
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnswerViewMode('raw')}
                      className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                        answerViewMode === 'raw'
                          ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-2xs font-bold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                      title="원문 마크다운 텍스트 뷰"
                    >
                      원문 (Raw)
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyAnswer}
                    disabled={!ragState.answer}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition flex items-center gap-1 cursor-pointer disabled:opacity-40 shadow-2xs"
                    title="마크다운 답변 클립보드 복사"
                  >
                    {isCopied ? (
                      <>
                        <span className="text-emerald-500 font-bold">✓</span>
                        <span className="text-emerald-600 dark:text-emerald-400">복사됨</span>
                      </>
                    ) : (
                      <>
                        <span>📋</span>
                        <span>복사</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 검색된 참조 청크 빠른 바로가기 배지 */}
              {ragState.retrieved_chunks.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap text-xs bg-slate-50/80 dark:bg-slate-950/50 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800/80">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                    인용된 참조 문서:
                  </span>
                  {ragState.retrieved_chunks.map((c) => (
                    <button
                      key={c.id || c.chunk_id}
                      type="button"
                      onClick={() => scrollToChunkCard(c.rank)}
                      className="text-[11px] px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold transition cursor-pointer flex items-center gap-1"
                      title="클릭 시 해당 검색 청크 카드로 스크롤 이동"
                    >
                      <span>[참조 #{c.rank}]</span>
                      <span className="max-w-[120px] truncate font-normal opacity-80">
                        {c.title || c.breadcrumbs?.[0] || c.chunk_id}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* 답변 본문 렌더링 (실시간 스트리밍 마크다운) */}
              <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs sm:text-sm text-slate-800 dark:text-slate-100 min-h-[90px] shadow-inner selection:bg-indigo-500 selection:text-white">
                {ragState.answer ? (
                  answerViewMode === 'rendered' ? (
                    <MarkdownRenderer
                      content={ragState.answer}
                      isStreaming={ragState.status === 'generating'}
                      onSelectCitation={scrollToChunkCard}
                    />
                  ) : (
                    <div className="font-mono text-xs whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-200 overflow-x-auto">
                      {ragState.answer}
                      {ragState.status === 'generating' && (
                        <span className="inline-block w-2 h-4 ml-1 bg-indigo-600 dark:bg-indigo-400 animate-pulse align-middle" />
                      )}
                    </div>
                  )
                ) : ragState.status === 'searching' ? (
                  <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 py-4">
                    <svg className="animate-spin w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>관련된 Qdrant 청크 문맥을 검색하고 있습니다...</span>
                  </div>
                ) : ragState.status === 'generating' ? (
                  <div className="flex items-center gap-2 text-indigo-500 py-4">
                    <span className="inline-block w-2 h-4 bg-indigo-600 dark:bg-indigo-400 animate-pulse" />
                    <span>LLM 모델이 첫 번째 토큰을 생성하고 있습니다...</span>
                  </div>
                ) : (
                  <span className="text-slate-400">생성된 답변이 없습니다.</span>
                )}
              </div>

              {/* 주입된 전체 프롬프트 및 부모 청크 인스펙터 (디버깅 뷰) */}
              {ragState.used_context && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setIsContextInspectorOpen(!isContextInspectorOpen)}
                    className="text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <span>◈ 주입된 전체 프롬프트 및 부모 청크 문맥 확인 ({ragState.retrieved_chunks.length}개 청크)</span>
                    <span className="text-[10px]">{isContextInspectorOpen ? '▲ 접기' : '▼ 펼치기'}</span>
                  </button>

                  {isContextInspectorOpen && (
                    <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 text-xs animate-in fade-in duration-150">
                      <div>
                        <span className="text-slate-700 dark:text-slate-300 font-bold block mb-1">
                          [실제 적용된 System Prompt]
                        </span>
                        <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 font-mono text-[11px] whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                          {systemPrompt || defaultPrompt}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-slate-700 dark:text-slate-300 font-bold">
                            [조립되어 주입된 [참고 문서] 컨텍스트 (Parent-Child)]
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold">
                            {useParentContext ? '✓ 부모 청크 문맥 결합됨' : '자식 청크만 주입됨'}
                          </span>
                        </div>
                        <div className="p-3.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 font-mono text-[11px] whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto text-slate-700 dark:text-slate-300">
                          {ragState.used_context}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 2. 하이브리드 검색 결과 목록 바 */}
          {searchResponse && (
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1 pt-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <span>📚 검색된 참조 청크 목록</span>
                <span className="text-slate-400 font-normal">
                  (컬렉션: <strong className="font-mono text-slate-700 dark:text-slate-200">{searchResponse.collection_name}</strong> / 총{' '}
                  <strong className="text-indigo-600 dark:text-indigo-400 font-bold">{searchResponse.total_matches}개</strong>)
                </span>
              </span>
            </div>
          )}

          {/* 검색 결과 청크 카드 리스트 */}
          {searchResponse?.results.map((item) => {
            const isHighlighted = highlightedRank === item.rank;
            const isParentExpanded = !!expandedParents[item.chunk_id];

            return (
              <div
                key={item.id || item.chunk_id}
                id={`search-chunk-${item.rank}`}
                onClick={() => setSelectedResult(item)}
                className={`p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all shadow-2xs hover:shadow-xs cursor-pointer group space-y-3 ${
                  isHighlighted
                    ? 'border-indigo-500 ring-2 ring-indigo-500/30 bg-indigo-50/10 dark:bg-indigo-950/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/50'
                }`}
              >
                {/* 상단 메타데이터 바 */}
                <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-bold flex items-center justify-center text-xs border border-indigo-500/30">
                      {item.rank}
                    </span>
                    <CopyableBadge
                      id={item.chunk_id}
                      type="chunk"
                      titlePrefix="전체 청크 ID"
                      className="font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700"
                    />
                    {(() => {
                      const kind = getChunkKind(item as any);
                      return (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${getChunkKindBadgeClass(kind)}`}>
                          {getChunkKindLabel(kind)}
                        </span>
                      );
                    })()}
                    <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                      {item.page_number
                        ? item.page_end && item.page_end > item.page_number
                          ? `p.${item.page_number}~${item.page_end}`
                          : `p.${item.page_number}`
                        : `p.${item.page_idx + 1}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700">
                      <span className="text-slate-500 dark:text-slate-400 text-[10px]">RRF Score:</span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-mono font-bold text-xs">{item.score.toFixed(4)}</span>
                    </div>
                    {onSelectChunk && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectChunk(item.chunk_id);
                        }}
                        className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                      >
                        에디터에서 보기 →
                      </button>
                    )}
                  </div>
                </div>

                {/* 브레드크럼 */}
                {(item.breadcrumbs || item.heading_hierarchy) && (item.breadcrumbs || item.heading_hierarchy)!.length > 0 && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
                    <span className="text-slate-400">📁</span>
                    {(item.breadcrumbs || item.heading_hierarchy)!.map((h, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span className="text-slate-300 dark:text-slate-600">/</span>}
                        <span className="text-slate-700 dark:text-slate-300 font-medium">{h}</span>
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {/* 메타데이터 태그 미리보기 */}
                {item.metadata && Object.keys(item.metadata).length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {Object.entries(item.metadata).slice(0, 4).map(([k, v]) => (
                      <span
                        key={k}
                        className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono font-medium"
                      >
                        {k}: <span className="text-indigo-600 dark:text-indigo-400">{String(v)}</span>
                      </span>
                    ))}
                    {Object.keys(item.metadata).length > 4 && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">+{Object.keys(item.metadata).length - 4}개</span>
                    )}
                  </div>
                )}

                {/* 검색된 자식 청크 본문 */}
                <div className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed bg-slate-50 dark:bg-slate-950/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800/80 font-sans whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {item.text}
                </div>

                {/* 인라인 부모 청크 문맥 확인 버튼 및 확장 뷰 */}
                {item.parent_text && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleParentText(item.chunk_id);
                      }}
                      className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>◈ 부모 청크 문맥(Parent Context) {isParentExpanded ? '접기' : '펼쳐보기'}</span>
                      <span className="text-[10px]">{isParentExpanded ? '▲' : '▼'}</span>
                    </button>

                    {isParentExpanded && (
                      <div className="mt-2 p-3 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 text-[11px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto animate-in fade-in duration-150">
                        <div className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 mb-1 flex items-center gap-1">
                          <span>[연계된 부모 청크 ID: {item.parent_chunk_id || '없음'}]</span>
                        </div>
                        {item.parent_text}
                      </div>
                    )}
                  </div>
                )}

                {/* 표 이미지 미리보기 */}
                {item.image_url && (
                  <div className="mt-2 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 max-w-sm">
                    <img src={item.image_url} alt="Chunk Media" className="w-full object-cover" />
                  </div>
                )}
              </div>
            );
          })}

          {/* 초기 안내 상태 */}
          {!searchResponse && ragState.status === 'idle' && !isLoadingSearch && (
            <div className="text-center py-20 text-slate-400 dark:text-slate-500 space-y-3">
              <div className="text-4xl">📚</div>
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                자연어 질문을 입력하고 [🤖 RAG 답변 생성]을 실행해보세요.
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-600 max-w-md mx-auto leading-relaxed">
                Qdrant 하이브리드 RRF로 매칭된 상위 문서 청크들과 부모 문맥을 결합하여, LLM이 실시간 스트리밍으로 정확한 답변을 생성합니다.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 청크 상세 모달 */}
      {selectedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] transition-colors">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">청크 상세 정보</span>
                <CopyableBadge
                  id={selectedResult.chunk_id}
                  type="chunk"
                  prefix="("
                  suffix=")"
                  titlePrefix="전체 청크 ID"
                  className="text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-200/60 dark:border-indigo-800/60"
                />
              </div>
              <button
                type="button"
                onClick={() => setSelectedResult(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-xl">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">RRF Score:</span>
                  <span className="ml-2 font-mono font-bold text-indigo-600 dark:text-indigo-400">{selectedResult.score}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">페이지:</span>
                  <span className="ml-2 text-slate-800 dark:text-slate-200 font-medium">
                    {selectedResult.page_number
                      ? selectedResult.page_end && selectedResult.page_end > selectedResult.page_number
                        ? `p.${selectedResult.page_number}~${selectedResult.page_end}`
                        : `p.${selectedResult.page_number}`
                      : `p.${selectedResult.page_idx + 1}`}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">타입:</span>
                  <span className="ml-2 text-slate-800 dark:text-slate-200 font-medium">
                    {getChunkKindLabel(getChunkKind(selectedResult as any))}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">추정 토큰 수:</span>
                  <span className="ml-2 text-slate-800 dark:text-slate-200 font-medium">{selectedResult.token_count || selectedResult.token_estimate || 0}</span>
                </div>
                {selectedResult.parent_chunk_id && (
                  <div className="col-span-2">
                    <span className="text-slate-500 dark:text-slate-400 font-semibold">부모 청크 ID:</span>
                    <span className="ml-2 font-mono text-indigo-600 dark:text-indigo-400">{selectedResult.parent_chunk_id}</span>
                  </div>
                )}
              </div>

              {/* 메타데이터 상세 */}
              {selectedResult.metadata && Object.keys(selectedResult.metadata).length > 0 && (
                <div>
                  <span className="block text-slate-700 dark:text-slate-300 font-semibold mb-1.5">메타데이터:</span>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap gap-2">
                    {Object.entries(selectedResult.metadata).map(([k, v]) => (
                      <span
                        key={k}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono font-medium shadow-2xs"
                      >
                        <span className="text-slate-500 dark:text-slate-400">{k}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 검색 자식 본문 텍스트 */}
              <div>
                <span className="block text-slate-700 dark:text-slate-300 font-semibold mb-1.5">자식 청크 본문 (검색 대상):</span>
                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto">
                  {selectedResult.text}
                </div>
              </div>

              {/* 부모 청크 컨텍스트 */}
              {selectedResult.parent_text && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-slate-700 dark:text-slate-300 font-semibold flex items-center gap-1.5">
                      <span className="text-indigo-600 dark:text-indigo-400">◈</span> 부모 청크 문맥 (LLM 주입용 Parent Context):
                    </span>
                  </div>
                  <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-xl border border-indigo-200 dark:border-indigo-900/40 text-slate-800 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto text-xs">
                    {selectedResult.parent_text}
                  </div>
                </div>
              )}

              {selectedResult.image_url && (
                <div>
                  <span className="block text-slate-700 dark:text-slate-300 font-semibold mb-1.5">표/이미지:</span>
                  <img src={selectedResult.image_url} alt="Media" className="rounded-xl border border-slate-200 dark:border-slate-800 max-h-60" />
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedResult(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

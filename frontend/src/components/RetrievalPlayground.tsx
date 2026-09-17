import React, { useState, useEffect } from 'react';
import type { SearchResultItem, SearchTestResponse } from '../types';
import { searchTest, getQdrantCollections } from '../api/client';
import { CopyableBadge } from './CopyableBadge';
import { getChunkKind, getChunkKindLabel, getChunkKindBadgeClass } from '../utils/chunkKindUtils';

interface RetrievalPlaygroundProps {
  collectionName?: string;
  onOpenConfig?: () => void;
  onSelectChunk?: (chunkId: string) => void;
}

export const RetrievalPlayground: React.FC<RetrievalPlaygroundProps> = ({
  collectionName,
  onOpenConfig,
  onSelectChunk,
}) => {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(10);
  const [selectedCol, setSelectedCol] = useState<string>(collectionName || '');
  const [availableCollections, setAvailableCollections] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchResponse, setSearchResponse] = useState<SearchTestResponse | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResultItem | null>(null);

  useEffect(() => {
    loadCollections();
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

  const sampleQueries = [
    '제27조 자격 요건 및 자문의사 위촉 기준',
    '제7조 최초 요양급여 신청방법 및 제출서류',
    '석면 해체 제거 작업 시 안전 보호구 착용 기준',
    '산재보험 질병별 자료수집 목록',
  ];

  const handleSearch = async (targetQuery?: string) => {
    const q = (targetQuery !== undefined ? targetQuery : query).trim();
    if (!q) {
      setErrorMsg('검색 질의어를 입력해주세요.');
      return;
    }

    if (targetQuery !== undefined) {
      setQuery(targetQuery);
    }

    setIsLoading(true);
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
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 transition-colors">
      {/* 검색 바 영역 */}
      <div className="p-5 sm:p-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 backdrop-blur-md shadow-2xs transition-colors">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-base sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                <span>🔍 하이브리드 RRF 검색 플레이그라운드</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 font-semibold">
                  BGE-m3-ko + Kiwi Modifier.IDF
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                인덱싱된 Qdrant 컬렉션에서 Dense 의미론적 검색과 Kiwi 형태소 키워드 검색을 RRF로 최적 융합합니다.
              </p>
            </div>
            {onOpenConfig && (
              <button
                type="button"
                onClick={onOpenConfig}
                className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition flex items-center gap-1.5 cursor-pointer shadow-2xs shrink-0"
              >
                <span>⚙️ Qdrant 설정</span>
              </button>
            )}
          </div>

          {/* 검색 인풋 그룹 */}
          <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
            {/* 컬렉션 선택 드롭다운 */}
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 shrink-0 shadow-2xs">
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
                placeholder="한국어 자연어 질문 또는 핵심 키워드를 입력하세요... (예: 자문의사 자격 요건)"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition shadow-2xs font-medium"
              />
            </div>

            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-hidden focus:border-indigo-500 cursor-pointer shrink-0 shadow-2xs"
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
            </select>

            <button
              type="button"
              onClick={() => handleSearch()}
              disabled={isLoading}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs sm:text-sm font-bold text-white shadow-md shadow-indigo-600/20 transition disabled:opacity-50 flex items-center gap-2 shrink-0 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>검색 중...</span>
                </>
              ) : (
                <span>검색 실행</span>
              )}
            </button>
          </div>

          {/* 추천 샘플 질의 */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">추천 질의:</span>
            {sampleQueries.map((sq, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSearch(sq)}
                className="text-[11px] px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition cursor-pointer shadow-2xs font-medium"
              >
                {sq}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 검색 결과 영역 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {errorMsg && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between shadow-2xs">
              <span>{errorMsg}</span>
            </div>
          )}

          {searchResponse && (
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
              <span>
                컬렉션 <strong className="text-slate-800 dark:text-slate-200 font-mono">{searchResponse.collection_name}</strong> 에서 총{' '}
                <strong className="text-indigo-600 dark:text-indigo-400 font-bold">{searchResponse.total_matches}개</strong> 청크 검색됨
              </span>
            </div>
          )}

          {/* 검색 결과 리스트 */}
          {searchResponse?.results.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedResult(item)}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-all shadow-2xs hover:shadow-xs cursor-pointer group space-y-3"
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
                      ? (item.page_end && item.page_end > item.page_number
                          ? `p.${item.page_number}~${item.page_end}`
                          : `p.${item.page_number}`)
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

              {/* 텍스트 본문 */}
              <div className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed bg-slate-50 dark:bg-slate-950/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800/80 font-sans whitespace-pre-wrap max-h-36 overflow-y-auto">
                {item.text}
              </div>

              {/* 표 이미지 미리보기 */}
              {item.image_url && (
                <div className="mt-2 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 max-w-sm">
                  <img src={item.image_url} alt="Chunk Media" className="w-full object-cover" />
                </div>
              )}
            </div>
          ))}

          {!searchResponse && !isLoading && (
            <div className="text-center py-20 text-slate-400 dark:text-slate-500 space-y-3">
              <div className="text-4xl">📚</div>
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">검색어를 입력하고 하이브리드 RRF 검색 성능을 테스트해보세요.</p>
              <p className="text-xs text-slate-400 dark:text-slate-600">
                BGE-m3-ko 1024차원 벡터와 Kiwi 형태소 기반의 Qdrant Modifier.IDF가 실시간 결합됩니다.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 결과 상세 모달 */}
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
                      ? (selectedResult.page_end && selectedResult.page_end > selectedResult.page_number
                          ? `p.${selectedResult.page_number}~${selectedResult.page_end}`
                          : `p.${selectedResult.page_number}`)
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

              {/* 부모 청크 컨텍스트 (LLM 생성 주입용) */}
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

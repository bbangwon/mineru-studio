import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  AlertTriangle,
  EyeOff,
  Table2,
  AlignLeft,
  Scale,
  Check,
  FolderTree,
  BookOpen,
  ShieldCheck,
  Sparkles,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { ChildChunk, ParentSection, ParentChunk, LLMRefineResponse, ReparentChildChunkParams } from '../types';
import { syncChunkPageMetadata, formatChunkPageFull } from '../utils/pageUtils';
import { estimateKoreanTokens } from '../utils/idUtils';
import { refineChunkText } from '../api/client';
import { RefineDiffModal } from './RefineDiffModal';
import { CopyableBadge } from './CopyableBadge';
import { ReparentChildModal } from './ReparentChildModal';

interface ChunkEditModalProps {
  chunk: ChildChunk | null;
  parentSections: ParentSection[];
  parentChunks?: ParentChunk[];
  autoRefine?: boolean;
  onClose: () => void;
  onSave: (updatedChunk: ChildChunk) => void;
  onReassignParentSection?: (parentChunkId: string, newSectionId: string) => void;
  onReparentChildChunk?: (params: ReparentChildChunkParams) => void;
}

export const ChunkEditModal: React.FC<ChunkEditModalProps> = ({
  chunk,
  parentSections,
  parentChunks,
  autoRefine = false,
  onClose,
  onSave,
  onReassignParentSection,
  onReparentChildChunk,
}) => {
  const [text, setText] = useState(chunk?.text || '');
  const [sectionId, setSectionId] = useState(chunk?.section_id || chunk?.parent_id || '');
  const [pageNumber, setPageNumber] = useState<number>(chunk?.page_number || 1);
  const [pageEnd, setPageEnd] = useState<number | ''>(chunk?.page_end || '');
  const [isIgnored, setIsIgnored] = useState(Boolean(chunk?.is_ignored));
  const [activeTab, setActiveTab] = useState<'text' | 'raw_html' | 'preview'>('text');

  // Table specific state
  const isTable = chunk?.chunk_type === 'table' || Boolean(chunk?.is_atomic_table);
  const isArticle = chunk?.chunk_type === 'article' || chunk?.chunk_type === 'article_clause';
  const [rawHtml, setRawHtml] = useState(chunk?.raw_html || '');
  const [tableCaption, setTableCaption] = useState(chunk?.table_caption || '');
  const [tableFootnote, setTableFootnote] = useState(chunk?.table_footnote || '');

  // AI Refinement State
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<LLMRefineResponse | null>(null);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [isReparentModalOpen, setIsReparentModalOpen] = useState(false);

  const runRefineText = async (targetText: string) => {
    if (!targetText || !targetText.trim()) {
      setRefineError('교정할 본문 텍스트가 비어 있습니다.');
      return;
    }
    setIsRefining(true);
    setRefineError(null);
    try {
      const res = await refineChunkText(targetText);
      setDiffData(res);
      setIsDiffModalOpen(true);
    } catch (err: any) {
      setRefineError(err.message || 'AI 교정 중 오류가 발생했습니다.');
    } finally {
      setIsRefining(false);
    }
  };

  const handleRunAiRefine = () => {
    const textToRefine = activeTab === 'raw_html' ? rawHtml : text;
    runRefineText(textToRefine);
  };

  useEffect(() => {
    if (!chunk) return;
    setText(chunk.text || '');
    setSectionId(chunk.section_id || chunk.parent_id || '');
    setPageNumber(chunk.page_number || 1);
    setPageEnd(chunk.page_end || '');
    setIsIgnored(Boolean(chunk.is_ignored));
    setRawHtml(chunk.raw_html || '');
    setTableCaption(chunk.table_caption || '');
    setTableFootnote(chunk.table_footnote || '');
    setActiveTab('text');
    setRefineError(null);
    setDiffData(null);
    setIsDiffModalOpen(false);

    if (autoRefine && chunk.text && chunk.text.trim()) {
      runRefineText(chunk.text);
    }
  }, [chunk, autoRefine]);

  if (!chunk) return null;

  // Real-time word / token estimate
  const currentTextToCount = activeTab === 'text' ? text : rawHtml;
  const wordCount = estimateKoreanTokens(currentTextToCount);
  const charCount = currentTextToCount.length;

  const currentParent = (parentChunks || []).find(
    (p) => (p.parent_chunk_id || p.id) === (chunk.parent_chunk_id || chunk.parent_id)
  );

  const handleApply = () => {
    // Determine updated breadcrumbs if section changed
    const targetSection = parentSections.find((p) => p.id === sectionId);
    let updatedBreadcrumbs = chunk.breadcrumbs || [];
    if (targetSection) {
      if (isArticle && chunk.metadata?.article_no) {
        const artDisplay = chunk.metadata?.article_title
          ? `${chunk.metadata.article_no}(${chunk.metadata.article_title})`
          : chunk.metadata.article_no;
        updatedBreadcrumbs = [...targetSection.breadcrumbs, artDisplay];
      } else {
        updatedBreadcrumbs = [...targetSection.breadcrumbs];
      }
    }

    const startPage = Math.max(1, pageNumber);
    const endPageNum = typeof pageEnd === 'number' && pageEnd > startPage ? pageEnd : undefined;
    const pid = chunk.parent_chunk_id || chunk.parent_id || '';

    // If section changed and onReassignParentSection exists, reassign parent's section
    if (sectionId !== (chunk.section_id || chunk.parent_id) && onReassignParentSection && pid) {
      onReassignParentSection(pid, sectionId);
    }

    const updated: ChildChunk = {
      ...chunk,
      text: text,
      section_id: sectionId,
      parent_chunk_id: pid,
      parent_id: pid,
      page_number: startPage,
      page_end: endPageNum,
      breadcrumbs: updatedBreadcrumbs,
      is_ignored: isIgnored,
      is_edited: true,
      token_estimate: wordCount,
      metadata: syncChunkPageMetadata(chunk.metadata, startPage, endPageNum),
    };

    if (isTable) {
      updated.raw_html = rawHtml;
      updated.table_caption = tableCaption;
      updated.table_footnote = tableFootnote;
    }

    onSave(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              {isTable ? (
                <Table2 className="w-5 h-5" />
              ) : isArticle ? (
                <Scale className="w-5 h-5 text-purple-600" />
              ) : (
                <AlignLeft className="w-5 h-5 text-slate-600" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">청크 내용 & 메타데이터 편집</h3>
                <CopyableBadge
                  id={chunk.chunk_id}
                  type="chunk"
                  titlePrefix="전체 청크 ID"
                  className="text-xs px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-semibold border border-slate-300 shrink-0"
                />
                {chunk.is_edited && (
                  <span className="text-[11px] bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded border border-amber-200">
                    기존 수정됨
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatChunkPageFull(chunk)} · {isTable ? '원형 보존 표 청크 (Atomic Table)' : isArticle ? '조문 청크' : '일반 문단 청크'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Level 2 Parent Chunk Info & Context Banner */}
          <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-indigo-900 flex items-center gap-1">
                <FolderTree className="w-3.5 h-3.5 text-indigo-600" />
                <span>상위 Parent:</span>
              </span>
              <CopyableBadge
                id={chunk.parent_chunk_id || chunk.parent_id || 'p001'}
                type="parent"
                titlePrefix="전체 Parent ID"
                className="text-[11px] font-bold text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-200 shrink-0"
              />
              {currentParent?.title && (
                <span className="text-slate-700 font-medium truncate max-w-xs">
                  · {currentParent.title}
                </span>
              )}
              {onReparentChildChunk && (
                <button
                  type="button"
                  onClick={() => setIsReparentModalOpen(true)}
                  className="text-[11px] text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded border border-purple-200 font-semibold cursor-pointer ml-1 transition"
                  title="이 Child 청크의 상위 Parent 재할당"
                >
                  Parent 변경
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-600 font-mono">
              {currentParent && (
                <>
                  <span>
                    소속 자식 청크: <strong>{currentParent.child_chunk_ids?.length || 1}</strong>개
                  </span>
                  <span
                    className={
                      (currentParent.token_estimate || 0) > 2048
                        ? 'text-amber-700 font-bold'
                        : 'text-slate-600'
                    }
                  >
                    Parent 토큰: ~{currentParent.token_estimate || 0} tok
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Top Options Row: Section Reassign, Page Range & Embedding Exclude Toggle */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            {/* Section Reassign Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-indigo-600" />
                소속 섹션 (Section) 재지정
              </label>
              <select
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                className="w-full text-xs font-medium bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {parentSections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.title} (Level {sec.level})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                상위 섹션 및 하위 브레드크럼이 일괄 연쇄 동기화됩니다.
              </p>
            </div>

            {/* Page Number & Range Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                페이지 번호 (시작 ~ 끝)
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <input
                    type="number"
                    min="1"
                    value={pageNumber}
                    onChange={(e) => setPageNumber(parseInt(e.target.value, 10) || 1)}
                    className="w-full text-xs font-mono font-medium bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    placeholder="시작 페이지"
                  />
                </div>
                <span className="text-slate-400 text-xs font-bold">~</span>
                <div className="flex-1">
                  <input
                    type="number"
                    min={pageNumber}
                    value={pageEnd}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setPageEnd(val ? parseInt(val, 10) : '');
                    }}
                    className="w-full text-xs font-mono font-medium bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    placeholder="끝 (선택)"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                단일 페이지는 시작만, 병합 청크는 끝까지 지정
              </p>
            </div>

            {/* Embedding Ignore Option */}
            <div className="flex flex-col justify-between">
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5 text-rose-500" />
                임베딩 및 인덱싱 필터링
              </label>
              <label className="flex items-center gap-2.5 p-2 bg-white rounded-lg border border-slate-300 cursor-pointer hover:bg-slate-50 transition">
                <input
                  type="checkbox"
                  checked={isIgnored}
                  onChange={(e) => setIsIgnored(e.target.checked)}
                  className="w-4 h-4 text-rose-600 rounded border-slate-300 focus:ring-rose-500 cursor-pointer"
                />
                <div className="text-xs">
                  <span className={`font-semibold ${isIgnored ? 'text-rose-700' : 'text-slate-700'}`}>
                    RAG Vector DB 임베딩 대상에서 제외
                  </span>
                  <p className="text-[11px] text-slate-400">
                    목차, 면책조항 등 검색 노이즈 청크를 JSONL 적재 시 제외합니다.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Table Special Fields */}
          {isTable && (
            <div className="space-y-3 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
              <div className="flex items-center justify-between border-b border-indigo-200/60 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('text')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      activeTab === 'text'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    표 텍스트 (검색용 요약)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('raw_html')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      activeTab === 'raw_html'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    표 HTML 원형 (raw_html)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      activeTab === 'preview'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    HTML 미리보기
                  </button>
                </div>

                <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  표 원형 보존 상태 (Atomic Table)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">표 제목 (Caption)</label>
                  <input
                    type="text"
                    value={tableCaption}
                    onChange={(e) => setTableCaption(e.target.value)}
                    placeholder="예: [표 1] 검사항목별 세부기준"
                    className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">표 각주 (Footnote)</label>
                  <input
                    type="text"
                    value={tableFootnote}
                    onChange={(e) => setTableFootnote(e.target.value)}
                    placeholder="예: ※ 1일 기준 최대 허용치"
                    className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Main Text / HTML / Preview Editor Area */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs font-bold text-slate-700">
                  {isTable && activeTab === 'raw_html'
                    ? '표 원형 HTML 편집'
                    : isTable && activeTab === 'preview'
                    ? '표 HTML 렌더링 미리보기'
                    : '청크 본문 텍스트 (Text) 편집'}
                </label>

                {/* AI Refine Button */}
                {activeTab !== 'preview' && (
                  <button
                    type="button"
                    onClick={handleRunAiRefine}
                    disabled={isRefining}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
                    title="로컬 LLM을 사용하여 비정상적인 줄바꿈과 띄어쓰기를 자동으로 정제합니다"
                  >
                    {isRefining ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>AI 교정 중...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" />
                        <span>🪄 AI 텍스트 자동 교정</span>
                      </>
                    )}
                  </button>
                )}

                {diffData && (
                  <button
                    type="button"
                    onClick={() => setIsDiffModalOpen(true)}
                    className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1 cursor-pointer transition"
                    title="AI 교정 결과 Diff 비교 창 다시 열기"
                  >
                    <span>Diff 비교 보기</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                <span>글자 수: <strong className="text-slate-700">{charCount}</strong>자</span>
                <span>추정 토큰/단어: <strong className="text-indigo-600">~{wordCount}</strong> tokens</span>
                {isTable ? (
                  <span className="text-emerald-700 flex items-center gap-1 font-sans text-[11px] font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    표 원형 보존 (512 한도 예외)
                  </span>
                ) : wordCount > 512 ? (
                  <span className="text-amber-600 flex items-center gap-1 font-sans text-[11px] font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    512 토큰 초과 주의 (분할 권장)
                  </span>
                ) : (
                  <span className="text-emerald-700 flex items-center gap-1 font-sans text-[11px]">
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    임베딩 최적 길이
                  </span>
                )}
              </div>
            </div>

            {/* Error Message if AI Refine failed */}
            {refineError && (
              <div className="mb-2 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{refineError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRefineError(null)}
                  className="text-rose-400 hover:text-rose-600 p-0.5 rounded cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {isTable && activeTab === 'preview' ? (
              <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200 min-h-[240px] max-h-[380px] overflow-y-auto">
                <div
                  className="prose-custom text-xs"
                  dangerouslySetInnerHTML={{
                    __html: rawHtml || text || '<p>표 내용 없음</p>',
                  }}
                />
              </div>
            ) : isTable && activeTab === 'raw_html' ? (
              <textarea
                value={rawHtml}
                onChange={(e) => setRawHtml(e.target.value)}
                rows={12}
                className="w-full font-mono text-xs p-3.5 bg-slate-900 text-emerald-400 rounded-xl border border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed resize-y"
                placeholder="<table>...</table>"
              />
            ) : (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                className="w-full text-xs p-3.5 bg-white rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 leading-relaxed text-slate-800 resize-y"
                placeholder="청크 본문 내용을 입력하세요..."
              />
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {isIgnored ? (
              <span className="text-rose-600 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                이 청크는 RAG JSONL 다운로드 시 제외됩니다.
              </span>
            ) : (
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                정상 임베딩 대상 청크
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs flex items-center gap-1.5 transition"
            >
              <Save className="w-4 h-4" />
              <span>수정사항 적용</span>
            </button>
          </div>
        </div>
      </div>

      {/* Diff View Modal Overlay */}
      <RefineDiffModal
        isOpen={isDiffModalOpen}
        diffData={diffData}
        onClose={() => setIsDiffModalOpen(false)}
        onApply={(refined) => {
          if (activeTab === 'raw_html') {
            setRawHtml(refined);
          } else {
            setText(refined);
          }
        }}
      />

      {/* Reparent Child Modal Overlay */}
      {isReparentModalOpen && chunk && (
        <ReparentChildModal
          isOpen={isReparentModalOpen}
          onClose={() => setIsReparentModalOpen(false)}
          targetChunks={[chunk]}
          parentSections={parentSections}
          parentChunks={parentChunks || []}
          childChunks={[]}
          onReparent={(params) => {
            if (onReparentChildChunk) {
              onReparentChildChunk(params);
            }
            setIsReparentModalOpen(false);
            onClose();
          }}
        />
      )}
    </div>
  );
};


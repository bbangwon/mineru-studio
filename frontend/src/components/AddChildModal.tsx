import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  HelpCircle,
  FileText,
  BookOpen,
  AlertCircle,
  Table2,
  Layers,
  Scale,
  Eye,
  Edit3,
  ArrowDownToLine,
  Tag,
  Wand2,
  ClipboardPaste,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { ParentChunk, ChildChunk, AddChildData, EmbeddedTableItem } from '../types';
import { CopyableBadge } from './CopyableBadge';
import { TableEditorModal } from './TableEditorModal';
import { estimateKoreanTokens, repairSoftWraps, formatDisplayChunkId } from '../utils/idUtils';
import {
  parseTsvToGrid,
  gridToHtmlTable,
  gridToMarkdownTable,
  hasMarkdownTable,
} from '../utils/tableChunkUtils';
import {
  getChunkKind,
  getChunkKindLabel,
  getChunkKindBadgeClass,
} from '../utils/chunkKindUtils';

interface AddChildModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentChunk: ParentChunk | null;
  parentChildren?: ChildChunk[];
  initialInsertAfterChunkId?: string;
  sectionTitle?: string;
  onAddChild: (data: AddChildData) => void;
}

export const AddChildModal: React.FC<AddChildModalProps> = ({
  isOpen,
  onClose,
  parentChunk,
  parentChildren = [],
  initialInsertAfterChunkId,
  sectionTitle,
  onAddChild,
}) => {
  const [text, setText] = useState<string>('');
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageEnd, setPageEnd] = useState<string>('');
  const [rawHtml, setRawHtml] = useState<string>('');
  const [tableCaption, setTableCaption] = useState<string>('');
  const [tableFootnote, setTableFootnote] = useState<string>('');
  const [customTags, setCustomTags] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // 조문 메타데이터 전용 상태
  const [articleNo, setArticleNo] = useState<string>('');
  const [articleTitle, setArticleTitle] = useState<string>('');
  const [isArticleSectionOpen, setIsArticleSectionOpen] = useState<boolean>(false);

  // 순서/삽입 위치 상태
  const [insertPosition, setInsertPosition] = useState<'end' | 'start' | 'after'>('end');
  const [insertAfterChunkId, setInsertAfterChunkId] = useState<string>('');

  // 표 편집기 및 TSV 모달 상태
  const [isTableEditorOpen, setIsTableEditorOpen] = useState<boolean>(false);
  const [isTsvInputOpen, setIsTsvInputOpen] = useState<boolean>(false);
  const [tsvText, setTsvText] = useState<string>('');

  // 모달 오픈 시 초기화
  useEffect(() => {
    if (isOpen && parentChunk) {
      setText('');
      setRawHtml('');
      setTableCaption('');
      setTableFootnote('');
      setCustomTags('');
      setArticleNo('');
      setArticleTitle('');
      setIsArticleSectionOpen(false);
      setError('');
      setActiveTab('edit');
      setIsTableEditorOpen(false);
      setIsTsvInputOpen(false);
      setTsvText('');

      // 삽입 위치 및 페이지 번호 초기화
      if (initialInsertAfterChunkId) {
        setInsertPosition('after');
        setInsertAfterChunkId(initialInsertAfterChunkId);
        const targetChild = parentChildren.find((c) => c.chunk_id === initialInsertAfterChunkId);
        if (targetChild?.page_number) {
          setPageNumber(targetChild.page_number);
          setPageEnd(targetChild.page_end ? String(targetChild.page_end) : '');
        } else {
          const startP = parentChunk.page_range?.[0] || 1;
          const endP = parentChunk.page_range?.[1];
          setPageNumber(startP);
          setPageEnd(endP && endP > startP ? String(endP) : '');
        }
      } else {
        setInsertPosition('end');
        setInsertAfterChunkId(parentChildren.length > 0 ? parentChildren[parentChildren.length - 1].chunk_id : '');
        const startP = parentChunk.page_range?.[0] || 1;
        const endP = parentChunk.page_range?.[1];
        setPageNumber(startP);
        setPageEnd(endP && endP > startP ? String(endP) : '');
      }
    }
  }, [isOpen, parentChunk, initialInsertAfterChunkId, parentChildren]);

  // 실시간 예상 토큰 수 계산
  const tokenEstimate = useMemo(() => estimateKoreanTokens(text), [text]);

  // 실시간 청크 유형 동적 계산 (Unified Composite Model 기반)
  const computedKind = useMemo(() => {
    const virtualChunk: Partial<ChildChunk> = {
      text,
      raw_html: rawHtml,
      tables: rawHtml ? [{ table_index: 0, raw_html: rawHtml }] : [],
      metadata: {
        article_no: articleNo.trim() || undefined,
        article_title: articleTitle.trim() || undefined,
      },
    };
    return getChunkKind(virtualChunk);
  }, [text, rawHtml, articleNo, articleTitle]);

  if (!isOpen || !parentChunk) return null;

  // 본문 텍스트 변경 시 조문 패턴 자동 감지
  const handleTextChange = (val: string) => {
    setText(val);
    if (!articleNo) {
      // 본문 첫머리에서 제N조 또는 제N조(제목) 패턴 매칭
      const match = val.trim().match(/^(제\s*\d+(?:조의\d+)?)\s*(?:\(([^)]+)\))?/);
      if (match) {
        setArticleNo(match[1].replace(/\s+/g, ''));
        if (match[2]) {
          setArticleTitle(match[2].trim());
        }
        setIsArticleSectionOpen(true);
      }
    }
  };

  // 1. 줄바꿈 정돈 핸들러
  const handleRepairSoftWraps = () => {
    if (!text.trim()) return;
    const repaired = repairSoftWraps(text);
    handleTextChange(repaired);
    if (error) setError('');
  };

  // 2. 조문 템플릿 삽입
  const handleInsertArticleTemplate = () => {
    const template = '제1조(목적)\n① 이 규정은 업무 수행에 필요한 세부 사항을 규정함을 목적으로 한다.\n② 제1항에 따른 세부 지침은 관련 부서에서 별도로 정한다.';
    if (!text.trim()) {
      handleTextChange(template);
    } else {
      handleTextChange(`${text.trim()}\n\n${template}`);
    }
    setArticleNo('제1조');
    setArticleTitle('목적');
    setIsArticleSectionOpen(true);
    if (error) setError('');
  };

  // 3. 표 편집기 저장 완료 핸들러
  const handleTableSave = (data: {
    html: string;
    markdown: string;
    caption?: string;
    footnote?: string;
  }) => {
    setRawHtml(data.html);
    if (data.caption) setTableCaption(data.caption);
    if (data.footnote) setTableFootnote(data.footnote);

    const existingText = text.trim();
    const hasExistingTable = hasMarkdownTable(existingText);
    if (!existingText) {
      setText(data.markdown);
    } else if (!hasExistingTable) {
      setText(`${existingText}\n\n${data.markdown}`);
    } else {
      setText(data.markdown);
    }
    setIsTableEditorOpen(false);
    if (error) setError('');
  };

  // 4. 엑셀/스프레드시트(TSV) 빠른 붙여넣기 변환 핸들러
  const handleApplyTsv = () => {
    if (!tsvText.trim()) return;
    try {
      const grid = parseTsvToGrid(tsvText);
      const html = gridToHtmlTable(grid, tableCaption, tableFootnote);
      const md = gridToMarkdownTable(grid);

      setRawHtml(html);
      const existingText = text.trim();
      setText(existingText ? `${existingText}\n\n${md}` : md);
      setIsTsvInputOpen(false);
      setTsvText('');
      if (error) setError('');
    } catch {
      setError('TSV 표 데이터를 파싱하는 중 오류가 발생했습니다.');
    }
  };

  // 5. 폼 제출 처리
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText && !rawHtml.trim()) {
      setError('자식 청크 본문 내용 또는 표 데이터를 입력해주세요.');
      return;
    }
    if (pageNumber < 1) {
      setError('시작 페이지 번호는 1 이상이어야 합니다.');
      return;
    }

    const endPageNum = pageEnd ? parseInt(pageEnd, 10) : undefined;
    if (endPageNum && endPageNum < pageNumber) {
      setError('끝 페이지는 시작 페이지보다 크거나 같아야 합니다.');
      return;
    }

    // 커스텀 태그 파싱
    const tagsArray = customTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    // 표 메타데이터 구성 (표가 있는 경우 단일 테이블 아이템 생성)
    let tables: EmbeddedTableItem[] | undefined;
    if (rawHtml.trim()) {
      tables = [
        {
          table_index: 0,
          caption: tableCaption.trim() || undefined,
          footnote: tableFootnote.trim() || undefined,
          raw_html: rawHtml.trim(),
          page_number: pageNumber,
          page_end: endPageNum && endPageNum >= pageNumber ? endPageNum : pageNumber,
          token_estimate: tokenEstimate,
        },
      ];
    }

    const pid = parentChunk.parent_chunk_id || parentChunk.id || '';
    onAddChild({
      parentChunkId: pid,
      text: trimmedText,
      pageNumber,
      pageEnd: endPageNum && endPageNum >= pageNumber ? endPageNum : undefined,
      rawHtml: rawHtml.trim() ? rawHtml.trim() : undefined,
      tableCaption: tableCaption.trim() || undefined,
      tableFootnote: tableFootnote.trim() || undefined,
      tables,
      articleNo: articleNo.trim() || undefined,
      articleTitle: articleTitle.trim() || undefined,
      customTags: tagsArray,
      insertPosition,
      insertAfterChunkId: insertPosition === 'after' ? insertAfterChunkId : undefined,
    });

    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
        <div
          className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl text-indigo-600 dark:text-indigo-400 shrink-0">
                <Plus className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base leading-tight">
                    새 Child 청크 추가
                  </h3>
                  {/* 실시간 계산된 청크 유형 뱃지 */}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${getChunkKindBadgeClass(computedKind)}`}>
                    {getChunkKindLabel(computedKind, rawHtml ? 1 : 0)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  본문 텍스트, 표, 조문 정보를 단일 블록으로 자유롭게 구성합니다.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs flex-1">
            {error && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 rounded-xl flex items-center gap-2 animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span className="font-semibold">{error}</span>
              </div>
            )}

            {/* Parent Chunk Context Banner */}
            <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl border border-indigo-100/80 dark:border-indigo-900/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <span>소속 Parent:</span>
                    <CopyableBadge
                      id={parentChunk.parent_chunk_id || parentChunk.id}
                      type="parent"
                      titlePrefix="부모 청크 ID"
                      className="font-mono text-indigo-700 dark:text-indigo-300 bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-medium">
                    {parentChunk.title || sectionTitle || parentChunk.text?.slice(0, 36) || '부모 문맥 텍스트'}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 shrink-0">
                현재 자식: {parentChildren.length || parentChunk.child_chunk_ids?.length || 0}개
              </span>
            </div>

            {/* 1. 삽입 위치 지정 */}
            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <ArrowDownToLine className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                삽입 위치 (순서)
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setInsertPosition('end')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                      insertPosition === 'end'
                        ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    맨 뒤에 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => setInsertPosition('start')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                      insertPosition === 'start'
                        ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    맨 앞에 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => setInsertPosition('after')}
                    disabled={parentChildren.length === 0}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer disabled:opacity-40 ${
                      insertPosition === 'after'
                        ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    특정 Child 뒤에 삽입
                  </button>
                </div>

                {insertPosition === 'after' && parentChildren.length > 0 && (
                  <div className="flex-1 min-w-[200px]">
                    <select
                      value={insertAfterChunkId}
                      onChange={(e) => {
                        const cid = e.target.value;
                        setInsertAfterChunkId(cid);
                        const c = parentChildren.find((ch) => ch.chunk_id === cid);
                        if (c?.page_number) {
                          setPageNumber(c.page_number);
                        }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 font-mono"
                    >
                      {parentChildren.map((c, idx) => (
                        <option key={c.chunk_id} value={c.chunk_id}>
                          {idx + 1}. [{formatDisplayChunkId(c.chunk_id)}] {c.text?.slice(0, 24) || '본문 없음'}...
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* 2. 조문 메타데이터 섹션 (전용 스마트 입력창) */}
            <div className="border border-purple-200/80 dark:border-purple-900/50 bg-purple-50/30 dark:bg-purple-950/20 rounded-xl overflow-hidden transition">
              <button
                type="button"
                onClick={() => setIsArticleSectionOpen(!isArticleSectionOpen)}
                className="w-full p-2.5 flex items-center justify-between text-left cursor-pointer hover:bg-purple-100/40 dark:hover:bg-purple-900/30 transition"
              >
                <span className="font-bold text-purple-900 dark:text-purple-300 flex items-center gap-1.5 text-xs">
                  <Scale className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>법률/규정 조문 메타데이터 (선택사항)</span>
                  {articleNo && (
                    <span className="ml-1 px-1.5 py-0.2 bg-purple-200 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded font-mono text-[10px]">
                      {articleNo} {articleTitle ? `(${articleTitle})` : ''}
                    </span>
                  )}
                </span>
                {isArticleSectionOpen ? (
                  <ChevronUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                )}
              </button>

              {isArticleSectionOpen && (
                <div className="p-3 border-t border-purple-200/60 dark:border-purple-900/40 space-y-2">
                  <p className="text-[11px] text-purple-700 dark:text-purple-300">
                    조문 번호나 제목을 입력하면 본 청크는 RAG 검색 시 완성된 조문 엔티티로 특별 인덱싱됩니다.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        조문 번호
                      </label>
                      <input
                        type="text"
                        value={articleNo}
                        onChange={(e) => setArticleNo(e.target.value)}
                        placeholder="예: 제1조, 제14조의2"
                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        조문 제목
                      </label>
                      <input
                        type="text"
                        value={articleTitle}
                        onChange={(e) => setArticleTitle(e.target.value)}
                        placeholder="예: 목적, 정의, 적용 범위"
                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 font-medium"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Page Range & Tags */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                  페이지 번호 (시작 ~ 끝)
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <input
                      type="number"
                      min="1"
                      value={pageNumber}
                      onChange={(e) => setPageNumber(parseInt(e.target.value, 10) || 1)}
                      placeholder="시작 페이지"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-slate-100 font-mono font-medium"
                    />
                  </div>
                  <span className="text-slate-400 font-bold">~</span>
                  <div className="flex-1">
                    <input
                      type="number"
                      min={pageNumber}
                      value={pageEnd}
                      onChange={(e) => setPageEnd(e.target.value)}
                      placeholder="끝 페이지 (선택)"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-slate-100 font-mono font-medium"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5 text-slate-500" />
                  커스텀 태그 (선택사항)
                </label>
                <input
                  type="text"
                  value={customTags}
                  onChange={(e) => setCustomTags(e.target.value)}
                  placeholder="쉼표(,)로 구분 (예: 규정, 별표, 참고)"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>
            </div>

            {/* 4. Helper Toolbar & Quick Actions */}
            <div className="flex items-center justify-between bg-slate-100/70 dark:bg-slate-800/50 p-2 rounded-xl border border-slate-200 dark:border-slate-700 flex-wrap gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* 줄바꿈 정돈 (Soft-wrap) 버튼 */}
                <button
                  type="button"
                  onClick={handleRepairSoftWraps}
                  disabled={!text.trim()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-40"
                  title="PDF 복사 텍스트의 불필요한 행바꿈을 단일 문맥으로 깔끔하게 정돈합니다."
                >
                  <Wand2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                  <span>줄바꿈 정돈</span>
                </button>

                {/* 조문 템플릿 버튼 */}
                <button
                  type="button"
                  onClick={handleInsertArticleTemplate}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-950/50 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-lg text-xs font-semibold transition cursor-pointer"
                  title="제1조(목적) 규정 양식을 본문에 삽입합니다."
                >
                  <Layers className="w-3 h-3" />
                  <span>조문 양식 삽입</span>
                </button>

                {/* 표 편집기 열기 버튼 */}
                <button
                  type="button"
                  onClick={() => setIsTableEditorOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-2xs"
                  title="미니 표 편집기를 열어 행/열 추가, 셀 병합, 표 본문을 작성합니다."
                >
                  <Table2 className="w-3 h-3" />
                  <span>+ 표 편집기</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsTsvInputOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-semibold transition cursor-pointer"
                  title="엑셀/스프레드시트에서 복사한 표를 즉시 변환하여 삽입합니다."
                >
                  <ClipboardPaste className="w-3 h-3" />
                  <span>엑셀(TSV) 붙여넣기</span>
                </button>
              </div>

              {/* 편집 / 미리보기 탭 토글 */}
              <div className="flex items-center bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('edit')}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                    activeTab === 'edit'
                      ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <Edit3 className="w-3 h-3" />
                  <span>편집</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                    activeTab === 'preview'
                      ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>미리보기</span>
                </button>
              </div>
            </div>

            {/* 엑셀 TSV 빠른 붙여넣기 모달 영역 */}
            {isTsvInputOpen && (
              <div className="p-3 bg-amber-50/60 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2 animate-in fade-in duration-100">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1 text-xs">
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    엑셀 / 스프레드시트 셀 복사 데이터 붙여넣기
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsTsvInputOpen(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={tsvText}
                  onChange={(e) => setTsvText(e.target.value)}
                  placeholder="Excel이나 Google 스프레드시트에서 셀 범위를 Ctrl+C한 후 여기에 Ctrl+V 하세요."
                  className="w-full bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-lg p-2 text-xs font-mono"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsTsvInputOpen(false)}
                    className="px-2.5 py-1 text-xs text-slate-600 hover:bg-amber-100 rounded-lg"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyTsv}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs"
                  >
                    표로 변환하여 적용
                  </button>
                </div>
              </div>
            )}

            {/* 5. Main Text Editor / Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  청크 본문 내용 (Markdown)
                </label>
                <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                  약 {tokenEstimate} 토큰 ({text.length}자)
                </span>
              </div>

              {activeTab === 'edit' ? (
                <textarea
                  rows={8}
                  value={text}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder="추가할 본문 내용을 입력하세요. 필요시 상단의 '+ 표 편집기'를 눌러 표를 결합할 수 있습니다."
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-slate-100 font-sans leading-relaxed text-xs resize-y"
                />
              ) : (
                <div className="min-h-[160px] p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto text-xs leading-relaxed">
                  {rawHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: rawHtml }} className="prose-custom" />
                  ) : text.trim() ? (
                    <div className="whitespace-pre-wrap font-sans text-slate-800 dark:text-slate-200">
                      {text}
                    </div>
                  ) : (
                    <span className="text-slate-400 italic">내용이 없습니다.</span>
                  )}
                </div>
              )}
            </div>

            {/* 6. Raw HTML & Table Metadata (표가 첨부되었거나 rawHtml이 있을 때 자동 노출) */}
            {(rawHtml.trim() || hasMarkdownTable(text)) && (
              <div className="space-y-2 p-3 bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-900 dark:text-indigo-300 text-[11px] flex items-center gap-1">
                    <Table2 className="w-3.5 h-3.5" />
                    첨부된 표 메타데이터 (HTML 및 캡션)
                  </span>
                  {rawHtml && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" />
                      원형 HTML 보존됨
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={tableCaption}
                    onChange={(e) => setTableCaption(e.target.value)}
                    placeholder="표 캡션/제목 (예: [표 1] 부서별 직무 기준)"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400"
                  />
                  <input
                    type="text"
                    value={tableFootnote}
                    onChange={(e) => setTableFootnote(e.target.value)}
                    placeholder="표 각주/출처 (예: ※ 본 표는 2026년 기준임)"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400"
                  />
                </div>

                {rawHtml && (
                  <div>
                    <textarea
                      rows={2}
                      value={rawHtml}
                      onChange={(e) => setRawHtml(e.target.value)}
                      placeholder="<table>...</table> 원형 HTML"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-slate-100 placeholder-slate-400 font-mono text-[10px] resize-y"
                    />
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
              <HelpCircle className="w-3 h-3 shrink-0" />
              자식 청크가 추가되면 부모(Parent)의 문맥 결합 텍스트와 누적 토큰 수가 자동으로 동기화됩니다.
            </p>

            {/* Action Buttons */}
            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Child 추가 완료</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Mini Table Editor Modal */}
      {isTableEditorOpen && (
        <TableEditorModal
          isOpen={isTableEditorOpen}
          initialHtml={rawHtml || undefined}
          caption={tableCaption}
          footnote={tableFootnote}
          onClose={() => setIsTableEditorOpen(false)}
          onSave={handleTableSave}
        />
      )}
    </>
  );
};

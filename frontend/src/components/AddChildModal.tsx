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
  Sparkles,
  Eye,
  Edit3,
  ArrowDownToLine,
  Tag,
  Wand2,
  ClipboardPaste,
  CheckCircle2,
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
  isPureTable,
} from '../utils/tableChunkUtils';

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
  const [chunkType, setChunkType] = useState<'paragraph' | 'article' | 'table' | 'composite'>('paragraph');
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageEnd, setPageEnd] = useState<string>('');
  const [rawHtml, setRawHtml] = useState<string>('');
  const [tableCaption, setTableCaption] = useState<string>('');
  const [tableFootnote, setTableFootnote] = useState<string>('');
  const [customTags, setCustomTags] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

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
      setChunkType('paragraph');
      setRawHtml('');
      setTableCaption('');
      setTableFootnote('');
      setCustomTags('');
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

  if (!isOpen || !parentChunk) return null;

  // 1. 소프트랩(줄바꿈) 정돈 핸들러
  const handleRepairSoftWraps = () => {
    if (!text.trim()) return;
    const repaired = repairSoftWraps(text);
    setText(repaired);
    if (error) setError('');
  };

  // 2. 조항/규정 템플릿 삽입
  const handleInsertArticleTemplate = () => {
    const template = '제1조(목적)\n① 이 규정은 업무 수행에 필요한 세부 사항을 규정함을 목적으로 한다.\n② 제1항에 따른 세부 지침은 관련 부서에서 별도로 정한다.';
    if (!text.trim()) {
      setText(template);
    } else {
      setText((prev) => `${prev.trim()}\n\n${template}`);
    }
    setChunkType('article');
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

    if (chunkType === 'composite') {
      // 복합 청크: 문단이 있으면 문단 뒤에 표 마크다운 결합
      const existingText = text.trim();
      const hasExistingTable = hasMarkdownTable(existingText);
      if (!existingText) {
        setText(data.markdown);
      } else if (!hasExistingTable) {
        setText(`${existingText}\n\n${data.markdown}`);
      } else {
        // 이미 표가 포함되어 있다면 교체
        setText(data.markdown);
      }
    } else {
      // 단독 표 청크
      setText(data.markdown);
      setChunkType('table');
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
      if (chunkType === 'composite') {
        const existingText = text.trim();
        setText(existingText ? `${existingText}\n\n${md}` : md);
      } else {
        setText(md);
        setChunkType('table');
      }
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
    if (!trimmedText) {
      setError('자식 청크 본문 내용을 입력해주세요.');
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

    // 스마트 청크 타입 보정 (표가 포함되었는지 여부 확인)
    let finalChunkType = chunkType;
    const hasTable = hasMarkdownTable(trimmedText) || Boolean(rawHtml.trim());
    if (hasTable) {
      const pureTable = isPureTable(trimmedText) || (rawHtml.trim() && !trimmedText.replace(/\|[^\n]+\|/g, '').trim());
      if (pureTable) {
        finalChunkType = 'table';
      } else if (chunkType === 'paragraph' || chunkType === 'article') {
        finalChunkType = 'composite';
      }
    }

    // 커스텀 태그 파싱
    const tagsArray = customTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    // 표 메타데이터 구성
    let tables: EmbeddedTableItem[] | undefined;
    if (finalChunkType === 'table' || finalChunkType === 'composite') {
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
    }

    const pid = parentChunk.parent_chunk_id || parentChunk.id || '';
    onAddChild({
      parentChunkId: pid,
      text: trimmedText,
      chunkType: finalChunkType,
      pageNumber,
      pageEnd: endPageNum && endPageNum >= pageNumber ? endPageNum : undefined,
      rawHtml: rawHtml.trim() ? rawHtml.trim() : undefined,
      tableCaption: tableCaption.trim() || undefined,
      tableFootnote: tableFootnote.trim() || undefined,
      tables,
      customTags: tagsArray.length > 0 ? tagsArray : undefined,
      insertPosition,
      insertAfterChunkId: insertPosition === 'after' ? insertAfterChunkId : undefined,
    });

    onClose();
  };

  const pid = parentChunk.parent_chunk_id || parentChunk.id || '';

  // 4대 청크 타입 정의
  const chunkTypeOptions: { id: 'paragraph' | 'article' | 'table' | 'composite'; label: string; desc: string; icon: any }[] = [
    { id: 'paragraph', label: '일반 문단', desc: '본문 설명문 (~512 tok)', icon: FileText },
    { id: 'article', label: '조문/규정', desc: '제O조(제목) 규정 조항', icon: Layers },
    { id: 'table', label: '단독 표', desc: 'RAG 표 마크다운 + HTML', icon: Table2 },
    { id: 'composite', label: '복합 청크', desc: '문단 + 표 결합 본문', icon: Sparkles },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150 overflow-y-auto"
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl overflow-hidden flex flex-col my-8 max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-indigo-50/60 dark:bg-indigo-950/40">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 rounded-xl">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  새 Child(자식 청크) 추가
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  선택한 Parent 문맥 아래에 4대 표준 청크 형식(조문·문단·표·복합) 단위로 추가합니다.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs overflow-y-auto">
            {error && (
              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-rose-700 dark:text-rose-300 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Target Parent Info Banner */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-slate-500 dark:text-slate-400 text-[11px]">
                    대상 부모:
                  </span>
                  <CopyableBadge
                    id={pid}
                    type="parent"
                    titlePrefix="전체 Parent ID"
                    className="font-mono text-indigo-700 dark:text-indigo-300 font-bold bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 shrink-0 text-[11px]"
                  />
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {parentChunk.title || '제목 없음'}
                  </span>
                </div>
                {sectionTitle && (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-md">
                    소속 섹션: {sectionTitle}
                  </p>
                )}
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 shrink-0">
                현재 자식: {parentChildren.length || parentChunk.child_chunk_ids?.length || 0}개
              </span>
            </div>

            {/* 1. Chunk Type Selector (4대 청크 형식: 조문, 문단, 표, 복합) */}
            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-700 dark:text-slate-300">
                청크 형식 (4대 표준)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {chunkTypeOptions.map((t) => {
                  const Icon = t.icon;
                  const isSelected = chunkType === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setChunkType(t.id)}
                      className={`p-2 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-indigo-50/80 dark:bg-indigo-950/60 border-indigo-500 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                          : 'bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{t.label}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                        {t.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Insertion Position Selector (작업자 편의: 삽입 순서 지정) */}
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
                {chunkType === 'article' && (
                  <button
                    type="button"
                    onClick={handleInsertArticleTemplate}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs font-semibold transition cursor-pointer"
                    title="제1조(목적) 규정 양식을 본문에 삽입합니다."
                  >
                    <Layers className="w-3 h-3" />
                    <span>조문 양식 삽입</span>
                  </button>
                )}

                {/* 표 편집기 열기 버튼 (표/복합 청크 전용) */}
                {(chunkType === 'table' || chunkType === 'composite') && (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsTableEditorOpen(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-2xs"
                      title="미니 표 편집기를 열어 행/열 추가, 셀 병합, 표 본문을 작성합니다."
                    >
                      <Table2 className="w-3 h-3" />
                      <span>표 편집기 열기</span>
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
                  </>
                )}
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

            {/* 5. Child Chunk Text / Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  {chunkType === 'composite'
                    ? '본문 내용 (설명 문단 + 표 Markdown)'
                    : chunkType === 'table'
                    ? '검색용 표 내용 (Markdown 파이프 표)'
                    : '청크 내용 (검색 및 임베딩 텍스트)'}
                  <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="text-slate-400 dark:text-slate-500">{text.length}자</span>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <span
                    className={`font-semibold ${
                      tokenEstimate > 512
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-indigo-600 dark:text-indigo-400'
                    }`}
                  >
                    ~{tokenEstimate} tokens
                  </span>
                  {tokenEstimate > 512 && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-1 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                      권장 초과
                    </span>
                  )}
                </div>
              </div>

              {activeTab === 'edit' ? (
                <textarea
                  rows={6}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder={
                    chunkType === 'table'
                      ? '| 헤더1 | 헤더2 |\n| --- | --- |\n| 항목A | 항목B |\n\n(표 편집기 버튼을 누르면 쉽게 작성할 수 있습니다.)'
                      : chunkType === 'composite'
                      ? '표에 대한 설명 문단을 작성하고, 아래 [표 편집기 열기]로 표를 추가하세요...'
                      : '추가할 자식 청크의 본문 내용을 입력하세요...'
                  }
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-sans leading-relaxed text-xs resize-y"
                  autoFocus
                />
              ) : (
                <div className="w-full min-h-[150px] max-h-[300px] overflow-y-auto bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs leading-relaxed">
                  {text.trim() ? (
                    <div className="space-y-3">
                      <div className="whitespace-pre-wrap font-sans text-slate-800 dark:text-slate-200">
                        {text}
                      </div>
                      {rawHtml && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                          <p className="text-[11px] font-bold text-slate-500 mb-1">표 원형 렌더링:</p>
                          <div
                            className="overflow-x-auto"
                            dangerouslySetInnerHTML={{ __html: rawHtml }}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-400 italic text-center py-6">
                      입력된 본문 내용이 없습니다.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 6. Raw HTML & Table Metadata (표/복합 전용) */}
            {(chunkType === 'table' || chunkType === 'composite') && (
              <div className="space-y-2 p-3 bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-900 dark:text-indigo-300 text-[11px] flex items-center gap-1">
                    <Table2 className="w-3.5 h-3.5" />
                    표 세부 메타데이터 (HTML 및 캡션)
                  </span>
                  {rawHtml && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" />
                      HTML 원형 준비됨
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

                <div>
                  <textarea
                    rows={2}
                    value={rawHtml}
                    onChange={(e) => setRawHtml(e.target.value)}
                    placeholder="<table>...</table> 원형 HTML (표 편집기 사용 시 자동 생성됩니다)"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-slate-100 placeholder-slate-400 font-mono text-[10px] resize-y"
                  />
                </div>
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

      {/* 표 편집기 서브모달 연동 */}
      <TableEditorModal
        isOpen={isTableEditorOpen}
        onClose={() => setIsTableEditorOpen(false)}
        initialHtml={rawHtml}
        initialMarkdown={text}
        caption={tableCaption}
        footnote={tableFootnote}
        onSave={handleTableSave}
      />

      {/* TSV(엑셀 붙여넣기) 간편 모달 */}
      {isTsvInputOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          onClick={() => setIsTsvInputOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-sm">
                <ClipboardPaste className="w-4 h-4" />
                <span>엑셀/스프레드시트 표 붙여넣기 (TSV)</span>
              </div>
              <button
                type="button"
                onClick={() => setIsTsvInputOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              엑셀, 구글 스프레드시트 또는 노션 표를 복사(Ctrl+C)한 후 아래에 붙여넣으면 마크다운 및 HTML 표로 즉시 변환됩니다.
            </p>

            <textarea
              rows={6}
              value={tsvText}
              onChange={(e) => setTsvText(e.target.value)}
              placeholder="엑셀에서 복사한 셀을 여기에 붙여넣으세요 (탭 구분자)..."
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs font-mono"
              autoFocus
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsTsvInputOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleApplyTsv}
                disabled={!tsvText.trim()}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                표 변환 및 적용
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

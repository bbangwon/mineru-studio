import React, { useState } from 'react';
import { Code2, X, Copy, Check } from 'lucide-react';
import type { ChildChunk, ParentSection, ParentChunk } from '../types';
import { getChunkPageList } from '../utils/pageUtils';

interface JsonlModalProps {
  chunk: ChildChunk | null;
  parentSections: ParentSection[];
  parentChunks?: ParentChunk[];
  onClose: () => void;
}

export const JsonlModal: React.FC<JsonlModalProps> = ({
  chunk,
  parentSections,
  parentChunks,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!chunk) return null;

  const pid = chunk.parent_chunk_id || chunk.parent_id;
  const parent = parentChunks?.find((p) => (p.parent_chunk_id || p.id) === pid);
  const secId = chunk.section_id || parent?.section_id || chunk.parent_id;
  const section = parentSections.find((s) => s.id === secId);

  const startPage = chunk.page_number || 1;
  const endPage = chunk.page_end && chunk.page_end >= startPage ? chunk.page_end : startPage;
  const pages = getChunkPageList(startPage, endPage);

  const breadcrumbs = chunk.breadcrumbs || section?.breadcrumbs || [];
  const breadcrumbs_str = breadcrumbs.join(' > ');
  const parentText = parent?.text || '';
  const parentContextText = parentText
    ? (breadcrumbs_str && !parentText.startsWith(`[${breadcrumbs_str}]`)
        ? `[${breadcrumbs_str}]\n${parentText}`
        : parentText)
    : '';

  const isAtomicTable = chunk.chunk_type === 'table' || Boolean(chunk.is_atomic_table);

  const record: Record<string, any> = {
    id: chunk.chunk_id,
    parent_chunk_id: pid,
    section_id: secId,
    section_title: section?.title || '',
    breadcrumbs: breadcrumbs,
    breadcrumbs_str: breadcrumbs_str,
    text: chunk.text,
    parent_context_text: parentContextText,
    chunk_type: chunk.chunk_type,
    is_atomic_table: isAtomicTable,
    page: startPage,
    ...(endPage > startPage ? { page_end: endPage } : {}),
    pages: pages,
    token_estimate: chunk.token_estimate,
    parent_token_estimate: parent?.token_estimate || 0,
    metadata: {
      ...(chunk.metadata || {}),
      doc_title: chunk.metadata?.doc_title || '',
      section: section?.title || '',
      page: startPage,
      page_start: startPage,
      page_end: endPage,
      pages: pages,
      is_atomic_table: isAtomicTable,
    },
  };

  if (isAtomicTable) {
    record.raw_html = chunk.raw_html || '';
    if (chunk.table_caption) record.table_caption = chunk.table_caption;
  }

  const jsonString = JSON.stringify(record, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 text-slate-800 dark:text-slate-100 transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">RAG JSONL 레코드 미리보기 (Small-to-Big Retrieval)</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Vector DB 검색용 <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-indigo-600 dark:text-indigo-400 font-mono">text</code>와
          LLM 프롬프트 생성용 <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-emerald-600 dark:text-emerald-400 font-mono">parent_context_text</code>가
          분리 적재되는 표준 3단계 계층 JSONL 단일 레코드입니다.
        </p>

        {/* Content Box */}
        <div className="relative">
          <pre className="bg-slate-950 text-emerald-400 p-4 rounded-xl text-xs font-mono overflow-x-auto max-h-96 whitespace-pre-wrap break-all select-all border border-slate-800">
            {jsonString}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-semibold px-3 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-2xs border border-indigo-200 dark:border-indigo-800"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-700 dark:text-emerald-400">복사 완료!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>JSON 복사</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold px-4 py-2 rounded-xl transition cursor-pointer shadow-2xs"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { Table2, AlignLeft, FileCode2, ChevronRight, MapPin, ShieldCheck, Image as ImageIcon, ExternalLink, Scale, Edit3, EyeOff, CheckCircle2, AlertTriangle, Info, Trash2, Sparkles } from 'lucide-react';
import type { ChildChunk, ParentSection } from '../types';
import { formatChunkPageFull } from '../utils/pageUtils';
import { estimateKoreanTokens } from '../utils/idUtils';
import { CopyableBadge } from './CopyableBadge';

interface ChunkCardProps {
  chunk: ChildChunk;
  parentSection?: ParentSection;
  onOpenJsonlModal: (chunk: ChildChunk) => void;
  onEditChunk?: (chunk: ChildChunk) => void;
  onDeleteChunk?: (chunkId: string) => void;
  onRefineChunk?: (chunk: ChildChunk) => void;
}

export const ChunkCard: React.FC<ChunkCardProps> = ({
  chunk,
  parentSection,
  onOpenJsonlModal,
  onEditChunk,
  onDeleteChunk,
  onRefineChunk,
}) => {
  const isTable = chunk.chunk_type === 'table' || Boolean(chunk.is_atomic_table);
  const isArticle = chunk.chunk_type === 'article' || chunk.chunk_type === 'article_clause';
  const isIgnored = Boolean(chunk.is_ignored);
  const isEdited = Boolean(chunk.is_edited);
  const breadcrumbs = chunk.breadcrumbs || [];

  const wordCount = chunk.token_estimate || (chunk.text ? estimateKoreanTokens(chunk.text) : 0);
  const isEmpty = (!chunk.text || !chunk.text.trim()) && (!chunk.raw_html || !chunk.raw_html.trim());
  const isOverTokenLimit = !isTable && wordCount > 512;
  const isUnderTokenLimit = !isTable && !isEmpty && wordCount > 0 && wordCount < 20;

  return (
    <div
      className={`p-4 rounded-xl border shadow-xs transition relative ${
        isIgnored
          ? 'bg-slate-50/70 dark:bg-slate-900/60 border-slate-300 dark:border-slate-800 opacity-65'
          : isTable
          ? 'border-indigo-300 dark:border-indigo-800 ring-1 ring-indigo-200/60 dark:ring-indigo-900/40 bg-white dark:bg-slate-900'
          : isArticle
          ? 'border-purple-300 dark:border-purple-800 ring-1 ring-purple-200/60 dark:ring-purple-900/40 bg-white dark:bg-slate-900'
          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
      }`}
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isTable ? (
            <span className="bg-indigo-600 text-white text-[11px] font-bold px-2.5 py-0.5 rounded shadow-xs flex items-center gap-1">
              <Table2 className="w-3.5 h-3.5" />
              ATOMIC TABLE (원형 보존)
            </span>
          ) : isArticle ? (
            <span className="bg-purple-600 text-white text-[11px] font-bold px-2.5 py-0.5 rounded shadow-xs flex items-center gap-1">
              <Scale className="w-3.5 h-3.5" />
              {chunk.metadata?.article_no ? `${chunk.metadata.article_no} 조문 완결 청크` : '조문 완결 청크'}
            </span>
          ) : (
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-medium px-2 py-0.5 rounded flex items-center gap-1">
              <AlignLeft className="w-3 h-3 text-slate-400 dark:text-slate-500" />
              문단
            </span>
          )}

          {/* Edited Status Badge */}
          {isEdited && (
            <span className="bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-amber-500" />
              수정됨
            </span>
          )}

          {/* Ignored Status Badge */}
          {isIgnored && (
            <span className="bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1">
              <EyeOff className="w-3 h-3 text-rose-500" />
              임베딩 제외
            </span>
          )}

          {/* Linter Warning Badges */}
          {isEmpty ? (
            <span className="bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
              빈 청크
            </span>
          ) : isTable ? (
            <span className="bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              표 원형 보존 상태
            </span>
          ) : isOverTokenLimit ? (
            <span className="bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
              512+ tokens (분할 권장)
            </span>
          ) : isUnderTokenLimit ? (
            <span className="bg-sky-50 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800 text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1">
              <Info className="w-3 h-3 text-sky-600 dark:text-sky-400" />
              &lt;20 tokens (병합 권장)
            </span>
          ) : null}

          <CopyableBadge
            id={chunk.chunk_id}
            type="chunk"
            titlePrefix="전체 청크 ID"
            className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200/80 dark:border-slate-700/80 shrink-0"
          />
          <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
            {formatChunkPageFull(chunk)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onEditChunk && (
            <button
              type="button"
              onClick={() => onEditChunk(chunk)}
              className="text-[11px] text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-indigo-100 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-2.5 py-1 rounded transition flex items-center gap-1 font-semibold cursor-pointer border border-indigo-200/80 dark:border-indigo-800"
              title="청크 내용 및 부모 섹션 수정"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>수정</span>
            </button>
          )}

          {onRefineChunk && (
            <button
              type="button"
              onClick={() => onRefineChunk(chunk)}
              className="text-[11px] text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100 bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 dark:hover:bg-purple-900/60 px-2.5 py-1 rounded transition flex items-center gap-1 font-semibold cursor-pointer border border-purple-200/80 dark:border-purple-800"
              title="로컬 LLM을 통한 청크 텍스트 띄어쓰기 및 줄바꿈 자동 교정"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span>AI 교정</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onOpenJsonlModal(chunk)}
            className="text-[11px] text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 px-2.5 py-1 rounded transition flex items-center gap-1 font-medium cursor-pointer"
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>JSONL</span>
          </button>

          {onDeleteChunk && (
            <button
              type="button"
              onClick={() => {
                const ok = window.confirm(
                  `청크 '${chunk.chunk_id}'를 정말 삭제하시겠습니까?\n\n` +
                  `• 소속된 상위 Parent의 본문 문맥도 남은 청크 기준으로 자동 축소됩니다.\n` +
                  `• 만약 이 청크가 해당 Parent의 마지막 청크라면 Parent도 함께 자동 정리됩니다.\n\n` +
                  `삭제를 진행하시겠습니까?`
                );
                if (ok) onDeleteChunk(chunk.chunk_id);
              }}
              className="text-[11px] text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-100 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 px-2 py-1 rounded transition flex items-center gap-1 font-medium cursor-pointer border border-rose-200 dark:border-rose-800"
              title="청크 삭제"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumb Path */}
      <div className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400 flex items-center flex-wrap gap-1">
        <MapPin className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
        {breadcrumbs.length > 0 ? (
          breadcrumbs.map((b, idx) => (
            <React.Fragment key={idx}>
              <span
                className={
                  idx === breadcrumbs.length - 1
                    ? 'font-semibold text-slate-700 dark:text-slate-200'
                    : 'text-slate-400 dark:text-slate-500'
                }
              >
                {b}
              </span>
              {idx < breadcrumbs.length - 1 && (
                <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />
              )}
            </React.Fragment>
          ))
        ) : (
          <span className="text-slate-400 dark:text-slate-500">{parentSection?.title || '루트 문서'}</span>
        )}
      </div>

      {/* Content */}
      {isTable ? (
        <div className="space-y-2 mt-2.5">
          <div
            className="prose-custom overflow-x-auto bg-slate-50/70 dark:bg-slate-950/70 p-3 rounded-lg border border-slate-200 dark:border-slate-800"
            dangerouslySetInnerHTML={{ __html: chunk.raw_html || chunk.text }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
            <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>잘림 없는 독립 엔티티 (RAG 검색 시 Multi-Vector / 요약 인덱싱 지원)</span>
            </span>
            {chunk.image_url && (
              <a
                href={chunk.image_url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline flex items-center gap-1 font-medium"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>원본 표 이미지 보기</span>
                <ExternalLink className="w-3 h-3 text-indigo-400" />
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed mt-2.5 whitespace-pre-line bg-slate-50/50 dark:bg-slate-950/60 p-3 rounded-lg border border-slate-100 dark:border-slate-800 font-sans">
          {chunk.text}
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono">
        <span className="flex items-center gap-1 flex-wrap">
          <span>Parent:</span>
          <CopyableBadge
            id={chunk.parent_chunk_id || chunk.parent_id}
            type="parent"
            titlePrefix="전체 Parent ID"
            className="text-[10px] font-bold text-slate-600 dark:text-slate-300 px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60"
          />
          {chunk.section_id && (
            <>
              <span>| Section:</span>
              <CopyableBadge
                id={chunk.section_id}
                type="section"
                titlePrefix="전체 Section ID"
                className="text-[10px] text-slate-500 dark:text-slate-400 px-1 py-0.2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
              />
            </>
          )}
          {parentSection && ` (${parentSection.title})`}
        </span>
        <span>추정 토큰: ~{wordCount} tokens</span>
      </div>
    </div>
  );
};

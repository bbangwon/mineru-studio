import React from 'react';
import { FolderTree, Boxes, Table2, AlignLeft, Type, Scale } from 'lucide-react';
import type { EtlStats } from '../types';

interface StatCardsProps {
  stats?: EtlStats;
}

export const StatCards: React.FC<StatCardsProps> = ({ stats }) => {
  const isLegalMode = stats && (stats.article_chunks ?? 0) > 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
      {/* 1. Parent Sections */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider">부모 섹션 (Parent)</span>
          <FolderTree className="w-4 h-4 text-indigo-500" />
        </div>
        <div className="text-2xl font-bold text-slate-800 tracking-tight">
          {stats ? stats.total_parent_sections.toLocaleString() : '-'}
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5">
          {isLegalMode ? '장·절·조문 계층' : 'Heading 계층 분할'}
        </p>
      </div>

      {/* 2. Total Child Chunks */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider">총 자식 청크 (Child)</span>
          <Boxes className="w-4 h-4 text-blue-500" />
        </div>
        <div className="text-2xl font-bold text-slate-800 tracking-tight">
          {stats ? stats.total_child_chunks.toLocaleString() : '-'}
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5">임베딩 인덱스 대상</p>
      </div>

      {/* 3. Atomic Tables (Highlighted) */}
      <div className="bg-white p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/20 shadow-xs hover:border-indigo-300 transition">
        <div className="flex items-center justify-between text-indigo-700 mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider">표 청크 (Atomic Table)</span>
          <Table2 className="w-4 h-4 text-indigo-600" />
        </div>
        <div className="text-2xl font-black text-indigo-700 tracking-tight">
          {stats ? stats.table_chunks.toLocaleString() : '-'}
        </div>
        <p className="text-[10px] text-indigo-600 font-medium mt-0.5 flex items-center gap-1">
          <span>🚨</span> 원형 100% 무손실 보존
        </p>
      </div>

      {/* 4. Paragraphs or Legal Articles */}
      <div
        className={`p-3.5 rounded-xl border shadow-xs transition ${
          isLegalMode
            ? 'bg-purple-50/30 border-purple-200 hover:border-purple-300'
            : 'bg-white border-slate-200 hover:border-slate-300'
        }`}
      >
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider">
            {isLegalMode ? '조문 청크 (Articles)' : '문단 청크 (Text)'}
          </span>
          {isLegalMode ? (
            <Scale className="w-4 h-4 text-purple-600" />
          ) : (
            <AlignLeft className="w-4 h-4 text-slate-400" />
          )}
        </div>
        <div
          className={`text-2xl font-bold tracking-tight ${
            isLegalMode ? 'text-purple-700' : 'text-slate-800'
          }`}
        >
          {stats
            ? isLegalMode
              ? stats.article_chunks?.toLocaleString()
              : stats.paragraph_chunks.toLocaleString()
            : '-'}
        </div>
        <p
          className={`text-[10px] mt-0.5 ${
            isLegalMode ? 'text-purple-600 font-medium' : 'text-slate-400'
          }`}
        >
          {isLegalMode ? '법률 조문 완결 결합' : '자연 문맥 문단'}
        </p>
      </div>

      {/* 5. Total Words */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition">
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider">단어 수 (Words)</span>
          <Type className="w-4 h-4 text-slate-400" />
        </div>
        <div className="text-2xl font-bold text-slate-800 tracking-tight">
          {stats ? stats.total_words.toLocaleString() : '-'}
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5">추정 토큰 기반</p>
      </div>
    </div>
  );
};

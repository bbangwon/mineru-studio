import React, { useState, useEffect, useMemo } from 'react';
import { X, Layers, HelpCircle, FileText, BookOpen, AlertCircle, ArrowDownUp, Tag } from 'lucide-react';
import type { SectionNode, ParentChunk, ParentInsertPosition, ChildChunk } from '../types';
import { extractCustomMetadata } from '../utils/pageUtils';

interface AddParentModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: SectionNode[];
  parentChunks?: ParentChunk[];
  childChunks?: ChildChunk[];
  defaultSectionId?: string | null;
  onAddParent: (data: {
    sectionId: string;
    title: string;
    pageNumber: number;
    initialChildText: string;
    chunkType: 'paragraph' | 'table' | 'article_clause' | 'article';
    insertPosition?: ParentInsertPosition;
    inheritMetadata?: boolean;
  }) => void;
}

export const AddParentModal: React.FC<AddParentModalProps> = ({
  isOpen,
  onClose,
  sections,
  parentChunks = [],
  childChunks = [],
  defaultSectionId,
  onAddParent,
}) => {
  const [sectionId, setSectionId] = useState<string>('');
  const [positionType, setPositionType] = useState<'end' | 'start' | 'after'>('end');
  const [afterParentId, setAfterParentId] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [chunkType, setChunkType] = useState<'paragraph' | 'article_clause' | 'table'>('paragraph');
  const [childText, setChildText] = useState<string>('');
  const [inheritMetadata, setInheritMetadata] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // 현재 선택된 섹션에 속한 기존 Parent 목록 (섹션의 parent_chunk_ids 순서 유지)
  const existingParentsForSection = useMemo(() => {
    if (!sectionId) return [];
    const sec = sections.find((s) => s.id === sectionId);
    const pMap = new Map<string, ParentChunk>();
    parentChunks.forEach((p) => {
      const pid = p.parent_chunk_id || p.id || '';
      if (pid) pMap.set(pid, p);
    });

    if (sec?.parent_chunk_ids && sec.parent_chunk_ids.length > 0) {
      return sec.parent_chunk_ids
        .map((pid) => pMap.get(pid))
        .filter((p): p is ParentChunk => Boolean(p));
    }
    return parentChunks.filter((p) => p.section_id === sectionId);
  }, [sectionId, sections, parentChunks]);

  // 상속 가능한 메타데이터 소스 탐색 (페이지 관련 필드는 제외)
  const candidateCustomMetadata = useMemo(() => {
    if (!childChunks || childChunks.length === 0) return {};
    let sourceChunk: ChildChunk | undefined;

    // 1) 특정 Parent 뒤에 삽입하는 경우: 해당 Parent의 마지막 자식 청크
    if (positionType === 'after' && afterParentId) {
      const refP = parentChunks.find((p) => (p.parent_chunk_id || p.id) === afterParentId);
      if (refP?.child_chunk_ids && refP.child_chunk_ids.length > 0) {
        const lastChildId = refP.child_chunk_ids[refP.child_chunk_ids.length - 1];
        sourceChunk = childChunks.find((c) => c.chunk_id === lastChildId);
      }
    }

    // 2) 동일 섹션 내의 자식 청크
    if (!sourceChunk && sectionId) {
      sourceChunk = childChunks.find((c) => c.section_id === sectionId);
    }

    // 3) 문서 전체의 첫 번째 청크 (문서 전역 공통 메타데이터)
    if (!sourceChunk && childChunks.length > 0) {
      sourceChunk = childChunks[0];
    }

    return extractCustomMetadata(sourceChunk?.metadata);
  }, [positionType, afterParentId, sectionId, parentChunks, childChunks]);

  useEffect(() => {
    if (isOpen) {
      const initialSec = defaultSectionId && sections.some((s) => s.id === defaultSectionId)
        ? defaultSectionId
        : (sections.length > 0 ? sections[0].id : '');
      setSectionId(initialSec);

      // 해당 섹션의 시작 페이지를 기본 페이지로 설정
      const foundSec = sections.find((s) => s.id === initialSec);
      const defaultPage = foundSec?.page_range?.[0] || 1;

      setPositionType('end');
      setAfterParentId('');
      setTitle('');
      setPageNumber(defaultPage);
      setChunkType('paragraph');
      setChildText('');
      setInheritMetadata(true);
      setError('');
    }
  }, [isOpen, defaultSectionId, sections]);

  // 섹션 내 Parent 목록이 바뀔 때 afterParentId 초기값 설정
  useEffect(() => {
    if (existingParentsForSection.length > 0 && !afterParentId) {
      const lastP = existingParentsForSection[existingParentsForSection.length - 1];
      setAfterParentId(lastP.parent_chunk_id || lastP.id || '');
    }
  }, [existingParentsForSection, afterParentId]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedText = childText.trim();

    if (!sectionId) {
      setError('소속될 섹션을 선택해주세요.');
      return;
    }
    if (!trimmedTitle) {
      setError('Parent(부모 문맥) 제목을 입력해주세요.');
      return;
    }
    if (!trimmedText) {
      setError('누락된 본문 텍스트(최초 Child 청크)를 입력해주세요.');
      return;
    }
    if (pageNumber < 1) {
      setError('유효한 페이지 번호(1 이상)를 입력해주세요.');
      return;
    }

    let insertPosition: ParentInsertPosition = { type: 'end' };
    if (positionType === 'start') {
      insertPosition = { type: 'start' };
    } else if (positionType === 'after' && afterParentId) {
      insertPosition = { type: 'after', parentId: afterParentId };
    }

    onAddParent({
      sectionId,
      title: trimmedTitle,
      pageNumber,
      initialChildText: trimmedText,
      chunkType,
      insertPosition,
      inheritMetadata,
    });

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-purple-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">새 Parent(부모 청크) 추가</h3>
              <p className="text-xs text-slate-500">
                누락된 본문을 위한 부모 문맥과 최초 자식 청크를 함께 생성합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Target Section */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">
              소속 섹션 (Section) <span className="text-rose-500">*</span>
            </label>
            <select
              value={sectionId}
              onChange={(e) => {
                setSectionId(e.target.value);
                const foundSec = sections.find((s) => s.id === e.target.value);
                if (foundSec?.page_range?.[0]) {
                  setPageNumber(foundSec.page_range[0]);
                }
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-slate-800 font-medium cursor-pointer"
            >
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.breadcrumbs && sec.breadcrumbs.length > 0
                    ? sec.breadcrumbs.join(' > ')
                    : sec.title} (L{sec.level})
                </option>
              ))}
            </select>
          </div>

          {/* Insertion Position */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-slate-700 flex items-center gap-1">
                <ArrowDownUp className="w-3.5 h-3.5 text-purple-600" />
                <span>추가 위치 (순서)</span>
              </label>
              {existingParentsForSection.length > 0 && (
                <span className="text-[11px] text-purple-600 font-medium">
                  현재 섹션에 {existingParentsForSection.length}개 부모 존재
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPositionType('end')}
                className={`py-2 px-2 rounded-xl border text-xs font-semibold transition cursor-pointer text-center ${
                  positionType === 'end'
                    ? 'bg-purple-100 border-purple-500 text-purple-900 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                맨 뒤에 추가 (기본)
              </button>
              <button
                type="button"
                onClick={() => setPositionType('start')}
                className={`py-2 px-2 rounded-xl border text-xs font-semibold transition cursor-pointer text-center ${
                  positionType === 'start'
                    ? 'bg-purple-100 border-purple-500 text-purple-900 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                맨 처음에 추가
              </button>
              <button
                type="button"
                disabled={existingParentsForSection.length === 0}
                onClick={() => setPositionType('after')}
                className={`py-2 px-2 rounded-xl border text-xs font-semibold transition cursor-pointer text-center ${
                  existingParentsForSection.length === 0
                    ? 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-200 text-slate-400'
                    : positionType === 'after'
                    ? 'bg-purple-100 border-purple-500 text-purple-900 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                특정 Parent 다음
              </button>
            </div>

            {positionType === 'after' && existingParentsForSection.length > 0 && (
              <div className="pt-1.5 animate-in fade-in duration-150">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                  어느 Parent 바로 뒤에 삽입할까요?
                </label>
                <select
                  value={afterParentId}
                  onChange={(e) => {
                    const newAfterId = e.target.value;
                    setAfterParentId(newAfterId);
                    const refP = existingParentsForSection.find(
                      (p) => (p.parent_chunk_id || p.id) === newAfterId
                    );
                    if (refP?.page_range?.[0]) {
                      setPageNumber(refP.page_range[0]);
                    }
                  }}
                  className="w-full bg-purple-50/70 border border-purple-300 rounded-xl px-3 py-2 text-purple-950 font-medium text-xs focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                >
                  {existingParentsForSection.map((p, idx) => {
                    const pid = p.parent_chunk_id || p.id || '';
                    const shortId = pid.includes('_p') ? 'P' + pid.split('_p')[1] : pid;
                    return (
                      <option key={pid} value={pid}>
                        [{idx + 1}] [{shortId}] {p.title || (p.text ? p.text.trim().split('\n')[0].slice(0, 30) : '부모 문맥')}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>

          {/* Parent Title & Page Number */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="block font-semibold text-slate-700">
                Parent 제목 / 소제목 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (error) setError('');
                }}
                placeholder="예: 제3조 (용어의 정의), 2.2 운영 지침"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-slate-900 placeholder-slate-400 font-medium"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="block font-semibold text-slate-700 flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                페이지 번호
              </label>
              <input
                type="number"
                min="1"
                value={pageNumber}
                onChange={(e) => setPageNumber(parseInt(e.target.value, 10) || 1)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-slate-900 font-mono font-medium"
              />
            </div>
          </div>

          {/* Chunk Type Selector */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">청크 유형</label>
            <div className="flex items-center gap-2">
              {[
                { id: 'paragraph', label: '일반 문단 (Paragraph)' },
                { id: 'article_clause', label: '법률/조항 (Article)' },
                { id: 'table', label: '표/테이블 (Table)' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setChunkType(t.id as any)}
                  className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                    chunkType === t.id
                      ? 'bg-purple-50 border-purple-500 text-purple-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Initial Child Chunk Text */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-slate-700 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-purple-600" />
                누락된 본문 텍스트 (최초 Child 청크) <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] text-slate-400 font-mono">
                {childText.length}자
              </span>
            </div>
            <textarea
              rows={5}
              value={childText}
              onChange={(e) => {
                setChildText(e.target.value);
                if (error) setError('');
              }}
              placeholder="누락되었던 본문 내용을 여기에 입력하거나 붙여넣으세요. (이 내용이 부모 및 첫 번째 자식 청크의 본문이 됩니다)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 focus:bg-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 text-slate-900 placeholder-slate-400 font-sans leading-relaxed text-xs resize-y"
            />
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <HelpCircle className="w-3 h-3 shrink-0" />
              부모 청크 생성 시 최소 1개의 자식 청크가 필수이므로 함께 등록됩니다. 생성 후 자식을 추가할 수 있습니다.
            </p>
          </div>

          {/* Custom Metadata Inheritance Card */}
          {Object.keys(candidateCustomMetadata).length > 0 && (
            <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={inheritMetadata}
                    onChange={(e) => setInheritMetadata(e.target.checked)}
                    className="rounded border-purple-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                  <span className="font-semibold text-purple-900 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-purple-600" />
                    <span>기존 커스텀 메타데이터 자동 상속 ({Object.keys(candidateCustomMetadata).length}개)</span>
                  </span>
                </label>
                <span className="text-[10px] text-purple-600 font-medium">
                  페이지는 p.{pageNumber}로 유지
                </span>
              </div>

              {inheritMetadata ? (
                <div className="space-y-1.5 pt-1">
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {Object.entries(candidateCustomMetadata).map(([k, v]) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-1 text-[11px] bg-white text-slate-800 border border-purple-200 px-2 py-0.5 rounded-md font-mono"
                      >
                        <span className="font-semibold text-purple-700">{k}:</span>
                        <span className="text-slate-600 truncate max-w-[150px]">{String(v)}</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-purple-600/80">
                    ※ page_number, page_end 등 물리적 페이지 정보는 상속되지 않고 입력한 번호로 안전하게 생성됩니다.
                  </p>
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 italic">
                  자동 상속이 꺼져있어 빈 메타데이터(페이지 번호만 포함)로 등록됩니다.
                </p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Parent 생성</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

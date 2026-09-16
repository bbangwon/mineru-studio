import React, { useState, useEffect, useMemo } from 'react';
import { X, FolderPlus, HelpCircle, ArrowDownUp } from 'lucide-react';
import type { ParentSection, SectionInsertPosition } from '../types';

interface AddSectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentSections: ParentSection[];
  onAddSection: (sectionData: {
    title: string;
    parentSectionId?: string;
    level: number;
    insertPosition?: SectionInsertPosition;
  }) => void;
}

export const AddSectionModal: React.FC<AddSectionModalProps> = ({
  isOpen,
  onClose,
  parentSections,
  onAddSection,
}) => {
  const [title, setTitle] = useState('');
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [positionType, setPositionType] = useState<'end' | 'start' | 'after'>('end');
  const [afterSectionId, setAfterSectionId] = useState<string>('');
  const [level, setLevel] = useState<number>(1);
  const [error, setError] = useState<string>('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setSelectedParentId('');
      setPositionType('end');
      setAfterSectionId(parentSections.length > 0 ? parentSections[parentSections.length - 1].id : '');
      setLevel(1);
      setError('');
    }
  }, [isOpen, parentSections]);

  // 후보 섹션 목록 (동일 상위 섹션을 공유하는 섹션 또는 전체)
  const candidateSectionsForAfter = useMemo(() => {
    if (selectedParentId) {
      return parentSections.filter((s) => s.parent_section_id === selectedParentId);
    }
    return parentSections.filter((s) => !s.parent_section_id || s.level <= 1);
  }, [parentSections, selectedParentId]);

  // Automatically update level based on selected parent section
  const handleParentChange = (parentId: string) => {
    setSelectedParentId(parentId);
    if (!parentId) {
      setLevel(1);
    } else {
      const parent = parentSections.find((s) => s.id === parentId);
      if (parent) {
        setLevel(Math.min(5, parent.level + 1));
      }
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('섹션 제목을 입력해주세요.');
      return;
    }

    let insertPosition: SectionInsertPosition = { type: 'end' };
    if (positionType === 'start') {
      insertPosition = { type: 'start' };
    } else if (positionType === 'after' && afterSectionId) {
      insertPosition = { type: 'after', sectionId: afterSectionId };
    }

    onAddSection({
      title: trimmedTitle,
      parentSectionId: selectedParentId || undefined,
      level,
      insertPosition,
    });

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">새 섹션 추가</h3>
              <p className="text-xs text-slate-500">
                문서 계층 구조에 새로운 부모 섹션을 생성합니다.
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
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-medium">
              {error}
            </div>
          )}

          {/* Section Title */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">
              섹션 제목 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError('');
              }}
              placeholder="예: 제3조 (적용범위), 2.2 핵심 요구사항"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 placeholder-slate-400 font-medium"
              autoFocus
            />
          </div>

          {/* Parent Section Dropdown */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-slate-700">
                상위 섹션 지정 (선택)
              </label>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                적용 계층: H{level} {level === 1 ? '(대분류)' : level === 2 ? '(중분류)' : level === 3 ? '(소분류)' : `(깊이 ${level})`}
              </span>
            </div>
            <select
              value={selectedParentId}
              onChange={(e) => handleParentChange(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-medium cursor-pointer"
            >
              <option value="">-- 최상위 (루트 계층, H1 생성) --</option>
              {parentSections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.breadcrumbs && sec.breadcrumbs.length > 0
                    ? sec.breadcrumbs.join(' > ')
                    : sec.title} (H{sec.level})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
              <HelpCircle className="w-3 h-3 shrink-0" />
              상위 섹션을 지정하면 계층 트리(H{level})와 브레드크럼이 자동으로 구성됩니다.
            </p>
          </div>

          {/* Insertion Position */}
          <div className="space-y-2 pt-1 border-t border-slate-100">
            <label className="block font-semibold text-slate-700 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ArrowDownUp className="w-3.5 h-3.5 text-indigo-600" />
                삽입 위치
              </span>
              <span className="text-[11px] font-normal text-slate-400">
                문서 목록 상의 배치 순서
              </span>
            </label>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPositionType('end')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-semibold transition cursor-pointer text-center ${
                  positionType === 'end'
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                맨 뒤에 추가
              </button>
              <button
                type="button"
                onClick={() => setPositionType('start')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-semibold transition cursor-pointer text-center ${
                  positionType === 'start'
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                맨 앞에 추가
              </button>
              <button
                type="button"
                onClick={() => setPositionType('after')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-semibold transition cursor-pointer text-center ${
                  positionType === 'after'
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-2xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                특정 섹션 뒤
              </button>
            </div>

            {positionType === 'after' && (
              <div className="pt-1.5 space-y-1">
                <label className="block text-[11px] font-medium text-slate-500">
                  기준이 될 이전 섹션 선택:
                </label>
                <select
                  value={afterSectionId}
                  onChange={(e) => setAfterSectionId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 font-medium cursor-pointer"
                >
                  {candidateSectionsForAfter.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {sec.title} ({sec.id})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

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
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition cursor-pointer"
            >
              섹션 생성
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

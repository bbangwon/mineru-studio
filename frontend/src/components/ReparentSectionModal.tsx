import React, { useState, useEffect, useMemo } from 'react';
import { X, FolderTree, CornerDownRight, Check } from 'lucide-react';
import type { ParentSection } from '../types';

interface ReparentSectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetSection: ParentSection | null;
  parentSections: ParentSection[];
  onReparent: (sectionId: string, newParentSectionId: string | null) => void;
}

export const ReparentSectionModal: React.FC<ReparentSectionModalProps> = ({
  isOpen,
  onClose,
  targetSection,
  parentSections,
  onReparent,
}) => {
  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [error, setError] = useState<string>('');

  // 루트 섹션 찾기
  const rootSection = useMemo(() => {
    return parentSections.find(
      (s) => s.level === 0 || s.id.endsWith('_s00') || s.id.endsWith('_root')
    );
  }, [parentSections]);

  // 대상 섹션의 모든 하위 자손(Descendant) ID 집합 계산 (순환 참조 방지)
  const descendantIds = useMemo(() => {
    if (!targetSection) return new Set<string>();
    const ids = new Set<string>([targetSection.id]);
    let added = true;
    while (added) {
      added = false;
      for (const s of parentSections) {
        if (s.parent_section_id && ids.has(s.parent_section_id) && !ids.has(s.id)) {
          ids.add(s.id);
          added = true;
        }
      }
    }
    return ids;
  }, [targetSection, parentSections]);

  // 모달이 열릴 때 선택값 초기화
  useEffect(() => {
    if (isOpen && targetSection) {
      setSelectedParentId(targetSection.parent_section_id || (rootSection?.id ?? ''));
      setError('');
    }
  }, [isOpen, targetSection, rootSection]);

  if (!isOpen || !targetSection) return null;

  const currentParentId = targetSection.parent_section_id || (rootSection?.id ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedParentId === currentParentId) {
      setError('이미 현재 상위 섹션으로 지정되어 있습니다.');
      return;
    }

    if (descendantIds.has(selectedParentId)) {
      setError('자기 자신이나 하위 자손 섹션을 상위 섹션으로 지정할 수 없습니다.');
      return;
    }

    const newParentId =
      selectedParentId === rootSection?.id || !selectedParentId
        ? null
        : selectedParentId;

    onReparent(targetSection.id, newParentId);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl text-indigo-600 dark:text-indigo-400">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base">
                상위 섹션 변경 (계층 이동)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                섹션을 다른 상위 섹션의 하위로 편입하거나 최상위로 승격합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 text-xs bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 rounded-xl">
              {error}
            </div>
          )}

          {/* 대상 섹션 정보 */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/70 dark:border-slate-700/60 space-y-1">
            <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
              이동할 대상 섹션
            </div>
            <div className="flex items-center gap-2 font-semibold text-sm text-slate-800 dark:text-slate-200">
              <span className="px-1.5 py-0.5 text-[10px] font-mono bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 rounded">
                Level {targetSection.level}
              </span>
              <span className="truncate">{targetSection.title}</span>
            </div>
            {targetSection.breadcrumbs && targetSection.breadcrumbs.length > 0 && (
              <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                현재 경로: {targetSection.breadcrumbs.join(' > ')}
              </div>
            )}
          </div>

          {/* 새 상위 섹션 선택 */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              새 상위(부모) 섹션 선택
            </label>
            <select
              value={selectedParentId}
              onChange={(e) => {
                setSelectedParentId(e.target.value);
                setError('');
              }}
              className="w-full text-xs px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
              size={8}
            >
              {/* 최상위 승격 옵션 */}
              <option
                value={rootSection?.id || ''}
                className="py-1 font-semibold text-indigo-600 dark:text-indigo-400"
              >
                🏠 [문서 루트] 최상위 계층 (Level 1)으로 승격
              </option>

              {/* 각 섹션 목록 */}
              {parentSections
                .filter((s) => s.level !== 0 && !s.id.endsWith('_s00') && !s.id.endsWith('_root'))
                .map((sec) => {
                  const isSelfOrDescendant = descendantIds.has(sec.id);
                  const isCurrent = sec.id === currentParentId;
                  const indent = '　'.repeat(Math.max(0, sec.level - 1));

                  return (
                    <option
                      key={sec.id}
                      value={sec.id}
                      disabled={isSelfOrDescendant}
                      className={`py-1 ${
                        isSelfOrDescendant
                          ? 'text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-900/50'
                          : isCurrent
                          ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {indent}ㄴ {sec.title}
                      {isCurrent ? ' (현재 상위)' : ''}
                      {isSelfOrDescendant ? ' (이동 불가: 자기자신/자손)' : ''}
                    </option>
                  );
                })}
            </select>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              * 자기 자신과 그 하위 자손 섹션은 순환 참조 방지를 위해 선택할 수 없습니다.
            </p>
          </div>

          {/* 변경 예고 안내 */}
          {selectedParentId && selectedParentId !== currentParentId && (
            <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 rounded-xl space-y-1 text-xs text-indigo-900 dark:text-indigo-200">
              <div className="flex items-center gap-1.5 font-semibold text-indigo-700 dark:text-indigo-300">
                <CornerDownRight className="w-3.5 h-3.5" />
                <span>계층 이동 미리보기</span>
              </div>
              <div className="text-[11px] text-indigo-600 dark:text-indigo-400">
                {selectedParentId === (rootSection?.id || '') ? (
                  <span>최상위 섹션(Level 1)으로 승격되며, 하위 섹션 및 청크의 브레드크럼이 자동 갱신됩니다.</span>
                ) : (
                  <span>
                    선택한 섹션의 하위 섹션(Level +1)으로 이동하며, 하위 섹션 및 청크의 브레드크럼이 연쇄 동기화됩니다.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Modal Footer */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={selectedParentId === currentParentId || descendantIds.has(selectedParentId)}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              상위 섹션 변경 적용
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

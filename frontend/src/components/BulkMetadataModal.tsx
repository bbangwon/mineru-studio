import React, { useState } from 'react';
import {
  X,
  Tag,
  Layers,
  Sparkles,
  Trash2,
  Check,
  AlertCircle,
  FolderTree,
  FileText,
  Copy,
} from 'lucide-react';
import { RESERVED_METADATA_KEYS } from '../utils/pageUtils';

interface BulkMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalChunksCount: number;
  currentSectionId?: string;
  currentSectionTitle?: string;
  currentSectionChunksCount: number;
  activeChunkId?: string;
  activeChunkMetadata?: Record<string, any>;
  existingDocCustomKeys: string[];
  onApply: (params: {
    mode: 'add_tag' | 'apply_batch' | 'delete_tag';
    key?: string;
    value?: any;
    tags?: Record<string, any>;
    scope: 'all' | 'section';
    sectionId?: string;
    overwrite?: boolean;
  }) => void;
}

type TabMode = 'add' | 'propagate' | 'delete';

const PRESET_KEYS = [
  'doc_category',
  'department',
  'doc_type',
  'year',
  'security_level',
  'source',
  'version',
  'author',
];

export const BulkMetadataModal: React.FC<BulkMetadataModalProps> = ({
  isOpen,
  onClose,
  totalChunksCount,
  currentSectionId,
  currentSectionTitle,
  currentSectionChunksCount,
  activeChunkId,
  activeChunkMetadata = {},
  existingDocCustomKeys,
  onApply,
}) => {
  const [activeTab, setActiveTab] = useState<TabMode>('add');
  const [scope, setScope] = useState<'all' | 'section'>('all');
  const [overwrite, setOverwrite] = useState(true);

  // Tab 1: Single Tag Add State
  const [tagKey, setTagKey] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);

  // Tab 2: Propagate State
  const activeCustomEntries = Object.entries(activeChunkMetadata).filter(
    ([k]) => !RESERVED_METADATA_KEYS.has(k)
  );
  const [selectedPropagateKeys, setSelectedPropagateKeys] = useState<string[]>(
    activeCustomEntries.map(([k]) => k)
  );

  // Tab 3: Delete State
  const [deleteKey, setDeleteKey] = useState<string>('');

  if (!isOpen) return null;

  const targetCount =
    scope === 'all'
      ? totalChunksCount
      : currentSectionId
      ? currentSectionChunksCount
      : 0;

  // Handle Tab 1: Add Tag
  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = tagKey.trim();
    if (!trimmedKey) {
      setKeyError('메타데이터 키를 입력해주세요.');
      return;
    }
    if (RESERVED_METADATA_KEYS.has(trimmedKey)) {
      setKeyError(`'${trimmedKey}'는 시스템 예약어이므로 사용할 수 없습니다.`);
      return;
    }
    setKeyError(null);

    onApply({
      mode: 'add_tag',
      key: trimmedKey,
      value: tagValue.trim(),
      scope,
      sectionId: currentSectionId,
      overwrite,
    });
    onClose();
  };

  // Handle Tab 2: Propagate Tags
  const handlePropagateSubmit = () => {
    if (selectedPropagateKeys.length === 0) return;
    const tagsToApply: Record<string, any> = {};
    for (const k of selectedPropagateKeys) {
      if (k in activeChunkMetadata) {
        tagsToApply[k] = activeChunkMetadata[k];
      }
    }

    onApply({
      mode: 'apply_batch',
      tags: tagsToApply,
      scope,
      sectionId: currentSectionId,
      overwrite,
    });
    onClose();
  };

  // Handle Tab 3: Delete Tag
  const handleDeleteSubmit = () => {
    if (!deleteKey) return;
    onApply({
      mode: 'delete_tag',
      key: deleteKey,
      scope,
      sectionId: currentSectionId,
    });
    onClose();
  };

  const togglePropagateKey = (k: string) => {
    setSelectedPropagateKeys((prev) =>
      prev.includes(k) ? prev.filter((item) => item !== k) : [...prev, k]
    );
  };

  const toggleAllPropagateKeys = () => {
    if (selectedPropagateKeys.length === activeCustomEntries.length) {
      setSelectedPropagateKeys([]);
    } else {
      setSelectedPropagateKeys(activeCustomEntries.map(([k]) => k));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                임베딩 커스텀 메타데이터 일괄 관리
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                문서 전체 또는 특정 섹션 청크들에 메타데이터를 일괄 추가/전파/삭제합니다.
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

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Scope Selector */}
          <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <span>적용 대상 범위</span>
              <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded">
                {targetCount}개 청크
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label
                className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium cursor-pointer transition ${
                  scope === 'all'
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <FileText className="w-3.5 h-3.5 text-indigo-500" />
                <span>문서 전체 청크 ({totalChunksCount}개)</span>
              </label>

              <label
                className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium cursor-pointer transition ${
                  !currentSectionId ? 'opacity-40 cursor-not-allowed' : ''
                } ${
                  scope === 'section'
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'section'}
                  disabled={!currentSectionId}
                  onChange={() => setScope('section')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <FolderTree className="w-3.5 h-3.5 text-indigo-500" />
                <span className="truncate">
                  {currentSectionTitle
                    ? `선택 섹션 (${currentSectionChunksCount}개)`
                    : '선택 섹션 없음'}
                </span>
              </label>
            </div>
          </div>

          {/* Mode Navigation Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('add')}
              className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'add'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>새 태그 일괄 추가</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('propagate')}
              className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'propagate'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>현재 청크 태그 전파</span>
              {activeCustomEntries.length > 0 && (
                <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.2 rounded-full font-mono">
                  {activeCustomEntries.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('delete')}
              className={`pb-2.5 px-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'delete'
                  ? 'border-rose-600 text-rose-600 dark:text-rose-400 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>일괄 삭제</span>
            </button>
          </div>

          {/* Tab 1: Add Tag Form */}
          {activeTab === 'add' && (
            <form onSubmit={handleAddSubmit} className="space-y-4">
              {/* Preset Key Recommendation Chips */}
              <div>
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span>추천 메타데이터 키 빠른 선택:</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setTagKey(k);
                        setKeyError(null);
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded-md border font-mono transition cursor-pointer ${
                        tagKey === k
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>

              {/* Key & Value Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    메타데이터 키 (Key) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={tagKey}
                    onChange={(e) => {
                      setTagKey(e.target.value);
                      setKeyError(null);
                    }}
                    placeholder="예: doc_category"
                    className="w-full text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden font-mono"
                  />
                  {keyError && (
                    <p className="text-[11px] text-rose-500 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {keyError}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    메타데이터 값 (Value)
                  </label>
                  <input
                    type="text"
                    value={tagValue}
                    onChange={(e) => setTagValue(e.target.value)}
                    placeholder="예: 인사규정"
                    className="w-full text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Overwrite Checkbox */}
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                <span>기존 청크에 동일한 키가 있는 경우 새 값으로 덮어쓰기</span>
              </label>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={!tagKey.trim()}
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{targetCount}개 청크에 일괄 추가</span>
                </button>
              </div>
            </form>
          )}

          {/* Tab 2: Propagate Current Chunk Tags */}
          {activeTab === 'propagate' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  현재 청크(<span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{activeChunkId || '선택 없음'}</span>)의 커스텀 태그를 다른 청크들에 복제합니다.
                </div>
                {activeCustomEntries.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAllPropagateKeys}
                    className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                  >
                    {selectedPropagateKeys.length === activeCustomEntries.length
                      ? '전체 해제'
                      : '전체 선택'}
                  </button>
                )}
              </div>

              {activeCustomEntries.length === 0 ? (
                <div className="p-6 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                  현재 선택된 청크에 복제할 커스텀 메타데이터 태그가 없습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50 dark:bg-slate-950/40">
                    {activeCustomEntries.map(([k, v]) => {
                      const isChecked = selectedPropagateKeys.includes(k);
                      return (
                        <label
                          key={k}
                          onClick={() => togglePropagateKey(k)}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${
                            isChecked
                              ? 'bg-indigo-50/80 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800'
                              : 'bg-white dark:bg-slate-900 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                            />
                            <span className="text-xs font-mono font-bold text-indigo-700 dark:text-indigo-400">
                              {k}:
                            </span>
                            <span className="text-xs text-slate-700 dark:text-slate-300">
                              {String(v)}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                    />
                    <span>기존 청크에 동일한 키가 있는 경우 새 값으로 덮어쓰기</span>
                  </label>
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handlePropagateSubmit}
                  disabled={selectedPropagateKeys.length === 0}
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{selectedPropagateKeys.length}개 태그를 {targetCount}개 청크에 전파</span>
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: Bulk Delete Form */}
          {activeTab === 'delete' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-600 dark:text-slate-400">
                문서 내 청크들에 존재하는 특정 메타데이터 키를 대상 범위에서 일괄 삭제합니다.
              </div>

              {existingDocCustomKeys.length === 0 ? (
                <div className="p-6 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                  문서 전체에 등록된 커스텀 메타데이터 키가 없습니다.
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    삭제할 메타데이터 키 선택
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950/40">
                    {existingDocCustomKeys.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setDeleteKey(k)}
                        className={`text-xs px-2.5 py-1 rounded-lg border font-mono transition cursor-pointer flex items-center gap-1.5 ${
                          deleteKey === k
                            ? 'bg-rose-600 text-white border-rose-600 shadow-2xs font-bold'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-rose-400'
                        }`}
                      >
                        <span>{k}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {deleteKey && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2 animate-in fade-in duration-100">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  <div>
                    <span className="font-bold">주의:</span> 선택한 대상 범위({targetCount}개 청크)에서 <span className="font-mono font-bold">'{deleteKey}'</span> 메타데이터가 영구 삭제됩니다.
                  </div>
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSubmit}
                  disabled={!deleteKey}
                  className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>'{deleteKey}' 일괄 삭제</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

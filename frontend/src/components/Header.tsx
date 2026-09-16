import React, { useState, useRef, useEffect } from 'react';
import {
  Download,
  Cpu,
  Save,
  RotateCcw,
  Loader2,
  LayoutDashboard,
  SlidersHorizontal,
  FileText,
  ListOrdered,
  Database,
  Search,
  Zap,
  Bot,
  Menu,
  MoreVertical,
  Archive,
} from 'lucide-react';
import type { ActiveTab } from './SidebarNav';
import { ThemeToggle } from './ThemeToggle';
import type { ThemeMode } from '../utils/useTheme';

interface HeaderProps {
  hasData: boolean;
  activeTab?: ActiveTab;
  activePdf?: string;
  isDirty?: boolean;
  isSaving?: boolean;
  isResetting?: boolean;
  isIndexingQdrant?: boolean;
  qdrantIndexProgress?: { msg: string; pct: number } | null;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  onSave?: () => void;
  onReset?: () => void;
  onReindex?: () => void;
  onOpenLLMConfig?: () => void;
  onOpenQdrantConfig?: () => void;
  onIndexQdrant?: () => void;
  onOpenBackup?: () => void;
  onToggleSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  hasData,
  activeTab = 'dashboard',
  activePdf,
  isDirty = false,
  isSaving = false,
  isResetting = false,
  isIndexingQdrant = false,
  qdrantIndexProgress = null,
  theme,
  setTheme,
  onSave,
  onReset,
  onReindex,
  onOpenLLMConfig,
  onOpenQdrantConfig,
  onIndexQdrant,
  onOpenBackup,
  onToggleSidebar,
}) => {
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    if (isMoreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoreMenuOpen]);
  return (
    <header className="bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-2xs backdrop-blur-md transition-colors">
      <div className="w-full px-3 sm:px-5 h-16 flex items-center justify-between gap-2 sm:gap-3">
        {/* Left: Mobile Menu Toggle & Active Tab Badge & Current PDF name */}
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          {/* Mobile hamburger menu button */}
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="md:hidden p-2 -ml-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="메뉴 열기"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors shrink-0 ${
                activeTab === 'studio'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                  : activeTab === 'search'
                  ? 'bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300'
                  : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {activeTab === 'studio' ? (
                <>
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="hidden sm:inline">청크 에디터 스튜디오</span>
                  <span className="sm:hidden">스튜디오</span>
                </>
              ) : activeTab === 'search' ? (
                <>
                  <Search className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                  <span className="hidden sm:inline">하이브리드 검색</span>
                  <span className="sm:hidden">검색</span>
                </>
              ) : (
                <>
                  <LayoutDashboard className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                  <span className="hidden sm:inline">파싱 대시보드</span>
                  <span className="sm:hidden">대시보드</span>
                </>
              )}
            </span>

            {activePdf && (
              <span
                className="hidden lg:inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 max-w-xs truncate"
                title={activePdf}
              >
                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{activePdf}</span>
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions and Theme Switcher */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
          <span className="hidden 2xl:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
            <span className="w-2 h-2 mr-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <Cpu className="w-3.5 h-3.5 mr-1" />
            Apple Silicon Metal
          </span>

          {/* Desktop-only: Reindex IDs Button */}
          {hasData && onReindex && (
            <button
              type="button"
              onClick={onReindex}
              disabled={isResetting || isSaving}
              className="hidden xl:inline-flex text-xs font-semibold px-2.5 py-2 rounded-xl transition border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
              title="전체 섹션(s00~)과 청크(c0001~) ID를 문서 순서 및 128-bit 고유 규격으로 일괄 재정렬"
            >
              <ListOrdered className="w-3.5 h-3.5 text-indigo-500" />
              <span>ID 재정렬</span>
            </button>
          )}

          {/* Desktop-only: Reset to Original Button */}
          {hasData && onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={isResetting || isSaving}
              className="hidden xl:inline-flex text-xs font-semibold px-2.5 py-2 rounded-xl transition border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
              title="수정본을 삭제하고 원본 파싱 결과로 복원"
            >
              {isResetting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>초기화</span>
            </button>
          )}

          {/* Save Edited Result Button (Always Visible) */}
          {hasData && onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving || isResetting}
              className={`text-xs font-semibold px-3 sm:px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                isDirty
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              } disabled:opacity-50`}
              title="현재 수정한 청크 및 섹션 데이터를 백엔드에 영속 저장"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span className="font-bold">{isDirty ? '저장*' : '저장'}</span>
            </button>
          )}

          {/* Qdrant Indexing Button (Always Visible) */}
          {hasData && onIndexQdrant && (
            <button
              type="button"
              onClick={onIndexQdrant}
              disabled={isIndexingQdrant || isSaving || isResetting}
              className={`text-xs font-semibold px-2.5 sm:px-3 py-2 rounded-xl transition border flex items-center gap-1.5 cursor-pointer shadow-2xs ${
                isIndexingQdrant
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400 animate-pulse'
                  : 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300'
              } disabled:opacity-50`}
              title="현재 청크 데이터를 Dense(BGE-M3) & Sparse(Kiwi+IDF)로 인코딩하여 Qdrant에 색인"
            >
              {isIndexingQdrant ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                  <span className="hidden sm:inline">
                    색인 중{qdrantIndexProgress ? ` (${qdrantIndexProgress.pct}%)` : '...'}
                  </span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="hidden sm:inline">Qdrant 색인</span>
                </>
              )}
            </button>
          )}

          {/* Desktop-only: LLM Config Modal Button */}
          {onOpenLLMConfig && (
            <button
              type="button"
              onClick={onOpenLLMConfig}
              className="hidden xl:inline-flex text-xs font-semibold px-2.5 py-2 rounded-xl transition border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 items-center gap-1.5 cursor-pointer shadow-2xs"
              title="로컬 LLM 기반 텍스트 자동 교정 및 OpenAI 호환 설정"
            >
              <Bot className="w-3.5 h-3.5 text-indigo-500" />
              <span>LLM 설정</span>
            </button>
          )}

          {/* Desktop-only: Qdrant Config Modal Button */}
          {onOpenQdrantConfig && (
            <button
              type="button"
              onClick={onOpenQdrantConfig}
              className="hidden xl:inline-flex text-xs font-semibold px-2.5 py-2 rounded-xl transition border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 items-center gap-1 cursor-pointer shadow-2xs"
              title="Qdrant 연결 및 컬렉션 설정"
            >
              <Database className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>Qdrant 설정</span>
            </button>
          )}

          {/* Desktop-only: Backup & Restore Button */}
          {onOpenBackup && (
            <button
              type="button"
              onClick={onOpenBackup}
              className="hidden xl:inline-flex text-xs font-semibold px-2.5 py-2 rounded-xl transition border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 items-center gap-1.5 cursor-pointer shadow-2xs"
              title="작업공간 및 데이터 스냅샷 백업 & 원복"
            >
              <Archive className="w-3.5 h-3.5 text-indigo-500" />
              <span>백업/원복</span>
            </button>
          )}

          {/* Desktop-only: Download JSONL Button */}
          <a
            href="/api/etl/export/jsonl"
            download="rag_chunks.jsonl"
            className={`hidden xl:inline-flex text-xs font-semibold px-2.5 py-2 rounded-xl transition shadow-2xs items-center gap-1.5 border ${
              hasData
                ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                : 'bg-slate-100 dark:bg-slate-800/40 border-transparent text-slate-400 dark:text-slate-600 pointer-events-none'
            }`}
            title="RAG 표준 JSONL 파일 다운로드"
          >
            <Download className="w-3.5 h-3.5" />
            <span>JSONL</span>
          </a>

          {/* Responsive Dropdown Menu for Smaller Screens (< xl) */}
          <div className="relative xl:hidden" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors shadow-2xs cursor-pointer"
              title="더보기 메뉴 (도구 및 설정)"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {isMoreMenuOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-150">
                {activePdf && (
                  <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    <span className="font-semibold block text-slate-700 dark:text-slate-300">작업 문서</span>
                    <span className="truncate block font-mono">{activePdf}</span>
                  </div>
                )}

                {hasData && onReindex && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      onReindex();
                    }}
                    disabled={isResetting || isSaving}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                  >
                    <ListOrdered className="w-4 h-4 text-indigo-500" />
                    <span>ID 일괄 재정렬</span>
                  </button>
                )}

                {hasData && onReset && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      onReset();
                    }}
                    disabled={isResetting || isSaving}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-4 h-4 text-slate-500" />
                    <span>원본으로 복원 (초기화)</span>
                  </button>
                )}

                {onOpenLLMConfig && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      onOpenLLMConfig();
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <Bot className="w-4 h-4 text-indigo-500" />
                    <span>로컬 LLM 설정</span>
                  </button>
                )}

                {onOpenQdrantConfig && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      onOpenQdrantConfig();
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <Database className="w-4 h-4 text-slate-500" />
                    <span>Qdrant DB 설정</span>
                  </button>
                )}

                {onOpenBackup && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      onOpenBackup();
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <Archive className="w-4 h-4 text-indigo-500" />
                    <span>백업 & 원복 관리</span>
                  </button>
                )}

                {hasData && (
                  <a
                    href="/api/etl/export/jsonl"
                    download="rag_chunks.jsonl"
                    onClick={() => setIsMoreMenuOpen(false)}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-slate-500" />
                    <span>RAG JSONL 다운로드</span>
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Theme Switcher in Header */}
          <div className="pl-1 border-l border-slate-200 dark:border-slate-800">
            <ThemeToggle theme={theme} setTheme={setTheme} compact />
          </div>
        </div>
      </div>
    </header>
  );
};

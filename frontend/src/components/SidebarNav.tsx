import React from 'react';
import {
  LayoutDashboard,
  SlidersHorizontal,
  FileCode2,
  Sparkles,
  Layers,
  CheckCircle2,
  FileText,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Archive,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import type { ThemeMode } from '../utils/useTheme';

export type ActiveTab = 'dashboard' | 'studio' | 'search';

interface SidebarNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  totalChunks: number;
  editedChunksCount: number;
  ignoredChunksCount: number;
  isDirty: boolean;
  activePdf?: string;
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  onOpenBackupModal?: () => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeTab,
  setActiveTab,
  totalChunks,
  editedChunksCount,
  ignoredChunksCount,
  isDirty,
  activePdf,
  theme,
  setTheme,
  isCollapsed = false,
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile,
  onOpenBackupModal,
}) => {
  const handleTabClick = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs md:hidden animate-in fade-in duration-200"
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 ${
          isCollapsed ? 'w-16' : 'w-60'
        } bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 flex flex-col shrink-0 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 select-none ${
          isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Top Brand Header */}
        <div className="h-16 px-3.5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            {!isCollapsed && (
              <div className="overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-slate-900 dark:text-white tracking-tight">MinerU</span>
                  <span className="text-[10px] px-1.5 py-0.2 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-mono rounded border border-indigo-500/30">
                    v2.0
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">RAG 파이프라인</p>
              </div>
            )}
          </div>

          {/* Desktop Collapse Toggle / Mobile Close */}
          <div className="flex items-center">
            {/* Mobile close button */}
            <button
              type="button"
              onClick={onCloseMobile}
              className="md:hidden p-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg cursor-pointer"
              title="사이드바 닫기"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Desktop collapse button */}
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="hidden md:flex p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title={isCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
              >
                {isCollapsed ? (
                  <PanelLeftOpen className="w-4 h-4 text-indigo-500" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

      {/* Navigation Links */}
      <div className="p-2.5 space-y-1.5 flex-1 overflow-y-auto">
        {!isCollapsed && (
          <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            워크스페이스
          </div>
        )}

        {/* Dashboard Tab */}
        <button
          type="button"
          onClick={() => handleTabClick('dashboard')}
          className={`w-full flex items-center ${
            isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
          } rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'dashboard'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25 font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
          }`}
          title="대시보드 (문서 ETL 파이프라인 현황)"
        >
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          {!isCollapsed && (
            <div className="flex flex-1 items-center justify-between">
              <span>대시보드</span>
              <span className="text-[10px] opacity-70 font-normal">파이프라인</span>
            </div>
          )}
        </button>

        {/* Chunk Studio Tab */}
        <button
          type="button"
          onClick={() => handleTabClick('studio')}
          className={`w-full flex items-center ${
            isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
          } rounded-xl text-xs font-semibold transition-all cursor-pointer relative ${
            activeTab === 'studio'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25 font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
          }`}
          title="청크 스튜디오 (3단 계층 & 청크 에디터)"
        >
          <div className="relative">
            <SlidersHorizontal className="w-4 h-4 shrink-0" />
            {isDirty && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full animate-ping" />
            )}
          </div>
          {!isCollapsed && (
            <div className="flex flex-1 items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span>청크 스튜디오</span>
                {isDirty && (
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" title="저장되지 않은 변경사항" />
                )}
              </div>
              {totalChunks > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                    activeTab === 'studio'
                      ? 'bg-indigo-700 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {totalChunks}
                </span>
              )}
            </div>
          )}
        </button>

        {/* Hybrid Search Playground Tab */}
        <button
          type="button"
          onClick={() => handleTabClick('search')}
          className={`w-full flex items-center ${
            isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
          } rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeTab === 'search'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25 font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
          }`}
          title="하이브리드 검색 플레이그라운드 (Qdrant RRF)"
        >
          <Search className="w-4 h-4 shrink-0" />
          {!isCollapsed && (
            <div className="flex flex-1 items-center justify-between">
              <span>하이브리드 검색</span>
              <span className="text-[10px] bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 px-1 py-0.2 rounded font-medium">RRF</span>
            </div>
          )}
        </button>

        {/* Backup & Restore Action Button */}
        {onOpenBackupModal && (
          <button
            type="button"
            onClick={() => {
              onOpenBackupModal();
              if (onCloseMobile) onCloseMobile();
            }}
            className={`w-full flex items-center ${
              isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
            } rounded-xl text-xs font-semibold transition-all cursor-pointer text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40`}
            title="작업공간 및 데이터 백업 & 원복 관리"
          >
            <Archive className="w-4 h-4 text-indigo-500 shrink-0" />
            {!isCollapsed && (
              <div className="flex flex-1 items-center justify-between">
                <span>백업 & 원복</span>
                <span className="text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 px-1 py-0.2 rounded font-medium">
                  Snapshot
                </span>
              </div>
            )}
          </button>
        )}

        {/* Section Divider & Statistics */}
        {!isCollapsed && (
          <div className="pt-4">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              임베딩 통계
            </div>
            <div className="px-2.5 py-2 space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                  전체 청크
                </span>
                <span className="font-mono text-slate-900 dark:text-slate-200 font-semibold">{totalChunks}</span>
              </div>

              <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" />
                  수정된 청크
                </span>
                <span className="font-mono text-amber-600 dark:text-amber-400 font-semibold">{editedChunksCount}</span>
              </div>

              <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <FileCode2 className="w-3.5 h-3.5 text-rose-500" />
                  임베딩 제외
                </span>
                <span className="font-mono text-rose-600 dark:text-rose-400 font-semibold">{ignoredChunksCount}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Footer: Theme Switcher & Active PDF Status */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-950/40 space-y-3 shrink-0">
        {!isCollapsed ? (
          <>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
                화면 테마
              </div>
              <ThemeToggle theme={theme} setTheme={setTheme} />
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                <FileText className="w-3.5 h-3.5 text-indigo-500" />
                <span>현재 작업 문서</span>
              </div>
              <p className="text-xs text-slate-900 dark:text-slate-200 truncate font-medium" title={activePdf || '문서 미선택'}>
                {activePdf || '문서 미선택'}
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <ThemeToggle theme={theme} setTheme={setTheme} compact />
            {activePdf && (
              <div title={activePdf}>
                <FileText className="w-4 h-4 text-indigo-500" />
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
    </>
  );
};

export default SidebarNav;

import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import type { ThemeMode } from '../utils/useTheme';

interface ThemeToggleProps {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, setTheme, compact = false }) => {
  if (compact) {
    // 사이드바 축소 모드 또는 헤더 툴바용 원클릭 순환 토글 버튼
    const nextTheme: ThemeMode = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    const label = theme === 'light' ? '라이트 모드' : theme === 'dark' ? '다크 모드' : '시스템 설정 동기화';

    return (
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition border border-slate-200 dark:border-slate-700 cursor-pointer shadow-2xs"
        title={`테마 전환: ${label} (클릭하여 변경)`}
      >
        {theme === 'light' && <Sun className="w-4 h-4 text-amber-500" />}
        {theme === 'dark' && <Moon className="w-4 h-4 text-indigo-400" />}
        {theme === 'system' && <Monitor className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
      </button>
    );
  }

  return (
    <div className="flex items-center p-1 bg-slate-200/70 dark:bg-slate-800/80 rounded-xl border border-slate-300/60 dark:border-slate-700/60">
      <button
        type="button"
        onClick={() => setTheme('light')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
          theme === 'light'
            ? 'bg-white text-slate-900 shadow-2xs font-semibold'
            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
        title="라이트 모드"
      >
        <Sun className={`w-3.5 h-3.5 ${theme === 'light' ? 'text-amber-500' : ''}`} />
        <span className="hidden sm:inline">라이트</span>
      </button>

      <button
        type="button"
        onClick={() => setTheme('dark')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
          theme === 'dark'
            ? 'bg-slate-900 text-white shadow-2xs font-semibold'
            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
        title="다크 모드"
      >
        <Moon className={`w-3.5 h-3.5 ${theme === 'dark' ? 'text-indigo-400' : ''}`} />
        <span className="hidden sm:inline">다크</span>
      </button>

      <button
        type="button"
        onClick={() => setTheme('system')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
          theme === 'system'
            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-2xs font-semibold'
            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
        title="시스템 설정 자동 동기화"
      >
        <Monitor className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">자동</span>
      </button>
    </div>
  );
};

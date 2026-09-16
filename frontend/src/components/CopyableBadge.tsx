import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  copyToClipboard,
  formatDisplayChunkId,
  formatDisplayParentId,
  formatDisplaySectionId,
  formatDisplayId,
} from '../utils/idUtils';

export interface CopyableBadgeProps {
  id?: string | null;
  displayId?: string;
  type?: 'chunk' | 'parent' | 'section' | 'generic';
  prefix?: string;
  suffix?: string;
  className?: string;
  showIcon?: boolean;
  titlePrefix?: string;
}

export const CopyableBadge: React.FC<CopyableBadgeProps> = ({
  id,
  displayId,
  type = 'generic',
  prefix,
  suffix,
  className = '',
  showIcon = true,
  titlePrefix,
}) => {
  const [copied, setCopied] = useState(false);

  if (!id) return null;

  let formatted = displayId;
  if (!formatted) {
    if (type === 'chunk') formatted = formatDisplayChunkId(id);
    else if (type === 'parent') formatted = formatDisplayParentId(id);
    else if (type === 'section') formatted = formatDisplaySectionId(id);
    else formatted = formatDisplayId(id);
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const success = await copyToClipboard(id);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const label = titlePrefix ? `${titlePrefix}: ${id}` : `전체 ID: ${id}`;

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? `전체 ID 복사 완료! (${id})` : `${label} (클릭하여 복사)`}
      className={`group/copy inline-flex items-center gap-1 font-mono transition-all duration-150 cursor-pointer select-none text-left ${
        copied
          ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
          : 'hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-300'
      } ${className}`}
    >
      {prefix && <span>{prefix}</span>}
      <span className="truncate">
        {copied ? '복사됨!' : formatted}
      </span>
      {suffix && <span>{suffix}</span>}
      {showIcon && (
        copied ? (
          <Check className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        ) : (
          <Copy className="w-2.5 h-2.5 opacity-40 group-hover/copy:opacity-100 shrink-0 transition-opacity" />
        )
      )}
    </button>
  );
};

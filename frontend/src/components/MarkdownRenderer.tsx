import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onSelectCitation?: (rank: number) => void;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  isStreaming = false,
  onSelectCitation,
  className = '',
}) => {
  // 본문 텍스트 내 '[참조 #1]', '[참조 1]', '[참고 #1]' 등을 클릭 가능한 인터랙티브 배지 컴포넌트로 치환
  const renderTextWithCitations = (text: string): React.ReactNode => {
    if (!text || typeof text !== 'string') return text;

    const citationRegex = /(\[(?:참조|참고)\s*#?(\d+)\])/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = citationRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      const fullMatch = match[1];
      const rankNum = parseInt(match[2], 10);

      parts.push(
        <button
          key={`${match.index}-${fullMatch}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectCitation?.(rankNum);
          }}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-1 rounded-md bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950/80 dark:hover:bg-indigo-900 border border-indigo-300/80 dark:border-indigo-700/80 text-indigo-700 dark:text-indigo-300 font-mono font-bold text-[11px] cursor-pointer transition shadow-2xs align-baseline"
          title={`[참조 #${rankNum}] 해당 검색 청크 카드로 이동`}
        >
          <span>🔗</span>
          <span>{fullMatch}</span>
        </button>
      );

      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  // 자식 노드를 순회하며 텍스트 노드에 인용 링크 치환 적용
  const processChildren = (children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
        return renderTextWithCitations(child);
      }
      return child;
    });
  };

  return (
    <div className={`markdown-body leading-relaxed text-slate-800 dark:text-slate-100 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-4 mb-2 pb-1 border-b border-slate-200 dark:border-slate-800 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mt-3.5 mb-2 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white mt-2.5 mb-1.5 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-2 mb-1 first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="text-xs sm:text-sm leading-relaxed mb-3 last:mb-0 text-slate-800 dark:text-slate-200">
              {processChildren(children)}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-2 space-y-1 text-xs sm:text-sm text-slate-800 dark:text-slate-200">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-2 space-y-1 text-xs sm:text-sm text-slate-800 dark:text-slate-200">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">
              {processChildren(children)}
            </li>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-slate-900 dark:text-white">
              {children}
            </strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 pl-3.5 py-1.5 my-2.5 rounded-r-lg text-xs italic text-slate-700 dark:text-slate-300">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs">
              <table className="w-full border-collapse text-xs text-left">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-100 dark:bg-slate-800/90 font-semibold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="p-2.5 text-xs font-bold border-r border-slate-200 dark:border-slate-700 last:border-r-0">
              {children}
            </th>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {children}
            </tbody>
          ),
          td: ({ children }) => (
            <td className="p-2.5 text-xs text-slate-700 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800/60 last:border-r-0">
              {processChildren(children)}
            </td>
          ),
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const isBlock = match || String(children).includes('\n');
            if (isBlock) {
              return (
                <div className="my-2.5 rounded-xl overflow-hidden border border-slate-800 shadow-md">
                  {match && (
                    <div className="bg-slate-900 px-3 py-1 text-[10px] font-mono text-slate-400 border-b border-slate-800">
                      {match[1]}
                    </div>
                  )}
                  <pre className="p-3 bg-slate-950 text-slate-100 overflow-x-auto font-mono text-xs leading-normal">
                    <code>{children}</code>
                  </pre>
                </div>
              );
            }
            return (
              <code
                className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold border border-slate-200/80 dark:border-slate-700/80"
                {...props}
              >
                {children}
              </code>
            );
          },
          hr: () => (
            <hr className="my-4 border-slate-200 dark:border-slate-800" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span
          className="inline-block w-2 h-4 ml-1 bg-indigo-600 dark:bg-indigo-400 animate-pulse align-middle"
          title="생성 중..."
        />
      )}
    </div>
  );
};

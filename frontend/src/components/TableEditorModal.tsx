import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Table2,
  Plus,
  Trash2,
  Split,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Edit3,
  Eye,
  Check,
  ClipboardPaste,
  Columns,
  Rows,
  HelpCircle,
} from 'lucide-react';
import {
  type TableGrid,
  parseHtmlTableToGrid,
  parseMarkdownTableToGrid,
  gridToHtmlTable,
  gridToMarkdownTable,
  parseTsvToGrid,
  createDefaultTableGrid,
  formatTableTitle,
  formatTableFootnote,
  extractTableCaptionFromMarkdown,
  extractTableFootnoteFromMarkdown,
} from '../utils/tableChunkUtils';

interface TableEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialHtml?: string;
  initialMarkdown?: string;
  caption?: string;
  footnote?: string;
  tableIndex?: number;
  onSave: (data: {
    grid: TableGrid;
    html: string;
    markdown: string;
    caption?: string;
    footnote?: string;
  }) => void;
}

export const TableEditorModal: React.FC<TableEditorModalProps> = ({
  isOpen,
  onClose,
  initialHtml,
  initialMarkdown,
  caption: initialCaption,
  footnote: initialFootnote,
  tableIndex,
  onSave,
}) => {
  const [grid, setGrid] = useState<TableGrid>(() => {
    if (initialHtml && initialHtml.includes('<table')) {
      return parseHtmlTableToGrid(initialHtml).grid;
    }
    if (initialMarkdown && initialMarkdown.includes('|')) {
      return parseMarkdownTableToGrid(initialMarkdown);
    }
    return createDefaultTableGrid(3, 3);
  });

  const [caption, setCaption] = useState<string>(() => {
    if (initialCaption !== undefined && initialCaption !== '') return initialCaption;
    if (initialHtml && initialHtml.includes('<table')) {
      const parsedCap = parseHtmlTableToGrid(initialHtml).caption;
      if (parsedCap) return parsedCap;
    }
    if (initialMarkdown) {
      const extracted = extractTableCaptionFromMarkdown(initialMarkdown, tableIndex ?? 0);
      if (extracted) return extracted;
    }
    return '';
  });

  const [footnote, setFootnote] = useState<string>(() => {
    if (initialFootnote !== undefined && initialFootnote !== '') return initialFootnote;
    if (initialHtml && initialHtml.includes('<table')) {
      const parsedFn = parseHtmlTableToGrid(initialHtml).footnote;
      if (parsedFn) return parsedFn;
    }
    if (initialMarkdown) {
      const extracted = extractTableFootnoteFromMarkdown(initialMarkdown, tableIndex ?? 0);
      if (extracted) return extracted;
    }
    return '';
  });
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>({ r: 0, c: 0 });
  const [activeTab, setActiveTab] = useState<'grid' | 'preview'>('grid');
  const [isTsvInputOpen, setIsTsvInputOpen] = useState<boolean>(false);
  const [tsvText, setTsvText] = useState<string>('');
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLargeView, setIsLargeView] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const cellRefs = useRef<{ [key: string]: HTMLTableCellElement | null }>({});
  const textareaRefs = useRef<{ [key: string]: HTMLTextAreaElement | null }>({});

  // 병합으로 숨겨진 셀인 경우 상위 원본(Anchor) 셀 위치 탐색
  const findCellAnchor = useCallback(
    (targetGrid: TableGrid, r: number, c: number): { r: number; c: number } => {
      if (r < 0 || r >= targetGrid.length) return { r: Math.max(0, Math.min(r, targetGrid.length - 1)), c: 0 };
      const row = targetGrid[r];
      if (!row || c < 0 || c >= row.length) return { r, c: Math.max(0, Math.min(c, (row?.length || 1) - 1)) };
      if (!row[c]?.isMergedHidden) return { r, c };

      for (let cr = r; cr >= 0; cr--) {
        for (let cc = c; cc >= 0; cc--) {
          const cell = targetGrid[cr]?.[cc];
          if (cell && !cell.isMergedHidden) {
            const rs = cell.rowSpan || 1;
            const cs = cell.colSpan || 1;
            if (cr + rs > r && cc + cs > c) {
              return { r: cr, c: cc };
            }
          }
        }
      }
      return { r, c };
    },
    []
  );

  const moveDirection = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right') => {
      if (!selectedCell) return;
      const { r, c } = selectedCell;
      const currentCell = grid[r]?.[c];
      if (!currentCell) return;

      let targetR = r;
      let targetC = c;

      if (dir === 'up') {
        if (r <= 0) return;
        targetR = r - 1;
      } else if (dir === 'down') {
        targetR = r + (currentCell.rowSpan || 1);
        if (targetR >= grid.length) return;
      } else if (dir === 'left') {
        if (c <= 0) return;
        targetC = c - 1;
      } else if (dir === 'right') {
        targetC = c + (currentCell.colSpan || 1);
        if (targetC >= (grid[r]?.length || 0)) return;
      }

      const anchor = findCellAnchor(grid, targetR, targetC);
      setSelectedCell(anchor);
    },
    [selectedCell, grid, findCellAnchor]
  );

  const moveTab = useCallback(() => {
    if (!selectedCell) return;
    const { r, c } = selectedCell;
    const currentCell = grid[r]?.[c];
    if (!currentCell) return;

    const targetC = c + (currentCell.colSpan || 1);
    if (targetC < (grid[r]?.length || 0)) {
      setSelectedCell(findCellAnchor(grid, r, targetC));
    } else if (r + 1 < grid.length) {
      setSelectedCell(findCellAnchor(grid, r + 1, 0));
    }
  }, [selectedCell, grid, findCellAnchor]);

  const moveShiftTab = useCallback(() => {
    if (!selectedCell) return;
    const { r, c } = selectedCell;
    if (c > 0) {
      setSelectedCell(findCellAnchor(grid, r, c - 1));
    } else if (r > 0) {
      const prevRowLen = grid[r - 1]?.length || 1;
      setSelectedCell(findCellAnchor(grid, r - 1, prevRowLen - 1));
    }
  }, [selectedCell, grid, findCellAnchor]);

  // 셀 선택 / 편집 모드 전환 시 포커스 제어
  // 핵심: 탐색 모드(!isEditing)에서도 포커스를 TD 대신 선택된 셀의 textarea에 상시 유지하여
  // 비편집 요소(TD) -> 편집 요소(textarea)로의 포커스 전환 시 발생하는 macOS/브라우저 한글 IME 조합 버퍼 유실(자모 분리) 방지
  useEffect(() => {
    if (!selectedCell || activeTab !== 'grid') return;
    const activeEl = document.activeElement;
    if (activeEl?.getAttribute('data-formula-bar') === 'true') return;

    const key = `${selectedCell.r}_${selectedCell.c}`;
    const textarea = textareaRefs.current[key];
    if (textarea) {
      if (document.activeElement !== textarea) {
        textarea.focus({ preventScroll: true });
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
      }
      const cellEl = cellRefs.current[key];
      cellEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [selectedCell, isEditing, activeTab]);

  const lastPasteTimeRef = useRef<number>(0);

  // 클립보드 텍스트를 대상 셀 위치를 시작점으로 배치 (단일 셀 또는 엑셀 다중 셀 TSV 지원)
  const applyPastedText = (text: string, startR: number, startC: number) => {
    const now = Date.now();
    if (now - lastPasteTimeRef.current < 200) return;
    lastPasteTimeRef.current = now;

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (lines.length === 1 && !lines[0].includes('\t')) {
      handleCellChange(startR, startC, lines[0]);
      showAlert('셀에 텍스트가 붙여넣어졌습니다.');
      return;
    }

    setGrid((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ ...cell })));
      lines.forEach((line, dr) => {
        const targetR = startR + dr;
        if (targetR >= next.length) return;
        const cells = line.split('\t');
        cells.forEach((val, dc) => {
          const targetC = startC + dc;
          if (targetC >= (next[targetR]?.length || 0)) return;
          if (!next[targetR][targetC].isMergedHidden) {
            next[targetR][targetC].text = val.trim();
          }
        });
      });
      return next;
    });
    showAlert(`${lines.length}행 범위의 데이터가 표에 붙여넣어졌습니다.`);
  };

  // 셀 키보드 이벤트 (textarea 상시 포커스 기반 처리로 탐색 모드 -> 한글 입력 시 자모 분리 완전 방지)
  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement | HTMLTableCellElement>,
    r: number,
    c: number
  ) => {
    // 텍스트에어리어 키 입력이 상위 TD/Table로 무분별하게 버블링되는 것 방지
    e.stopPropagation();

    // 1. 편집 모드 (isEditing === true) 상태의 키 제어
    if (isEditing) {
      // 한글 조합 중(isComposing)일 때는 Enter 등으로 인한 조기 편집 종료 방지
      if (e.nativeEvent.isComposing) return;

      if (e.key === 'Enter') {
        if (e.shiftKey || e.altKey) {
          // Shift+Enter / Alt+Enter: 줄바꿈 허용 (기본 동작 유지)
          return;
        }
        // Enter 단독: 편집 완료 후 아래 셀로 이동
        e.preventDefault();
        setIsEditing(false);
        moveDirection('down');
      } else if (e.key === 'Tab') {
        // Tab: 편집 완료 후 다음 열로 이동
        e.preventDefault();
        setIsEditing(false);
        if (e.shiftKey) moveShiftTab();
        else moveTab();
      } else if (e.key === 'Escape') {
        // Esc: 편집 모드 종료 (탐색 모드로 복귀)
        e.preventDefault();
        setIsEditing(false);
      } else if (e.key === 'F2') {
        // F2: 편집 모드 토글 (탐색 모드로 복귀)
        e.preventDefault();
        setIsEditing(false);
      }
      return;
    }

    // 2. 탐색 모드 (!isEditing) 상태의 키 제어
    // (1) 클립보드 복사 (Ctrl+C / Cmd+C)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      const text = grid[r]?.[c]?.text ?? '';
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      showAlert(`셀 내용 복사됨: "${text.length > 20 ? text.slice(0, 20) + '...' : text}"`);
      return;
    }

    // (2) 클립보드 잘라내기 (Ctrl+X / Cmd+X)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      const text = grid[r]?.[c]?.text ?? '';
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      handleCellChange(r, c, '');
      showAlert('셀 내용이 잘라내기 되었습니다.');
      return;
    }

    // (3) 클립보드 붙여넣기 (Ctrl+V / Cmd+V)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      if (navigator?.clipboard?.readText) {
        navigator.clipboard
          .readText()
          .then((clipText) => {
            if (clipText) {
              applyPastedText(clipText, r, c);
            }
          })
          .catch(() => {});
      }
      return;
    }

    // (4) 방향키 및 셀 내비게이션
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveDirection('up');
        return;
      case 'ArrowDown':
        e.preventDefault();
        moveDirection('down');
        return;
      case 'ArrowLeft':
        e.preventDefault();
        moveDirection('left');
        return;
      case 'ArrowRight':
        e.preventDefault();
        moveDirection('right');
        return;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) moveShiftTab();
        else moveTab();
        return;
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey) moveDirection('up');
        else moveDirection('down');
        return;
      case 'F2':
        e.preventDefault();
        setIsEditing(true);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        handleCellChange(r, c, '');
        return;
      case 'Escape':
        e.preventDefault();
        return;
      default:
        // 일반 문자 타이핑 시작 시 (영문, 숫자, 기호, 한글 IME 포함):
        // 핵심: 포커스 이동이나 selection 변경 없이 오직 isEditing만 true로 켜고 이벤트를 통과시켜,
        // 브라우저의 기본 타이핑 및 macOS IME 조합 세션(compositionstart)이 단절되지 않고 깨끗하게 이어지도록 함!
        if (
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          (e.key.length === 1 || e.key === 'Process' || e.nativeEvent.isComposing)
        ) {
          setIsEditing(true);
        }
        break;
    }
  };

  if (!isOpen) return null;

  const showAlert = (msg: string) => {
    setAlertMessage(msg);
    setTimeout(() => setAlertMessage(null), 3000);
  };

  // 셀 텍스트 수정
  const handleCellChange = (r: number, c: number, text: string) => {
    setGrid((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ ...cell })));
      if (next[r] && next[r][c]) {
        next[r][c].text = text;
      }
      return next;
    });
  };

  // 1. 가로 셀 병합 (현재 선택된 셀과 우측 셀 결합)
  const handleMergeRight = () => {
    if (!selectedCell) return;
    const { r, c } = selectedCell;
    const currentCell = grid[r]?.[c];
    if (!currentCell || currentCell.isMergedHidden) return;

    const currentCs = currentCell.colSpan || 1;
    const currentRs = currentCell.rowSpan || 1;
    const targetC = c + currentCs;

    if (targetC >= (grid[r]?.length || 0)) {
      showAlert('오른쪽에 더 이상 병합할 셀이 없습니다.');
      return;
    }

    const targetCell = grid[r][targetC];
    if (!targetCell || targetCell.isMergedHidden) {
      showAlert('오른쪽 셀이 이미 다른 병합에 포함되어 있어 결합할 수 없습니다.');
      return;
    }

    const targetRs = targetCell.rowSpan || 1;
    if (currentRs !== targetRs) {
      showAlert('세로 높이(행 병합 수)가 일치해야 가로로 병합할 수 있습니다.');
      return;
    }

    const targetCs = targetCell.colSpan || 1;

    setGrid((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ ...cell })));
      const base = next[r][c];
      const target = next[r][targetC];

      // 텍스트 결합
      if (target.text.trim()) {
        base.text = base.text ? `${base.text} ${target.text}` : target.text;
      }

      base.colSpan = currentCs + targetCs;

      // 새로 포함된 영역 isMergedHidden 설정
      for (let dr = 0; dr < currentRs; dr++) {
        for (let dc = 0; dc < targetCs; dc++) {
          next[r + dr][targetC + dc].isMergedHidden = true;
        }
      }
      return next;
    });
    showAlert('우측 셀과 가로 병합되었습니다.');
  };

  // 2. 세로 셀 병합 (현재 선택된 셀과 아래 셀 결합)
  const handleMergeDown = () => {
    if (!selectedCell) return;
    const { r, c } = selectedCell;
    const currentCell = grid[r]?.[c];
    if (!currentCell || currentCell.isMergedHidden) return;

    const currentCs = currentCell.colSpan || 1;
    const currentRs = currentCell.rowSpan || 1;
    const targetR = r + currentRs;

    if (targetR >= grid.length) {
      showAlert('아래에 더 이상 병합할 셀이 없습니다.');
      return;
    }

    const targetCell = grid[targetR]?.[c];
    if (!targetCell || targetCell.isMergedHidden) {
      showAlert('아래 셀이 이미 다른 병합에 포함되어 있어 결합할 수 없습니다.');
      return;
    }

    const targetCs = targetCell.colSpan || 1;
    if (currentCs !== targetCs) {
      showAlert('가로 너비(열 병합 수)가 일치해야 세로로 병합할 수 있습니다.');
      return;
    }

    const targetRs = targetCell.rowSpan || 1;

    setGrid((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ ...cell })));
      const base = next[r][c];
      const target = next[targetR][c];

      if (target.text.trim()) {
        base.text = base.text ? `${base.text}\n${target.text}` : target.text;
      }

      base.rowSpan = currentRs + targetRs;

      // 새로 포함된 영역 isMergedHidden 설정
      for (let dr = 0; dr < targetRs; dr++) {
        for (let dc = 0; dc < currentCs; dc++) {
          next[targetR + dr][c + dc].isMergedHidden = true;
        }
      }
      return next;
    });
    showAlert('아래 셀과 세로 병합되었습니다.');
  };

  // 3. 병합 해제
  const handleUnmerge = () => {
    if (!selectedCell) return;
    const { r, c } = selectedCell;
    const currentCell = grid[r]?.[c];
    if (!currentCell) return;

    const cs = currentCell.colSpan || 1;
    const rs = currentCell.rowSpan || 1;

    if (cs <= 1 && rs <= 1) {
      showAlert('선택된 셀은 병합된 상태가 아닙니다.');
      return;
    }

    setGrid((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ ...cell })));
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          const target = next[r + dr]?.[c + dc];
          if (target) {
            target.colSpan = 1;
            target.rowSpan = 1;
            target.isMergedHidden = false;
          }
        }
      }
      return next;
    });
    showAlert('병합이 해제되어 개별 셀들로 복원되었습니다.');
  };

  // 행 추가 (맨 아래 또는 선택 행 다음)
  const handleAddRow = () => {
    setGrid((prev) => {
      const numCols = Math.max(...prev.map((r) => r.length), 1);
      const newRow = Array(numCols)
        .fill(null)
        .map((_, i) => ({
          text: `내용 ${prev.length + 1}-${i + 1}`,
          colSpan: 1,
          rowSpan: 1,
          isMergedHidden: false,
        }));
      return [...prev, newRow];
    });
  };

  // 행 삭제
  const handleDeleteRow = () => {
    if (grid.length <= 1) {
      showAlert('표에는 최소 1개의 행이 존재해야 합니다.');
      return;
    }
    const targetR = selectedCell ? selectedCell.r : grid.length - 1;
    setGrid((prev) => prev.filter((_, i) => i !== targetR));
    if (selectedCell && selectedCell.r >= grid.length - 1) {
      setSelectedCell({ r: Math.max(0, grid.length - 2), c: selectedCell.c });
    }
    showAlert(`${targetR + 1}번째 행이 삭제되었습니다.`);
  };

  // 열 추가
  const handleAddCol = () => {
    setGrid((prev) => {
      return prev.map((row, rIdx) => [
        ...row,
        {
          text: rIdx === 0 ? `항목 ${row.length + 1}` : '',
          colSpan: 1,
          rowSpan: 1,
          isMergedHidden: false,
        },
      ]);
    });
  };

  // 열 삭제
  const handleDeleteCol = () => {
    if ((grid[0]?.length || 0) <= 1) {
      showAlert('표에는 최소 1개의 열이 존재해야 합니다.');
      return;
    }
    const targetC = selectedCell ? selectedCell.c : (grid[0]?.length || 1) - 1;
    setGrid((prev) => prev.map((row) => row.filter((_, i) => i !== targetC)));
    if (selectedCell && selectedCell.c >= (grid[0]?.length || 1) - 1) {
      setSelectedCell({ r: selectedCell.r, c: Math.max(0, (grid[0]?.length || 2) - 2) });
    }
    showAlert(`${targetC + 1}번째 열이 삭제되었습니다.`);
  };

  // 엑셀 / TSV 붙여넣기 적용
  const handleApplyTsv = () => {
    if (!tsvText.trim()) {
      showAlert('붙여넣을 텍스트가 없습니다.');
      return;
    }
    const parsedGrid = parseTsvToGrid(tsvText);
    setGrid(parsedGrid);
    setIsTsvInputOpen(false);
    setTsvText('');
    showAlert('클립보드 표 데이터가 그리드에 적용되었습니다.');
  };

  // 저장
  const handleSave = () => {
    const html = gridToHtmlTable(grid);
    const rawMd = gridToMarkdownTable(grid);
    const trimmedCap = caption.trim() || undefined;
    const trimmedFn = footnote.trim() || undefined;
    const fullMd = [
      formatTableTitle(trimmedCap),
      rawMd,
      formatTableFootnote(trimmedFn),
    ]
      .filter(Boolean)
      .join('\n\n');

    onSave({
      grid,
      html,
      markdown: fullMd,
      caption: trimmedCap,
      footnote: trimmedFn,
    });
    onClose();
  };

  const previewHtml = gridToHtmlTable(grid);
  const previewMd = [
    formatTableTitle(caption),
    gridToMarkdownTable(grid),
    formatTableFootnote(footnote),
  ]
    .filter(Boolean)
    .join('\n\n');
  const selectedCellData = selectedCell ? grid[selectedCell.r]?.[selectedCell.c] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-800 dark:text-slate-100 transition-all duration-200 ${
          isFullscreen
            ? 'w-full h-full max-w-none max-h-none rounded-none sm:rounded-2xl sm:w-[98vw] sm:h-[96vh]'
            : 'w-full max-w-6xl max-h-[92vh]'
        }`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400">
              <Table2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  {tableIndex !== undefined ? `표 ${tableIndex + 1} 상세 편집기` : '표 데이터 및 셀 병합 편집기'}
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  셀 병합 지원
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                행/열 추가·삭제, 셀 클릭 인라인 수정, 가로/세로 셀 병합(Colspan/Rowspan)을 지원합니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'grid' ? 'preview' : 'grid')}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
            >
              {activeTab === 'grid' ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-indigo-500" />
                  <span>결과 미리보기</span>
                </>
              ) : (
                <>
                  <Table2 className="w-3.5 h-3.5 text-indigo-500" />
                  <span>그리드 편집</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? '창 크기 복원' : '창 최대화 (전체화면)'}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer transition"
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5 text-indigo-500" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Toolbar & Alerts */}
        <div className="px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
          {/* 셀 병합 & 행열 제어 툴바 */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {/* 가로 병합 */}
            <button
              type="button"
              onClick={handleMergeRight}
              disabled={!selectedCell || selectedCellData?.isMergedHidden}
              title="현재 셀과 오른쪽 셀을 가로로 병합합니다"
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-300 border border-slate-300 dark:border-slate-700 font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition"
            >
              <Maximize2 className="w-3 h-3 rotate-45 text-indigo-500" />
              <span>우측 셀 병합 ➡️</span>
            </button>

            {/* 세로 병합 */}
            <button
              type="button"
              onClick={handleMergeDown}
              disabled={!selectedCell || selectedCellData?.isMergedHidden}
              title="현재 셀과 아래쪽 셀을 세로로 병합합니다"
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-300 border border-slate-300 dark:border-slate-700 font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition"
            >
              <Maximize2 className="w-3 h-3 rotate-135 text-indigo-500" />
              <span>아래 셀 병합 ⬇️</span>
            </button>

            {/* 병합 해제 */}
            <button
              type="button"
              onClick={handleUnmerge}
              disabled={!selectedCell || ((selectedCellData?.colSpan || 1) <= 1 && (selectedCellData?.rowSpan || 1) <= 1)}
              title="선택된 셀의 병합을 해제하여 독립된 셀들로 되돌립니다"
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-300 border border-slate-300 dark:border-slate-700 font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition"
            >
              <Split className="w-3 h-3 text-rose-500" />
              <span>병합 해제</span>
            </button>

            <span className="w-px h-5 bg-slate-200 dark:border-slate-800 mx-1" />

            {/* 행 조작 */}
            <button
              type="button"
              onClick={handleAddRow}
              className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 flex items-center gap-1 cursor-pointer transition"
            >
              <Plus className="w-3 h-3 text-emerald-500" />
              <Rows className="w-3 h-3 text-slate-400" />
              <span>행 추가</span>
            </button>

            <button
              type="button"
              onClick={handleDeleteRow}
              className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/80 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700 flex items-center gap-1 cursor-pointer transition"
            >
              <Trash2 className="w-3 h-3 text-rose-500" />
              <span>행 삭제</span>
            </button>

            {/* 열 조작 */}
            <button
              type="button"
              onClick={handleAddCol}
              className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 flex items-center gap-1 cursor-pointer transition"
            >
              <Plus className="w-3 h-3 text-emerald-500" />
              <Columns className="w-3 h-3 text-slate-400" />
              <span>열 추가</span>
            </button>

            <button
              type="button"
              onClick={handleDeleteCol}
              className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/80 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700 flex items-center gap-1 cursor-pointer transition"
            >
              <Trash2 className="w-3 h-3 text-rose-500" />
              <span>열 삭제</span>
            </button>

            <span className="w-px h-5 bg-slate-200 dark:border-slate-800 mx-1" />

            {/* 엑셀 붙여넣기 모달 열기 */}
            <button
              type="button"
              onClick={() => setIsTsvInputOpen(!isTsvInputOpen)}
              className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 flex items-center gap-1 cursor-pointer transition font-medium"
            >
              <ClipboardPaste className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
              <span>엑셀/TSV 붙여넣기</span>
            </button>

            {/* 보기 크기 확대 토글 */}
            <button
              type="button"
              onClick={() => setIsLargeView(!isLargeView)}
              title={isLargeView ? '기본 크기로 전환' : '셀 및 글자 크기 확대 (여유로운 편집)'}
              className={`px-2.5 py-1 rounded-lg border font-medium flex items-center gap-1 cursor-pointer transition ${
                isLargeView
                  ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700'
                  : 'bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {isLargeView ? <ZoomOut className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> : <ZoomIn className="w-3.5 h-3.5 text-indigo-500" />}
              <span>{isLargeView ? '확대 모드 ON' : '크게 보기'}</span>
            </button>
          </div>

          {/* 선택 상태 뱃지 */}
          {selectedCell && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-mono">
              <span>선택: R{selectedCell.r + 1}:C{selectedCell.c + 1}</span>
              {isEditing ? (
                <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 animate-pulse">
                  [수정 중]
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                  [탐색 모드]
                </span>
              )}
              {(selectedCellData?.colSpan || 1) > 1 && (
                <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                  [가로{selectedCellData?.colSpan}칸]
                </span>
              )}
              {(selectedCellData?.rowSpan || 1) > 1 && (
                <span className="text-purple-600 dark:text-purple-400 font-bold">
                  [세로{selectedCellData?.rowSpan}칸]
                </span>
              )}
            </div>
          )}
        </div>

        {/* Alert Notification */}
        {alertMessage && (
          <div className="px-6 py-1.5 bg-indigo-50 dark:bg-indigo-950 border-b border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs flex items-center gap-1.5 animate-in fade-in duration-100">
            <HelpCircle className="w-3.5 h-3.5 text-indigo-600" />
            <span>{alertMessage}</span>
          </div>
        )}

        {/* TSV 입력 확장 패널 */}
        {isTsvInputOpen && (
          <div className="px-6 py-3 bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 space-y-2 animate-in slide-in-from-top-2 duration-150">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span>엑셀 / 노션 표 복사 텍스트 붙여넣기 (Tab 구분자 자동 파싱)</span>
              <button
                type="button"
                onClick={() => setIsTsvInputOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                닫기
              </button>
            </div>
            <textarea
              value={tsvText}
              onChange={(e) => setTsvText(e.target.value)}
              rows={3}
              placeholder="엑셀에서 복사한 영역을 여기에 Ctrl+V(또는 Cmd+V) 하세요..."
              className="w-full text-xs font-mono p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsTsvInputOpen(false)}
                className="text-xs px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleApplyTsv}
                className="text-xs font-bold px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer shadow-2xs"
              >
                그리드로 가져오기
              </button>
            </div>
          </div>
        )}

        {/* Caption & Footnote Input Fields */}
        <div className="px-6 py-3 bg-slate-50/50 dark:bg-slate-950/20 border-b border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              표 제목 (Caption)
            </label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="예: [표 1] 산업재해 인정 세부 기준"
              className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              표 각주 (Footnote)
            </label>
            <input
              type="text"
              value={footnote}
              onChange={(e) => setFootnote(e.target.value)}
              placeholder="예: ※ 1일 기준 시간 초과 시 가산 산정"
              className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
            />
          </div>
        </div>

        {/* 선택된 셀 집중 편집창 (수식 입력줄 / Formula Bar 스타일) */}
        {activeTab === 'grid' && selectedCell && selectedCellData && !selectedCellData.isMergedHidden && (
          <div className="px-6 py-2.5 bg-indigo-50/70 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-900/60 flex items-start gap-3 animate-in fade-in duration-100">
            <div className="flex items-center gap-1.5 pt-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300 shrink-0">
              <Edit3 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span className="font-mono bg-white dark:bg-slate-900 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800 shadow-2xs">
                {selectedCell.r === 0 ? '헤더(1행)' : `${selectedCell.r + 1}행`} · {selectedCell.c + 1}열
              </span>
            </div>
            <div className="flex-1 relative">
              <textarea
                data-formula-bar="true"
                value={selectedCellData.text}
                onChange={(e) => handleCellChange(selectedCell.r, selectedCell.c, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    moveDirection('down');
                  }
                }}
                rows={2}
                placeholder="선택한 셀 내용 집중 편집 (여기에 입력하면 표에 실시간 반영되며, 줄바꿈과 긴 문장을 여유 있게 편집할 수 있습니다)..."
                className="w-full text-xs sm:text-sm p-2 bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-700/80 rounded-lg shadow-inner focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-800 dark:text-slate-100 resize-y min-h-[50px]"
              />
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto p-6 bg-slate-100/50 dark:bg-slate-950/50">
          {activeTab === 'grid' ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-x-auto p-4">
              <table
                onCopy={(e) => {
                  if (isEditing || !selectedCell) return;
                  const text = grid[selectedCell.r]?.[selectedCell.c]?.text ?? '';
                  e.clipboardData.setData('text/plain', text);
                  e.preventDefault();
                  showAlert(`셀 내용 복사됨: "${text.length > 20 ? text.slice(0, 20) + '...' : text}"`);
                }}
                onCut={(e) => {
                  if (isEditing || !selectedCell) return;
                  const text = grid[selectedCell.r]?.[selectedCell.c]?.text ?? '';
                  e.clipboardData.setData('text/plain', text);
                  handleCellChange(selectedCell.r, selectedCell.c, '');
                  e.preventDefault();
                  showAlert('셀 내용이 잘라내기 되었습니다.');
                }}
                onPaste={(e) => {
                  if (isEditing || !selectedCell) return;
                  const text = e.clipboardData.getData('text/plain');
                  if (text) {
                    e.preventDefault();
                    applyPastedText(text, selectedCell.r, selectedCell.c);
                  }
                }}
                className="border-collapse border border-slate-300 dark:border-slate-700 w-full min-w-full"
              >
                <tbody>
                  {grid.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => {
                        if (cell.isMergedHidden) return null; // 병합으로 덮인 셀 숨김

                        const isSelected = selectedCell?.r === r && selectedCell?.c === c;
                        const isHeader = r === 0;

                        return (
                            <td
                            key={c}
                            ref={(el) => {
                              cellRefs.current[`${r}_${c}`] = el;
                            }}
                            tabIndex={-1}
                            colSpan={cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined}
                            rowSpan={cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined}
                            onClick={() => {
                              if (isSelected && !isEditing) {
                                setIsEditing(true);
                              } else {
                                setSelectedCell({ r, c });
                                setIsEditing(false);
                              }
                            }}
                            onDoubleClick={() => {
                              setSelectedCell({ r, c });
                              setIsEditing(true);
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, r, c)}
                            className={`border border-slate-300 dark:border-slate-700 transition relative align-top outline-hidden select-none ${
                              isLargeView ? 'min-w-[200px] p-2' : 'min-w-[150px] p-1.5'
                            } ${
                              isSelected
                                ? isEditing
                                  ? 'ring-2 ring-emerald-500 ring-inset z-20 bg-white dark:bg-slate-900 shadow-md'
                                  : 'ring-2 ring-indigo-500 ring-inset z-10 bg-indigo-50/70 dark:bg-indigo-950/50 cursor-cell'
                                : isHeader
                                ? 'bg-slate-100 dark:bg-slate-800/80 font-medium cursor-pointer'
                                : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer'
                            }`}
                          >
                            <textarea
                              ref={(el) => {
                                textareaRefs.current[`${r}_${c}`] = el;
                              }}
                              value={cell.text}
                              readOnly={!isSelected}
                              onChange={(e) => handleCellChange(r, c, e.target.value)}
                              onKeyDown={(e) => handleCellKeyDown(e, r, c)}
                              onCopy={(e) => {
                                if (isEditing) return;
                                const text = cell.text ?? '';
                                e.clipboardData.setData('text/plain', text);
                                e.preventDefault();
                                showAlert(`셀 내용 복사됨: "${text.length > 20 ? text.slice(0, 20) + '...' : text}"`);
                              }}
                              onCut={(e) => {
                                if (isEditing) return;
                                const text = cell.text ?? '';
                                e.clipboardData.setData('text/plain', text);
                                handleCellChange(r, c, '');
                                e.preventDefault();
                                showAlert('셀 내용이 잘라내기 되었습니다.');
                              }}
                              onPaste={(e) => {
                                if (isEditing) return;
                                const text = e.clipboardData.getData('text/plain');
                                if (text) {
                                  e.preventDefault();
                                  applyPastedText(text, r, c);
                                }
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCell({ r, c });
                                setIsEditing(true);
                              }}
                              rows={Math.max(isLargeView ? 2 : 1, (cell.text.match(/\n/g) || []).length + 1)}
                              placeholder={isHeader ? `항목 ${c + 1}` : '내용'}
                              className={`w-full bg-transparent border-0 focus:outline-hidden resize-none rounded transition ${
                                isSelected
                                  ? isEditing
                                    ? 'cursor-text select-text caret-indigo-600 dark:caret-indigo-400'
                                    : 'cursor-cell select-none caret-transparent pointer-events-none'
                                  : 'cursor-pointer select-none pointer-events-none'
                              } ${
                                isLargeView
                                  ? 'text-sm p-1.5 min-h-[48px]'
                                  : 'text-xs sm:text-sm p-1 min-h-[38px]'
                              } ${
                                isHeader
                                  ? 'font-bold text-slate-800 dark:text-slate-100 text-center'
                                  : 'text-slate-700 dark:text-slate-200'
                              }`}
                            />

                            {/* 병합 상태 인디케이터 뱃지 */}
                            {((cell.colSpan || 1) > 1 || (cell.rowSpan || 1) > 1) && (
                              <span className="absolute bottom-1 right-1 text-[9px] px-1 py-0.2 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-mono font-bold pointer-events-none opacity-80">
                                {cell.colSpan || 1}x{cell.rowSpan || 1}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
                <div className="text-xs font-bold text-indigo-700 dark:text-indigo-300 mb-2 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  <span>실시간 HTML 렌더링 결과 (브라우저/문서 뷰어 출력형태)</span>
                </div>
                {caption.trim() && (
                  <div className="font-bold text-xs text-slate-800 dark:text-slate-200 mb-1.5">
                    {caption.trim()}
                  </div>
                )}
                <div
                  className="prose-custom text-xs"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
                {footnote.trim() && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 italic mt-1.5">
                    {footnote.trim()}
                  </div>
                )}
              </div>

              <div className="bg-slate-900 text-slate-200 rounded-xl border border-slate-800 p-4 font-mono text-xs shadow-xs space-y-2">
                <div className="text-slate-400 text-[11px] font-semibold flex items-center justify-between">
                  <span>RAG 검색 임베딩 텍스트 (Markdown Table)</span>
                  <span className="text-[10px] text-emerald-400">병합 정렬 동기화</span>
                </div>
                <pre className="overflow-x-auto text-emerald-400 leading-relaxed whitespace-pre-wrap">
                  {previewMd}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              총 <span className="font-bold text-slate-800 dark:text-slate-200">{grid.length}</span>행 ×{' '}
              <span className="font-bold text-slate-800 dark:text-slate-200">{grid[0]?.length || 0}</span>열
            </div>

            {/* 엑셀 단축키 안내 뱃지 */}
            <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 font-mono">
              <span className="font-bold text-indigo-600 dark:text-indigo-400">⌨️ 엑셀 단축키</span>
              <span>[방향키/Tab] 이동</span>
              <span>·</span>
              <span>[F2/더블클릭] 편집</span>
              <span>·</span>
              <span>[Enter] 아래 이동</span>
              <span>·</span>
              <span>[Shift+Enter] 줄바꿈</span>
              <span>·</span>
              <span>[Ctrl+C/X/V] 복사/잘라내기/붙여넣기</span>
              <span>·</span>
              <span>[Del] 비우기</span>
              <span>·</span>
              <span>[Esc] 완료</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>표 저장 및 청크 동기화</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

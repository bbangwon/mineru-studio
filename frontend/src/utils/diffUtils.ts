import { diffWordsWithSpace, type Change } from 'diff';

export interface DiffSummaryStats {
  originalChars: number;
  refinedChars: number;
  charDelta: number;
  addedChars: number;
  removedChars: number;
  modifiedSegments: number;
}

export interface ProcessedDiff {
  changes: Change[];
  stats: DiffSummaryStats;
}

/**
 * 원문과 교정본 간의 단어/공백 단위 Diff를 계산하고 통계를 산출합니다.
 */
export function computeWordDiff(original: string, refined: string): ProcessedDiff {
  const changes = diffWordsWithSpace(original, refined);

  let addedChars = 0;
  let removedChars = 0;
  let modifiedSegments = 0;

  for (const change of changes) {
    if (change.added) {
      addedChars += change.value.length;
      modifiedSegments += 1;
    } else if (change.removed) {
      removedChars += change.value.length;
      modifiedSegments += 1;
    }
  }

  const originalChars = original.length;
  const refinedChars = refined.length;
  const charDelta = refinedChars - originalChars;

  return {
    changes,
    stats: {
      originalChars,
      refinedChars,
      charDelta,
      addedChars,
      removedChars,
      modifiedSegments,
    },
  };
}

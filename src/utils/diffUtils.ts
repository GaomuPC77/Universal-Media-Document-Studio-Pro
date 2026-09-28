import * as Diff from 'diff';

export interface DiffResult {
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  changes: {
    type: 'added' | 'removed' | 'unchanged';
    value: string;
    lineNumberOld?: number;
    lineNumberNew?: number;
  }[];
}

/**
 * Compare two text bodies line-by-line and return diff structure
 */
export function compareTextLines(oldText: string, newText: string): DiffResult {
  const diff = Diff.diffLines(oldText, newText);
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;
  let lineOld = 1;
  let lineNew = 1;

  const changes: DiffResult['changes'] = [];

  for (const part of diff) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.added) {
      addedCount += lines.length;
      for (const line of lines) {
        changes.push({
          type: 'added',
          value: line,
          lineNumberNew: lineNew++,
        });
      }
    } else if (part.removed) {
      removedCount += lines.length;
      for (const line of lines) {
        changes.push({
          type: 'removed',
          value: line,
          lineNumberOld: lineOld++,
        });
      }
    } else {
      unchangedCount += lines.length;
      for (const line of lines) {
        changes.push({
          type: 'unchanged',
          value: line,
          lineNumberOld: lineOld++,
          lineNumberNew: lineNew++,
        });
      }
    }
  }

  return {
    addedCount,
    removedCount,
    unchangedCount,
    changes,
  };
}

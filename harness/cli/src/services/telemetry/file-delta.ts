/**
 * Pure per-file change-delta computation (plan 056 · T002).
 *
 * The adapters already parse the tool payload (Claude `Write` content / `Edit`
 * old→new; Copilot `apply_patch`, `create`/`edit` body). These helpers turn that
 * payload into an integer {@link FileDelta} — line + UTF-8 byte add/remove counts
 * — WITHOUT reading the file from disk (D5) and WITHOUT retaining the text (P12,
 * D4): only the measured counts survive, never the content.
 *
 * The line diff is an order-insensitive MULTISET difference, deliberately NOT an
 * LCS: a line present in both old and new (in equal multiplicity) is unchanged;
 * the surplus in each side is the add/remove. Cheap, allocation-light, and — for
 * an `Edit` whose `old_string`/`new_string` share anchor context — it counts only
 * the genuinely changed lines, not the shared anchors.
 */

import type { FileDelta } from './events.js';

const encoder = new TextEncoder();

/** UTF-8 byte length of a string (never the string itself). */
function byteLen(s: string): number {
  return encoder.encode(s).length;
}

/**
 * Split text into logical lines for churn counting: the empty string is zero
 * lines, and a single trailing newline is not counted as an extra empty line
 * (files idiomatically end with one). Bytes are measured per line WITHOUT the
 * separator — a consistent convention shared by written + edited deltas.
 */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body === '' ? [''] : body.split('\n');
}

function freq(lines: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}

/**
 * Line + byte add/remove counts from an old→new text pair (the `Edit` shape).
 * Order-insensitive multiset difference: unchanged lines (equal multiplicity on
 * both sides) contribute nothing; only the surplus counts.
 */
export function computeFileDelta(oldText: string, newText: string): FileDelta {
  const oldFreq = freq(splitLines(oldText));
  const newFreq = freq(splitLines(newText));

  let lines_added = 0;
  let lines_removed = 0;
  let bytes_added = 0;
  let bytes_removed = 0;

  for (const [line, n] of newFreq) {
    const added = n - Math.min(n, oldFreq.get(line) ?? 0);
    if (added > 0) {
      lines_added += added;
      bytes_added += added * byteLen(line);
    }
  }
  for (const [line, n] of oldFreq) {
    const removed = n - Math.min(n, newFreq.get(line) ?? 0);
    if (removed > 0) {
      lines_removed += removed;
      bytes_removed += removed * byteLen(line);
    }
  }

  return { lines_added, lines_removed, bytes_added, bytes_removed };
}

/**
 * The delta for a whole-file `Write`/`create`: every line of `content` is added,
 * nothing removed. Defined as {@link computeFileDelta} against the empty string so
 * the two helpers share one byte/line convention (AC-01 — removed is always 0).
 */
export function writtenDelta(content: string): FileDelta {
  return computeFileDelta('', content);
}

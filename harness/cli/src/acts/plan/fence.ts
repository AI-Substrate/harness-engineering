import type { DdDoc } from '@ai-substrate/dd';

/**
 * Fences as data (ac-7120, tk-7171).
 *
 * A dispatch fence is normally prose: a paragraph in a brief listing the paths a
 * delegated agent may touch. That has two failure modes this plan met in its own
 * first phase. The brief instructed a mechanism and omitted the file the
 * mechanism lives in, so the fence was wrong and only a human reviewer noticed —
 * hours after the work was done. And a fence row, once written, has no way to
 * expire: nobody can tell whether a restriction still serves its reason or is
 * simply the sentence somebody typed once.
 *
 * Making the fence a document fixes both mechanically. Every row carries the
 * `cause` it exists for and an `expiry`, so a rule that has outlived its reason
 * is visible as data rather than remembered. And because the rows are
 * addressable, a check can compare a change's touched paths against them and name
 * BOTH the offending path and the row that refused it — which is the difference
 * between "that is out of fence" and an argument.
 *
 * Pure: paths in, verdict out. Reading git, resolving the document, and mapping a
 * verdict onto an envelope all belong to the act.
 */

export interface FenceRow {
  id: string;
  pattern: string;
  mode: 'allow' | 'forbid';
  owner: string;
  cause: string;
  expiry?: string;
  note?: string;
}

export interface FenceViolation {
  path: string;
  /** The row that refused it — a fence that cannot say WHICH rule is an opinion. */
  row: string;
  pattern: string;
  mode: 'allow' | 'forbid';
  owner: string;
  cause: string;
  reason: 'forbidden' | 'not-allowed';
}

export interface FenceExpired {
  row: string;
  expiry: string;
  owner: string;
}

export interface FenceReading {
  ok: true;
  rows: FenceRow[];
  violations: FenceViolation[];
  /** Rows past their expiry date — reported, never silently ignored. */
  expired: FenceExpired[];
  checked: number;
}

export interface FenceUnreadable {
  ok: false;
  message: string;
  next_action: string;
}

export type FenceResult = FenceReading | FenceUnreadable;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Glob matching, deliberately small: `**` spans separators, `*` does not, `?` is
 * one character. That is the subset every fence in this repository has ever
 * needed, and a fence pattern language nobody can predict is a fence nobody
 * trusts. An unanchored pattern matches from the repository root, because a fence
 * row that could match anywhere would be a rule whose meaning depends on where
 * you stand.
 */
export function fenceMatches(pattern: string, path: string): boolean {
  // Scanned left to right rather than built from chained `replace` calls. The
  // chained version needed sentinel characters to stop later rules rewriting
  // earlier ones, and its two `**` cases came out the same — compiling
  // `harness/cli/src/**` to a regex that only matched a path ending in a slash,
  // so every in-fence file read as out of fence and every forbid row silently
  // missed. A fence that refuses everything and one that refuses nothing both
  // look like the tool working.
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        // `**/` spans zero or more leading segments, so `docs/**/x` matches
        // `docs/x` as well as `docs/a/b/x`.
        source += '(?:[^/]+/)*';
        index += 2;
      } else {
        // A trailing `**` takes everything that remains, including nothing.
        source += '.*';
        index += 1;
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += char.replace(/[.+^${}()|[\]\\]/, '\\$&');
  }
  return new RegExp(`^${source}$`).test(path);
}

/** Read the rows out of a fence document, or say why it is not one. */
export function readFenceRows(doc: DdDoc): { ok: true; rows: FenceRow[] } | FenceUnreadable {
  const section = doc.sections.find((entry) => entry.name === 'rows');
  if (section === undefined || !Array.isArray(section.value)) {
    return {
      ok: false,
      message: 'this document has no `rows` section, so it cannot act as a fence',
      next_action:
        'Point at a document whose schema is `builder/fence`, or add the rows the fence is meant to hold.',
    };
  }
  const rows: FenceRow[] = [];
  for (const entry of section.value) {
    if (!isRecord(entry)) continue;
    const { id, pattern, mode, owner, cause, expiry, note } = entry;
    if (
      typeof id !== 'string' ||
      typeof pattern !== 'string' ||
      (mode !== 'allow' && mode !== 'forbid') ||
      typeof owner !== 'string' ||
      typeof cause !== 'string'
    ) {
      return {
        ok: false,
        message: `fence row ${typeof id === 'string' ? id : '<unnamed>'} is missing a required field (pattern, mode, owner, cause)`,
        next_action:
          'Run `harness dd validate <fence>` — a fence whose rows are half-written refuses work for reasons nobody can read.',
      };
    }
    rows.push({
      id,
      pattern,
      mode,
      owner,
      cause,
      ...(typeof expiry === 'string' && { expiry }),
      ...(typeof note === 'string' && { note }),
    });
  }
  return { ok: true, rows };
}

/**
 * Compare touched paths against a fence.
 *
 * FORBID beats ALLOW, always. A fence is a safety rule, and the reading that
 * fails safe is the one where an explicit prohibition cannot be widened away by a
 * broader permission written later. It also makes amendments cheap to reason
 * about: adding an allow row can never quietly unlock something a forbid row
 * names.
 *
 * With no allow rows at all, every path is permitted unless forbidden — a fence
 * that only forbids is a blocklist, and reading it as "nothing is allowed" would
 * turn a partial fence into a total one by accident.
 */
export function checkFence(
  rows: readonly FenceRow[],
  paths: readonly string[],
  options: { now?: string } = {},
): FenceReading {
  const allows = rows.filter((row) => row.mode === 'allow');
  const forbids = rows.filter((row) => row.mode === 'forbid');
  const violations: FenceViolation[] = [];

  for (const path of paths) {
    const forbidden = forbids.find((row) => fenceMatches(row.pattern, path));
    if (forbidden !== undefined) {
      violations.push({
        path,
        row: forbidden.id,
        pattern: forbidden.pattern,
        mode: 'forbid',
        owner: forbidden.owner,
        cause: forbidden.cause,
        reason: 'forbidden',
      });
      continue;
    }
    if (allows.length === 0) continue;
    if (allows.some((row) => fenceMatches(row.pattern, path))) continue;
    violations.push({
      path,
      row: allows.map((row) => row.id).join(','),
      pattern: allows.map((row) => row.pattern).join(' | '),
      mode: 'allow',
      owner: allows[0]?.owner ?? '',
      cause: 'no allow row covers this path',
      reason: 'not-allowed',
    });
  }

  const now = options.now;
  const expired: FenceExpired[] =
    now === undefined
      ? []
      : rows
          .filter((row) => row.expiry !== undefined && row.expiry < now)
          .map((row) => ({ row: row.id, expiry: row.expiry as string, owner: row.owner }));

  return { ok: true, rows: [...rows], violations, expired, checked: paths.length };
}

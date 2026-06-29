/**
 * Pure core for the `check:doctrine-parity` guard (plan 040, Phase 5; AC-09/10).
 *
 * The `doctrine-parity:039` block is the single source of truth for the harness
 * chore/seam shape. It is authored **byte-identically** in TWO repos:
 *   - the-flow (a separate user-global skill): `references/harness-seams.md` — canonical
 *   - this repo: `skills/eng-harness-flow/SKILL.md` — the mirror (always present)
 * The marker comment promises "the parity guard diffs them"; this is that guard's
 * logic. It extracts the delimited block from a file's text and compares two blocks.
 *
 * NO `node:*`, NO I/O — by design (the hexagonal pure-core rule). The caller
 * (`scripts/doctrine-parity.mjs`) reads the bytes and resolves the-flow's deploy path
 * through injected predicates, so the parity logic is unit-tested with FIXTURES and
 * never against the real `~/.agents` (C1/AC-09 — eng-harness-flow must not depend on
 * the-flow at runtime; the guard SKIPS gracefully when the-flow is absent).
 */

/** The doctrine-parity marker version this guard keys on. Bump in lockstep with the
 *  block (the v1 → v2 bump landed with the D1 full-seed/no-gate rewrite). */
export const MARKER_VERSION = 'v2';

const OPEN_PREFIX = `<!-- doctrine-parity:039 ${MARKER_VERSION}`;
const CLOSE_MARKER = `<!-- /doctrine-parity:039 ${MARKER_VERSION} -->`;

/**
 * Extract the doctrine-parity block from a markdown file's text — from the start of
 * the open-marker comment through the end of the close-marker comment, INCLUSIVE (so
 * the version string + the marker prose are part of what gets compared; a version skew
 * surfaces as drift). Returns `null` when either marker is absent.
 */
export function extractDoctrineBlock(text: string): string | null {
  const open = text.indexOf(OPEN_PREFIX);
  if (open === -1) return null;
  const close = text.indexOf(CLOSE_MARKER, open);
  if (close === -1) return null;
  return text.slice(open, close + CLOSE_MARKER.length);
}

/** Join path segments with `/`, collapsing duplicate separators — a node-free helper
 *  so this core carries no `node:path` import (the candidate paths are POSIX-shaped). */
function joinPath(...segs: string[]): string {
  return segs
    .filter((s) => s.length > 0)
    .join('/')
    .replace(/(?<!:)\/{2,}/g, '/');
}

/**
 * The ordered candidate paths for the-flow's `harness-seams.md`, given the environment
 * and the home dir. Mirrors the documented resolver order:
 *   1. `$HARNESS_THE_FLOW_DIR` — an explicit override; accepted as a direct `*.md` file
 *      path OR a the-flow dir (we then probe `<dir>/references/harness-seams.md` and
 *      `<dir>/harness-seams.md`).
 *   2. `~/.agents/skills/the-flow/references/harness-seams.md` — the raw deploy copy.
 *   3. `~/.claude/skills/the-flow/references/harness-seams.md` — the symlinked mirror.
 */
export function theFlowSeamsCandidates(opts: {
  env: Record<string, string | undefined>;
  home: string;
}): string[] {
  const out: string[] = [];
  const override = opts.env.HARNESS_THE_FLOW_DIR?.trim();
  if (override) {
    if (override.endsWith('.md')) out.push(override);
    else {
      out.push(joinPath(override, 'references/harness-seams.md'));
      out.push(joinPath(override, 'harness-seams.md'));
    }
  }
  out.push(joinPath(opts.home, '.agents/skills/the-flow/references/harness-seams.md'));
  out.push(joinPath(opts.home, '.claude/skills/the-flow/references/harness-seams.md'));
  return out;
}

/** First existing candidate path, or `null` when the-flow is not locatable. Pure: the
 *  `exists` predicate is injected (the script passes `existsSync`; tests pass a fake). */
export function resolveTheFlowSeamsPath(opts: {
  env: Record<string, string | undefined>;
  home: string;
  exists: (path: string) => boolean;
}): string | null {
  for (const candidate of theFlowSeamsCandidates(opts)) {
    if (opts.exists(candidate)) return candidate;
  }
  return null;
}

/** A short, line-level drift report (first few differing lines), labelled per side. */
export function blockDiff(inRepo: string, theFlow: string, max = 8): string {
  const a = inRepo.split('\n');
  const b = theFlow.split('\n');
  const n = Math.max(a.length, b.length);
  const lines: string[] = [];
  let shown = 0;
  for (let i = 0; i < n && shown < max; i++) {
    if (a[i] !== b[i]) {
      lines.push(`  L${i + 1}:`);
      lines.push(`    - in-repo : ${JSON.stringify(a[i] ?? '<missing>')}`);
      lines.push(`    + the-flow: ${JSON.stringify(b[i] ?? '<missing>')}`);
      shown++;
    }
  }
  if (shown === max) lines.push('  … (further differences elided)');
  return lines.join('\n');
}

export type ParityVerdict = 'ok' | 'fail' | 'skip' | 'error';

export interface ParityResult {
  verdict: ParityVerdict;
  /** 0 for ok/skip (never blocks the gate); 1 for fail/error. */
  exitCode: number;
  message: string;
  diff?: string;
  theFlowPath?: string | null;
}

/**
 * The verdict combinator — the heart of the guard.
 *   - in-repo block missing            → `error`  (exit 1; the mirror must always carry it)
 *   - the-flow not locatable           → `skip`   (exit 0; NEVER fail — graceful skip, C1)
 *   - the-flow present, no v2 block     → `fail`   (exit 1; a stale copy — re-deploy the-flow)
 *   - blocks differ                    → `fail`   (exit 1; with a diff)
 *   - blocks byte-identical            → `ok`     (exit 0)
 */
export function evaluateParity(args: {
  inRepoText: string;
  inRepoLabel: string;
  theFlowText: string | null;
  theFlowPath: string | null;
}): ParityResult {
  const inRepoBlock = extractDoctrineBlock(args.inRepoText);
  if (inRepoBlock === null) {
    return {
      verdict: 'error',
      exitCode: 1,
      message: `doctrine-parity:039 ${MARKER_VERSION} block not found in ${args.inRepoLabel} — the in-repo mirror must always carry it.`,
      theFlowPath: args.theFlowPath,
    };
  }

  if (args.theFlowText === null) {
    return {
      verdict: 'skip',
      exitCode: 0,
      message:
        'the-flow not present (no harness-seams.md at any deploy path) — doctrine parity not checked. ' +
        'eng-harness-flow is standalone; this is expected on a the-flow-less machine and in CI.',
      theFlowPath: null,
    };
  }

  const theFlowBlock = extractDoctrineBlock(args.theFlowText);
  if (theFlowBlock === null) {
    return {
      verdict: 'fail',
      exitCode: 1,
      message:
        `the-flow is present at ${args.theFlowPath} but carries no doctrine-parity:039 ${MARKER_VERSION} block ` +
        '(a stale copy — re-deploy the-flow so its canonical block matches the in-repo mirror).',
      theFlowPath: args.theFlowPath,
    };
  }

  if (inRepoBlock === theFlowBlock) {
    return {
      verdict: 'ok',
      exitCode: 0,
      message: `doctrine-parity:039 ${MARKER_VERSION} block is byte-identical in ${args.inRepoLabel} and the-flow (${args.theFlowPath}).`,
      theFlowPath: args.theFlowPath,
    };
  }

  return {
    verdict: 'fail',
    exitCode: 1,
    message:
      `doctrine-parity:039 ${MARKER_VERSION} block DIFFERS between ${args.inRepoLabel} and the-flow (${args.theFlowPath}). ` +
      'Edit BOTH copies so they are byte-identical (then re-deploy the-flow).',
    diff: blockDiff(inRepoBlock, theFlowBlock),
    theFlowPath: args.theFlowPath,
  };
}

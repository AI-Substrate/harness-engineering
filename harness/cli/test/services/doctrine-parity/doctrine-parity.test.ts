import { describe, expect, it } from 'vitest';
import {
  blockDiff,
  evaluateParity,
  extractDoctrineBlock,
  MARKER_VERSION,
  resolveTheFlowSeamsPath,
  theFlowSeamsCandidates,
} from '../../../src/services/doctrine-parity/doctrine-parity.js';

/**
 * P5 (plan 040 · AC-09/10) — the pure core of `check:doctrine-parity`. The guard
 * asserts the `doctrine-parity:039` block is byte-identical in the in-repo mirror
 * (`skills/eng-harness-flow/SKILL.md`) and the-flow's canonical `harness-seams.md`.
 * These tests drive the PURE core with FIXTURES — never the real `~/.agents` (C1):
 * identical → ok, one-char-diff → fail, the-flow missing → skip.
 */

const OPEN = `<!-- doctrine-parity:039 ${MARKER_VERSION} — mirrored byte-identically; edit BOTH copies. -->`;
const CLOSE = `<!-- /doctrine-parity:039 ${MARKER_VERSION} -->`;

/** A realistic file that wraps the block in surrounding prose (as both real files do). */
function fileWith(block: string): string {
  return `# Some heading\n\nIntro prose that differs between the two files.\n\n${block}\n\n> trailer prose, also file-specific.\n`;
}

const BLOCK = `${OPEN}

This is the **canonical** statement of the harness chore/seam shape.

**Creation is two parts — no gate** *(D1)*:

1. The full pre-authored template seed — 9 nodes, baked unconditionally.
2. A plan-complete additive expander — byte-stable idempotent, no gate.

**D5 — never resurrect a terminal node.**

${CLOSE}`;

describe('extractDoctrineBlock', () => {
  it('extracts the block inclusive of both markers, ignoring file-specific surroundings', () => {
    const got = extractDoctrineBlock(fileWith(BLOCK));
    expect(got).toBe(BLOCK);
    expect(got?.startsWith(OPEN)).toBe(true);
    expect(got?.endsWith(CLOSE)).toBe(true);
  });

  it('returns null when the open marker is absent', () => {
    expect(extractDoctrineBlock('# no markers here\n\njust prose\n')).toBeNull();
  });

  it('returns null when only the open marker is present (truncated block)', () => {
    expect(extractDoctrineBlock(`prose\n${OPEN}\nbody with no close\n`)).toBeNull();
  });

  it('returns null for a stale older-version block (keys on the current version only)', () => {
    const v1 = '<!-- doctrine-parity:039 v1 — old -->\nbody\n<!-- /doctrine-parity:039 v1 -->';
    expect(extractDoctrineBlock(fileWith(v1))).toBeNull();
  });
});

describe('evaluateParity', () => {
  const inRepoLabel = 'skills/eng-harness-flow/SKILL.md';

  it('IDENTICAL blocks → ok (exit 0), even with different surrounding prose', () => {
    const r = evaluateParity({
      inRepoText: fileWith(BLOCK),
      inRepoLabel,
      theFlowText: `# the-flow file\n\nTotally different wrapper.\n\n${BLOCK}\n`,
      theFlowPath: '/home/x/.agents/skills/the-flow/references/harness-seams.md',
    });
    expect(r.verdict).toBe('ok');
    expect(r.exitCode).toBe(0);
    expect(r.diff).toBeUndefined();
  });

  it('ONE-CHAR diff inside the block → fail (exit 1) with a diff', () => {
    const tampered = BLOCK.replace('9 nodes', '8 nodes');
    const r = evaluateParity({
      inRepoText: fileWith(BLOCK),
      inRepoLabel,
      theFlowText: fileWith(tampered),
      theFlowPath: '/home/x/.agents/.../harness-seams.md',
    });
    expect(r.verdict).toBe('fail');
    expect(r.exitCode).toBe(1);
    expect(r.diff).toContain('9 nodes');
    expect(r.diff).toContain('8 nodes');
  });

  it('the-flow NOT locatable → skip (exit 0, never fail)', () => {
    const r = evaluateParity({
      inRepoText: fileWith(BLOCK),
      inRepoLabel,
      theFlowText: null,
      theFlowPath: null,
    });
    expect(r.verdict).toBe('skip');
    expect(r.exitCode).toBe(0);
  });

  it('the-flow present but carries no current-version block → fail (stale; re-deploy)', () => {
    const v1Only =
      '# the-flow\n\n<!-- doctrine-parity:039 v1 — old -->\nstale\n<!-- /doctrine-parity:039 v1 -->\n';
    const r = evaluateParity({
      inRepoText: fileWith(BLOCK),
      inRepoLabel,
      theFlowText: v1Only,
      theFlowPath: '/home/x/.agents/.../harness-seams.md',
    });
    expect(r.verdict).toBe('fail');
    expect(r.exitCode).toBe(1);
  });

  it('in-repo mirror missing the block → error (the mirror must always carry it)', () => {
    const r = evaluateParity({
      inRepoText: '# SKILL.md with no doctrine block\n',
      inRepoLabel,
      theFlowText: fileWith(BLOCK),
      theFlowPath: '/home/x/.agents/.../harness-seams.md',
    });
    expect(r.verdict).toBe('error');
    expect(r.exitCode).toBe(1);
  });
});

describe('resolveTheFlowSeamsPath', () => {
  const home = '/home/dev';

  it('falls back to ~/.agents then ~/.claude in order', () => {
    const candidates = theFlowSeamsCandidates({ env: {}, home });
    expect(candidates).toEqual([
      '/home/dev/.agents/skills/the-flow/references/harness-seams.md',
      '/home/dev/.claude/skills/the-flow/references/harness-seams.md',
    ]);
  });

  it('prefers the ~/.agents copy when present', () => {
    const agents = '/home/dev/.agents/skills/the-flow/references/harness-seams.md';
    const got = resolveTheFlowSeamsPath({ env: {}, home, exists: (p) => p === agents });
    expect(got).toBe(agents);
  });

  it('uses ~/.claude when ~/.agents is absent', () => {
    const claude = '/home/dev/.claude/skills/the-flow/references/harness-seams.md';
    const got = resolveTheFlowSeamsPath({ env: {}, home, exists: (p) => p === claude });
    expect(got).toBe(claude);
  });

  it('returns null when the-flow is absent everywhere', () => {
    expect(resolveTheFlowSeamsPath({ env: {}, home, exists: () => false })).toBeNull();
  });

  it('HARNESS_THE_FLOW_DIR override (a dir) wins and probes references/ first', () => {
    const env = { HARNESS_THE_FLOW_DIR: '/repos/tools/skills/SDD/the-flow' };
    const candidates = theFlowSeamsCandidates({ env, home });
    expect(candidates[0]).toBe('/repos/tools/skills/SDD/the-flow/references/harness-seams.md');
    expect(candidates[1]).toBe('/repos/tools/skills/SDD/the-flow/harness-seams.md');
    const got = resolveTheFlowSeamsPath({
      env,
      home,
      exists: (p) => p === '/repos/tools/skills/SDD/the-flow/references/harness-seams.md',
    });
    expect(got).toBe('/repos/tools/skills/SDD/the-flow/references/harness-seams.md');
  });

  it('HARNESS_THE_FLOW_DIR override accepts a direct *.md file path', () => {
    const env = { HARNESS_THE_FLOW_DIR: '/custom/harness-seams.md' };
    expect(theFlowSeamsCandidates({ env, home })[0]).toBe('/custom/harness-seams.md');
  });
});

describe('blockDiff', () => {
  it('reports the first differing line, labelled per side', () => {
    const d = blockDiff('alpha\nbeta\ngamma', 'alpha\nBETA\ngamma');
    expect(d).toContain('L2');
    expect(d).toContain('beta');
    expect(d).toContain('BETA');
  });
});

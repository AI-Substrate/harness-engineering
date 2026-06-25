import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExecGitWrite } from '../../../src/adapters/git/exec-git-write.js';
import {
  TELEMETRY_FALLBACK_AUTHOR,
  telemetryRefFor,
} from '../../../src/adapters/git/git-write-port.js';

/** A representative shard ref — the real plumbing is ref-agnostic; this exercises a dated per-session ref. */
const TELEMETRY_REF = telemetryRefFor('2026/03/23', 'sessA');

/**
 * T002 (plan 034 Phase 4 · 4.2 · AC-06/07) — the REAL git plumbing against a
 * throwaway repo. Proves the two claims a fake cannot: (1) the orphan-ref write
 * leaves `git status --porcelain` byte-identical (no index/worktree touch, AC-06),
 * and (2) the commit author AND committer are the **contributor's configured git
 * identity** (the 2026-06-25 attribution decision — telemetry refs are traceable
 * to who pushed them), with the generic fallback only when none is configured.
 */

const ENGINEER_EMAIL = 'engineer@example.com';
let repo: string;
let git: ExecGitWrite;

function g(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'telem-gitwrite-'));
  g('init', '-q');
  g('config', 'user.email', ENGINEER_EMAIL);
  g('config', 'user.name', 'Engineer Individual');
  g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), '# fixture\n');
  g('add', 'README.md');
  g('commit', '-q', '-m', 'initial');
  git = new ExecGitWrite(repo);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('ExecGitWrite — real orphan-ref plumbing', () => {
  it('writes an orphan telemetry commit without touching the index/working tree (AC-06)', () => {
    const porcelainBefore = g('status', '--porcelain');

    const blob = git.hashObject('{"command":"doctor","window":{"from":0,"to":8}}\n');
    expect(blob).toMatch(/^[0-9a-f]{40}$/);
    const tree = git.mktree([{ mode: '100644', type: 'blob', sha: blob, name: '1.json' }]);
    const parent = git.refTip(TELEMETRY_REF);
    expect(parent).toBeNull(); // first ever → orphan
    const commit = git.commitTree(tree, parent, 'telemetry: flush 1 segment');
    expect(git.updateRef(TELEMETRY_REF, commit, parent)).toBe(true);

    // The ref now points at our commit…
    expect(g('rev-parse', TELEMETRY_REF)).toBe(commit);
    // …and the segment is in the ref's tree, not the working tree.
    expect(g('cat-file', '-p', `${TELEMETRY_REF}:1.json`)).toContain('"command":"doctor"');
    // AC-06: nothing staged, nothing changed in the working tree.
    expect(g('status', '--porcelain')).toBe(porcelainBefore);
  });

  it('attributes the commit to the configured contributor identity (author AND committer, AC-07)', () => {
    expect(g('config', 'user.email')).toBe(ENGINEER_EMAIL);
    const commit = g('rev-parse', TELEMETRY_REF);

    const authorEmail = g('show', '-s', '--format=%ae', commit);
    const committerEmail = g('show', '-s', '--format=%ce', commit);
    const authorName = g('show', '-s', '--format=%an', commit);

    // Attributable: the contributor's own git identity is on the telemetry commit.
    expect(authorEmail).toBe(ENGINEER_EMAIL);
    expect(committerEmail).toBe(ENGINEER_EMAIL);
    expect(authorName).toBe('Engineer Individual');
  });

  it('updateRef is real compare-and-set: a stale oldSha is rejected', () => {
    const tip = git.refTip(TELEMETRY_REF);
    expect(tip).not.toBeNull();
    const blob = git.hashObject('{"command":"flow"}\n');
    const tree = git.mktree([{ mode: '100644', type: 'blob', sha: blob, name: '2.json' }]);
    const next = git.commitTree(tree, tip, 'flush 2');
    // Wrong oldSha → rejected, tip unmoved.
    expect(git.updateRef(TELEMETRY_REF, next, '0000000000000000000000000000000000000000')).toBe(
      false,
    );
    expect(git.refTip(TELEMETRY_REF)).toBe(tip);
    // Correct oldSha → accepted.
    expect(git.updateRef(TELEMETRY_REF, next, tip)).toBe(true);
    expect(git.refTip(TELEMETRY_REF)).toBe(next);
  });

  it('deleteRef removes the ref (the orphan-rollback primitive)', () => {
    expect(git.refTip(TELEMETRY_REF)).not.toBeNull();
    git.deleteRef(TELEMETRY_REF);
    expect(git.refTip(TELEMETRY_REF)).toBeNull();
    // Still no working-tree footprint after all that.
    expect(g('status', '--porcelain')).toBe('');
  });

  it('push throws on failure (no origin remote) — the offline-safe path the service catches', () => {
    expect(() => git.push(`${TELEMETRY_REF}:${TELEMETRY_REF}`)).toThrow();
  });

  /**
   * AC-13 / A4 fallback branch — the OTHER half of attribution: when the repo has
   * NO configured `user.name`/`user.email`, `commitTree` injects the generic
   * `TELEMETRY_FALLBACK_AUTHOR` so an unconfigured environment (a fresh CI runner)
   * never fails the commit. Isolated in a throwaway repo with global+system config
   * pointed at /dev/null, so the dev box's own git identity can't satisfy the
   * `git config user.*` probe and the fallback path is exercised for real.
   */
  it('falls back to the generic identity when git has no configured user (AC-13)', () => {
    const noIdRepo = mkdtempSync(join(tmpdir(), 'telem-gitwrite-noid-'));
    const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
    const savedSystem = process.env.GIT_CONFIG_SYSTEM;
    try {
      // Disable global+system config for every git child in this test → the repo
      // genuinely has no identity, so fallbackIdentityEnv() injects the fallback.
      process.env.GIT_CONFIG_GLOBAL = '/dev/null';
      process.env.GIT_CONFIG_SYSTEM = '/dev/null';
      const ng = (...args: string[]): string =>
        execFileSync('git', args, { cwd: noIdRepo, encoding: 'utf8' }).trim();
      ng('init', '-q');
      ng('config', 'commit.gpgsign', 'false'); // local config only; identity stays unset

      const gitNoId = new ExecGitWrite(noIdRepo);
      const blob = gitNoId.hashObject('{"command":"doctor"}\n');
      const tree = gitNoId.mktree([{ mode: '100644', type: 'blob', sha: blob, name: '1.json' }]);
      const commit = gitNoId.commitTree(tree, null, 'telemetry: flush (no configured identity)');

      // Author AND committer are the generic fallback — never a dev-box identity.
      expect(ng('show', '-s', '--format=%ae', commit)).toBe(TELEMETRY_FALLBACK_AUTHOR.email);
      expect(ng('show', '-s', '--format=%ce', commit)).toBe(TELEMETRY_FALLBACK_AUTHOR.email);
      expect(ng('show', '-s', '--format=%an', commit)).toBe(TELEMETRY_FALLBACK_AUTHOR.name);
    } finally {
      if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
      if (savedSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = savedSystem;
      rmSync(noIdRepo, { recursive: true, force: true });
    }
  });
});

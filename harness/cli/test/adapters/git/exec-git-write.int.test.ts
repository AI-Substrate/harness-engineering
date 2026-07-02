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
   * RECURSION-SAFETY GUARD — the telemetry push MUST carry `--no-verify` so it can
   * never trigger a `pre-push` hook. A push-triggered gate that itself pushes
   * telemetry recursed catastrophically (the removed pre-push `harness checks` gate
   * → load average 175). This proves the flag is present AND effective: a `pre-push`
   * hook that ALWAYS fails cannot block the telemetry push.
   */
  it('push uses --no-verify: a failing pre-push hook cannot block it', () => {
    const remote = mkdtempSync(join(tmpdir(), 'telem-gitwrite-remote-'));
    try {
      execFileSync('git', ['init', '--bare', '-q', remote]);
      g('remote', 'add', 'origin', remote);
      // A pre-push hook that ALWAYS fails — a push WITHOUT --no-verify aborts here.
      writeFileSync(
        join(repo, '.git', 'hooks', 'pre-push'),
        '#!/usr/bin/env bash\necho "pre-push BLOCK" >&2\nexit 1\n',
        { mode: 0o755 },
      );
      const ref = telemetryRefFor('2026/03/24', 'sessNoVerify');
      const blob = git.hashObject('{"command":"doctor","window":{"from":0,"to":1}}\n');
      const tree = git.mktree([{ mode: '100644', type: 'blob', sha: blob, name: '1.json' }]);
      const commit = git.commitTree(tree, null, 'telemetry: flush nv');
      git.updateRef(ref, commit, null);

      // --no-verify bypasses the failing hook → push succeeds, the ref lands on the remote.
      expect(() => git.push(`${ref}:${ref}`)).not.toThrow();
      expect(
        execFileSync('git', ['--git-dir', remote, 'rev-parse', ref], { encoding: 'utf8' }).trim(),
      ).toBe(commit);
    } finally {
      try {
        g('remote', 'remove', 'origin');
      } catch {
        /* best-effort cleanup */
      }
      rmSync(join(repo, '.git', 'hooks', 'pre-push'), { force: true });
      rmSync(remote, { recursive: true, force: true });
    }
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

  it('readRefTree lifts a real ref tree back to its flat blobs byte-verbatim; null for a missing ref', () => {
    // The T007 union source: a LOCAL `cat-file` walk of the ref's own tree (no
    // remote), returning name+bytes for the rolled rewrite. Byte-verbatim is the P12
    // guarantee — the reader must not re-encode the concatenated OTLP records.
    const ref = telemetryRefFor('2026/04/01', 'sessR');
    expect(git.readRefTree(ref)).toBeNull(); // absent ref → null (a fresh session)

    const logsBytes = '{"resourceLogs":[{"seq":1}]}\n{"resourceLogs":[{"seq":2}]}\n';
    const manifestBytes =
      '{"format":"harness-telemetry-rollup/v1","session":"sessR","start_date":"2026/04/01","max_seq":2}\n';
    const logs = git.hashObject(logsBytes);
    const manifest = git.hashObject(manifestBytes);
    const tree = git.mktree([
      { mode: '100644', type: 'blob', sha: logs, name: 'session.logs.jsonl' },
      { mode: '100644', type: 'blob', sha: manifest, name: 'manifest.json' },
    ]);
    const commit = git.commitTree(tree, null, 'roll');
    expect(git.updateRef(ref, commit, null)).toBe(true);

    const blobs = git.readRefTree(ref);
    expect(blobs).not.toBeNull();
    const byName = Object.fromEntries((blobs ?? []).map((b) => [b.name, b.content]));
    expect(byName['session.logs.jsonl']).toBe(logsBytes); // byte-verbatim, trailing NL intact
    expect(byName['manifest.json']).toBe(manifestBytes);
  });

  it('readRefTree round-trips a >1 MiB blob byte-verbatim (shared 64 MiB maxBuffer — plan 049 round-2 F1)', () => {
    // A rolled `session.logs.jsonl` routinely exceeds Node's default 1 MiB stdout
    // cap. WITHOUT the shared maxBuffer, `cat-file blob` returns an ENOBUFS `error`
    // with a truncated stdout — and readRefTree now FAILS CLOSED on that (throws)
    // rather than force-pushing a partial roll. With the cap lifted, the whole blob
    // must round-trip byte-identical.
    const ref = telemetryRefFor('2026/04/02', 'sessBig');
    // >1 MiB of distinct single-line JSONL records (each ends in `\n`).
    const lines: string[] = [];
    let total = 0;
    let n = 0;
    while (total <= 1024 * 1024) {
      const line = `${JSON.stringify({ resourceLogs: [{ seq: n, pad: 'x'.repeat(64) }] })}\n`;
      lines.push(line);
      total += Buffer.byteLength(line);
      n++;
    }
    const logsBytes = lines.join('');
    expect(Buffer.byteLength(logsBytes)).toBeGreaterThan(1024 * 1024); // guard: actually > 1 MiB

    const logs = git.hashObject(logsBytes);
    const tree = git.mktree([
      { mode: '100644', type: 'blob', sha: logs, name: 'session.logs.jsonl' },
    ]);
    const commit = git.commitTree(tree, null, 'roll-big');
    expect(git.updateRef(ref, commit, null)).toBe(true);

    const blobs = git.readRefTree(ref);
    expect(blobs).not.toBeNull();
    const back = (blobs ?? []).find((b) => b.name === 'session.logs.jsonl');
    expect(back?.content).toBe(logsBytes); // full bytes, not an ENOBUFS-truncated prefix
    expect(Buffer.byteLength(back?.content ?? '')).toBe(Buffer.byteLength(logsBytes));
  });

  it('readRefBlob reads ONE ref blob byte-verbatim; null for a missing name or ref (plan 049 DL-001)', () => {
    // The manifest-only no-op fast path: a LOCAL `cat-file blob <ref>:<name>` that reads
    // exactly one blob rather than the whole (multi-MB) tree. Byte-verbatim (P12), and a
    // clean null — never a throw — when the ref or the path is absent.
    const ref = telemetryRefFor('2026/04/03', 'sessBlob');
    expect(git.readRefBlob(ref, 'manifest.json')).toBeNull(); // absent ref → null

    const manifestBytes =
      '{"format":"harness-telemetry-rollup/v1","session":"sessBlob","start_date":"2026/04/03","max_seq":7}\n';
    const logsBytes = '{"resourceLogs":[{"seq":1}]}\n';
    const manifest = git.hashObject(manifestBytes);
    const logs = git.hashObject(logsBytes);
    const tree = git.mktree([
      { mode: '100644', type: 'blob', sha: logs, name: 'session.logs.jsonl' },
      { mode: '100644', type: 'blob', sha: manifest, name: 'manifest.json' },
    ]);
    const commit = git.commitTree(tree, null, 'roll-blob');
    expect(git.updateRef(ref, commit, null)).toBe(true);

    // Reads exactly the named blob, byte-verbatim (trailing NL intact).
    expect(git.readRefBlob(ref, 'manifest.json')).toBe(manifestBytes);
    expect(git.readRefBlob(ref, 'session.logs.jsonl')).toBe(logsBytes);
    // A path that is not in the tree → clean null (the ref exists, the blob does not).
    expect(git.readRefBlob(ref, 'does-not-exist.json')).toBeNull();
  });
});

/**
 * T001 (plan 049 Phase 1) — the additive MIGRATION verbs against a real bare remote:
 * `lsRemoteTelemetryRefs` (the one sanctioned pull's discovery half), `fetchRef`
 * (bring an old ref's history local), and `deleteRemoteRef` (post-rollup cleanup via
 * the `--no-verify` push path). Proven against a throwaway repo + bare remote — the
 * claims a fake cannot make: real ls-remote parsing, a real forced fetch, a real
 * remote delete.
 */
describe('ExecGitWrite — migration verbs against a real bare remote (plan 049 T001)', () => {
  let mRepo: string;
  let remote: string;
  let mGit: ExecGitWrite;
  const REF_A = telemetryRefFor('2026/06/24', 'mSessA');
  const REF_B = telemetryRefFor('2026/06/25', 'mSessB');

  function mg(...args: string[]): string {
    return execFileSync('git', args, { cwd: mRepo, encoding: 'utf8' }).trim();
  }
  function pushRef(ref: string, name: string): string {
    const blob = mGit.hashObject(`{"seg":"${name}"}\n`);
    const tree = mGit.mktree([{ mode: '100644', type: 'blob', sha: blob, name }]);
    const commit = mGit.commitTree(tree, null, `seed ${name}`);
    mGit.updateRef(ref, commit, null);
    mGit.push(`${ref}:${ref}`);
    return commit;
  }

  beforeAll(() => {
    mRepo = mkdtempSync(join(tmpdir(), 'telem-migrate-'));
    remote = mkdtempSync(join(tmpdir(), 'telem-migrate-remote-'));
    execFileSync('git', ['init', '--bare', '-q', remote]);
    mg('init', '-q');
    mg('config', 'user.email', ENGINEER_EMAIL);
    mg('config', 'user.name', 'Engineer Individual');
    mg('config', 'commit.gpgsign', 'false');
    mg('remote', 'add', 'origin', remote);
    mGit = new ExecGitWrite(mRepo);
    pushRef(REF_A, '0.json');
    pushRef(REF_B, '0.json');
  });

  afterAll(() => {
    rmSync(mRepo, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });

  it('lsRemoteTelemetryRefs discovers exactly the telemetry refs on the remote', () => {
    expect(mGit.lsRemoteTelemetryRefs().sort()).toEqual([REF_A, REF_B].sort());
  });

  it('fetchRef brings a remote-only ref local (its history becomes walkable)', () => {
    // Delete the local ref so only the remote copy remains, then fetch it back.
    mGit.deleteRef(REF_A);
    expect(mGit.refTip(REF_A)).toBeNull();
    mGit.fetchRef(REF_A);
    expect(mGit.refTip(REF_A)).not.toBeNull();
    // The fetched ref's tree is readable locally (rev-parse succeeds).
    expect(mg('cat-file', '-p', `${REF_A}:0.json`)).toContain('"seg"');
  });

  it('deleteRemoteRef removes the ref from the remote (rides --no-verify)', () => {
    expect(mGit.lsRemoteTelemetryRefs()).toContain(REF_B);
    mGit.deleteRemoteRef(REF_B);
    expect(mGit.lsRemoteTelemetryRefs()).not.toContain(REF_B);
  });

  it('lsRemoteTelemetryRefs throws when the remote is unreachable (deferrable migration)', () => {
    const orphan = new ExecGitWrite(mkdtempSync(join(tmpdir(), 'telem-migrate-noremote-')));
    expect(() => orphan.lsRemoteTelemetryRefs()).toThrow();
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecGitRead } from '../../../src/adapters/git/exec-git-read.js';
import { ExecGitWrite } from '../../../src/adapters/git/exec-git-write.js';
import { TELEMETRY_REF_GLOB, telemetryRefFor } from '../../../src/adapters/git/git-write-port.js';

/**
 * Plan 067 — the BATCHED `cat-file` tree read + the header-only shape probe, against
 * REAL git. The service-level cost tests pin *that* sync stopped walking the corpus;
 * these pin that the replacement plumbing is byte-faithful and actually batched.
 *
 * The framing is the risk: `cat-file --batch` delimits each record by a BYTE count, so
 * a multi-byte blob decoded as utf8 before slicing would silently mis-attribute
 * content to the following entry. The multi-byte + empty-blob cases below are exactly
 * that mutation's tripwire.
 */

const SID = 'b67cd3ce-e0ee-4048-831e-7f4591f20a60';
const REF = telemetryRefFor('2026/06/24', SID);

let repo: string;

function git(...args: string[]): string {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout ?? '';
}

/** Publish a flat tree of `name → content` as an orphan telemetry ref. */
function publish(ref: string, entries: Record<string, string>): void {
  const gw = new ExecGitWrite(repo);
  const tree = gw.mktree(
    Object.entries(entries).map(([name, content]) => ({
      mode: '100644' as const,
      type: 'blob' as const,
      sha: gw.hashObject(content),
      name,
    })),
  );
  const commit = gw.commitTree(tree, null, `telemetry: ${ref}`);
  gw.updateRef(ref, commit, null);
}

/**
 * Publish a LARGE flat tree cheaply: the entries are written as files and hashed by a
 * single `add`/`write-tree` pair, so the fixture costs a handful of git invocations
 * instead of one `hash-object` per entry (which made this test the slowest in the
 * suite). The repo starts with an EMPTY commit, so the written index IS the flat tree.
 */
function publishMany(ref: string, entries: Record<string, string>): void {
  for (const [name, content] of Object.entries(entries)) {
    writeFileSync(join(repo, name), content);
  }
  git('add', '-A');
  const tree = git('write-tree').trim();
  const commit = git('commit-tree', tree, '-m', 'bulk').trim();
  git('update-ref', ref, commit);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'harness-catfile-batch-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '-q', '--allow-empty', '-m', 'init');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('ExecGitRead — batched flat-tree reads (plan 067)', () => {
  it('round-trips multi-byte + empty blobs byte-exactly (the batch framing tripwire)', () => {
    // Multi-byte content: 'é' is 2 bytes / 1 JS char, '🜂' is 4 bytes / 2 chars. A frame
    // parser that slices by CHARACTERS desynchronises here and mis-attributes content.
    const entries = {
      '0.logs.jsonl': '{"resourceLogs":[{"note":"éé🜂"}]}\n',
      '1.logs.jsonl': '',
      '2.logs.jsonl': '{"resourceLogs":[{"note":"plain"}]}\n',
      'manifest.json': '{"format":"harness.telemetry.rollup.v1"}\n',
    };
    publish(REF, entries);

    const blobs = new ExecGitRead(repo).readShardTree(REF);

    expect(Object.fromEntries(blobs.map((b) => [b.name, b.content]))).toEqual(entries);
  });

  it('reads a 150-entry tree in a BOUNDED number of git subprocesses', () => {
    const entries: Record<string, string> = {};
    for (let seq = 1; seq <= 150; seq++) entries[`${seq}.json`] = `{"seq":${seq}}\n`;
    publishMany(REF, entries);

    const trace = join(repo, 'trace.txt');
    const gr = new ExecGitRead(repo);
    const previous = process.env.GIT_TRACE;
    process.env.GIT_TRACE = trace;
    let blobs: { name: string; content: string }[];
    try {
      blobs = gr.readShardTree(REF);
    } finally {
      if (previous === undefined) delete process.env.GIT_TRACE;
      else process.env.GIT_TRACE = previous;
    }

    expect(blobs).toHaveLength(150);
    expect(blobs.find((b) => b.name === '99.json')?.content).toBe('{"seq":99}\n');
    // Pre-067 this cost 151 subprocesses (one `cat-file blob` per entry).
    const spawns = (
      spawnSync('grep', ['-c', 'built-in: git', trace], { encoding: 'utf8' }).stdout ?? '0'
    ).trim();
    expect(Number.parseInt(spawns, 10)).toBeLessThanOrEqual(5);
  });

  it('an absent ref reads as an empty tree (never a throw)', () => {
    const gr = new ExecGitRead(repo);
    expect(gr.readShardTree(telemetryRefFor('2026/06/24', 'no-such-session'))).toEqual([]);
  });
});

describe('ExecGitRead.refsWithBlob — batched shape probe (plan 067)', () => {
  it('classifies rolled vs old-shape refs in ONE git subprocess', () => {
    const rolled = telemetryRefFor('2026/06/24', 'rolled-session');
    const old = telemetryRefFor('2026/06/24', 'old-session');
    publish(rolled, { 'manifest.json': '{"max_seq":1}\n', 'session.logs.jsonl': 'x\n' });
    publish(old, { '1.logs.jsonl': 'x\n' });
    const absent = telemetryRefFor('2026/06/24', 'absent-session');

    const trace = join(repo, 'probe-trace.txt');
    const gr = new ExecGitRead(repo);
    const previous = process.env.GIT_TRACE;
    process.env.GIT_TRACE = trace;
    let withManifest: string[];
    try {
      withManifest = gr.refsWithBlob([rolled, old, absent], 'manifest.json');
    } finally {
      if (previous === undefined) delete process.env.GIT_TRACE;
      else process.env.GIT_TRACE = previous;
    }

    expect(withManifest).toEqual([rolled]);
    const spawns = (
      spawnSync('grep', ['-c', 'built-in: git', trace], { encoding: 'utf8' }).stdout ?? '0'
    ).trim();
    expect(Number.parseInt(spawns, 10)).toBe(1);
  });

  it('agrees with a full tree read about every ref (the probe is not a guess)', () => {
    const rolled = telemetryRefFor('2026/06/24', 'rolled-session');
    const old = telemetryRefFor('2026/06/24', 'old-session');
    publish(rolled, { 'manifest.json': '{"max_seq":1}\n' });
    publish(old, { '1.logs.jsonl': 'x\n' });
    const gr = new ExecGitRead(repo);

    const probed = new Set(gr.refsWithBlob([rolled, old], 'manifest.json'));
    for (const ref of [rolled, old]) {
      const byFullRead = gr.readShardTree(ref).some((b) => b.name === 'manifest.json');
      expect(probed.has(ref)).toBe(byFullRead);
    }
  });

  it('an empty ref list costs no subprocess at all', () => {
    expect(new ExecGitRead(repo).refsWithBlob([], 'manifest.json')).toEqual([]);
  });
});

describe('ExecGitWrite.readRefTree — batched, still fail-closed (plan 067)', () => {
  it('reads the same bytes the READ adapter does, and null for an absent ref', () => {
    const entries = {
      'session.logs.jsonl': '{"resourceLogs":[{"note":"éé🜂"}]}\n',
      'manifest.json': '{"max_seq":3}\n',
    };
    publish(REF, entries);

    const write = new ExecGitWrite(repo).readRefTree(REF);
    const read = new ExecGitRead(repo).readShardTree(REF);

    expect(write).not.toBeNull();
    expect(Object.fromEntries((write ?? []).map((b) => [b.name, b.content]))).toEqual(entries);
    expect(write).toEqual(read);
    expect(new ExecGitWrite(repo).readRefTree(telemetryRefFor('2026/06/24', 'nope'))).toBeNull();
  });

  it('leaves the working tree byte-identical (read-only by construction)', () => {
    publish(REF, { 'manifest.json': '{"max_seq":1}\n' });
    const before = git('status', '--porcelain');
    new ExecGitRead(repo).readShardTree(REF);
    new ExecGitRead(repo).refsWithBlob([REF], 'manifest.json');
    new ExecGitRead(repo).listTelemetryRefs(TELEMETRY_REF_GLOB);
    new ExecGitWrite(repo).readRefTree(REF);
    expect(git('status', '--porcelain')).toBe(before);
  });
});

import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeRemoteTelemetryGit } from '../../../src/adapters/git/fake-remote-telemetry-git.js';
import type {
  RemoteRepository,
  TelemetrySnapshot,
} from '../../../src/adapters/git/remote-telemetry-git-port.js';
import { FakeHash } from '../../../src/adapters/hash/fake-hash.js';
import { isCaptureEnabled } from '../../../src/services/telemetry/capture-gate.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import {
  listPublishedTelemetry,
  pullPublishedTelemetry,
} from '../../../src/services/telemetry/remote-telemetry-service.js';
import { buildReportFromInputs } from '../../../src/services/telemetry/report.js';
import { ROLLUP_FORMAT, serializeManifest } from '../../../src/services/telemetry/rolled-shard.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';
import { readTelemetryBundle } from '../../../src/services/telemetry/telemetry-bundle-reader.js';

/**
 * Plan 073 · ac-0002 — turning CAPTURE off must not turn READING off.
 *
 * 123 `refs/harness-telemetry/*` are already published. If the handover silenced
 * the read path too, that history would become unreachable the day the collector
 * changed — the exact failure class this repo keeps killing: a system that
 * cannot read something reporting there is nothing to read.
 *
 * So the proof is deliberately end-to-end over a published ref, with the gate
 * asserted CLOSED in the same test: list → pull → bundle read → report build all
 * succeed while capture is disabled.
 */

const encoder = new TextEncoder();
const oid = (c: string): string => c.repeat(40);
const SESSION = 'session-published-1';
const PRODUCT = oid('a');

const IDENTITY = 'https://example.com/repo';

/** The repository key is DERIVED (the bundle reader re-verifies it), never invented. */
function repositoryFor(hash: FakeHash): RemoteRepository {
  return {
    key: `repo-${hash.sha256Hex(IDENTITY).slice(0, 16)}`,
    identity: IDENTITY,
    transportUrl: IDENTITY,
  };
}

/** One already-published telemetry ref, exactly as a pre-handover harness left it. */
function publishedFixture(repository: RemoteRepository) {
  const refName = `refs/harness-telemetry/2026/07/16/${SESSION}`;
  const tip = oid('c');
  const segment = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: SESSION,
      timecode: '2026-07-16T00:00:00.000Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      product_commit: PRODUCT,
      event_stream: [
        { t: '2026-07-16T00:00:00.000Z', kind: 'turn', dur_s: 1, in: 1, out: 1 },
        {
          t: '2026-07-16T00:00:00.000Z',
          kind: 'usage',
          observation_kind: 'final_shutdown',
          in: 1,
          out: 1,
          cache_read: 0,
          cache_create: 0,
          nano_aiu: 2,
        },
      ],
    },
    '/repo',
  );
  const entries = [
    {
      path: 'manifest.json',
      mode: '100644',
      type: 'blob' as const,
      oid: oid('1'),
      bytes: encoder.encode(
        serializeManifest({
          format: ROLLUP_FORMAT,
          session: SESSION,
          start_date: '2026/07/16',
          max_seq: 1,
          product_commits: [PRODUCT],
        }),
      ),
    },
    {
      path: 'session.logs.jsonl',
      mode: '100644',
      type: 'blob' as const,
      oid: oid('2'),
      bytes: encoder.encode(`${JSON.stringify(segmentToOtlpLogs(segment))}\n`),
    },
    {
      path: 'session.metrics.jsonl',
      mode: '100644',
      type: 'blob' as const,
      oid: oid('3'),
      bytes: encoder.encode(`${JSON.stringify(rollupToOtlpMetrics(segment))}\n`),
    },
  ];
  const snapshot: TelemetrySnapshot = {
    repository,
    refs: [{ name: refName, advertisedOid: tip, history: [{ oid: tip, parents: [], entries }] }],
    effects: {
      advertisedRefs: 1,
      fetchedRefs: 1,
      telemetryBytes: entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0),
      productGraphFetched: false,
      callerRepositoryMutated: false,
      disposableStoreRemoved: true,
    },
  };
  return {
    advertisement: { ok: true as const, refs: [{ name: refName, oid: tip }], malformedRefCount: 0 },
    snapshot: { ok: true as const, snapshot },
    interval: { ok: true as const, membership: { [PRODUCT]: true }, unavailable: [] },
  };
}

describe('plan 073 — the telemetry READ path is ungated (ac-0002)', () => {
  it('`telemetry pull` resolves an existing published ref while capture is disabled', async () => {
    // The default install: capture is off, and this is the environment the read
    // happens in. Asserted here so the test cannot silently pass with it on.
    expect(isCaptureEnabled(new FakeEnv({}))).toBe(false);

    const hash = new FakeHash();
    const repository = repositoryFor(hash);
    const git = new FakeRemoteTelemetryGit(publishedFixture(repository));
    const fs = new FakeFs();

    const pulled = await pullPublishedTelemetry(
      {
        repositories: [repository],
        selector: { kind: 'session', session: SESSION },
        out: '/exports/pull',
      },
      { git, fs, hash },
    );

    expect(pulled).toMatchObject({ ok: true, data: { sessions: 1, refs: 1, written: true } });
    expect(fs.readText('/exports/pull/bundle.json')).toContain('harness.telemetry-pull-bundle/v1');
    expect(readTelemetryBundle('/exports/pull', { fs, hash }).ok).toBe(true);
  });

  it('`telemetry ls` still advertises the published session while capture is disabled', async () => {
    expect(isCaptureEnabled(new FakeEnv({}))).toBe(false);

    const hash = new FakeHash();
    const repository = repositoryFor(hash);
    const listed = await listPublishedTelemetry(
      { repositories: [repository], selector: null },
      { git: new FakeRemoteTelemetryGit(publishedFixture(repository)), fs: new FakeFs(), hash },
    );

    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.rows).toMatchObject([{ sessionId: SESSION, refCount: 1, fidelity: 'full' }]);
  });

  it('`telemetry report` still builds totals from that pulled ref while capture is disabled', async () => {
    expect(isCaptureEnabled(new FakeEnv({}))).toBe(false);

    const hash = new FakeHash();
    const repository = repositoryFor(hash);
    const fs = new FakeFs();
    await pullPublishedTelemetry(
      {
        repositories: [repository],
        selector: { kind: 'session', session: SESSION },
        out: '/exports/report-in',
      },
      { git: new FakeRemoteTelemetryGit(publishedFixture(repository)), fs, hash },
    );

    // The report verb's own path: read the bundle, then build from its inputs.
    const bundle = readTelemetryBundle('/exports/report-in', { fs, hash });
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;

    const report = buildReportFromInputs(bundle.inputs, {
      generatedAt: '2026-08-06T00:00:00.000Z',
      sourcePaths: ['/exports/report-in'],
    });

    expect(report.totals.sessions).toBe(1);
    expect(report.provenance.session_count).toBe(1);
    expect(report.totals.tokens).toEqual({ input: 1, output: 1 });
  });

  it('no read-path module imports the capture gate (a future gate cannot creep in)', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = join(dirname(fileURLToPath(import.meta.url)), '../../../src/services/telemetry');
    const readPath = [
      'remote-telemetry-service.ts',
      'published-telemetry.ts',
      'telemetry-bundle-reader.ts',
      'report.ts',
    ];

    for (const file of readPath) {
      expect(readFileSync(join(src, file), 'utf8')).not.toContain('capture-gate');
    }
  });
});

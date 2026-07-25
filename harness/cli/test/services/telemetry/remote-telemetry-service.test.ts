import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeRemoteTelemetryGit } from '../../../src/adapters/git/fake-remote-telemetry-git.js';
import type {
  RemoteRepository,
  RemoteTelemetryGitPort,
  SnapshotRequest,
  TelemetrySnapshot,
} from '../../../src/adapters/git/remote-telemetry-git-port.js';
import { FakeHash } from '../../../src/adapters/hash/fake-hash.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import {
  listPublishedTelemetry,
  pullPublishedTelemetry,
} from '../../../src/services/telemetry/remote-telemetry-service.js';
import { ROLLUP_FORMAT, serializeManifest } from '../../../src/services/telemetry/rolled-shard.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';
import { readTelemetryBundle } from '../../../src/services/telemetry/telemetry-bundle-reader.js';

const encoder = new TextEncoder();
const oid = (c: string): string => c.repeat(40);
const repository = (key: string): RemoteRepository => ({
  key,
  identity: `https://example.com/${key}`,
  transportUrl: `https://example.com/${key}`,
});

function fixture(repo: RemoteRepository, session = 'session-1', product = oid('a')) {
  const refName = `refs/harness-telemetry/2026/07/16/${session}`;
  const tip = oid('c');
  const segment = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: session,
      timecode: '2026-07-16T00:00:00.000Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      product_commit: product,
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
          session,
          start_date: '2026/07/16',
          max_seq: 1,
          product_commits: [product],
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
    repository: repo,
    refs: [
      {
        name: refName,
        advertisedOid: tip,
        history: [{ oid: tip, parents: [], entries }],
      },
    ],
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
    interval: { ok: true as const, membership: { [product]: true }, unavailable: [] },
  };
}

function partialGraphFixture(repo: RemoteRepository) {
  const session = 'partial-session';
  const known = oid('a');
  const unavailable = oid('b');
  const state = fixture(repo, session, known);
  const second = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: session,
      timecode: '2026-07-16T00:00:01.000Z',
      window: { since: 'last-command', from: 1, to: 2 },
      branch: 'main',
      product_commit: unavailable,
      event_stream: [
        { t: '2026-07-16T00:00:01.000Z', kind: 'turn', dur_s: 1, in: 2, out: 2 },
        {
          t: '2026-07-16T00:00:01.000Z',
          kind: 'usage',
          observation_kind: 'final_shutdown',
          in: 2,
          out: 2,
          cache_read: 0,
          cache_create: 0,
          nano_aiu: 4,
        },
      ],
    },
    '/repo',
  );
  const entries = state.snapshot.snapshot.refs[0].history[0].entries;
  entries[0].bytes = encoder.encode(
    serializeManifest({
      format: ROLLUP_FORMAT,
      session,
      start_date: '2026/07/16',
      max_seq: 2,
      product_commits: [known, unavailable],
    }),
  );
  entries.push({
    path: '2.json',
    mode: '100644',
    type: 'blob',
    oid: oid('4'),
    bytes: encoder.encode(JSON.stringify(second)),
  });
  state.interval = {
    ok: true,
    membership: { [known]: true },
    unavailable: [unavailable],
  };
  return { state, known, unavailable };
}

describe('remote telemetry service orchestration', () => {
  it('lists safe repository-scoped rows with no durable output', async () => {
    const repo = repository('repo-aaaaaaaaaaaaaaaa');
    const git = new FakeRemoteTelemetryGit(fixture(repo));
    const fs = new FakeFs();
    const result = await listPublishedTelemetry(
      { repositories: [repo], selector: null },
      { git, fs, hash: new FakeHash() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('ok');
    expect(result.rows).toMatchObject([
      {
        repositoryKey: repo.key,
        repository: repo.identity,
        sessionId: 'session-1',
        refCount: 1,
        fidelity: 'full',
        product: { state: 'known', commits: [oid('a')] },
      },
    ]);
    expect(result.rows[0]).not.toHaveProperty('blobs');
    expect(fs.writes).toEqual([]);
    expect(git.calls.map((call) => call.kind)).toEqual(['advertise', 'snapshot']);
  });

  it('renders an impossible advertised calendar date as null with the provenance gap', async () => {
    const repo = repository('repo-aaaaaaaaaaaaaaaa');
    const state = fixture(repo);
    const invalid = 'refs/harness-telemetry/2026/02/30/session-1';
    state.advertisement.refs[0].name = invalid;
    state.snapshot.snapshot.refs[0].name = invalid;
    const result = await listPublishedTelemetry(
      { repositories: [repo], selector: null },
      { git: new FakeRemoteTelemetryGit(state), fs: new FakeFs(), hash: new FakeHash() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.date).toBeNull();
    expect(result.rows[0]?.gaps).toContain('date_provenance_unavailable');
  });

  it('pulls the same whole-session selection and publishes written then reused', async () => {
    const repo = repository('repo-aaaaaaaaaaaaaaaa');
    const git = new FakeRemoteTelemetryGit(fixture(repo));
    const fs = new FakeFs();
    const deps = { git, fs, hash: new FakeHash() };
    const request = {
      repositories: [repo],
      selector: { kind: 'session' as const, session: 'session-1' },
      out: '/exports/pull',
    };
    const first = await pullPublishedTelemetry(request, deps);
    expect(first).toMatchObject({
      ok: true,
      status: 'ok',
      data: { sessions: 1, refs: 1, written: true, reused: false },
    });
    expect(fs.readText('/exports/pull/bundle.json')).toContain('harness.telemetry-pull-bundle/v1');
    const second = await pullPublishedTelemetry(request, deps);
    expect(second).toMatchObject({ ok: true, data: { written: false, reused: true } });
  });

  it('returns conclusive exact absence only after every repository advertises successfully', async () => {
    const repo = repository('repo-aaaaaaaaaaaaaaaa');
    const git = new FakeRemoteTelemetryGit(fixture(repo));
    const result = await pullPublishedTelemetry(
      {
        repositories: [repo],
        selector: { kind: 'session', session: 'absent' },
        out: '/exports/pull',
      },
      { git, fs: new FakeFs(), hash: new FakeHash() },
    );
    expect(result).toEqual({ ok: false, kind: 'session_not_found' });
  });

  it('keeps ls partial success degraded but makes pull all-or-none on repository failure', async () => {
    const good = repository('repo-aaaaaaaaaaaaaaaa');
    const bad = repository('repo-bbbbbbbbbbbbbbbb');
    const git = new FakeRemoteTelemetryGit({
      byRepository: {
        [good.key]: fixture(good),
        [bad.key]: {
          advertisement: {
            ok: false,
            kind: 'transport',
            message: 'safe transport failure',
            repositoryKey: bad.key,
          },
        },
      },
    });
    const deps = { git, fs: new FakeFs(), hash: new FakeHash() };
    const listed = await listPublishedTelemetry(
      { repositories: [good, bad], selector: null },
      deps,
    );
    expect(listed).toMatchObject({
      ok: true,
      status: 'degraded',
      errors: [{ repositoryKey: bad.key }],
    });
    const pulled = await pullPublishedTelemetry(
      {
        repositories: [good, bad],
        selector: { kind: 'session', session: 'session-1' },
        out: '/exports/pull',
      },
      deps,
    );
    expect(pulled).toMatchObject({ ok: false, kind: 'transport', repositoryKey: bad.key });
    expect(deps.fs.exists('/exports/pull')).toBe(false);
  });

  it('groups exact candidates before fetch and never snapshots unrelated advertised refs', async () => {
    const repo = repository('repo-aaaaaaaaaaaaaaaa');
    const state = fixture(repo);
    state.advertisement.refs.push({
      name: 'refs/harness-telemetry/2026/07/16/unrelated',
      oid: oid('d'),
    });
    const git = new FakeRemoteTelemetryGit(state);
    const result = await listPublishedTelemetry(
      { repositories: [repo], selector: { kind: 'session', session: 'session-1' } },
      { git, fs: new FakeFs(), hash: new FakeHash() },
    );
    expect(result).toMatchObject({ ok: true, rows: [{ sessionId: 'session-1' }] });
    const snapshotCall = git.calls.find((call) => call.kind === 'snapshot');
    expect(snapshotCall).toMatchObject({
      kind: 'snapshot',
      request: {
        advertisedRefs: state.advertisement.refs,
        candidateRefs: [state.advertisement.refs[0]],
      },
    });
  });

  it('owns one whole advertise→group→candidate→snapshot retry and includes a new same-session ref', async () => {
    const repo = repository('repo-aaaaaaaaaaaaaaaa');
    const initial = fixture(repo);
    const addedName = 'refs/harness-telemetry/2026/07/15/session-1';
    const added = {
      ...initial.snapshot.snapshot.refs[0],
      name: addedName,
    };
    const movedSnapshot: TelemetrySnapshot = {
      ...initial.snapshot.snapshot,
      refs: [initial.snapshot.snapshot.refs[0], added],
      effects: {
        ...initial.snapshot.snapshot.effects,
        advertisedRefs: 2,
        fetchedRefs: 2,
      },
    };
    const advertisements = [
      initial.advertisement,
      {
        ...initial.advertisement,
        refs: [...initial.advertisement.refs, { name: addedName, oid: added.advertisedOid }],
      },
    ];
    const snapshotRequests: SnapshotRequest[] = [];
    let advertisementIndex = 0;
    const git: RemoteTelemetryGitPort = {
      async advertiseTelemetryRefs() {
        return advertisements[Math.min(advertisementIndex++, 1)];
      },
      async loadVerifiedTelemetrySnapshot(request) {
        snapshotRequests.push(request);
        return snapshotRequests.length === 1
          ? {
              ok: false,
              kind: 'namespace_moved',
              message: 'remote telemetry namespace moved',
              repositoryKey: repo.key,
            }
          : { ok: true, snapshot: movedSnapshot };
      },
      async resolveProductCommitInterval(request) {
        return {
          ok: true,
          membership: Object.fromEntries(request.candidates.map((x) => [x, true])),
          unavailable: [],
        };
      },
    };
    const result = await listPublishedTelemetry(
      { repositories: [repo], selector: { kind: 'session', session: 'session-1' } },
      { git, fs: new FakeFs(), hash: new FakeHash() },
    );
    expect(result).toMatchObject({ ok: true, rows: [{ sessionId: 'session-1', refCount: 2 }] });
    expect(advertisementIndex).toBe(2);
    expect(snapshotRequests).toHaveLength(2);
    expect(snapshotRequests[1]).toMatchObject({
      advertisedRefs: advertisements[1].refs,
      candidateRefs: [...advertisements[1].refs].sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

  it.each([
    ['A=true/B=false', ['a', 'b'], false, false, ['repo-aaaaaaaaaaaaaaaa'], 1, 'ok'],
    [
      'A=true/B=unavailable',
      ['a', 'b'],
      true,
      false,
      ['repo-aaaaaaaaaaaaaaaa', 'repo-bbbbbbbbbbbbbbbb'],
      1,
      'degraded',
    ],
    ['opposite repository order', ['b', 'a'], false, false, ['repo-aaaaaaaaaaaaaaaa'], 1, 'ok'],
    [
      'both true',
      ['a', 'b'],
      false,
      true,
      ['repo-aaaaaaaaaaaaaaaa', 'repo-bbbbbbbbbbbbbbbb'],
      2,
      'ok',
    ],
  ] as const)('keeps same-OID commit membership repository-scoped for %s', async (_name, order, bUnavailable, bMember, expectedListedRepositories, expectedSelectedCount, expectedStatus) => {
    const a = repository('repo-aaaaaaaaaaaaaaaa');
    const b = repository('repo-bbbbbbbbbbbbbbbb');
    const product = oid('a');
    const aState = fixture(a, 'session-a', product);
    const bState = fixture(b, 'session-b', product);
    aState.interval = { ok: true, membership: { [product]: true }, unavailable: [] };
    bState.interval = {
      ok: true,
      membership: { [product]: bMember },
      unavailable: bUnavailable ? [product] : [],
    };
    const repositories = order.map((key) => (key === 'a' ? a : b));
    const state = {
      byRepository: {
        [a.key]: aState,
        [b.key]: bState,
      },
    };
    const selector = { kind: 'commit' as const, from: oid('0'), to: oid('f') };
    const listedGit = new FakeRemoteTelemetryGit(state);
    const listed = await listPublishedTelemetry(
      { repositories, selector },
      { git: listedGit, fs: new FakeFs(), hash: new FakeHash() },
    );
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.status).toBe(expectedStatus);
    expect(listed.rows.map((row) => row.repositoryKey).sort()).toEqual(expectedListedRepositories);
    if (bUnavailable) {
      expect(listed.gaps).toContainEqual({
        repositoryKey: b.key,
        sessionId: 'session-b',
        ref: 'refs/harness-telemetry/2026/07/16/session-b',
        reason: 'commit_provenance_unavailable',
      });
    }
    expect(
      listedGit.calls
        .filter((call) => call.kind === 'interval')
        .map((call) => call.request.repository.key),
    ).toEqual(repositories.map((repo) => repo.key));

    const pulled = await pullPublishedTelemetry(
      { repositories, selector, out: '/exports/scoped-membership' },
      { git: new FakeRemoteTelemetryGit(state), fs: new FakeFs(), hash: new FakeHash() },
    );
    expect(pulled).toMatchObject({ ok: true, data: { sessions: expectedSelectedCount } });
  });

  it('publishes and strictly rereads a deterministic degraded bundle for known+unavailable graph candidates', async () => {
    const hash = new FakeHash();
    const identity = 'https://example.com/partial-graph';
    const repo: RemoteRepository = {
      key: `repo-${hash.sha256Hex(identity).slice(0, 16)}`,
      identity,
      transportUrl: identity,
    };
    const { state, known, unavailable } = partialGraphFixture(repo);
    const fs = new FakeFs();
    const result = await pullPublishedTelemetry(
      {
        repositories: [repo],
        selector: { kind: 'commit', from: oid('0'), to: oid('f') },
        out: '/exports/partial-graph',
      },
      { git: new FakeRemoteTelemetryGit(state), fs, hash },
    );
    expect(result).toMatchObject({
      ok: true,
      status: 'degraded',
      data: { sessions: 1, completeness: 'partial', gaps: 1 },
      bundle: {
        manifest: {
          selection: {
            gaps: [
              {
                repository_key: repo.key,
                session_id: 'partial-session',
                ref: 'refs/harness-telemetry/2026/07/16/partial-session',
                reason: 'commit_provenance_unavailable',
              },
            ],
          },
          provenance: {
            repositories: [
              {
                sessions: [
                  {
                    refs: [
                      {
                        product_commits: {
                          state: 'partial',
                          values: [known, unavailable],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    });
    expect(readTelemetryBundle('/exports/partial-graph', { fs, hash }).ok).toBe(true);

    const repeatFs = new FakeFs();
    const repeat = await pullPublishedTelemetry(
      {
        repositories: [repo],
        selector: { kind: 'commit', from: oid('0'), to: oid('f') },
        out: '/exports/partial-graph',
      },
      { git: new FakeRemoteTelemetryGit(partialGraphFixture(repo).state), fs: repeatFs, hash },
    );
    expect(repeat.ok).toBe(true);
    if (result.ok && repeat.ok) expect(repeat.bundle.bundleJson).toBe(result.bundle.bundleJson);
  });

  it('maps a residual bundle-construction exception to a typed safe failure', async () => {
    const repo = repository('repo-aaaaaaaaaaaaaaaa');
    const hash = {
      sha256Hex(): string {
        throw new Error('private bundle contradiction');
      },
    };
    await expect(
      pullPublishedTelemetry(
        {
          repositories: [repo],
          selector: { kind: 'session', session: 'session-1' },
          out: '/exports/residual',
        },
        { git: new FakeRemoteTelemetryGit(fixture(repo)), fs: new FakeFs(), hash },
      ),
    ).resolves.toEqual({
      ok: false,
      kind: 'invalid_telemetry',
      message: 'selected telemetry could not form a consistent bundle',
      repositoryKey: repo.key,
    });
  });

  it('uses commit graph membership and keeps unavailable candidates as degraded selection gaps', async () => {
    const repo = repository('repo-aaaaaaaaaaaaaaaa');
    const state = fixture(repo);
    state.interval = {
      ok: true,
      membership: { [oid('a')]: true },
      unavailable: [oid('a')],
    };
    const result = await listPublishedTelemetry(
      {
        repositories: [repo],
        selector: { kind: 'commit', from: oid('0'), to: oid('f') },
      },
      { git: new FakeRemoteTelemetryGit(state), fs: new FakeFs(), hash: new FakeHash() },
    );
    expect(result).toMatchObject({ ok: true, status: 'degraded', completeness: 'partial' });
  });
});

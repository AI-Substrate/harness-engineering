import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import type { RemoteRepository } from '../../../src/adapters/git/remote-telemetry-git-port.js';
import { FakeHash } from '../../../src/adapters/hash/fake-hash.js';
import { publishTelemetryBundle } from '../../../src/services/telemetry/bundle-publisher.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import { decodePublishedTelemetrySession } from '../../../src/services/telemetry/published-telemetry.js';
import { parseTelemetryAdvertisement } from '../../../src/services/telemetry/remote-selection.js';
import { ROLLUP_FORMAT, serializeManifest } from '../../../src/services/telemetry/rolled-shard.js';
import { serializeSegment } from '../../../src/services/telemetry/segment.js';
import { buildTelemetryBundle } from '../../../src/services/telemetry/telemetry-bundle.js';
import { readTelemetryBundle } from '../../../src/services/telemetry/telemetry-bundle-reader.js';

const encoder = new TextEncoder();
const oid = (c: string): string => c.repeat(40);
const REPOSITORY_URL = 'https://example.com/team/repo';
const REPOSITORY_KEY = `repo-${new FakeHash().sha256Hex(REPOSITORY_URL).slice(0, 16)}`;

function published() {
  const repository: RemoteRepository = {
    key: REPOSITORY_KEY,
    identity: REPOSITORY_URL,
    transportUrl: REPOSITORY_URL,
  };
  const sessionId = 'session-1';
  const refName = `refs/harness-telemetry/2026/07/16/${sessionId}`;
  const tip = oid('c');
  const product = oid('a');
  const segment = serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: sessionId,
      timecode: '2026-07-16T00:00:00.000Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      product_commit: product,
      event_stream: [{ t: '2026-07-16T00:00:00.000Z', kind: 'turn', dur_s: 1, in: 2, out: 3 }],
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
          session: sessionId,
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
  const parsed = parseTelemetryAdvertisement({ name: refName, oid: tip });
  if (!parsed.ok) throw new Error('fixture');
  const decoded = decodePublishedTelemetrySession({
    group: {
      repository,
      sessionId,
      refs: [parsed.value],
      gaps: [],
      product: { state: 'unavailable', commits: null },
    },
    refs: [
      {
        name: refName,
        advertisedOid: tip,
        history: [{ oid: tip, parents: [], entries }],
      },
    ],
  });
  if (!decoded.ok) throw new Error('fixture decode');
  return decoded.session;
}

function publishedWithTwoRefs() {
  const repository: RemoteRepository = {
    key: REPOSITORY_KEY,
    identity: REPOSITORY_URL,
    transportUrl: REPOSITORY_URL,
  };
  const sessionId = 'session-1';
  const makeRef = (date: string, tipChar: string, product: string) => {
    const name = `refs/harness-telemetry/${date.replaceAll('-', '/')}/${sessionId}`;
    const tip = oid(tipChar);
    const segment = serializeSegment(
      {
        command: `flow-${tipChar}`,
        harness: 'claude-code',
        harness_session_id: sessionId,
        timecode: `2026-07-${tipChar === 'c' ? '16' : '17'}T00:00:00.000Z`,
        window: { since: 'session-start', from: 0, to: 1 },
        branch: 'main',
        product_commit: product,
        event_stream: [
          {
            t: `2026-07-${tipChar === 'c' ? '16' : '17'}T00:00:00.000Z`,
            kind: 'turn' as const,
            dur_s: 1,
            in: 2,
            out: 3,
          },
        ],
      },
      '/repo',
    );
    const manifest = {
      path: 'manifest.json',
      mode: '100644',
      type: 'blob' as const,
      oid: oid('1'),
      bytes: encoder.encode(
        serializeManifest({
          format: ROLLUP_FORMAT,
          session: sessionId,
          start_date: date.replaceAll('-', '/'),
          max_seq: tipChar === 'c' ? 1 : 2,
          product_commits: [product],
        }),
      ),
    };
    const entries =
      tipChar === 'c'
        ? [
            manifest,
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
          ]
        : [
            manifest,
            {
              path: '2.json',
              mode: '100644',
              type: 'blob' as const,
              oid: oid('4'),
              bytes: encoder.encode(JSON.stringify(segment)),
            },
          ];
    const advertisement = parseTelemetryAdvertisement({ name, oid: tip });
    if (!advertisement.ok) throw new Error('fixture advertisement');
    return {
      advertisement: advertisement.value,
      snapshot: { name, advertisedOid: tip, history: [{ oid: tip, parents: [], entries }] },
    };
  };
  const first = makeRef('2026-07-16', 'c', oid('a'));
  const second = makeRef('2026-07-17', 'd', oid('b'));
  const decoded = decodePublishedTelemetrySession({
    group: {
      repository,
      sessionId,
      refs: [first.advertisement, second.advertisement],
      gaps: ['duplicate_session_identity'],
      product: { state: 'unavailable', commits: null },
    },
    refs: [first.snapshot, second.snapshot],
  });
  if (!decoded.ok) throw new Error('two-ref fixture decode');
  return decoded.session;
}

function objectAt(root: unknown, ...path: Array<string | number>): Record<string, unknown> {
  let value: unknown = root;
  for (const part of path) {
    value = Array.isArray(value)
      ? value[part as number]
      : (value as Record<string, unknown>)[part as string];
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('fixture path is not an object');
  }
  return value as Record<string, unknown>;
}

function materialize(session = published()) {
  const hash = new FakeHash();
  const bundle = buildTelemetryBundle(
    {
      selector: { kind: 'session', session: session.sessionId },
      completeness: 'complete',
      selectionGaps: [],
      sessions: [session],
      repositorySnapshots: [
        {
          key: session.repository.key,
          identity: session.repository.identity,
          advertisedRefs: session.refs.length,
          selectedRefs: session.refs.length,
        },
      ],
    },
    hash,
  );
  const fs = new FakeFs();
  expect(publishTelemetryBundle(bundle, '/bundle', { fs, hash }).ok).toBe(true);
  return { fs, hash, bundle };
}

describe('telemetry pull bundle reader', () => {
  it('verifies hashes/path confinement and reconstructs a repository-tagged full input', () => {
    const { fs, hash } = materialize();
    const result = readTelemetryBundle('/bundle', { fs, hash });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inputs).toMatchObject([
      {
        kind: 'full',
        repositoryKey: REPOSITORY_KEY,
        sessionId: 'session-1',
      },
    ]);
    expect(result.inputs[0]?.sessionExport?.summary.tokens).toMatchObject({ in: 2, out: 3 });
    expect(result.selection).toMatchObject({ completeness: 'complete', gaps: [] });
  });

  it('accepts bundle.json directly and rejects changed/extra/non-regular managed paths', () => {
    const direct = materialize();
    expect(readTelemetryBundle('/bundle/bundle.json', direct).ok).toBe(true);

    const changed = materialize();
    const blob = changed.bundle.manifest.integrity.blobs[0]?.path as string;
    changed.fs.writeBytes(`/bundle/${blob}`, Uint8Array.from([9]));
    expect(readTelemetryBundle('/bundle', changed)).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });

    const extra = materialize();
    extra.fs.writeText('/bundle/extra', 'x');
    expect(readTelemetryBundle('/bundle', extra)).toEqual({ ok: false, reason: 'invalid_bundle' });

    const linked = materialize();
    linked.fs.nonRegularPaths.add('/bundle/bundle.json');
    expect(readTelemetryBundle('/bundle', linked)).toEqual({ ok: false, reason: 'invalid_bundle' });
  });

  it('accepts only the public product-commit selector discriminator', () => {
    const value = materialize();
    const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
    const selection = objectAt(manifest, 'selection');
    Object.assign(selection, {
      mode: 'product-commit',
      session_id: null,
      from_date: null,
      to_date: null,
      from_commit: oid('a'),
      to_commit: oid('f'),
    });
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
    const result = readTelemetryBundle('/bundle', value);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.selection.mode).toBe('product-commit');
  });

  it.each([
    [
      'null session_id',
      (selection: Record<string, unknown>) => {
        selection.session_id = null;
      },
    ],
    [
      'numeric session_id',
      (selection: Record<string, unknown>) => {
        selection.session_id = 7;
      },
    ],
    [
      'empty session_id',
      (selection: Record<string, unknown>) => {
        selection.session_id = '';
      },
    ],
    [
      'legacy commit alias',
      (selection: Record<string, unknown>) => {
        Object.assign(selection, {
          mode: 'commit',
          session_id: null,
          from_commit: oid('a'),
          to_commit: oid('f'),
        });
      },
    ],
    [
      'mixed-width product commits',
      (selection: Record<string, unknown>) => {
        Object.assign(selection, {
          mode: 'product-commit',
          session_id: null,
          from_commit: oid('a'),
          to_commit: 'f'.repeat(64),
        });
      },
    ],
    [
      'null product endpoint',
      (selection: Record<string, unknown>) => {
        Object.assign(selection, {
          mode: 'product-commit',
          session_id: null,
          from_commit: null,
          to_commit: oid('f'),
        });
      },
    ],
    [
      'numeric date endpoint',
      (selection: Record<string, unknown>) => {
        Object.assign(selection, {
          mode: 'date',
          session_id: null,
          from_date: 20260701,
          to_date: '2026-07-02',
        });
      },
    ],
    [
      'mode/field mismatch',
      (selection: Record<string, unknown>) => {
        Object.assign(selection, { mode: 'date', from_date: '2026-07-01', to_date: '2026-07-02' });
      },
    ],
  ] as Array<
    [string, (selection: Record<string, unknown>) => void]
  >)('rejects selector runtime mismatch: %s', (_name, mutate) => {
    const value = materialize();
    const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
    mutate(objectAt(manifest, 'selection'));
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
    expect(readTelemetryBundle('/bundle', value)).toEqual({ ok: false, reason: 'invalid_bundle' });
  });

  it.each([
    [
      'selection extra key',
      (manifest: Record<string, unknown>) => {
        objectAt(manifest, 'selection').unexpected = true;
      },
    ],
    [
      'credential-bearing repository URL',
      (manifest: Record<string, unknown>) => {
        objectAt(manifest, 'provenance', 'repositories', 0).url =
          'https://user:secret@example.com/team/repo';
      },
    ],
    [
      'declared selected-ref count mismatch',
      (manifest: Record<string, unknown>) => {
        objectAt(manifest, 'provenance', 'repositories', 0).selected_ref_count = 99;
      },
    ],
    [
      'invalid per-ref date pair',
      (manifest: Record<string, unknown>) => {
        objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0, 'refs', 0).date = {
          state: 'known',
          value: null,
        };
      },
    ],
    [
      'invalid per-ref shape',
      (manifest: Record<string, unknown>) => {
        objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0, 'refs', 0).shape =
          'source-tree';
      },
    ],
    [
      'invalid per-ref product null rule',
      (manifest: Record<string, unknown>) => {
        objectAt(
          manifest,
          'provenance',
          'repositories',
          0,
          'sessions',
          0,
          'refs',
          0,
        ).product_commits = { state: 'known', values: null };
      },
    ],
    [
      'unexpected nested commit key',
      (manifest: Record<string, unknown>) => {
        const ref = objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0, 'refs', 0);
        ref.commits = [{ oid: oid('c'), tree: [], unexpected: true }];
      },
    ],
    [
      'integrity repository ownership mismatch',
      (manifest: Record<string, unknown>) => {
        objectAt(manifest, 'integrity', 'blobs', 0).repository_key = 'repo-bbbbbbbbbbbbbbbb';
      },
    ],
  ] as Array<
    [string, (manifest: Record<string, unknown>) => void]
  >)('rejects malformed nested contract: %s', (_name, mutate) => {
    const value = materialize();
    const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
    mutate(manifest);
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
    expect(readTelemetryBundle('/bundle', value)).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });
  });

  it.each([
    [
      'ghost session gap',
      (manifest: Record<string, unknown>) => {
        (objectAt(manifest, 'selection').gaps as unknown[]).push({
          repository_key: REPOSITORY_KEY,
          session_id: 'ghost-session',
          ref: null,
          reason: 'duplicate_session_identity',
        });
      },
    ],
    [
      'known-date ref claimed unavailable',
      (manifest: Record<string, unknown>) => {
        objectAt(manifest, 'selection').completeness = 'partial';
        const ref = objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0, 'refs', 0);
        (objectAt(manifest, 'selection').gaps as unknown[]).push({
          repository_key: REPOSITORY_KEY,
          session_id: 'session-1',
          ref: ref.name,
          reason: 'date_provenance_unavailable',
        });
      },
    ],
    [
      'known-product ref claimed unavailable',
      (manifest: Record<string, unknown>) => {
        objectAt(manifest, 'selection').completeness = 'partial';
        const ref = objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0, 'refs', 0);
        (objectAt(manifest, 'selection').gaps as unknown[]).push({
          repository_key: REPOSITORY_KEY,
          session_id: 'session-1',
          ref: ref.name,
          reason: 'commit_provenance_unavailable',
        });
      },
    ],
    [
      'duplicate identity on a single-ref session',
      (manifest: Record<string, unknown>) => {
        (objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0).gaps as unknown[]).push(
          {
            repository_key: REPOSITORY_KEY,
            session_id: 'session-1',
            ref: null,
            reason: 'duplicate_session_identity',
          },
        );
      },
    ],
    [
      'manifest conflict names a ghost ref',
      (manifest: Record<string, unknown>) => {
        (objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0).gaps as unknown[]).push(
          {
            repository_key: REPOSITORY_KEY,
            session_id: 'session-1',
            ref: 'refs/harness-telemetry/2026/07/15/session-1',
            reason: 'manifest_date_conflict',
          },
        );
      },
    ],
    [
      'manifest conflict names an existing but non-conflicting ref',
      (manifest: Record<string, unknown>) => {
        const ref = objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0, 'refs', 0);
        (objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0).gaps as unknown[]).push(
          {
            repository_key: REPOSITORY_KEY,
            session_id: 'session-1',
            ref: ref.name,
            reason: 'manifest_date_conflict',
          },
        );
      },
    ],
    [
      'partial completeness without unresolved availability evidence',
      (manifest: Record<string, unknown>) => {
        objectAt(manifest, 'selection').completeness = 'partial';
      },
    ],
    [
      'complete selection carries unresolved availability',
      (manifest: Record<string, unknown>) => {
        (objectAt(manifest, 'selection').gaps as unknown[]).push({
          repository_key: REPOSITORY_KEY,
          session_id: 'unknown',
          ref: 'refs/harness-telemetry/not/a/date/unknown',
          reason: 'date_provenance_unavailable',
        });
      },
    ],
  ] as Array<
    [string, (manifest: Record<string, unknown>) => void]
  >)('rejects reason-inconsistent selection evidence: %s', (_name, mutate) => {
    const value = materialize();
    const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
    mutate(manifest);
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
    expect(readTelemetryBundle('/bundle', value)).toEqual({ ok: false, reason: 'invalid_bundle' });
  });

  it('rejects duplicate session gaps even when the underlying reason is valid', () => {
    const value = materialize(publishedWithTwoRefs());
    const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
    const gaps = objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0)
      .gaps as unknown[];
    gaps.push(structuredClone(gaps[0]));
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
    expect(readTelemetryBundle('/bundle', value)).toEqual({ ok: false, reason: 'invalid_bundle' });
  });

  it('accepts only unique deterministic ordering for advertisement-only unresolved gaps', () => {
    const hash = new FakeHash();
    const bundle = buildTelemetryBundle(
      {
        selector: { kind: 'date', from: '2026-07-01', to: '2026-07-02' },
        completeness: 'partial',
        selectionGaps: [
          {
            repositoryKey: REPOSITORY_KEY,
            sessionId: 'b',
            ref: 'refs/harness-telemetry/not/a/date/b',
            reason: 'date_provenance_unavailable',
          },
          {
            repositoryKey: REPOSITORY_KEY,
            sessionId: 'a',
            ref: 'refs/harness-telemetry/unknown/date/value/a',
            reason: 'date_provenance_unavailable',
          },
        ],
        sessions: [],
        repositorySnapshots: [
          {
            key: REPOSITORY_KEY,
            identity: REPOSITORY_URL,
            advertisedRefs: 2,
            selectedRefs: 0,
          },
        ],
      },
      hash,
    );
    const fs = new FakeFs();
    expect(publishTelemetryBundle(bundle, '/unresolved', { fs, hash }).ok).toBe(true);
    expect(readTelemetryBundle('/unresolved', { fs, hash }).ok).toBe(true);

    const duplicate = JSON.parse(bundle.bundleJson) as Record<string, unknown>;
    const duplicateGaps = objectAt(duplicate, 'selection').gaps as unknown[];
    duplicateGaps.push(structuredClone(duplicateGaps[0]));
    fs.writeText('/unresolved/bundle.json', `${JSON.stringify(duplicate, null, 2)}\n`);
    expect(readTelemetryBundle('/unresolved', { fs, hash })).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });

    const reordered = JSON.parse(bundle.bundleJson) as Record<string, unknown>;
    (objectAt(reordered, 'selection').gaps as unknown[]).reverse();
    fs.writeText('/unresolved/bundle.json', `${JSON.stringify(reordered, null, 2)}\n`);
    expect(readTelemetryBundle('/unresolved', { fs, hash })).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });
  });

  it('rejects a per-ref product-evidence swap even when the aggregate set is unchanged', () => {
    const value = materialize(publishedWithTwoRefs());
    const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
    const firstRef = objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0, 'refs', 0);
    const secondRef = objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0, 'refs', 1);
    const firstProduct = structuredClone(firstRef.product_commits);
    firstRef.product_commits = structuredClone(secondRef.product_commits);
    secondRef.product_commits = firstProduct;
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
    expect(readTelemetryBundle('/bundle', value)).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });
  });

  it('round-trips an impossible ref date as unavailable instead of producing an unreadable bundle', () => {
    const session = published();
    const invalidName = `refs/harness-telemetry/2026/02/30/${session.sessionId}`;
    const priorName = session.refs[0]?.name as string;
    session.refs[0].name = invalidName;
    session.refEvidence[0] = { ...session.refEvidence[0], name: invalidName };
    session.blobs = session.blobs.map((entry) => ({
      ...entry,
      refName: entry.refName === priorName ? invalidName : entry.refName,
    }));
    const hash = new FakeHash();
    const bundle = buildTelemetryBundle(
      {
        selector: { kind: 'session', session: session.sessionId },
        completeness: 'complete',
        selectionGaps: [],
        sessions: [session],
        repositorySnapshots: [
          {
            key: session.repository.key,
            identity: session.repository.identity,
            advertisedRefs: 1,
            selectedRefs: 1,
          },
        ],
      },
      hash,
    );
    expect(bundle.manifest.provenance.repositories[0]?.sessions[0]?.refs[0]?.date).toEqual({
      state: 'unavailable',
      value: null,
    });
    const fs = new FakeFs();
    expect(publishTelemetryBundle(bundle, '/invalid-date', { fs, hash }).ok).toBe(true);
    expect(readTelemetryBundle('/invalid-date', { fs, hash }).ok).toBe(true);
  });

  it('reads complete and unresolved partial empty bundles without a zero-activity claim', () => {
    for (const completeness of ['complete', 'partial'] as const) {
      const hash = new FakeHash();
      const bundle = buildTelemetryBundle(
        {
          selector: { kind: 'date', from: '2026-07-01', to: '2026-07-02' },
          completeness,
          selectionGaps:
            completeness === 'partial'
              ? [
                  {
                    repositoryKey: REPOSITORY_KEY,
                    sessionId: 'unknown',
                    ref: 'refs/harness-telemetry/not/a/date/unknown',
                    reason: 'date_provenance_unavailable',
                  },
                ]
              : [],
          sessions: [],
          repositorySnapshots:
            completeness === 'partial'
              ? [
                  {
                    key: REPOSITORY_KEY,
                    identity: REPOSITORY_URL,
                    advertisedRefs: 1,
                    selectedRefs: 0,
                  },
                ]
              : [],
        },
        hash,
      );
      const fs = new FakeFs();
      expect(publishTelemetryBundle(bundle, '/empty', { fs, hash }).ok).toBe(true);
      const read = readTelemetryBundle('/empty', { fs, hash });
      expect(read).toMatchObject({ ok: true, inputs: [], selection: { completeness } });
      if (!read.ok) continue;
      expect(read.repositories).toEqual(
        completeness === 'partial' ? [{ key: REPOSITORY_KEY, identity: REPOSITORY_URL }] : [],
      );
    }
  });
});

function materializeZeroRefGhost() {
  const value = materialize();
  const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
  const selection = objectAt(manifest, 'selection');
  const repository = objectAt(manifest, 'provenance', 'repositories', 0);
  const session = objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0);
  const integrity = objectAt(manifest, 'integrity');
  for (const row of integrity.blobs as Array<{ path: string }>) {
    value.fs.deleteFile(`/bundle/${row.path}`);
  }
  integrity.blobs = [];
  repository.selected_ref_count = 0;
  selection.matched_refs = 0;
  session.fidelity = 'identity-only';
  session.refs = [];
  session.gaps = [];
  session.coverage = {
    events: 'unavailable',
    measurements: 'unavailable',
    gaps: [
      { field: 'events', reason: 'identity_only', refs: [] },
      { field: 'measurements', reason: 'identity_only', refs: [] },
    ],
  };
  value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...value, manifest, selection, repository, session };
}

describe('repair RED 2 — ref-backed selected sessions and count closure', () => {
  it.each([
    'identity-only',
    'full',
    'partial',
  ] as const)('rejects a selected zero-ref %s ghost with zero report inputs', (fidelity) => {
    const value = materializeZeroRefGhost();
    value.session.fidelity = fidelity;
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(value.manifest, null, 2)}\n`);
    const read = readTelemetryBundle('/bundle', value);
    expect(read).toEqual({ ok: false, reason: 'invalid_bundle' });
    expect('inputs' in read).toBe(false);
  });

  it('rejects zero-ref forged coverage and session gaps', () => {
    const forgedCoverage = materializeZeroRefGhost();
    forgedCoverage.session.coverage = { events: 'full', measurements: 'complete', gaps: [] };
    forgedCoverage.fs.writeText(
      '/bundle/bundle.json',
      `${JSON.stringify(forgedCoverage.manifest, null, 2)}\n`,
    );
    expect(readTelemetryBundle('/bundle', forgedCoverage)).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });

    const forgedGap = materializeZeroRefGhost();
    forgedGap.session.gaps = [
      {
        repository_key: REPOSITORY_KEY,
        session_id: 'session-1',
        ref: null,
        reason: 'duplicate_session_identity',
      },
    ];
    forgedGap.fs.writeText(
      '/bundle/bundle.json',
      `${JSON.stringify(forgedGap.manifest, null, 2)}\n`,
    );
    expect(readTelemetryBundle('/bundle', forgedGap)).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });
  });

  it.each([
    ['matched sessions', 'matched_sessions', 0],
    ['matched refs', 'matched_refs', 0],
    ['matched repositories', 'matched_repositories', 0],
  ] as const)('rejects a %s disagreement', (_name, field, count) => {
    const value = materialize();
    const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
    objectAt(manifest, 'selection')[field] = count;
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
    expect(readTelemetryBundle('/bundle', value)).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });
  });

  it('rejects repository selected-ref count disagreement from the actual ref sum', () => {
    const value = materialize();
    const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
    const repository = objectAt(manifest, 'provenance', 'repositories', 0);
    repository.advertised_ref_count = 2;
    repository.selected_ref_count = 2;
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
    expect(readTelemetryBundle('/bundle', value)).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });
  });

  it('rejects two selected sessions sharing one declared selected-ref count', () => {
    const value = materializeZeroRefGhost();
    const second = structuredClone(value.session);
    second.session_id = 'session-2';
    (value.repository.sessions as unknown[]).push(second);
    value.repository.selected_ref_count = 1;
    value.selection.matched_sessions = 2;
    value.selection.matched_refs = 1;
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(value.manifest, null, 2)}\n`);
    expect(readTelemetryBundle('/bundle', value)).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });
  });

  it('rejects an advertised ref whose commit history is empty', () => {
    const value = materialize();
    const manifest = JSON.parse(value.bundle.bundleJson) as Record<string, unknown>;
    objectAt(manifest, 'provenance', 'repositories', 0, 'sessions', 0, 'refs', 0).commits = [];
    value.fs.writeText('/bundle/bundle.json', `${JSON.stringify(manifest, null, 2)}\n`);
    expect(readTelemetryBundle('/bundle', value)).toEqual({
      ok: false,
      reason: 'invalid_bundle',
    });
  });

  it('preserves genuine complete and unresolved partial repository-level empty selections', () => {
    for (const completeness of ['complete', 'partial'] as const) {
      const hash = new FakeHash();
      const bundle = buildTelemetryBundle(
        {
          selector: { kind: 'date', from: '2026-07-01', to: '2026-07-02' },
          completeness,
          selectionGaps:
            completeness === 'partial'
              ? [
                  {
                    repositoryKey: REPOSITORY_KEY,
                    sessionId: 'unknown',
                    ref: 'refs/harness-telemetry/not/a/date/unknown',
                    reason: 'date_provenance_unavailable',
                  },
                ]
              : [],
          sessions: [],
          repositorySnapshots: [
            {
              key: REPOSITORY_KEY,
              identity: REPOSITORY_URL,
              advertisedRefs: completeness === 'partial' ? 1 : 0,
              selectedRefs: 0,
            },
          ],
        },
        hash,
      );
      const fs = new FakeFs();
      expect(publishTelemetryBundle(bundle, '/repair-empty', { fs, hash }).ok).toBe(true);
      const read = readTelemetryBundle('/repair-empty', { fs, hash });
      expect(read).toMatchObject({ ok: true, inputs: [], selection: { completeness } });
    }
  });
});

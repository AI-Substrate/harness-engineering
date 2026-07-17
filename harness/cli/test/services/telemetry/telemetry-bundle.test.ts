import { describe, expect, it } from 'vitest';
import type { RemoteRepository } from '../../../src/adapters/git/remote-telemetry-git-port.js';
import { FakeHash } from '../../../src/adapters/hash/fake-hash.js';
import type { PublishedTelemetrySession } from '../../../src/services/telemetry/published-telemetry.js';
import {
  buildTelemetryBundle,
  type TelemetryBundleBuildInput,
} from '../../../src/services/telemetry/telemetry-bundle.js';

const encoder = new TextEncoder();
const repo = (key: string): RemoteRepository => ({
  key,
  identity: `https://example.com/${key}`,
  transportUrl: `https://example.com/${key}`,
});
const oid = (c: string): string => c.repeat(40);

function session(key: string, id: string, raw: Uint8Array): PublishedTelemetrySession {
  const repository = repo(key);
  const refName = `refs/harness-telemetry/2026/07/16/${id}`;
  const tip = oid('c');
  return {
    repository,
    sessionId: id,
    fidelity: 'identity-only',
    coverage: {
      events: { state: 'unavailable', count: null },
      measurements: { state: 'unavailable', count: null },
      gaps: ['events_unavailable', 'measurements_unavailable'],
    },
    product: { state: 'unavailable', commits: null },
    shapes: ['identity-only'],
    gaps: [],
    refs: [
      {
        name: refName,
        advertisedOid: tip,
        history: [
          {
            oid: tip,
            parents: [],
            entries: [
              { path: 'manifest.json', mode: '100644', type: 'blob', oid: oid('b'), bytes: raw },
            ],
          },
        ],
      },
    ],
    refEvidence: [
      {
        name: refName,
        shape: 'identity-only',
        product: { state: 'unavailable', commits: null },
      },
    ],
    blobs: [
      {
        repositoryKey: repository.key,
        sessionId: id,
        refName,
        advertisedOid: tip,
        commitOid: tip,
        path: 'manifest.json',
        gitOid: oid('b'),
        mode: '100644',
        bytes: raw,
      },
    ],
    sessionExport: null,
  };
}

function input(sessions: PublishedTelemetrySession[]): TelemetryBundleBuildInput {
  return {
    selector: { kind: 'session', session: 's' },
    completeness: 'complete',
    selectionGaps: [],
    sessions,
    repositorySnapshots: sessions.map((item) => ({
      key: item.repository.key,
      identity: item.repository.identity,
      advertisedRefs: item.refs.length,
      selectedRefs: item.refs.length,
    })),
  };
}

describe('deterministic telemetry pull bundle', () => {
  it('uses exact top-level key order and content-addressed raw Uint8Array bytes', () => {
    const hash = new FakeHash();
    const raw = Uint8Array.from([0, 13, 10, 255]);
    const bundle = buildTelemetryBundle(input([session('repo-bbbbbbbbbbbbbbbb', 's', raw)]), hash);
    expect(Object.keys(bundle.manifest)).toEqual([
      'schema_version',
      'selection',
      'provenance',
      'integrity',
    ]);
    expect(bundle.manifest.schema_version).toBe('harness.telemetry-pull-bundle/v1');
    const blob = bundle.files.find((file) => file.path.endsWith('.blob'));
    expect(blob?.bytes).toEqual(raw);
    expect(blob?.path).toMatch(/^repositories\/repo-[a-z0-9]+\/blobs\/[0-9a-f]{64}\.blob$/);
    expect(hash.calls.some((call) => call.input instanceof Uint8Array)).toBe(true);
    expect(bundle.manifest.integrity.blobs).toHaveLength(1);
    expect(bundle.files.some((file) => file.path === 'bundle.json')).toBe(true);
    expect(bundle.manifest.integrity.blobs.some((row) => row.path === 'bundle.json')).toBe(false);
  });

  it('matches the independent exact Workshop 002 bundle-v1 golden', () => {
    const raw = Uint8Array.from([0, 13, 10, 255]);
    const bundle = buildTelemetryBundle(
      input([session('repo-bbbbbbbbbbbbbbbb', 's', raw)]),
      new FakeHash(),
    );
    const digest = 'dc9df27f5e165911dc9df27f5e165911dc9df27f5e165911dc9df27f5e165911';
    const bundlePath = `repositories/repo-bbbbbbbbbbbbbbbb/blobs/${digest}.blob`;
    expect(bundle.manifest).toEqual({
      schema_version: 'harness.telemetry-pull-bundle/v1',
      selection: {
        mode: 'session',
        session_id: 's',
        from_date: null,
        to_date: null,
        from_commit: null,
        to_commit: null,
        completeness: 'complete',
        matched_repositories: 1,
        matched_sessions: 1,
        matched_refs: 1,
        gaps: [],
      },
      provenance: {
        repositories: [
          {
            key: 'repo-bbbbbbbbbbbbbbbb',
            url: 'https://example.com/repo-bbbbbbbbbbbbbbbb',
            advertised_ref_count: 1,
            selected_ref_count: 1,
            sessions: [
              {
                session_id: 's',
                fidelity: 'identity-only',
                coverage: {
                  events: 'unavailable',
                  measurements: 'unavailable',
                  gaps: [
                    {
                      field: 'events',
                      reason: 'identity_only',
                      refs: ['refs/harness-telemetry/2026/07/16/s'],
                    },
                    {
                      field: 'measurements',
                      reason: 'identity_only',
                      refs: ['refs/harness-telemetry/2026/07/16/s'],
                    },
                  ],
                },
                refs: [
                  {
                    name: 'refs/harness-telemetry/2026/07/16/s',
                    advertised_oid: oid('c'),
                    date: { state: 'known', value: '2026-07-16' },
                    shape: 'identity-only',
                    product_commits: { state: 'unavailable', values: null },
                    commits: [
                      {
                        oid: oid('c'),
                        tree: [
                          {
                            logical_path: 'manifest.json',
                            git_blob_oid: oid('b'),
                            content_sha256: digest,
                            bytes: 4,
                            bundle_path: bundlePath,
                          },
                        ],
                      },
                    ],
                  },
                ],
                gaps: [],
              },
            ],
          },
        ],
      },
      integrity: {
        algorithm: 'sha256',
        blobs: [
          {
            repository_key: 'repo-bbbbbbbbbbbbbbbb',
            path: bundlePath,
            sha256: digest,
            bytes: 4,
          },
        ],
      },
    });
  });

  it('serializes exact public gap objects, strict dates, and unsigned product ordering', () => {
    const item = session('repo-aaaaaaaaaaaaaaaa', 's', encoder.encode('{"safe":true}\n'));
    const invalidDateRef = 'refs/harness-telemetry/2026/02/30/s';
    const priorRef = item.refs[0]?.name as string;
    item.refs[0].name = invalidDateRef;
    item.refEvidence[0] = {
      name: invalidDateRef,
      shape: 'identity-only',
      product: { state: 'partial', commits: [oid('f'), oid('a')] },
    };
    item.product = { state: 'partial', commits: [oid('f'), oid('a')] };
    item.gaps = [];
    item.blobs = item.blobs.map((entry) => ({
      ...entry,
      refName: entry.refName === priorRef ? invalidDateRef : entry.refName,
    }));
    const value = input([item]);
    value.completeness = 'partial';
    value.selectionGaps = [
      {
        repositoryKey: item.repository.key,
        sessionId: item.sessionId,
        ref: invalidDateRef,
        reason: 'date_provenance_unavailable',
      },
    ];
    const bundle = buildTelemetryBundle(value, new FakeHash());
    expect(bundle.manifest.selection.gaps).toEqual([
      {
        repository_key: item.repository.key,
        session_id: item.sessionId,
        ref: invalidDateRef,
        reason: 'date_provenance_unavailable',
      },
    ]);
    const manifestSession = bundle.manifest.provenance.repositories[0]?.sessions[0];
    expect(manifestSession?.gaps).toEqual([]);
    expect(manifestSession?.coverage.gaps).toEqual([
      { field: 'events', reason: 'identity_only', refs: [invalidDateRef] },
      { field: 'measurements', reason: 'identity_only', refs: [invalidDateRef] },
    ]);
    expect(manifestSession?.refs[0]?.date).toEqual({ state: 'unavailable', value: null });
    expect(manifestSession?.refs[0]?.product_commits).toEqual({
      state: 'partial',
      values: [oid('a'), oid('f')],
    });
  });

  it('is byte-identical under shuffled repositories/sessions and dedupes equal content storage only', () => {
    const raw = encoder.encode('{"safe":true}\n');
    const a = session('repo-aaaaaaaaaaaaaaaa', 'z', raw);
    const b = session('repo-bbbbbbbbbbbbbbbb', 'a', raw);
    const forward = buildTelemetryBundle(input([a, b]), new FakeHash());
    const reverseInput = input([b, a]);
    reverseInput.repositorySnapshots.reverse();
    const reverse = buildTelemetryBundle(reverseInput, new FakeHash());
    expect(reverse.bundleJson).toBe(forward.bundleJson);
    expect(reverse.files).toEqual(forward.files);
    expect(forward.manifest.provenance.repositories.map((row) => row.key)).toEqual([
      'repo-aaaaaaaaaaaaaaaa',
      'repo-bbbbbbbbbbbbbbbb',
    ]);
    // Same bytes in different repositories retain repository-local storage paths.
    expect(forward.files.filter((file) => file.path.endsWith('.blob'))).toHaveLength(2);
  });

  it('maps the internal commit selector to the public product-commit discriminator', () => {
    const value = input([]);
    value.selector = { kind: 'commit', from: oid('a'), to: oid('f') };
    const bundle = buildTelemetryBundle(value, new FakeHash());
    expect(bundle.manifest.selection).toMatchObject({
      mode: 'product-commit',
      session_id: null,
      from_date: null,
      to_date: null,
      from_commit: oid('a'),
      to_commit: oid('f'),
    });
    expect(bundle.bundleJson).not.toContain('"mode": "commit"');
  });

  it('represents complete and unresolved-only empty selections without fabricating sessions or blobs', () => {
    const complete = buildTelemetryBundle(input([]), new FakeHash());
    expect(complete.manifest.selection).toMatchObject({
      completeness: 'complete',
      matched_sessions: 0,
      matched_refs: 0,
      gaps: [],
    });
    expect(complete.manifest.provenance.repositories).toEqual([]);
    expect(complete.manifest.integrity.blobs).toEqual([]);

    const unresolvedInput = input([]);
    unresolvedInput.completeness = 'partial';
    unresolvedInput.selectionGaps = [
      {
        repositoryKey: 'repo-aaaaaaaaaaaaaaaa',
        sessionId: 'unknown',
        ref: 'refs/harness-telemetry/not/a/date/unknown',
        reason: 'date_provenance_unavailable',
      },
    ];
    unresolvedInput.repositorySnapshots = [
      {
        key: 'repo-aaaaaaaaaaaaaaaa',
        identity: 'https://example.com/a',
        advertisedRefs: 1,
        selectedRefs: 0,
      },
    ];
    const unresolved = buildTelemetryBundle(unresolvedInput, new FakeHash());
    expect(unresolved.manifest.selection.completeness).toBe('partial');
    expect(unresolved.manifest.selection.matched_sessions).toBe(0);
    expect(unresolved.manifest.selection.gaps).toHaveLength(1);
    expect(unresolved.files).toHaveLength(1); // bundle.json only
  });
});

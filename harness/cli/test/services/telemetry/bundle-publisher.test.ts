import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeHash } from '../../../src/adapters/hash/fake-hash.js';
import type { HashPort } from '../../../src/adapters/hash/hash-port.js';
import { publishTelemetryBundle } from '../../../src/services/telemetry/bundle-publisher.js';
import type { TelemetryBundle } from '../../../src/services/telemetry/telemetry-bundle.js';

const encoder = new TextEncoder();

function bundle(raw = Uint8Array.from([0, 1, 2])): TelemetryBundle {
  const digest = new FakeHash().sha256Hex(raw);
  const repositoryKey = 'repo-aaaaaaaaaaaaaaaa';
  const blobPath = `repositories/${repositoryKey}/blobs/${digest}.blob`;
  const refName = 'refs/harness-telemetry/2026/07/16/s';
  const oid = 'c'.repeat(40);
  const manifest = {
    schema_version: 'harness.telemetry-pull-bundle/v1' as const,
    selection: {
      mode: 'session' as const,
      session_id: 's',
      from_date: null,
      to_date: null,
      from_commit: null,
      to_commit: null,
      completeness: 'complete' as const,
      matched_repositories: 1,
      matched_sessions: 1,
      matched_refs: 1,
      gaps: [],
    },
    provenance: {
      repositories: [
        {
          key: repositoryKey,
          url: 'https://example.com/team/repo',
          advertised_ref_count: 1,
          selected_ref_count: 1,
          sessions: [
            {
              session_id: 's',
              fidelity: 'identity-only' as const,
              coverage: {
                events: 'unavailable' as const,
                measurements: 'unavailable' as const,
                gaps: [
                  { field: 'events', reason: 'identity_only' as const, refs: [refName] },
                  { field: 'measurements', reason: 'identity_only' as const, refs: [refName] },
                ],
              },
              refs: [
                {
                  name: refName,
                  advertised_oid: oid,
                  date: { state: 'known' as const, value: '2026-07-16' },
                  shape: 'identity-only' as const,
                  product_commits: { state: 'unavailable' as const, values: null },
                  commits: [
                    {
                      oid,
                      tree: [
                        {
                          logical_path: 'manifest.json',
                          git_blob_oid: 'b'.repeat(40),
                          content_sha256: digest,
                          bytes: 3,
                          bundle_path: blobPath,
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
      algorithm: 'sha256' as const,
      blobs: [{ repository_key: repositoryKey, path: blobPath, sha256: digest, bytes: 3 }],
    },
  };
  const bundleJson = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    manifest,
    bundleJson,
    files: [
      { path: 'bundle.json', bytes: encoder.encode(bundleJson) },
      { path: blobPath, bytes: raw },
    ],
  };
}

describe('exclusive exact-folder bundle publisher', () => {
  it('publishes through a sibling temp and reuses an exact existing target', () => {
    const fs = new FakeFs();
    const hash = new FakeHash();
    const first = publishTelemetryBundle(bundle(), '/exports/pull', { fs, hash });
    expect(first).toEqual({ ok: true, written: true, reused: false });
    expect(fs.siblingTemps).toHaveLength(1);
    expect(fs.publishedDirectories).toHaveLength(1);
    expect(fs.listRegularFilesNoFollow('/exports/pull')).toEqual([
      'bundle.json',
      `repositories/repo-aaaaaaaaaaaaaaaa/blobs/${new FakeHash().sha256Hex(Uint8Array.from([0, 1, 2]))}.blob`,
    ]);

    const second = publishTelemetryBundle(bundle(), '/exports/pull', { fs, hash });
    expect(second).toEqual({ ok: true, written: false, reused: true });
    expect(fs.publishedDirectories).toHaveLength(1);
  });

  it('converges target aliases on one target-wide lock independent of bundle bytes', () => {
    const fs = new FakeFs();
    const hash = new FakeHash();
    const first = publishTelemetryBundle(bundle(), 'pull', { fs, hash });
    expect(first).toEqual({ ok: true, written: true, reused: false });
    const second = publishTelemetryBundle(bundle(), './pull/', { fs, hash });
    expect(second).toEqual({ ok: true, written: false, reused: true });
    const expectedLock = `telemetry-pull-${hash.sha256Hex('/cwd/pull').slice(0, 16)}`;
    expect(fs.publishedDirectories[0]).toMatchObject({
      target: '/cwd/pull',
      lockKey: expectedLock,
    });
    expect(fs.publishedDirectories[0]?.lockKey).not.toContain('pull/');

    expect(publishTelemetryBundle(bundle(), '/cwd/distinct', { fs, hash }).ok).toBe(true);
    expect(fs.publishedDirectories[1]?.lockKey).not.toBe(expectedLock);
  });

  it('returns a target conflict for missing/extra/different/non-regular existing entries', () => {
    for (const mutate of [
      (fs: FakeFs) => fs.deleteFile('/exports/pull/bundle.json'),
      (fs: FakeFs) => fs.writeText('/exports/pull/extra', 'extra'),
      (fs: FakeFs) => fs.writeText('/exports/pull/bundle.json', 'different'),
      (fs: FakeFs) => fs.nonRegularPaths.add('/exports/pull/bundle.json'),
    ]) {
      const fs = new FakeFs();
      expect(
        publishTelemetryBundle(bundle(), '/exports/pull', { fs, hash: new FakeHash() }).ok,
      ).toBe(true);
      mutate(fs);
      expect(
        publishTelemetryBundle(bundle(), '/exports/pull', { fs, hash: new FakeHash() }),
      ).toEqual({
        ok: false,
        kind: 'target_conflict',
      });
    }
  });

  it('treats a true differing writer as conflict without mixing or replacing the first target', () => {
    const fs = new FakeFs();
    const hash = new FakeHash();
    const first = bundle();
    expect(publishTelemetryBundle(first, '/exports/pull', { fs, hash }).ok).toBe(true);
    const originalManifest = fs.readText('/exports/pull/bundle.json');
    const second = bundle(Uint8Array.from([9, 8, 7]));
    expect(publishTelemetryBundle(second, '/exports/pull', { fs, hash })).toEqual({
      ok: false,
      kind: 'target_conflict',
    });
    expect(fs.readText('/exports/pull/bundle.json')).toBe(originalManifest);
    expect(fs.listRegularFilesNoFollow('/exports/pull')).toEqual(
      first.files.map((file) => file.path).sort(),
    );
  });

  it('preserves a pre-held writer lock and cleans only its own temp; acquired locks clear on failure/success', () => {
    const fs = new FakeFs();
    const hash = new FakeHash();
    const value = bundle();
    const lockKey = `telemetry-pull-${hash.sha256Hex('/exports/pull').slice(0, 16)}`;
    const foreignTemp = fs.createSiblingTempDir('/exports/foreign', 'other-writer-');
    fs.heldBundleLocks.add(lockKey);
    expect(publishTelemetryBundle(value, '/exports/pull', { fs, hash })).toEqual({
      ok: false,
      kind: 'filesystem_failure',
    });
    expect(fs.heldBundleLocks.has(lockKey)).toBe(true);
    expect(fs.exists(foreignTemp)).toBe(true);
    expect(fs.exists('/exports/pull')).toBe(false);
    expect(fs.removedDirs).not.toContain(foreignTemp);

    fs.heldBundleLocks.delete(lockKey);
    fs.failDirectoryPublishAfterLock = true;
    expect(publishTelemetryBundle(value, '/exports/pull', { fs, hash })).toEqual({
      ok: false,
      kind: 'filesystem_failure',
    });
    expect(fs.heldBundleLocks.has(lockKey)).toBe(false);
    expect(fs.exists('/exports/pull')).toBe(false);

    fs.failDirectoryPublishAfterLock = false;
    expect(publishTelemetryBundle(value, '/exports/pull', { fs, hash })).toEqual({
      ok: true,
      written: true,
      reused: false,
    });
    expect(fs.heldBundleLocks.has(lockKey)).toBe(false);
  });

  it('maps hash/publish/lock failures to filesystem_failure and cleans the sibling temp', () => {
    const throwingHash: HashPort = {
      sha256Hex(): string {
        throw new Error('forced hash failure');
      },
    };
    const hashFs = new FakeFs();
    expect(
      publishTelemetryBundle(bundle(), '/exports/pull', { fs: hashFs, hash: throwingHash }),
    ).toEqual({
      ok: false,
      kind: 'filesystem_failure',
    });
    expect(hashFs.exists('/exports/pull')).toBe(false);
    expect(hashFs.removedDirs).toContain(hashFs.siblingTemps[0]);

    const publishFs = new FakeFs();
    publishFs.failDirectoryPublish = true;
    expect(
      publishTelemetryBundle(bundle(), '/exports/pull', { fs: publishFs, hash: new FakeHash() }),
    ).toEqual({
      ok: false,
      kind: 'filesystem_failure',
    });
    expect(publishFs.exists('/exports/pull')).toBe(false);
    expect(publishFs.removedDirs).toContain(publishFs.siblingTemps[0]);
  });
});

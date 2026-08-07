import { describe, expect, it } from 'vitest';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
import {
  regenerateGitAiPin,
  renderPinSource,
} from '../../../../src/services/doctor/collector/regenerate.js';
import type { PlatformKey } from '../../../../src/services/doctor/collector/types.js';
import { FakeDownload, ok200 } from '../../../support/collector-fakes.js';

/**
 * Plan 073 · ac-000e, ac-0018, ac-000d — regenerating the pin.
 *
 * Two properties, and the second is the one that protects the first: the
 * regenerate path is the ONLY writer of the manifest, and it is all-or-nothing.
 * A five-of-six rewrite would leave one platform silently carrying an old digest
 * — a manifest nobody can review by reading it.
 */

const VERSION = 'v1.7.0';
const KEYS = Object.keys(GITAI_PIN.artifacts) as PlatformKey[];

function urlFor(key: PlatformKey, version = VERSION): string {
  return `${GITAI_PIN.release_base_url}/${version}/${GITAI_PIN.artifacts[key].file}`;
}

function allSix(version = VERSION): Record<string, ReturnType<typeof ok200>> {
  const scripts: Record<string, ReturnType<typeof ok200>> = {};
  for (const key of KEYS) {
    scripts[urlFor(key, version)] = ok200(new TextEncoder().encode(`binary-${key}`));
  }
  return scripts;
}

describe('regenerateGitAiPin — fetches every artifact and rewrites the manifest (ac-000e)', () => {
  it('hashes all six and renders a pin.ts carrying the new version and digests', async () => {
    const http = new FakeDownload(allSix());

    const result = await regenerateGitAiPin({ http, hash: new NodeHash() }, { version: VERSION });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(http.calls.map((call) => call.url).sort()).toEqual(KEYS.map((k) => urlFor(k)).sort());
    for (const key of KEYS) {
      expect(result.digests[key]).toBe(
        new NodeHash().sha256Hex(new TextEncoder().encode(`binary-${key}`)),
      );
      expect(result.source).toContain(result.digests[key]);
    }
    expect(result.source).toContain(`version: '${VERSION}'`);
    expect(result.source).toContain("expect_schema_version: 'authorship/3.0.0'");
  });

  it("refuses to pin 'latest' — a pin names one immutable tag (ac-0003)", async () => {
    const result = await regenerateGitAiPin(
      { http: new FakeDownload(allSix('latest')), hash: new NodeHash() },
      { version: 'latest' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.reason).toContain('latest');
  });
});

describe('regenerateGitAiPin — all-or-nothing (ac-0018)', () => {
  it('one failed fetch leaves the manifest untouched and names the platform', async () => {
    const scripts = allSix();
    delete scripts[urlFor('windows-arm64')]; // the release forgot one artifact
    const result = await regenerateGitAiPin(
      { http: new FakeDownload(scripts), hash: new NodeHash() },
      { version: VERSION },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((failure) => failure.key)).toEqual(['windows-arm64']);
    // No `source` is produced at all, so the caller has nothing to write.
    expect('source' in result).toBe(false);
  });

  it('a non-2xx on any one artifact aborts the whole regeneration', async () => {
    const scripts = allSix();
    scripts[urlFor('linux-x64')] = { ...ok200(new Uint8Array([1])), status: 500 };

    const result = await regenerateGitAiPin(
      { http: new FakeDownload(scripts), hash: new NodeHash() },
      { version: VERSION },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures).toEqual([
      { key: 'linux-x64', file: 'git-ai-linux-x64', reason: 'HTTP 500' },
    ]);
  });

  it('an empty body is a failure, not a zero-byte pin', async () => {
    const scripts = allSix();
    scripts[urlFor('macos-x64')] = ok200(new Uint8Array());

    const result = await regenerateGitAiPin(
      { http: new FakeDownload(scripts), hash: new NodeHash() },
      { version: VERSION },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]).toMatchObject({ key: 'macos-x64', reason: 'empty response body' });
  });
});

describe('the install path is not a writer of the manifest (ac-000e)', () => {
  it('no module outside regenerate.ts renders or writes pin.ts', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const collector = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../src/services/doctor/collector',
    );

    const offenders = readdirSync(collector)
      .filter((name) => name.endsWith('.ts') && name !== 'regenerate.ts' && name !== 'index.ts')
      .filter((name) => readFileSync(join(collector, name), 'utf8').includes("'pin.ts'"))
      .sort();

    expect(offenders).toEqual([]);
  });
});

describe('renderPinSource — a bump is a readable one-file diff (ac-000d)', () => {
  it('reproduces the CURRENT pin.ts byte-for-byte from its own data', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const current = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../src/services/doctor/collector/pin.ts',
      ),
      'utf8',
    );

    const digests = Object.fromEntries(
      KEYS.map((key) => [key, GITAI_PIN.artifacts[key].sha256]),
    ) as Record<PlatformKey, string>;

    // If this fails, regeneration would rewrite prose as well as data — and the
    // bump diff would stop being reviewable at a glance.
    expect(renderPinSource(GITAI_PIN, GITAI_PIN.version, digests)).toBe(current);
  });
});

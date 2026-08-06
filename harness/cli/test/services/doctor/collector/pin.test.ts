import { describe, expect, it } from 'vitest';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
import {
  binaryPathFor,
  configPathFor,
  resolveArtifact,
  resolvePlatformKey,
} from '../../../../src/services/doctor/collector/platform.js';

/**
 * Plan 073 · ac-0003, ac-0006, ac-0017, ac-000d, ac-000f — the pin and the six
 * platforms it covers.
 */

describe('the pin is DATA, and a bump is a single-file diff (ac-000d, ac-001a)', () => {
  it('names one immutable tag — never `latest`', () => {
    expect(GITAI_PIN.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(GITAI_PIN.version).not.toBe('latest');
    expect(GITAI_PIN.release_base_url).not.toContain('latest');
  });

  it('pins the note schema version alongside the binary (ac-000f)', () => {
    expect(GITAI_PIN.expect_schema_version).toBe('authorship/3.0.0');
  });

  it('carries all six published artifacts with a 64-hex digest each', () => {
    const keys = Object.keys(GITAI_PIN.artifacts).sort();
    expect(keys).toEqual([
      'linux-arm64',
      'linux-x64',
      'macos-arm64',
      'macos-x64',
      'windows-arm64',
      'windows-x64',
    ]);
    for (const key of keys) {
      const entry = GITAI_PIN.artifacts[key as keyof typeof GITAI_PIN.artifacts];
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.file.startsWith('git-ai-')).toBe(true);
    }
  });

  it('holds NO imports and NO logic — nothing to review but data', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../src/services/doctor/collector/pin.ts',
      ),
      'utf8',
    );

    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toMatch(/\bfunction\b/);
    expect(source.match(/^export /gm) ?? []).toHaveLength(1);
  });

  it('no source file outside the pin hard-codes the pinned version (ac-001a)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { dirname, join, relative } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const srcRoot = join(cliRoot, 'src');

    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) files.push(path);
      }
    };
    walk(srcRoot);

    const offenders = files
      .filter((file) => !file.endsWith(join('collector', 'pin.ts')))
      .filter((file) => readFileSync(file, 'utf8').includes(GITAI_PIN.version))
      .map((file) => relative(cliRoot, file));

    // Bumping the version must not require editing anything else — if this list
    // is ever non-empty, the pin has stopped being data.
    expect(offenders).toEqual([]);
  });
});

describe('platform resolution covers all six and falls back to NOTHING (ac-0006, ac-0017)', () => {
  it.each([
    ['darwin', 'x64', 'macos-x64', 'git-ai-macos-x64'],
    ['darwin', 'arm64', 'macos-arm64', 'git-ai-macos-arm64'],
    ['linux', 'x64', 'linux-x64', 'git-ai-linux-x64'],
    ['linux', 'arm64', 'linux-arm64', 'git-ai-linux-arm64'],
    ['win32', 'x64', 'windows-x64', 'git-ai-windows-x64.exe'],
    ['win32', 'arm64', 'windows-arm64', 'git-ai-windows-arm64.exe'],
  ])('resolves %s/%s → %s', (platform, arch, key, file) => {
    expect(resolvePlatformKey(platform, arch)).toBe(key);
    const resolved = resolveArtifact(platform, arch);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.artifact.file).toBe(file);
    expect(resolved.artifact.url).toBe(
      `${GITAI_PIN.release_base_url}/${GITAI_PIN.version}/${file}`,
    );
    expect(resolved.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['freebsd', 'x64'],
    ['linux', 'ppc64'],
    ['aix', 's390x'],
    ['darwin', 'ia32'],
  ])('reports %s/%s as unsupported and installs nothing', (platform, arch) => {
    expect(resolvePlatformKey(platform, arch)).toBeNull();
    const resolved = resolveArtifact(platform, arch);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe('unsupported-platform');
    expect(resolved.detail).toContain(`${platform}/${arch}`);
  });
});

describe('install locations are git-ai’s own, not harness paths', () => {
  it('places the binary under ~/.git-ai/bin with the platform suffix', () => {
    expect(binaryPathFor('/home/u', 'darwin')).toBe('/home/u/.git-ai/bin/git-ai');
    expect(binaryPathFor('/home/u/', 'linux')).toBe('/home/u/.git-ai/bin/git-ai');
    expect(binaryPathFor('/home/u', 'win32')).toBe('/home/u/.git-ai/bin/git-ai.exe');
  });

  it('writes the pin config at ~/.git-ai/config.json', () => {
    expect(configPathFor('/home/u')).toBe('/home/u/.git-ai/config.json');
  });
});

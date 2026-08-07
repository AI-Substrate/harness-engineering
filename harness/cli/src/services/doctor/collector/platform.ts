import { GITAI_PIN } from './pin.js';
import type { CollectorPin, PlatformKey, ResolvedArtifact } from './types.js';

/**
 * Platform resolution (plan 073 · ac-0006, ac-0017).
 *
 * git-ai publishes SIX raw binaries: `git-ai-{macos,linux}-{x64,arm64}` and
 * `git-ai-windows-{x64,arm64}.exe`. This maps a host onto exactly one of them,
 * or onto nothing.
 *
 * "Or onto nothing" is the whole design. An unsupported host must be REPORTED as
 * unsupported, never quietly handed the x64 artifact on the theory that it will
 * probably run — a wrong-architecture binary that fails at exec time is a much
 * worse read than an install that declined and said why.
 */

const PLATFORMS: Readonly<Record<string, string>> = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'windows',
};

const ARCHES: Readonly<Record<string, string>> = {
  x64: 'x64',
  arm64: 'arm64',
};

/** The pin key for a host, or null when the combination has no published artifact. */
export function resolvePlatformKey(platform: string, arch: string): PlatformKey | null {
  const os = PLATFORMS[platform];
  const cpu = ARCHES[arch];
  if (os === undefined || cpu === undefined) return null;
  const key = `${os}-${cpu}`;
  return key in GITAI_PIN.artifacts ? (key as PlatformKey) : null;
}

export type ArtifactResolution =
  | { ok: true; artifact: ResolvedArtifact }
  | { ok: false; reason: 'unsupported-platform'; detail: string };

/** Resolve the pinned artifact for a host — file name, download URL and digest. */
export function resolveArtifact(
  platform: string,
  arch: string,
  manifest: CollectorPin = GITAI_PIN,
): ArtifactResolution {
  const key = resolvePlatformKey(platform, arch);
  if (key === null) {
    return {
      ok: false,
      reason: 'unsupported-platform',
      detail: `git-ai publishes no artifact for ${platform}/${arch} — supported: ${Object.keys(
        manifest.artifacts,
      ).join(', ')}`,
    };
  }
  const entry = manifest.artifacts[key];
  return {
    ok: true,
    artifact: {
      key,
      file: entry.file,
      url: `${manifest.release_base_url}/${manifest.version}/${entry.file}`,
      sha256: entry.sha256,
    },
  };
}

/** Where the pinned binary is placed — git-ai's own location, not a harness path. */
export function binaryPathFor(home: string, platform: string): string {
  const name = platform === 'win32' ? 'git-ai.exe' : 'git-ai';
  return `${home.replace(/\/+$/, '')}/.git-ai/bin/${name}`;
}

/** git-ai's user config file — written BEFORE the binary is ever executed. */
export function configPathFor(home: string): string {
  return `${home.replace(/\/+$/, '')}/.git-ai/config.json`;
}

/** git-ai's daemon pid metadata file (`daemon.pid.json`), read never written. */
export function daemonPidPathFor(home: string): string {
  return `${home.replace(/\/+$/, '')}/.git-ai/internal/daemon/daemon.pid.json`;
}

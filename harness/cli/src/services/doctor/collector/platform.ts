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

/** The answer to "would a child process spawning the bare name `git-ai` find it?". */
export interface PathLookup {
  /** First PATH entry that holds a spawnable git-ai, or null when none does. */
  resolved: string | null;
}

/**
 * Resolve the BARE NAME `git-ai` against a PATH value, by filesystem read only —
 * nothing is spawned.
 *
 * Resolution, not existence, is the whole point. The binary can sit at
 * `~/.git-ai/bin` the entire time and that fact tells nobody anything: git-ai's
 * own editor extension spawns the literal string `git-ai` in production, so the
 * question that decides whether save-time KnownHuman attestations get recorded
 * is whether the bare name resolves for a GUI-launched process. An existence
 * check on the install dir is the false-negative trap that hid this for weeks
 * (see docs/plans/082-harness-hooks/assets/windows/root-cause-extension-cannot-find-git-ai.md).
 *
 * On win32 a shell-less spawn resolves `.exe`/`.com` only (`.cmd`/`.bat` need a
 * shell), and PATH entries may be quoted. On POSIX the executable bit is not
 * checked — a present-but-unexecutable file is close enough to name here, and
 * the fs port has no mode read.
 */
export function lookupGitAiOnPath(
  fs: { exists(path: string): boolean },
  platform: string,
  pathValue: string | undefined,
): PathLookup {
  const sep = platform === 'win32' ? ';' : ':';
  const names = platform === 'win32' ? ['git-ai.exe', 'git-ai.com'] : ['git-ai'];
  for (const raw of (pathValue ?? '').split(sep)) {
    const entry = platform === 'win32' ? raw.replace(/^"+|"+$/g, '') : raw;
    if (entry.trim() === '') continue;
    const dir = entry.replace(/\\/g, '/').replace(/\/+$/, '');
    for (const name of names) {
      const candidate = `${dir}/${name}`;
      if (fs.exists(candidate)) return { resolved: candidate };
    }
  }
  return { resolved: null };
}

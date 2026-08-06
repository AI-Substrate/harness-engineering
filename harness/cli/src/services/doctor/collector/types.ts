import type { Clock } from '../../../adapters/clock/clock-port.js';
import type { ExecPort } from '../../../adapters/exec/exec-port.js';
import type { FsPort } from '../../../adapters/fs/fs-port.js';
import type { HashPort } from '../../../adapters/hash/hash-port.js';
import type { GITAI_PIN } from './pin.js';

/**
 * The collector's shared vocabulary: the pin's shape, the host it resolves
 * against, and the two capabilities the CLI's existing ports do not already
 * cover (an HTTP GET, and the Unix executable bit).
 *
 * Ports are declared here rather than assumed, so every collector function is a
 * pure function of injected capability — the install path can be exercised end
 * to end with fakes, including the failure modes that only ever happen on a bad
 * network.
 */

/** The six published platform artifacts — the complete set, with no fallback. */
export type PlatformKey =
  | 'macos-x64'
  | 'macos-arm64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'windows-x64'
  | 'windows-arm64';

/** The pin literal's type, derived so the data file needs no imports of its own. */
export type CollectorPin = typeof GITAI_PIN;

/** The host the pin is resolved against — `process.platform` / `process.arch` values. */
export interface HostTarget {
  /** `process.platform`: 'darwin' | 'linux' | 'win32' | … */
  platform: string;
  /** `process.arch`: 'x64' | 'arm64' | … */
  arch: string;
  /** The user's home directory — git-ai installs under `<home>/.git-ai`. */
  home: string;
}

/** One artifact resolved for a host: what to fetch and what it must hash to. */
export interface ResolvedArtifact {
  key: PlatformKey;
  file: string;
  url: string;
  sha256: string;
}

/**
 * An HTTP GET, injected. The adapter follows redirects and reports where it
 * ENDED UP (`url`) plus how many hops it took, because "the bytes came from
 * somewhere else" is a provenance failure this design refuses rather than
 * tolerates (ac-0015).
 */
export interface DownloadPort {
  get(url: string, opts: { timeoutMs: number }): Promise<DownloadOutcome>;
}

export type DownloadOutcome =
  | {
      ok: true;
      status: number;
      /** The FINAL url after redirects. */
      url: string;
      redirects: number;
      bytes: Uint8Array;
      /** The server's declared `Content-Length`, when it sent one. */
      declaredBytes?: number;
    }
  | { ok: false; kind: 'timeout' | 'network'; message: string };

/**
 * The Unix executable bit. Not on {@link FsPort} because nothing in the harness
 * has ever placed an executable before; a downloaded CLI is the first (ac-0016).
 * Implementations no-op on Windows, where execution is extension-driven.
 */
export interface ExecutableBitPort {
  /** Set mode 0o755 on an existing path. False when the mode could not be set. */
  setExecutable(path: string): boolean;
}

/** The filesystem surface the collector actually uses — narrow on purpose. */
export type CollectorFsPort = Pick<
  FsPort,
  | 'exists'
  | 'readText'
  | 'readBytesNoFollow'
  | 'writeText'
  | 'writeBytes'
  | 'mkdirp'
  | 'mkdtemp'
  | 'rename'
  | 'deleteFile'
  | 'removeDir'
>;

/** Everything the install/re-check lifecycle needs. */
export interface CollectorDeps {
  fs: CollectorFsPort;
  hash: HashPort;
  http: DownloadPort;
  exec: ExecPort;
  exe: ExecutableBitPort;
  clock: Clock;
  host: HostTarget;
  /** The repo root the state file is written under, and `install-hooks`' cwd. */
  cwd: string;
  /**
   * Override for tests / a future channel; defaults to {@link GITAI_PIN}.
   *
   * Named `manifest` rather than `pin` on purpose, and the reason is worth
   * writing down: `test/services/telemetry/pin-knob-src-usage.test.ts` declares
   * EVERY `src/` occurrence of the lowercase identifier `pin`, so that nobody
   * can raise the telemetry segment READ pin without a reviewer seeing it. That
   * control is about a different pin in a different domain. Borrowing its word
   * here would add forty unrelated lines to its declared list and make every
   * future collector edit break a telemetry control — so the collector says
   * `manifest` in code and "the pin" in prose.
   */
  manifest?: CollectorPin;
}

/** Wall-clock ceilings. A collector install must never hang a doctor run. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;
export const INSTALL_HOOKS_TIMEOUT_MS = 120_000;

import type { Clock } from '../../../adapters/clock/clock-port.js';
import type { ExecPort } from '../../../adapters/exec/exec-port.js';
import type { ExecutableBitPort } from '../../../adapters/fs/executable-bit-port.js';
import type { FsPort } from '../../../adapters/fs/fs-port.js';
import type { PathKindPort } from '../../../adapters/fs/path-kind-port.js';
import type { HashPort } from '../../../adapters/hash/hash-port.js';
import type { DownloadPort } from '../../../adapters/http/download-port.js';
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
  /**
   * `CLAUDE_CONFIG_DIR`, when set. git-ai honours it (`utils.rs:430`), so the
   * skills guard must too: on a machine where it points at `~/.claude-alt`,
   * inspecting `~/.claude` would report safety about a directory git-ai never
   * touches. Absent → the guard falls back to `<home>/.claude`.
   */
  claudeConfigDir?: string;
}

/** One artifact resolved for a host: what to fetch and what it must hash to. */
export interface ResolvedArtifact {
  key: PlatformKey;
  file: string;
  url: string;
  sha256: string;
}

export type { ExecutableBitPort } from '../../../adapters/fs/executable-bit-port.js';
export type { PathKind, PathKindPort } from '../../../adapters/fs/path-kind-port.js';
/**
 * The two capabilities the CLI's existing ports did not already cover — an HTTP
 * GET and the Unix executable bit — now live where every other port lives,
 * `src/adapters/<x>/<x>-port.ts`, so the real adapters can implement them
 * without an adapter importing from `services/`. Re-exported here (type-only)
 * because the collector's vocabulary is what the rest of this directory reads.
 */
export type { DownloadOutcome, DownloadPort } from '../../../adapters/http/download-port.js';

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
  /** `lstat`-honest path classification — the skills guard's only capability. */
  paths: PathKindPort;
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

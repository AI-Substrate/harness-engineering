import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { Envelope, UpdateAvailable } from '../../output/envelope.js';
import type { OutputMode, Writers } from '../../output/output-port.js';
import { bannerFromCache } from './update-service.js';

/**
 * The single human-mode stderr notice (AC8), newline-terminated. Sourced from
 * the field so the command shown always matches `update_available.command`.
 */
export function formatUpdateBanner(ua: UpdateAvailable): string {
  return `update available to ${ua.latest} from ${ua.installed} — run: ${ua.command}\n`;
}

export interface BannerDecoratorDeps {
  fs: FsPort;
  env: EnvPort;
  /** Installed version (readVersion()) compared against the cached latest. */
  installed: string;
  mode: OutputMode;
  writers: Writers;
}

/**
 * Build the exit-chokepoint banner decorator (wired via `setBannerDecorator` in
 * T007). On each exit it does a SINGLE sync cache read — no network on the hot
 * path (AC9). If a newer version is known it sets the additive `update_available`
 * field (serialized by the JSON renderer on EVERY command, AC7) and, in human
 * mode only, writes exactly one stderr line (AC8). Returns the structural
 * `(env) => void` so the exit kernel never imports the service layer.
 */
export function buildBannerDecorator(deps: BannerDecoratorDeps): (env: Envelope) => void {
  return (env: Envelope) => {
    const ua = bannerFromCache(deps.fs, deps.env, deps.installed);
    if (!ua) return;
    env.update_available = ua;
    if (deps.mode === 'human') {
      deps.writers.err(formatUpdateBanner(ua));
    }
  };
}

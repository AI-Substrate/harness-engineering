import type { EnvPort } from '../../adapters/env/env-port.js';

/**
 * The ONE place that answers "may this harness capture telemetry?" (plan 073 ·
 * ac-0001, ac-0019).
 *
 * Until v1 of the collector handover the answer was "yes, unless the operator
 * exports `HARNESS_NO_TELEMETRY=1`" — capture was ON by default and the env var
 * was the only way off. That default now INVERTS: a shipped harness collects
 * nothing, because git-ai is the collector. The switch moves out of the
 * environment and into code ({@link CAPTURE_DEFAULT_ENABLED}), so a default
 * install is silent with NO environment variable set at all.
 *
 * Disabled, not deleted (plan 073 non-goal 1): every capture/publish/housekeeping
 * path stays intact behind this gate so v2 can migrate rather than rebuild, and
 * the READ path (`telemetry pull` / `telemetry report`) is deliberately NOT
 * gated here — the 123 published `refs/harness-telemetry/*` stay queryable
 * (ac-0002).
 */

/**
 * The historic env kill-switch (naming-consistent with `HARNESS_NO_EXTENSIONS`).
 * Still honoured, and still absolute: `=1` means off even when the opt-in below
 * is set, so an operator who has disabled telemetry machine-wide cannot have it
 * re-enabled by a stray project env.
 */
export const KILL_SWITCH_ENV = 'HARNESS_NO_TELEMETRY';

/**
 * The opt-in that turns harness-side capture back on for a session that WANTS
 * the old behaviour (the migration escape hatch, and how the existing suites
 * exercise the capture path). `=1` enables; anything else is off.
 */
export const CAPTURE_OPT_IN_ENV = 'HARNESS_TELEMETRY_CAPTURE';

/**
 * The shipped default — DATA, not an env read. This constant IS the flip: a
 * harness installed from the package, with a clean environment, captures nothing.
 */
export const CAPTURE_DEFAULT_ENABLED = false;

/** Why capture is off — distinct causes, never collapsed into one boolean. */
export type CaptureDisabledReason = 'kill-switch' | 'default-off';

/**
 * The disabling cause, or `null` when capture is enabled. Callers that only need
 * a yes/no use {@link isCaptureEnabled}; the reason exists so a reporting surface
 * can say WHICH off it is (an operator kill-switch reads differently from the
 * shipped default).
 */
export function captureDisabledReason(env: EnvPort): CaptureDisabledReason | null {
  if (env.get(KILL_SWITCH_ENV) === '1') return 'kill-switch';
  if (env.get(CAPTURE_OPT_IN_ENV) === '1') return null;
  return CAPTURE_DEFAULT_ENABLED ? null : 'default-off';
}

/** True when this process may capture, publish or housekeep telemetry. */
export function isCaptureEnabled(env: EnvPort): boolean {
  return captureDisabledReason(env) === null;
}

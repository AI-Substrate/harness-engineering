import type { DbPort } from '../../adapters/db/db-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitWritePort } from '../../adapters/git/git-write-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import type { Envelope, HousekeepingNotice } from '../../output/envelope.js';
import type { OutputMode, Writers } from '../../output/output-port.js';
import { isCaptureEnabled } from './capture-gate.js';
import { captureChecksOutcome } from './checks-capture.js';
import { pendingTelemetry, syncTelemetry } from './sync-service.js';

/**
 * Telemetry housekeeping for the **well-known** commands (plan 034 follow-on). An
 * exit-chokepoint decorator (composed alongside the update banner) that — and ONLY
 * when the command is one of these — surfaces telemetry housekeeping:
 *
 * - `checks` → records THIS run's gate **verdict** onto the session lane (plan 069
 *   — the preamble capture could only record that `checks` *ran*), then
 *   **auto-pushes** buffered telemetry (best-effort), unless disabled. `checks` is
 *   the wrap-up gate; the kernel capture preamble has already recorded this run's
 *   segment BEFORE the body, so the auto-sync flushes it along with the verdict
 *   marker — capture strictly precedes push. The verdict marker is a self-contained
 *   zero-width segment, so it adds no second transcript capture (which would only
 *   duplicate).
 * - `boot` / `doctor` → a passive **nudge** only (warns if telemetry is unpushed).
 *   `doctor` is the health command, so an unpushed-telemetry warning belongs there.
 *
 * DEFENSIVE BY CONTRACT (the whole point): this NEVER changes the host command's
 * status or exit code — it only *adds* {@link HousekeepingNotice}s to the envelope
 * and (human mode) writes side-channel stderr lines. Every path is wrapped so any
 * error is swallowed; `syncTelemetry`/`pendingTelemetry` are themselves fail-safe;
 * the auto-push is time-bounded by `ExecGitWrite`. A failed auto-sync is *reported*
 * (with the manual command), not thrown.
 *
 * Disable switches: `HARNESS_NO_TELEMETRY=1` (the kill-switch) turns everything
 * off; {@link TELEMETRY_AUTOSYNC_OFF_ENV} narrowly disables only the `checks`
 * auto-push (capture + manual `harness telemetry sync` still work — `checks` then
 * falls back to the nudge).
 */

/** The commands that carry telemetry housekeeping. Dormant for every other command. */
export const WELL_KNOWN_HOUSEKEEPING_COMMANDS = new Set(['boot', 'checks', 'doctor']);

/** Narrow opt-out for just the `checks` auto-push (telemetry otherwise stays on). */
export const TELEMETRY_AUTOSYNC_OFF_ENV = 'HARNESS_NO_TELEMETRY_AUTOSYNC';

/** The exact manual command a notice points at. */
const SYNC_COMMAND = 'harness telemetry sync';

export interface HousekeepingDecoratorDeps {
  fs: FsPort;
  env: EnvPort;
  proc: ProcessPort;
  /** WRITE plumbing for the auto-push (the composition root injects `ExecGitWrite`). */
  gitWrite: GitWritePort;
  /**
   * Read-only store access for the `checks` verdict marker — the ONE harness with
   * no session-id env var (VS Code Copilot Chat) resolves its lane by cwd. Optional:
   * without it that one harness stays silent, every other harness is unaffected.
   */
  db?: DbPort;
  mode: OutputMode;
  writers: Writers;
}

/** One-line human-mode rendering of a notice (newline-terminated). */
export function formatHousekeepingLine(n: HousekeepingNotice): string {
  return n.command
    ? `housekeeping: ${n.message} — run: ${n.command}\n`
    : `housekeeping: ${n.message}\n`;
}

/**
 * Build the housekeeping decorator. Returns the structural `(env) => void` so the
 * exit kernel never imports the service layer (mirrors `buildBannerDecorator`).
 */
export function buildHousekeepingDecorator(
  deps: HousekeepingDecoratorDeps,
): (env: Envelope) => void {
  const add = (env: Envelope, notice: HousekeepingNotice): void => {
    if (!env.housekeeping) env.housekeeping = [];
    env.housekeeping.push(notice);
    if (deps.mode === 'human') deps.writers.err(formatHousekeepingLine(notice));
  };

  const nudgeIfPending = (env: Envelope): void => {
    const p = pendingTelemetry({ fs: deps.fs, proc: deps.proc });
    if (p.segments > 0) {
      add(env, {
        kind: 'telemetry-unpushed',
        message: `${p.segments} telemetry segment(s) not yet pushed`,
        command: SYNC_COMMAND,
        details: { count: p.segments, sessions: p.sessions },
      });
    }
  };

  return (env: Envelope) => {
    try {
      if (!WELL_KNOWN_HOUSEKEEPING_COMMANDS.has(env.command)) return;
      // The HOUSEKEEPING enforcement point (plan 073 ac-0019): telemetry fully
      // off → no nudge, no push, no `checks` verdict capture, nothing buffered.
      // Off is the SHIPPED default now, not just the kill-switch.
      if (!isCaptureEnabled(deps.env)) return;

      // `checks` auto-pushes (capture already happened in the preamble) unless the
      // narrow opt-out is set, in which case it falls back to the passive nudge.
      if (env.command === 'checks') {
        // plan 069: record THIS run's gate verdict onto the session lane FIRST, so
        // the auto-sync below ships it in the same breath. The preamble could only
        // record that `checks` ran; only here is the outcome known. Isolated so a
        // capture failure can never cost the auto-push.
        try {
          captureChecksOutcome({ fs: deps.fs, env: deps.env, proc: deps.proc, db: deps.db }, env);
        } catch {
          // Defensive: an unwritable buffer must not break the gate or the push.
        }
      }
      if (env.command === 'checks' && deps.env.get(TELEMETRY_AUTOSYNC_OFF_ENV) !== '1') {
        const r = syncTelemetry({
          fs: deps.fs,
          env: deps.env,
          proc: deps.proc,
          git: deps.gitWrite,
        });
        if (!r.ok) {
          add(env, {
            kind: 'telemetry-autosync-failed',
            message: `telemetry auto-sync failed: ${r.message ?? 'unknown error'}`,
            command: SYNC_COMMAND,
            details: { count: r.segments },
          });
        } else if (r.pushed && r.segments > 0) {
          add(env, {
            kind: 'telemetry-synced',
            message: `auto-pushed ${r.segments} telemetry segment(s)`,
            details: { count: r.segments, sessions: r.sessions },
          });
        }
        // r.ok && nothing pending → silent (no notice).
        return;
      }

      // `boot` / `doctor`, or `checks` with auto-sync disabled → passive nudge only.
      nudgeIfPending(env);
    } catch {
      // Defensive: housekeeping must NEVER break or alter the host command.
    }
  };
}

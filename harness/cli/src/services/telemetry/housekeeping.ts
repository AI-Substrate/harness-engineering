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

/**
 * The collector opt-out, declared here rather than imported from
 * `services/doctor/collector/auto-install.ts` — importing it would make
 * `services/telemetry` depend on `services/doctor`, which is the coupling the
 * injected reading exists to avoid. Pinned to that module's
 * `COLLECTOR_OPT_OUT_ENV` by a test, so the two cannot drift apart silently.
 */
export const COLLECTOR_OPT_OUT_ENV = 'HARNESS_NO_COLLECTOR';

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
  /**
   * Reads which coding harnesses are present but NOT covered by the installed
   * git-ai hooks. Injected as a thunk rather than imported, for two reasons:
   *
   * 1. It keeps `services/telemetry` from depending on `services/doctor` — the
   *    composition root is the one layer allowed to know both.
   * 2. It makes the nudge a pure function of an injected reading, so every
   *    outcome (covered / uncovered / unreadable) is drivable with a fake. Same
   *    shape as `CollectorHealthDeps.ingress`, and for the same reason.
   *
   * MUST NOT PROBE. The real implementation is `readCollectorHealth`, which is
   * synchronous by design and does nothing but `fs.exists` reads — no exec, no
   * socket, no network. That is how the "bounded" requirement is met: there is
   * no unbounded operation to bound, rather than a timeout someone has to tune.
   *
   * Absent, or returning `null` → no nudge. A reading we could not take never
   * becomes either good news or a warning.
   */
  collectorHooks?: () => CollectorHooksReading | null;
  mode: OutputMode;
  writers: Writers;
}

/**
 * What the nudge needs to know, and nothing else — deliberately not the whole
 * `CollectorHealth`.
 *
 * Carrying only these three fields means the nudge cannot accidentally start
 * depending on the verdict ladder's RUNG ORDER. That matters right now: the
 * `could-not-determine` rungs are known to precede `ingress-blocked` and are
 * being reordered under plan 077. A nudge that read `health.verdict` would
 * silently change meaning when that lands; one that reads `missing` cannot.
 */
export interface CollectorHooksReading {
  /** Agents present on this machine whose edits are NOT being attributed. */
  missing: readonly string[];
  /**
   * The exact command that resolves it — a BARE COMMAND, never prose. This field
   * renders as `— run: <command>`, so a sentence here produces a paragraph after
   * "run:".
   *
   * It must also be platform-neutral. `harness doctor telemetry-nudge` is the
   * counter-example: on Windows the ingress is a NAMED PIPE (`drainable: false`,
   * `replayInto: false`), so the buffer-and-drain recovery path does not exist
   * there and the nudge refuses on platform grounds. Naming it would be advice
   * that cannot work for every Windows user.
   */
  command?: string;
  /**
   * The case-correct guidance, as prose. Carried in `details` rather than in
   * `command` precisely because it is a sentence and may name a recovery path
   * that is POSIX-only.
   */
  next_action?: string;
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

  /**
   * Surface a collector that is installed but NOT covering every coding harness
   * on this machine (packet 3d). `checks` runs constantly, so it is where an
   * agent whose edits are going unattributed gets noticed — the alternative is
   * that nobody finds out until someone reads a discipline panel with a hole in
   * it.
   *
   * SILENT WHEN HEALTHY, by construction: `missing` empty → no notice, no row,
   * no line. That is a requirement AND a hazard, because silent-when-healthy is
   * indistinguishable from never-ran. It is pinned by a test that asserts the
   * absence (`housekeeping.test.ts`), which is the only thing separating the two.
   *
   * NEVER CHANGES THE VERDICT: it only calls `add`, which appends to
   * `env.housekeeping`. It cannot reach `env.status` or the exit code, and the
   * decorator's outer catch means a throw here cannot reach the gate either.
   */
  const nudgeCollectorHooks = (env: Envelope): void => {
    if (deps.collectorHooks === undefined) return;
    // The collector opt-out is a DIFFERENT consent from the telemetry
    // kill-switch, and both silence this nudge for different reasons:
    //
    //   HARNESS_NO_TELEMETRY  — harness does not CAPTURE
    //   HARNESS_NO_COLLECTOR  — harness does not INSTALL SOMEONE ELSE'S
    //                           SOFTWARE on your machine
    //
    // A developer may reasonably want the second without the first. Whoever set
    // it declined the install deliberately, so nagging them every `checks` run
    // to go and do the thing they opted out of is not a nudge, it is a nag with
    // no resolving action — the opt-out IS the resolution.
    //
    // Read literally rather than via the collector's own gate, so this stays
    // free of a `services/doctor` import (the reading is injected for the same
    // reason).
    if (deps.env.get(COLLECTOR_OPT_OUT_ENV) === '1') return;
    const reading = deps.collectorHooks();
    if (reading === null || reading.missing.length === 0) return;
    const labels = reading.missing.join(', ');
    add(env, {
      kind: 'collector-hooks-incomplete',
      message: `${labels} ${reading.missing.length === 1 ? 'is' : 'are'} installed but not instrumented — ${
        reading.missing.length === 1 ? 'its' : 'their'
      } edits are not being attributed`,
      ...(reading.command !== undefined && { command: reading.command }),
      details: {
        agents: [...reading.missing],
        ...(reading.next_action !== undefined && { next_action: reading.next_action }),
      },
    });
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
        // BEFORE the auto-sync branch, and deliberately so. That branch RETURNS,
        // so anything placed beside `nudgeIfPending` at the bottom of this
        // function is unreachable whenever auto-sync is on — which is the shipped
        // default. A collector nudge added down there would have been silent on
        // every normal `harness checks` run while looking entirely correct in
        // review, and silent-when-healthy is the one failure this nudge cannot
        // distinguish from working.
        //
        // Isolated for the same reason the capture above is: running BEFORE the
        // auto-push means an unhandled throw here would cost the push entirely.
        // The outer catch would swallow it and the gate would stay green, so the
        // symptom would be telemetry that silently stopped shipping.
        try {
          nudgeCollectorHooks(env);
        } catch {
          // Defensive: an unreadable collector state must not cost the auto-push.
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

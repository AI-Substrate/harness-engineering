import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import type { Envelope } from '../../output/envelope.js';
import { toPosix } from '../shared/posix-path.js';
import { detectHarness, selectCapturedEnv, writeSegmentFile } from './capture-service.js';
import { buildChecksEvent } from './outcome-events.js';
import { type SegmentInput, serializeSegment } from './segment.js';

/**
 * `checks` outcome capture — the harness observing its OWN gate verdict (plan 069,
 * item 1).
 *
 * WHY HERE. The kernel's capture preamble runs BEFORE the command body, so it can
 * only record that `checks` was *invoked* (a `harness` verb marker), never how it
 * *ended*. The only adapter that ever emitted a `checks` EVENT was claude's, and
 * only when a harness JSON envelope happened to land in a captured `tool_result`
 * — so a rail-mode (`harness checks` without `--json`) run produced nothing, and
 * copilot-cli / cursor / copilot-vscode produced nothing EVER. Measured over the
 * whole telemetry corpus: 8 `checks` events against 226 `harness checks` verb
 * markers, which is why the discipline panel could never say whether a push was
 * gated by a PASSING check or a failing one.
 *
 * The exit chokepoint is the one observer that works for every agent harness,
 * because it is the harness itself: it holds the real {@link Envelope} — the same
 * verdict the user saw — and it fires before `checks`'s telemetry auto-push, so
 * the event ships on the very same sync.
 *
 * HONEST BY CONSTRUCTION. Nothing is fabricated: an unrecognized verdict yields
 * NO event ({@link buildChecksEvent} returns null), and a run with no detectable
 * harness session (a plain human shell) yields no event either — there is no lane
 * to attribute it to. Only codes/verdicts travel; a gate's free-text `note` never
 * does.
 *
 * The marker is a self-contained segment (`event_stream` is just the one `checks`
 * event) with a zero-width window, written via {@link writeSegmentFile} exactly as
 * `telemetry mark` does — so it never moves the transcript cursor, never
 * double-counts the command, and carries no tokens.
 */

export interface ChecksCaptureDeps {
  fs: FsPort;
  env: EnvPort;
  proc: ProcessPort;
}

/** The outcome of {@link captureChecksOutcome} — `null` when nothing was written. */
export type ChecksCaptureResult = { path: string; sessionId: string; harness: string } | null;

/**
 * Write the `checks` outcome of THIS invocation onto the caller's own session lane.
 * Best-effort and side-effect-free on every honest-silence path; the caller wraps
 * it so telemetry can never alter the host command (AC-09).
 */
export function captureChecksOutcome(
  deps: ChecksCaptureDeps,
  envelope: Envelope,
): ChecksCaptureResult {
  const detected = detectHarness(deps.env);
  if (detected === null || detected.sessionId.length === 0) return null;

  // The envelope's own timestamp — the real instant the gate finished, from the
  // kernel's injected clock. Never a re-read wall clock (honest time, plan 068).
  //
  // The per-gate verdicts live in `data` on a PASSING run but in `error.details`
  // on a failing one — and a failing gate is the case the discipline panel most
  // needs to see, so read both shapes (data first, then the error details).
  const gateSource = envelope.data ?? envelope.error?.details;
  const event = buildChecksEvent(envelope.status, gateSource, envelope.timestamp);
  if (event === null) return null;

  const cwd = toPosix(deps.proc.cwd());
  const segInput: SegmentInput = {
    command: 'checks',
    harness: detected.harness,
    harness_session_id: detected.sessionId,
    timecode: envelope.timestamp,
    window: { since: 'session-start', from: 0, to: 0 },
    branch: null,
    event_stream: [event],
    captured_env: selectCapturedEnv(deps.env),
  };
  const segment = serializeSegment(segInput, cwd);
  const path = writeSegmentFile(deps, cwd, detected.sessionId, segment);
  return { path, sessionId: detected.sessionId, harness: detected.harness };
}

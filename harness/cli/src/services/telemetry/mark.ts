import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { toPosix } from '../shared/posix-path.js';
import { detectHarness, selectCapturedEnv, writeSegmentFile } from './capture-service.js';
import { type Event, MARK_COUNT_KEYS, type MarkCountKey, type MarkEvent } from './events.js';
import { type SegmentInput, serializeSegment } from './segment.js';

/**
 * `harness telemetry mark` — the peer self-attestation SHAPE-GUARD + builder
 * (plan 053 · T003).
 *
 * A mark is COUNTS-ONLY and LEAK-PROOF BY CONSTRUCTION: `kind`/`verdict` are
 * identifier SLUGS and the finding buckets are non-negative integers — there is NO
 * free-text field, so no prose can ride the marker onto the wire (Constitution P12,
 * AC-05). The slug family is `record-service`'s `^[a-z][a-z0-9-]*$` with a 32-char
 * bound (`{0,31}`), matching the `captured_env` value-shape posture (dossier F-07).
 */

/** The mark slug shape: a lowercase identifier, 1–32 chars, digits/hyphens allowed. */
export const MARK_SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** The raw (pre-guard) inputs a caller hands the builder. */
export interface MarkInput {
  /** Capture-time ISO instant for the event's `t`. */
  t: string;
  /** The mark category (`--kind`) — must be a {@link MARK_SLUG_RE} slug. */
  kind: string;
  /** Optional verdict (`--verdict`) — must be a {@link MARK_SLUG_RE} slug when present. */
  verdict?: string;
  /** Optional finding buckets — non-negative integers keyed by {@link MarkCountKey}. */
  counts?: Partial<Record<MarkCountKey, number>>;
}

/** The builder outcome: a validated event, or a shaped (non-blocking) error. */
export type MarkResult =
  | { ok: true; event: MarkEvent }
  | { ok: false; error: string; next_action: string };

const SLUG_HINT = `must match ^[a-z][a-z0-9-]{0,31}$ (a lowercase identifier slug, ≤32 chars)`;

function isSlug(v: string): boolean {
  return MARK_SLUG_RE.test(v);
}

function isNonNegInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Validate the raw inputs and build a {@link MarkEvent}, or return a shaped error.
 * Pure: no I/O. Zero-valued count buckets are dropped (parity with the `artifact`
 * serializer), so a marker with only zeros serializes `counts:{}`.
 */
export function buildMarkEvent(input: MarkInput): MarkResult {
  if (!isSlug(input.kind)) {
    return {
      ok: false,
      error: `invalid --kind "${input.kind}"`,
      next_action: `--kind ${SLUG_HINT}`,
    };
  }
  if (input.verdict !== undefined && !isSlug(input.verdict)) {
    return {
      ok: false,
      error: `invalid --verdict "${input.verdict}"`,
      next_action: `--verdict ${SLUG_HINT}`,
    };
  }

  const counts: Partial<Record<MarkCountKey, number>> = {};
  for (const key of MARK_COUNT_KEYS) {
    const v = input.counts?.[key];
    if (v === undefined) continue;
    if (!isNonNegInt(v)) {
      return {
        ok: false,
        error: `invalid --${key.replace(/_/g, '-')} "${v}"`,
        next_action: `finding counts must be non-negative integers`,
      };
    }
    if (v > 0) counts[key] = v;
  }

  const event: MarkEvent = { t: input.t, kind: 'mark', mark_kind: input.kind, counts };
  if (input.verdict !== undefined) event.verdict = input.verdict;
  return { ok: true, event };
}

/** Narrow an {@link Event} to a {@link MarkEvent}. */
export function isMarkEvent(e: Event): e is MarkEvent {
  return e.kind === 'mark';
}

/** The ports the `telemetry mark` service reaches through. */
export interface MarkDeps {
  fs: FsPort;
  env: EnvPort;
  proc: ProcessPort;
  clock: Clock;
}

/** The outcome of {@link runMark} — the act maps it onto the envelope + exit code. */
export type RunMarkResult =
  | { ok: true; path: string; sessionId: string; harness: string; event: MarkEvent }
  | { ok: false; status: 'unconfigured'; next_action: string };

/**
 * Emit a peer self-attestation marker onto the CALLER's own session lane (plan 053).
 * Best-effort, non-blocking (D-3): a bad slug or an undetectable harness session
 * resolves to an `unconfigured` outcome (exit 2), NEVER a hard error — telemetry
 * must never break a peer's real work.
 *
 * The marker is a self-contained segment (its `event_stream` is just the one
 * {@link MarkEvent}), `tokens:null` (cost-excluded, filled by {@link serializeSegment}),
 * written via {@link writeSegmentFile} as the next `<seq>.json` — no OTLP sidecar,
 * so it surfaces via `get-fleet` from the live buffer, not the committed shards.
 */
export function runMark(
  deps: MarkDeps,
  input: { kind: string; verdict?: string; counts?: Partial<Record<MarkCountKey, number>> },
): RunMarkResult {
  const detected = detectHarness(deps.env);
  if (detected === null || detected.sessionId.length === 0) {
    return {
      ok: false,
      status: 'unconfigured',
      next_action:
        'No active harness session detected — run `harness telemetry mark` inside a harness (claude-code / copilot-cli / cursor) so the mark can land on its own lane.',
    };
  }

  const built = buildMarkEvent({ t: deps.clock.nowIso(), ...input });
  if (!built.ok) {
    return { ok: false, status: 'unconfigured', next_action: built.next_action };
  }

  const cwd = toPosix(deps.proc.cwd());
  const segInput: SegmentInput = {
    command: 'telemetry mark',
    harness: detected.harness,
    harness_session_id: detected.sessionId,
    timecode: deps.clock.nowIso(),
    window: { since: 'session-start', from: 0, to: 0 },
    branch: null,
    event_stream: [built.event],
    captured_env: selectCapturedEnv(deps.env),
  };
  const segment = serializeSegment(segInput, cwd);
  const path = writeSegmentFile(deps, cwd, detected.sessionId, segment);
  return {
    ok: true,
    path,
    sessionId: detected.sessionId,
    harness: detected.harness,
    event: built.event,
  };
}

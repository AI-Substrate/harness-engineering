import type { Clock } from '../../adapters/clock/clock-port.js';
import type { DbPort } from '../../adapters/db/db-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { ensureTemp } from '../shared/temp.js';
import {
  COPILOT_VSCODE_AI_AGENT,
  COPILOT_VSCODE_HARNESS,
  resolveCopilotVscodeSessionId,
} from './adapters/copilot-vscode-adapter.js';
import {
  type HarnessAdapter,
  type HarnessCapabilities,
  type HarnessContext,
  type HarnessSource,
  nullDefaultAdapter,
} from './adapters/harness-adapter.js';
import {
  branchPathFor,
  cursorPathFor,
  flowCursorPathFor,
  readBranch,
  readCursor,
  readFlowCursor,
  sessionDirFor,
  writeBranch,
  writeCursor,
  writeFlowCursor,
} from './cursor.js';
import type { Event } from './events.js';
import { flowLogEvents } from './flow-log.js';
import { flowEventFromFlightPlan } from './flow-nav.js';
import {
  type Segment,
  type SegmentInput,
  type SegmentWindow,
  serializeSegment,
} from './segment.js';

/**
 * The telemetry capture service (plan 034, T006 · P2 · §T3) — pure over injected
 * ports (P2: no `node:*`). On a command it detects the innermost harness, reads
 * the session cursor, computes the "since last command" window, builds a
 * counts-only segment through the adapter seam, and writes it to the
 * self-ignoring `.harness/temp/telemetry/<session>/<seq>.json` buffer atomically.
 *
 * Buffer layout (pinned for Phases 3/4 — F2/F4):
 *   `.harness/temp/telemetry/<harness_session_id>/<seq>.json`  one segment per file
 *   `.harness/temp/telemetry/<harness_session_id>.cursor`      the watermark
 *
 * The kill-switch + fail-safe wrapper are added in T009; the DESIGNED edge
 * no-ops (zero-harness, missing source, corrupt cursor) live here (T005/C3).
 */

export interface CaptureDeps {
  fs: FsPort;
  env: EnvPort;
  clock: Clock;
  proc: ProcessPort;
  git?: GitPort;
  /** Read-only SQLite access for adapters whose signal lives in a local db (Cursor). Optional. */
  db?: DbPort;
  /** The harness command that triggered capture (the kernel preamble passes this — Phase 3). */
  command: string;
  /** Per-harness adapters; the null-default is always the final fallback (AC-12). */
  adapters?: HarnessAdapter[];
}

interface DetectedHarness {
  harness: string;
  sessionId: string;
}

/**
 * Env → harness id, INNERMOST FIRST. Copilot vars nest under leaked Claude vars;
 * cursor-agent embeds a Claude runtime (it may leak `CLAUDE_CODE_SESSION_ID`), so
 * `CURSOR_CONVERSATION_ID` is matched BEFORE `CLAUDE_CODE_SESSION_ID`.
 */
const HARNESS_ENV_CHAIN: readonly { env: string; harness: string }[] = [
  { env: 'COPILOT_AGENT_SESSION_ID', harness: 'copilot-cli' },
  { env: 'CURSOR_CONVERSATION_ID', harness: 'cursor-agent' },
  { env: 'CLAUDE_CODE_SESSION_ID', harness: 'claude-code' },
];

/**
 * Detect the innermost active harness from env, or `null` (zero-harness → no-op).
 *
 * The env chain covers harnesses that publish a session-id env var. VS Code
 * Copilot **Chat** is the exception: it sets `AI_AGENT=github_copilot_vscode_agent`
 * but NO session-id var, so it's recognized here with an EMPTY `sessionId` — a
 * "resolve me from the store by cwd" marker that {@link captureUnsafe} fills via
 * {@link resolveCopilotVscodeSessionId} (it needs cwd + the db, neither available
 * to this pure env-only function). `TERM_PROGRAM=vscode` is deliberately NOT
 * consulted — a `copilot-cli` run inside VS Code's terminal must not false-match.
 */
export function detectHarness(env: EnvPort): DetectedHarness | null {
  for (const { env: key, harness } of HARNESS_ENV_CHAIN) {
    const sessionId = env.get(key);
    if (sessionId !== undefined && sessionId.length > 0) {
      return { harness, sessionId };
    }
  }
  if (env.get('AI_AGENT') === COPILOT_VSCODE_AI_AGENT) {
    return { harness: COPILOT_VSCODE_HARNESS, sessionId: '' }; // db-resolved by cwd in captureUnsafe
  }
  return null;
}

/**
 * Compute the capture window from the prior watermark + the current source
 * extent. No prior cursor (or a shrunk/rotated source) → `session-start` from 0;
 * otherwise the `last-command` delta. A null current position (missing source)
 * collapses to an empty window at the watermark.
 */
export function computeWindow(prev: number | null, current: number | null): SegmentWindow {
  const to = current ?? prev ?? 0;
  if (prev === null || to < prev) {
    return { since: 'session-start', from: 0, to: Math.max(to, 0) };
  }
  return { since: 'last-command', from: prev, to };
}

/** Next `<seq>.json` index in the session dir (max existing + 1; 1-based). */
function nextSeq(fs: FsPort, sessionDir: string): number {
  let max = 0;
  for (const name of fs.readdir(sessionDir)) {
    const m = /^(\d+)\.json$/.exec(name);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * Derive the plan id from a cwd under `docs/plans/<id>/` (the `<ordinal>-<slug>`
 * dir name), or null (plan 034 Phase 4, T006 — closes AC-08's "run inside
 * `docs/plans/<id>/`" clause; capture otherwise only saw `HARNESS_PLAN_ID`). The
 * regex requires the literal `docs/plans/` segment, so `docs/plansfoo/…` never
 * false-matches; it works from any depth below the plan dir.
 */
export function planIdFromCwd(cwd: string): string | null {
  const m = /(?:^|\/)docs\/plans\/([^/]+)/.exec(toPosix(cwd));
  return m ? (m[1] ?? null) : null;
}

/** Plan link: explicit `HARNESS_PLAN_ID` wins; else derive from the cwd (T006). */
function resolvePlanId(env: EnvPort, cwd: string): string | null {
  const explicit = env.get('HARNESS_PLAN_ID');
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return planIdFromCwd(cwd);
}

/**
 * Resolve the linked plan's `the-flow.json` path. `planIdFromCwd` supports running
 * from ANY depth under `docs/plans/<id>/` (e.g. `…/tasks`), so naively joining
 * `cwd + docs/plans/<id>` would double the segment and silently miss the flight
 * plan (companion F001). The repo root is the cwd prefix BEFORE `/docs/plans/`
 * (when present) — so the path is built from the root + the (possibly
 * `HARNESS_PLAN_ID`-overridden) `planId`, which also resolves an explicit plan id
 * that differs from the cwd's own plan (companion F005).
 *
 * Known limit: when cwd is NOT under any `docs/plans/<id>` (e.g. `…/harness/cli`)
 * there is no repo-root signal, so the plan dir is assumed to hang off cwd — the
 * same cwd≈repoRoot assumption the rest of capture already makes (path
 * relativization). Explicit-env plan links then resolve only from the repo root.
 */
function flightPlanPath(cwd: string, planId: string): string {
  const c = toPosix(cwd);
  const idx = c.indexOf('/docs/plans/');
  const root = idx !== -1 ? c.slice(0, idx) : c;
  return posixJoin(root, 'docs', 'plans', planId, 'the-flow.json');
}

/**
 * Read + parse the linked plan's `the-flow.json` ONCE (best-effort): no plan link,
 * a missing file, or a malformed JSON → `null` (capture never breaks). The parsed
 * object feeds BOTH the `flow` snapshot ({@link withFlowEvent}) and the `flow_log`
 * replay projection ({@link flowLogEvents}), so the plan is read a single time.
 */
function readFlightPlan(fs: FsPort, cwd: string, planId: string | null): unknown | null {
  if (planId === null) return null;
  const text = fs.readText(flightPlanPath(cwd, planId));
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Prepend the command-level `flow` event — read from the linked plan's
 * `the-flow.json` `nav` (AC-18, detail doc §4.4) — to the adapter's event stream,
 * anchored to the window start so {@link computeRollup} attributes the window's
 * gap-time to the current flight-plan stage (`flow_stage_time_s`). Best-effort:
 * no parsed plan or an empty stream → unchanged (no fabricated stage). This is the
 * current-stage ANCHOR; the `flow_log` projection (below) is the transition history.
 */
function withFlowEvent(parsed: unknown, stream: readonly Event[]): Event[] {
  if (parsed === null || stream.length === 0) return [...stream];
  const flow = flowEventFromFlightPlan(parsed, stream[0].t);
  return flow === null ? [...stream] : [flow, ...stream];
}

/**
 * Append the `flow_log` replay markers AFTER the window events (including the
 * harness tail). They carry their own real `fired_at` and are EXCLUDED from the
 * rollup (see `computeRollup`), so their possibly-older / backfilled times never
 * distort gap/wall/stage math; a replay consumer sorts the concatenated session
 * timeline by `t`. Appended last so they never shift the prepended `flow`/`branch`
 * head or the harness tail's anchor (plan 035).
 */
function withFlowLogEvents(flowLog: readonly Event[], stream: readonly Event[]): Event[] {
  return flowLog.length === 0 ? [...stream] : [...stream, ...flowLog];
}

/** Branch state for a capture: the current git branch, the prior one, and whether it changed. */
interface BranchInfo {
  current: string | null;
  from: string | null;
  changed: boolean;
}

/**
 * Prepend a `branch` event when the git branch changed since the last capture of
 * this session (branch-change detection is a git fact, computed in the service —
 * NOT a per-harness transcript fact). The event (`to`/`from`) is the SINGLE source
 * of truth for a switch — there is no `branch_changed` boolean; a consumer derives
 * it from `event_stream.some(e => e.kind === 'branch')`.
 *
 * Anchored to the window start when there's a stream; on an EMPTY window (a switch
 * with no other activity, e.g. `git checkout x` then `harness boot`) it anchors to
 * the window-end `timecode` and becomes the sole event — so a switch is never lost
 * for lack of a stream to anchor to. The exact switch time is unknown (it happened
 * between two captures), so `t_precision` is always `anchored`. A branch switch is
 * rare, so always-emitting barely touches the empty-stream / `rollup:null` case.
 */
function withBranchEvent(branch: BranchInfo, timecode: string, stream: readonly Event[]): Event[] {
  if (!branch.changed || branch.current === null) return [...stream];
  const t = stream.length > 0 ? stream[0].t : timecode;
  const e: Event = { t, t_precision: 'anchored', kind: 'branch', to: branch.current };
  if (branch.from !== null) e.from = branch.from;
  return [e, ...stream];
}

/**
 * Append a `harness` event for the command that triggered THIS capture (e.g.
 * `boot`, `flow`) so harness commands are visible in the reconstructed timeline.
 *
 * Anchored to the LAST event's timestamp — NOT the capture clock — deliberately: a
 * pure timeline marker that adds ZERO gap, so the (possibly idle) span between the
 * last observed work and the command firing is never mis-attributed as agent
 * working-time or stage-time. `t_precision:'anchored'` flags the inexact stamp.
 *
 * Appended ONLY to a NON-empty stream — a truly-empty window stays empty (rollup
 * null preserved), and the top-level `command` still names it. Mirrors
 * {@link withFlowEvent}/{@link withBranchEvent}'s no-op-on-empty contract. Detected
 * agent-run harness verbs already arrive as `harness` events from the adapters;
 * this adds only the triggering verb (not yet in the window's transcript at capture
 * time, so it can't duplicate one).
 */
function withHarnessCommandEvent(command: string, stream: readonly Event[]): Event[] {
  if (stream.length === 0 || command === '') return [...stream];
  const last = stream[stream.length - 1];
  return [...stream, { t: last.t, t_precision: 'anchored', kind: 'harness', verb: command }];
}

/** Merge detection context + adapter capabilities into a counts-only segment input. */
function buildInput(
  deps: CaptureDeps,
  detected: DetectedHarness,
  window: SegmentWindow,
  caps: HarnessCapabilities,
  branch: BranchInfo,
  planId: string | null,
  flightPlan: unknown,
  flowLog: readonly Event[],
): SegmentInput {
  const timecode = deps.clock.nowIso();
  return {
    command: deps.command,
    harness: detected.harness,
    harness_session_id: detected.sessionId,
    timecode,
    window,
    branch: branch.current,
    tokens: caps.tokens ?? null,
    models: caps.models ?? {},
    effort: caps.effort ?? null,
    skills: caps.skills ?? {},
    tools: caps.tools ?? {},
    user_prompts: caps.user_prompts ?? [],
    subagents: caps.subagents ?? [],
    files: caps.files ?? { written: [], edited: [] },
    plans_touched: planId !== null ? [planId] : [],
    events: {
      compactions: caps.compactions ?? [],
      api_errors: caps.api_errors ?? 0,
      local_commands: caps.local_commands ?? 0,
    },
    thinking: caps.thinking ?? null,
    // Compose the timeline: flow + branch prepend at the window start; the
    // triggering harness command appends as a zero-gap marker at the window end;
    // the flow_log replay markers append last (rollup-excluded, own real `t`).
    event_stream: withFlowLogEvents(
      flowLog,
      withHarnessCommandEvent(
        deps.command,
        withBranchEvent(branch, timecode, withFlowEvent(flightPlan, caps.event_stream ?? [])),
      ),
    ),
  };
}

/** The env kill-switch (naming-consistent with `HARNESS_NO_EXTENSIONS`). */
export const KILL_SWITCH_ENV = 'HARNESS_NO_TELEMETRY';

/**
 * Capture telemetry for the current command. The named entry the kernel preamble
 * (Phase 3) calls. Synchronous, ports-only, best-effort.
 *
 * Fail-safe by contract: the kill-switch short-circuits to ZERO side effects
 * (AC-05), and ANY error inside capture is swallowed (AC-09) — telemetry can
 * never change the host command's behaviour or exit code. This last-resort
 * catch-all is distinct from the DESIGNED edge no-ops in {@link captureUnsafe}.
 */
export function captureTelemetry(deps: CaptureDeps): void {
  try {
    if (deps.env.get(KILL_SWITCH_ENV) === '1') {
      return; // kill-switch → zero side effects (AC-05)
    }
    captureUnsafe(deps);
  } catch {
    // Fail-safe (AC-09): a corrupt source / parse error / fs failure inside
    // capture must never surface to the host command. Swallow and move on.
  }
}

/** The core capture path — may throw; always called through the {@link captureTelemetry} guard. */
function captureUnsafe(deps: CaptureDeps): void {
  let detected = detectHarness(deps.env);
  if (detected === null) {
    return; // zero-harness → clean no-op (no buffer, no writes)
  }

  const cwd = toPosix(deps.proc.cwd());

  // VS Code Copilot Chat carries no session-id env var (detection left it ''); the
  // active session is resolved from the store BY CWD (latest `updated_at`). This is
  // the ONE detection-time db read — done here, before the cursor/branch/buffer
  // paths consume `detected.sessionId`. No match → clean no-op (AC-21), never a
  // forced segment. Best-effort: a missing db / no `deps.db` resolves to null.
  if (detected.harness === COPILOT_VSCODE_HARNESS && detected.sessionId === '') {
    const sessionId =
      deps.db !== undefined ? resolveCopilotVscodeSessionId(deps.db, deps.env, cwd) : null;
    if (sessionId === null) return;
    detected = { harness: detected.harness, sessionId };
  }
  const source: HarnessSource = {
    env: deps.env,
    fs: deps.fs,
    db: deps.db,
    repoRoot: cwd,
    harness: detected.harness,
  };
  const adapter: HarnessAdapter =
    (deps.adapters ?? []).find((a) => a.handles(detected.harness)) ?? nullDefaultAdapter;

  const cursorPath = cursorPathFor(cwd, detected.sessionId);
  const prev = readCursor(deps.fs, cursorPath);
  const position = adapter.currentPosition?.(source) ?? null;
  const window = computeWindow(prev, position);

  // Branch-change detection: compare the live git branch to the one persisted on
  // the prior capture of this session. First capture (no prior) → not a change.
  const branchPath = branchPathFor(cwd, detected.sessionId);
  const priorBranch = readBranch(deps.fs, branchPath);
  const currentBranch = deps.git?.currentBranch() ?? null;
  const branch: BranchInfo = {
    current: currentBranch,
    from: priorBranch,
    changed: priorBranch !== null && currentBranch !== null && priorBranch !== currentBranch,
  };

  // Flow replay: read the linked flight plan ONCE, then window its append-only
  // `events[]` log by an array OFFSET kept per (session, plan) — collision-proof,
  // unlike a `fired_at` watermark (plan 035).
  const planId = resolvePlanId(deps.env, cwd);
  const flightPlan = readFlightPlan(deps.fs, cwd, planId);
  const flowCursorPath =
    planId !== null ? flowCursorPathFor(cwd, detected.sessionId, planId) : null;
  const priorFlowOffset = flowCursorPath !== null ? readFlowCursor(deps.fs, flowCursorPath) : 0;
  const flowLog = flowLogEvents(flightPlan, priorFlowOffset);

  const ctx: HarnessContext = { ...source, window };
  const caps = adapter.extract(ctx);
  const segment: Segment = serializeSegment(
    buildInput(deps, detected, window, caps, branch, planId, flightPlan, flowLog.events),
    cwd,
  );

  // Ensure the self-ignoring temp tree (writes temp/.gitignore = `*`), then write
  // the buffer entry atomically (temp + rename — mirror flow-service, not observe).
  ensureTemp({ fs: deps.fs, proc: deps.proc });
  const sessionDir = sessionDirFor(cwd, detected.sessionId);
  deps.fs.mkdirp(sessionDir);
  const entryPath = posixJoin(sessionDir, `${nextSeq(deps.fs, sessionDir)}.json`);
  const tmp = `${entryPath}.tmp`;
  deps.fs.writeText(tmp, `${JSON.stringify(segment, null, 2)}\n`);
  deps.fs.rename(tmp, entryPath);

  // Advance the high-water mark crash-safely, then remember this capture's branch
  // so the NEXT capture can detect a switch, and advance the flow-log offset so
  // each flight-plan event is surfaced exactly once.
  writeCursor(deps.fs, cursorPath, window.to);
  if (currentBranch !== null) writeBranch(deps.fs, branchPath, currentBranch);
  if (flowCursorPath !== null) writeFlowCursor(deps.fs, flowCursorPath, flowLog.nextOffset);
}

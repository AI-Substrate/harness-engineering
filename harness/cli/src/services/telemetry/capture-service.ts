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
import { artifactSemanticsEvents } from './artifact-semantics.js';
import {
  type CaptureProbe,
  classifyAttempt,
  newCaptureProbe,
  recordCaptureAttempt,
} from './capture-liveness.js';
import {
  branchPathFor,
  cursorPathFor,
  flowCursorPathFor,
  readBranch,
  readCursor,
  readFlowCursor,
  readFlushed,
  sessionDirFor,
  writeBranch,
  writeCursor,
  writeFlowCursor,
} from './cursor.js';
import type { Event } from './events.js';
import { flowLogEvents } from './flow-log.js';
import { flowEventFromFlightPlan } from './flow-nav.js';
import { segmentToOtlpLogs } from './otlp/logs.js';
import { rollupToOtlpMetrics } from './otlp/metrics.js';
import {
  CURRENT_CAPTURED_ENV_KEYS,
  isCapturedEnvEntry,
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
  /** The producing harness CLI version (the kernel preamble passes `readVersion()`) → segment `harness_version` / OTLP `service.version`. */
  version?: string;
  /** Per-harness adapters; the null-default is always the final fallback (AC-12). */
  adapters?: HarnessAdapter[];
}

export interface DetectedHarness {
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
 * "resolve me from the store by cwd" marker that {@link resolveDetectedSession}
 * fills via {@link resolveCopilotVscodeSessionId} (it needs cwd + the db, neither
 * available to this pure env-only function). `TERM_PROGRAM=vscode` is deliberately
 * NOT consulted — a `copilot-cli` run inside VS Code's terminal must not false-match.
 */
export function detectHarness(env: EnvPort): DetectedHarness | null {
  for (const { env: key, harness } of HARNESS_ENV_CHAIN) {
    const sessionId = env.get(key);
    if (sessionId !== undefined && sessionId.length > 0) {
      return { harness, sessionId };
    }
  }
  if (env.get('AI_AGENT') === COPILOT_VSCODE_AI_AGENT) {
    return { harness: COPILOT_VSCODE_HARNESS, sessionId: '' }; // db-resolved by cwd
  }
  return null;
}

/**
 * Complete a {@link detectHarness} result into a session the buffer can be keyed
 * by, or `null` when there is no attributable lane (→ a clean no-op, AC-21).
 *
 * Only VS Code Copilot Chat needs completing: it publishes no session-id env var,
 * so detection leaves `sessionId` EMPTY and the active session is read from the
 * chat store BY CWD. Every env-chain harness passes straight through unchanged.
 *
 * SHARED ON PURPOSE. Both writers of a session lane — the kernel's capture
 * preamble ({@link captureUnsafe}) and the `checks` exit-chokepoint marker
 * (`captureChecksOutcome`) — resolve through this ONE function. If they resolved
 * differently, a VS Code run's `checks` verdict would land on a different lane
 * than the command marker it is supposed to be joined with, and the discipline
 * panel would silently mis-attribute (or lose) the pairing.
 */
export function resolveDetectedSession(
  detected: DetectedHarness,
  deps: { env: EnvPort; db?: DbPort },
  cwd: string,
): DetectedHarness | null {
  if (detected.sessionId.length > 0) return detected;
  if (detected.harness !== COPILOT_VSCODE_HARNESS) return null;
  const sessionId =
    deps.db !== undefined ? resolveCopilotVscodeSessionId(deps.db, deps.env, cwd) : null;
  return sessionId === null ? null : { harness: detected.harness, sessionId };
}

/**
 * Allowlisted env-var name globs captured into every segment (`captured_env`).
 * A glob is an exact name or a `<prefix>*` prefix match. Code-constant BY DESIGN
 * (not env/config-driven): widening what telemetry records is then a reviewed
 * code change, fully auditable in git. Empty on most hosts → the field is omitted.
 */
export const ENV_CAPTURE_GLOBS: readonly string[] = [...CURRENT_CAPTURED_ENV_KEYS];

/**
 * Secret-shaped key-NAME guard, applied AFTER the globs: a name matching this is
 * DROPPED even when a glob selected it (so `PIJ_*` never sweeps `PIJ_TOKEN`). The
 * value then never reaches the segment, the buffer, or the pushed telemetry ref.
 * Matched case-insensitively against the NAME only — never the value (a value is
 * never inspected, so a non-secret-named var is captured verbatim).
 *
 * Tuned to genuine CREDENTIAL shapes, NOT broad substrings: a bare `SESSION` or
 * `KEY` would eat benign correlation handles like `PIJ_SESSION_ID` /
 * `PIJ_STATUS_KEY` (ids, not secrets). So `KEY` is denied only in a credential
 * compound (`API_KEY`, `SECRET_KEY`, `SSH_KEY`, …) and `SESSION_TOKEN` /
 * `SESSION_SECRET` are caught by the `TOKEN` / `SECRET` words, while `SESSION_ID`
 * flows. The narrow code-constant allowlist is the primary gate; this is
 * defense-in-depth for when a glob is widened.
 */
export const ENV_CAPTURE_DENY =
  /(?:^|_)(?:TOKEN|TOKENS|SECRET|SECRETS|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|CREDENTIALS|PRIVATE|BEARER|COOKIE|AUTH)(?:_|$)|APIKEY|(?:API|ACCESS|SECRET|PRIVATE|SIGNING|ENCRYPT|ENCRYPTION|SSH|GPG|PGP)[_-]?KEY/i;

/**
 * Free-form-CONTENT name guard, applied alongside the secret denylist. A var
 * whose name marks it as carrying a prompt/task/message/description holds
 * free-form text — NOT a count or identifier — so capturing its value would
 * leak message content into committed/pushed telemetry (P12/AC-04). `PIJ_SPAWN_TASK`
 * (the colleague's task prompt) is the motivating case. Names only — paired with
 * the value-shape guard below for content that slips a benign-looking name.
 */
export const ENV_CAPTURE_CONTENT_DENY =
  /(?:^|_)(?:TASK|TASKS|PROMPT|PROMPTS|MESSAGE|MESSAGES|MSG|TEXT|BODY|CONTENT|DESCRIPTION|DESC|COMMENT|COMMENTS|NOTE|NOTES|INSTRUCTION|INSTRUCTIONS|REQUEST|QUERY|INPUT|ARGS|ARGV|CMD|COMMAND)(?:_|$)/i;

/**
 * A captured value must look like an id/flag/path, never free-form content. A
 * value that is multi-line OR longer than this is almost certainly a prompt /
 * blob / serialized payload, so it is dropped name-agnostically — the second
 * line of defense behind {@link ENV_CAPTURE_CONTENT_DENY} (catches a content var
 * with a benign name, e.g. `PIJ_SPAWN_TASK` even were `TASK` not denied).
 */
export const ENV_VALUE_MAX_LEN = 256;

/**
 * Select only the exact Segment-2.5 pij environment vocabulary. Every value is
 * checked by its own grammar plus the shared credential detector; unknown and
 * historical-only keys are ignored before they can reach the serializer.
 */
export function selectCapturedEnv(env: EnvPort): Record<string, string> {
  const all = env.entries();
  const out: Record<string, string> = {};
  for (const name of CURRENT_CAPTURED_ENV_KEYS) {
    const value = all[name];
    if (value !== undefined && isCapturedEnvEntry(name, value, '2.5')) out[name] = value;
  }
  return out;
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

/** Write `obj` as a single OTLP/JSON-Lines record (one object + `\n`), atomically. */
function writeJsonLine(fs: FsPort, path: string, obj: unknown): void {
  const tmp = `${path}.tmp`;
  fs.writeText(tmp, `${JSON.stringify(obj)}\n`);
  fs.rename(tmp, path);
}

/** Next `<seq>.json` index, seeded above the durable flushed high-water. */
function nextSeq(fs: FsPort, sessionDir: string): number {
  let max = 0;
  for (const name of fs.readdir(sessionDir)) {
    const m = /^(\d+)\.json$/.exec(name);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return Math.max(readFlushed(fs, `${sessionDir}.flushed`), max) + 1;
}

/**
 * Write a pre-serialized {@link Segment} as the next `<seq>.json` in the session's
 * gitignored telemetry buffer, atomically (temp + rename — mirror {@link captureUnsafe}).
 * Returns the written path.
 *
 * Used by `harness telemetry mark` (plan 053) to drop a self-contained marker segment
 * onto the CALLER's own lane. UNLIKE the passive capture path this writes ONLY the
 * `<seq>.json` (no `.logs.jsonl`/`.metrics.jsonl` OTLP sidecars): `readSegments`
 * matches `^\d+\.json$`, so `get-fleet` picks the marker up from the live buffer, but
 * the mark deliberately does NOT ride the OTLP transport (it is not `telemetry
 * report` / committed-shard evidence — dossier F3).
 */
export function writeSegmentFile(
  deps: { fs: FsPort; proc: ProcessPort },
  cwd: string,
  sessionId: string,
  segment: Segment,
): string {
  ensureTemp({ fs: deps.fs, proc: deps.proc });
  const sessionDir = sessionDirFor(cwd, sessionId);
  deps.fs.mkdirp(sessionDir);
  const seq = nextSeq(deps.fs, sessionDir);
  const entryPath = posixJoin(sessionDir, `${seq}.json`);
  const tmp = `${entryPath}.tmp`;
  deps.fs.writeText(tmp, `${JSON.stringify(segment, null, 2)}\n`);
  deps.fs.rename(tmp, entryPath);
  return entryPath;
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
 * The distinct `docs/plans/<id>/` prefixes touched by this window's file paths
 * (T1.2-fix / AC-12). The root cause of live-empty `plans_touched`: env/cwd
 * derivation (`resolvePlanId`) ~never fires in a real run — the agent runs from
 * the repo root with no `HARNESS_PLAN_ID`, yet edits `docs/plans/<id>/…` all
 * session. Those edits ARE captured (`files.written`/`files.edited`), so the plan
 * identity is derivable from them with NO new I/O — a pure prefix scan. Returns
 * ids in first-seen order (deduped), P12-safe (path prefixes only, already
 * captured). A path like `docs/plansfoo/x` never false-matches (literal segment).
 */
function plansFromTouchedFiles(files: HarnessCapabilities['files']): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const paths = [...(files?.written ?? []), ...(files?.edited ?? [])];
  for (const p of paths) {
    const m = /(?:^|\/)docs\/plans\/([^/]+)/.exec(toPosix(p));
    const id = m?.[1];
    if (id !== undefined && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Dedupe plan ids, preserving first-seen order (the union's stable shape). */
function dedupePlans(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** True when a `docs/plans/<planId>/the-flow.json` path is among the touched files. */
function theFlowJsonTouched(files: HarnessCapabilities['files'], planId: string): boolean {
  const needle = `docs/plans/${planId}/the-flow.json`;
  const paths = [...(files?.written ?? []), ...(files?.edited ?? [])];
  return paths.some((p) => toPosix(p).endsWith(needle));
}

/**
 * Choose which plan's `the-flow.json` to read for the window's FlowEvent
 * (T1.2-fix). The env/cwd-derived id still wins (preserves the existing
 * flight-plan-read contract); otherwise an EVIDENCE-derived fallback keys off the
 * touched-file union so guided runs (which only ever surface plan identity through
 * their edits) still emit a stage:
 *  - exactly ONE plan in the union ⇒ read it;
 *  - MULTIPLE ⇒ read the one whose OWN `the-flow.json` is among the touched paths,
 *    but only when that disambiguates to exactly one candidate;
 *  - still ambiguous (zero or several such) ⇒ `null` ⇒ NO flow event (honest —
 *    `plans_touched` still keeps the full list; a stage is never fabricated).
 */
function selectFlightPlanId(
  envCwdPlanId: string | null,
  unionIds: readonly string[],
  files: HarnessCapabilities['files'],
): string | null {
  if (envCwdPlanId !== null) return envCwdPlanId;
  if (unionIds.length === 1) return unionIds[0];
  if (unionIds.length > 1) {
    const withFlow = unionIds.filter((id) => theFlowJsonTouched(files, id));
    if (withFlow.length === 1) return withFlow[0];
  }
  return null;
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

/**
 * Append the `artifact` semantic snapshots (plan 050) — one counts-only event per
 * changed flow/SDD artifact in the window's `files.written/edited` set. Appended
 * AFTER the flow_log markers: like them they carry a CAPTURE-TIME `t` and are
 * rollup-excluded, so their stamp never distorts gap/wall/stage math; a replay
 * consumer sorts the concatenated timeline by `t`. Empty changed set → unchanged.
 */
function withArtifactEvents(artifacts: readonly Event[], stream: readonly Event[]): Event[] {
  return artifacts.length === 0 ? [...stream] : [...stream, ...artifacts];
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
  plansTouched: string[],
  flightPlan: unknown,
  flowLog: readonly Event[],
  cwd: string,
): SegmentInput {
  const timecode = deps.clock.nowIso();
  // Artifact-semantics pass (plan 050): read each changed flow/SDD artifact at
  // capture time and project its structural markers into counts-only `artifact`
  // events, stamped at `timecode` (the "save time"). Guarded + defensive inside
  // the helper (skips missing/binary/oversized/out-of-repo; never throws).
  const artifactEvents = artifactSemanticsEvents(deps.fs, cwd, caps.files, timecode);
  return {
    command: deps.command,
    harness: detected.harness,
    harness_version: deps.version ?? 'unknown',
    harness_session_id: detected.sessionId,
    timecode,
    window,
    branch: branch.current,
    tokens: caps.tokens ?? null,
    token_unavailable_reason: caps.token_unavailable_reason ?? null,
    models: caps.models ?? {},
    effort: caps.effort ?? null,
    skills: caps.skills ?? {},
    tools: caps.tools ?? {},
    user_prompts: caps.user_prompts ?? [],
    subagents: caps.subagents ?? [],
    files: caps.files ?? { written: [], edited: [] },
    plans_touched: plansTouched,
    events: {
      compactions: caps.compactions ?? [],
      api_errors: caps.api_errors ?? 0,
      local_commands: caps.local_commands ?? 0,
    },
    thinking: caps.thinking ?? null,
    // v2.2 — allowlisted env snapshot at THIS capture point (glob-selected +
    // secret-denylisted). Empty on most hosts → omitted by the serializer.
    captured_env: selectCapturedEnv(deps.env),
    // Compose the timeline: flow + branch prepend at the window start; the
    // triggering harness command appends as a zero-gap marker at the window end;
    // the flow_log replay markers append next (rollup-excluded, own real `t`);
    // the artifact-semantics snapshots append last (rollup-excluded, capture `t`).
    event_stream: withArtifactEvents(
      artifactEvents,
      withFlowLogEvents(
        flowLog,
        withHarnessCommandEvent(
          deps.command,
          withBranchEvent(branch, timecode, withFlowEvent(flightPlan, caps.event_stream ?? [])),
        ),
      ),
    ),
  };
}

/** The env kill-switch (naming-consistent with `HARNESS_NO_EXTENSIONS`). */
export const KILL_SWITCH_ENV = 'HARNESS_NO_TELEMETRY';

/**
 * Re-entrancy guard env var. The kernel sets `HARNESS_TELEMETRY_DEPTH` in the
 * process env (app.ts) so any harness subprocess it spawns inherits it; a nested
 * invocation (`depth > 0`) self-suppresses capture. Without this, `harness checks`
 * — which shells out to its sub-verbs + the `flow render --check` drift gate as
 * child `harness` processes that all inherit `CLAUDE_CODE_SESSION_ID` — would
 * attribute ~10 segments to ONE logical run, and any self-spawned/looping child
 * would pollute the parent session's buffer. The TOP-level invocation runs at
 * depth 0 and is the only one that captures.
 */
export const CAPTURE_DEPTH_ENV = 'HARNESS_TELEMETRY_DEPTH';

/**
 * A capture carries real signal iff the transcript window advanced OR the event
 * stream is non-empty (which includes flow-replay markers — so a transcript-empty
 * window that surfaced flight-plan events is still kept). A no-activity capture is
 * read-only/idempotent plumbing (`flow rail/nav/render`, an idle status poll) and
 * is NOT spooled — otherwise the buffer fills with empty segments (the dominant
 * failure mode: 98% of one session's 19k segments were these).
 */
export function hasActivity(seg: Segment): boolean {
  return seg.window.from !== seg.window.to || seg.event_stream.length > 0;
}

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
    // Re-entrancy guard: a nested harness invocation (a sub-verb / drift-gate child
    // spawned by `harness checks`, or any self-spawned child) inherits a non-zero
    // depth and must NOT re-capture this session — the top-level (depth 0) already did.
    if (Number(deps.env.get(CAPTURE_DEPTH_ENV) ?? '0') > 0) {
      return;
    }
    // From here the invocation is ELIGIBLE: telemetry is on and this is the
    // top-level process. Everything an eligible attempt observes is recorded on
    // the probe so the liveness marker can describe what happened — INCLUDING
    // when the attempt dies in a swallowed throw (plan 070).
    const probe = newCaptureProbe();
    let threw = false;
    try {
      captureUnsafe(deps, probe);
    } catch (err) {
      // Fail-safe (AC-09): a corrupt source / parse error / fs failure inside
      // capture must never surface to the host command. Swallow — but no longer
      // silently: the attempt is about to be written down.
      threw = true;
      // The error CLASS only — never its message: a message can carry paths or
      // content, and this marker is diagnostic state, not curated telemetry.
      probe.errorKind = err instanceof Error ? err.name : typeof err;
    }
    if (probe.session !== null) {
      recordCaptureAttempt(deps, toPosix(deps.proc.cwd()), {
        session: probe.session,
        harness: probe.harness ?? 'unknown',
        command: deps.command,
        at: deps.clock.nowIso(),
        outcome: classifyAttempt(probe, threw),
        cursor: probe.cursor,
        position: probe.position,
        sourcePath: probe.sourcePath,
        ...(probe.errorKind !== undefined ? { errorKind: probe.errorKind } : {}),
      });
    }
    // A throw BEFORE the session was resolved leaves nothing to key a marker by
    // (zero-harness, or a store lookup that failed). We record nothing rather than
    // invent a lane — the detector marks absence, it never fabricates data.
  } catch {
    // Last-resort fail-safe: even the liveness bookkeeping above can never change
    // the host command's behaviour or exit code (AC-09 / plan 070 AC-5).
  }
}

/**
 * The core capture path — may throw; always called through the
 * {@link captureTelemetry} guard. Fills `probe` PROGRESSIVELY (each field only
 * once the attempt genuinely observed it), so a throw part-way through still
 * leaves an honest record of how far the attempt got.
 */
function captureUnsafe(deps: CaptureDeps, probe: CaptureProbe = newCaptureProbe()): void {
  let detected = detectHarness(deps.env);
  if (detected === null) {
    return; // zero-harness → clean no-op (no buffer, no writes)
  }

  const cwd = toPosix(deps.proc.cwd());

  // VS Code Copilot Chat carries no session-id env var (detection left it ''); the
  // active session is resolved from the store BY CWD (latest `updated_at`) through
  // the shared resolver — done here, before the cursor/branch/buffer paths consume
  // `detected.sessionId`. No match → clean no-op (AC-21), never a forced segment.
  const resolved = resolveDetectedSession(detected, deps, cwd);
  if (resolved === null) return;
  detected = resolved;
  // The lane is now known — from here every outcome is attributable to a session,
  // so the liveness marker has a key to be written under.
  probe.session = detected.sessionId;
  probe.harness = detected.harness;
  const standardClaude =
    detected.harness === 'claude-code'
      ? (() => {
          const selectedRoot = deps.env.get('CLAUDE_CONFIG_DIR');
          const home = deps.env.home();
          const configRoot =
            selectedRoot !== undefined && selectedRoot.length > 0
              ? toPosix(selectedRoot)
              : home !== undefined
                ? posixJoin(toPosix(home), '.claude')
                : '';
          const discovered = deps.git?.knownWorktreeRoots(32);
          // `cwd` is the FLOOR, never conditional on discovery (finding 05). Git can
          // fail transiently, the repo can exceed the worktree cap (`too-many`),
          // porcelain can drift (`malformed`), or the harness can run outside a repo —
          // and every one of those used to empty the candidate set and report a
          // perfectly readable transcript as `unavailable`. cwd needs no discovery, is
          // where Claude Code keys the project dir, and passes exactly the same
          // absolute/traversal checks in `locateAt` as any discovered root.
          const projectRoots = [
            ...new Set([
              cwd,
              ...(discovered?.status === 'ok' ? discovered.roots.map((root) => toPosix(root)) : []),
            ]),
          ];
          return { configRoot, projectRoots };
        })()
      : undefined;
  const source: HarnessSource = {
    env: deps.env,
    fs: deps.fs,
    db: deps.db,
    repoRoot: cwd,
    harness: detected.harness,
    sessionId: detected.sessionId,
    ...(standardClaude !== undefined ? { standardClaude } : {}),
  };
  const adapter: HarnessAdapter =
    (deps.adapters ?? []).find((a) => a.handles(detected.harness)) ?? nullDefaultAdapter;

  const cursorPath = cursorPathFor(cwd, detected.sessionId);
  const prev = readCursor(deps.fs, cursorPath);
  const position = adapter.currentPosition?.(source) ?? null;
  const window = computeWindow(prev, position);
  // The two numbers the stall is defined by: the watermark this attempt started
  // from, and how far the harness's own source had actually run.
  probe.cursor = prev;
  probe.position = position;
  probe.positionSupported = adapter.currentPosition !== undefined;
  probe.sourcePath = adapter.sourcePath?.(source) ?? null;

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

  // Extract the window's capabilities FIRST — its `files` are the evidence the
  // plan-identity union (below) reads (T1.2-fix); nothing about `caps` depends on
  // the plan link, so this reorder is behaviour-neutral for every non-plan field.
  const ctx: HarnessContext = { ...source, window, capturedAt: deps.clock.nowIso() };
  const caps = adapter.extract(ctx);

  // Plan identity (T1.2-fix / AC-12): `plans_touched` is the DEDUPED UNION of the
  // env/cwd-derived id (kept for the flight-plan read) PLUS every distinct
  // `docs/plans/<id>/` prefix in this window's touched files — because env/cwd
  // derivation ~never fires in a real run (repo-root cwd, no HARNESS_PLAN_ID), yet
  // the agent's edits carry the plan identity. Pure derivation, no new I/O.
  const envCwdPlanId = resolvePlanId(deps.env, cwd);
  const touchedPlanIds = plansFromTouchedFiles(caps.files);
  const plansTouched = dedupePlans([
    ...(envCwdPlanId !== null ? [envCwdPlanId] : []),
    ...touchedPlanIds,
  ]);

  // Flow replay: read the linked flight plan ONCE, then window its append-only
  // `events[]` log by an array OFFSET kept per (session, plan) — collision-proof,
  // unlike a `fired_at` watermark (plan 035). The plan whose `the-flow.json` is
  // read is the env/cwd id when present, else the evidence-derived choice from the
  // touched-file union (single ⇒ that; multiple ⇒ the one whose the-flow.json was
  // itself touched; still ambiguous ⇒ null ⇒ no fabricated FlowEvent).
  const flightPlanId = selectFlightPlanId(envCwdPlanId, plansTouched, caps.files);
  const flightPlan = readFlightPlan(deps.fs, cwd, flightPlanId);
  const flowCursorPath =
    flightPlanId !== null ? flowCursorPathFor(cwd, detected.sessionId, flightPlanId) : null;
  const priorFlowOffset = flowCursorPath !== null ? readFlowCursor(deps.fs, flowCursorPath) : 0;
  const flowLog = flowLogEvents(flightPlan, priorFlowOffset);

  const segment: Segment = serializeSegment(
    buildInput(deps, detected, window, caps, branch, plansTouched, flightPlan, flowLog.events, cwd),
    cwd,
  );

  // No-activity guard: a read-only/idempotent plumbing call (`flow rail/nav/render`,
  // an idle poll) yields an empty window + empty event stream — do NOT spool it.
  // Safe to skip the cursor/flow-offset writes: an empty window has `to === from ===
  // prev` (cursor already correct) and an empty stream consumed no flow-replay events.
  //
  // BUT the branch BASELINE must still be persisted when it is new or changed — else
  // an empty first capture on `main` never records `main`, and a later `main`→`feature`
  // switch has no baseline and is silently lost (a real change is only detectable
  // against a persisted prior branch). Only on a baseline delta — never a redundant
  // write on a stable-branch idle poll (keeps the no-activity path write-free).
  if (!hasActivity(segment)) {
    if (currentBranch !== null && currentBranch !== priorBranch) {
      ensureTemp({ fs: deps.fs, proc: deps.proc });
      deps.fs.mkdirp(sessionDirFor(cwd, detected.sessionId)); // creates the telemetry dir for the .branch write
      writeBranch(deps.fs, branchPath, currentBranch);
    }
    return;
  }

  // Product provenance is resolved only after activity is known. Detached HEAD is
  // valid; unborn/no-repo/invalid output stays unavailable and is omitted.
  const productCommit = deps.git?.currentCommit() ?? null;
  if (productCommit !== null) segment.product_commit = productCommit;

  // Ensure the self-ignoring temp tree (writes temp/.gitignore = `*`), then write
  // the buffer entry atomically (temp + rename — mirror flow-service, not observe).
  ensureTemp({ fs: deps.fs, proc: deps.proc });
  const sessionDir = sessionDirFor(cwd, detected.sessionId);
  deps.fs.mkdirp(sessionDir);
  const seq = nextSeq(deps.fs, sessionDir);
  const entryPath = posixJoin(sessionDir, `${seq}.json`);
  const tmp = `${entryPath}.tmp`;
  deps.fs.writeText(tmp, `${JSON.stringify(segment, null, 2)}\n`);
  deps.fs.rename(tmp, entryPath);

  // Transport-agnostic OTLP spool (plan 038 T010 · WS-B S4): emit the SAME
  // serialized segment as OTLP/JSON Lines beside the buffer entry — one `LogsData`
  // line + one `MetricsData` line per capture (the fileexporter idiom; one file
  // per signal, research A1). Written from the serialized segment only, so the
  // counts-only allowlist is inherited; atomic temp+rename. The transport (sync)
  // ships these — the serializer carries no transport knowledge. (Segment JSON is
  // kept until the sync publisher + scraper migrate to `.jsonl` in T011/T013.)
  writeJsonLine(deps.fs, posixJoin(sessionDir, `${seq}.logs.jsonl`), segmentToOtlpLogs(segment));
  writeJsonLine(
    deps.fs,
    posixJoin(sessionDir, `${seq}.metrics.jsonl`),
    rollupToOtlpMetrics(segment),
  );

  // Advance the high-water mark crash-safely, then remember this capture's branch
  // so the NEXT capture can detect a switch, and advance the flow-log offset so
  // each flight-plan event is surfaced exactly once.
  writeCursor(deps.fs, cursorPath, window.to);
  if (currentBranch !== null) writeBranch(deps.fs, branchPath, currentBranch);
  if (flowCursorPath !== null) writeFlowCursor(deps.fs, flowCursorPath, flowLog.nextOffset);
  // The window is durably consumed: this attempt is a proven-live capture, and
  // the watermark it leaves behind is the one a later residue check measures
  // against (on a first capture the PRIOR watermark is null — meaningless here).
  probe.captured = true;
  probe.cursor = window.to;
}

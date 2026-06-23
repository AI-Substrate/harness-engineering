import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { ensureTemp } from '../shared/temp.js';
import {
  type HarnessAdapter,
  type HarnessCapabilities,
  type HarnessContext,
  type HarnessSource,
  nullDefaultAdapter,
} from './adapters/harness-adapter.js';
import { cursorPathFor, readCursor, sessionDirFor, writeCursor } from './cursor.js';
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
  /** The harness command that triggered capture (the kernel preamble passes this — Phase 3). */
  command: string;
  /** Per-harness adapters; the null-default is always the final fallback (AC-12). */
  adapters?: HarnessAdapter[];
}

interface DetectedHarness {
  harness: string;
  sessionId: string;
}

/** Env → harness id, INNERMOST FIRST (Copilot vars nest under leaked Claude vars). */
const HARNESS_ENV_CHAIN: readonly { env: string; harness: string }[] = [
  { env: 'COPILOT_AGENT_SESSION_ID', harness: 'copilot-cli' },
  { env: 'CLAUDE_CODE_SESSION_ID', harness: 'claude-code' },
];

/** Detect the innermost active harness from env, or `null` (zero-harness → no-op). */
export function detectHarness(env: EnvPort): DetectedHarness | null {
  for (const { env: key, harness } of HARNESS_ENV_CHAIN) {
    const sessionId = env.get(key);
    if (sessionId !== undefined && sessionId.length > 0) {
      return { harness, sessionId };
    }
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

/** Merge detection context + adapter capabilities into a counts-only segment input. */
function buildInput(
  deps: CaptureDeps,
  detected: DetectedHarness,
  window: SegmentWindow,
  caps: HarnessCapabilities,
): SegmentInput {
  const planId = deps.env.get('HARNESS_PLAN_ID');
  return {
    command: deps.command,
    harness: detected.harness,
    harness_session_id: detected.sessionId,
    timecode: deps.clock.nowIso(),
    window,
    branch: deps.git?.currentBranch() ?? null,
    branch_changed: caps.branch_changed ?? false,
    tokens: caps.tokens ?? null,
    models: caps.models ?? {},
    effort: caps.effort ?? null,
    skills: caps.skills ?? {},
    tools: caps.tools ?? {},
    subagents: caps.subagents ?? [],
    files: caps.files ?? { written: [], edited: [] },
    plans_touched: planId !== undefined && planId.length > 0 ? [planId] : [],
    events: {
      compactions: caps.compactions ?? [],
      api_errors: caps.api_errors ?? 0,
      local_commands: caps.local_commands ?? 0,
    },
    thinking: caps.thinking ?? null,
  };
}

/**
 * Capture telemetry for the current command. The named entry the kernel preamble
 * (Phase 3) calls. Synchronous, ports-only, best-effort.
 */
export function captureTelemetry(deps: CaptureDeps): void {
  const detected = detectHarness(deps.env);
  if (detected === null) {
    return; // zero-harness → clean no-op (no buffer, no writes)
  }

  const cwd = toPosix(deps.proc.cwd());
  const source: HarnessSource = {
    env: deps.env,
    fs: deps.fs,
    repoRoot: cwd,
    harness: detected.harness,
  };
  const adapter: HarnessAdapter =
    (deps.adapters ?? []).find((a) => a.handles(detected.harness)) ?? nullDefaultAdapter;

  const cursorPath = cursorPathFor(cwd, detected.sessionId);
  const prev = readCursor(deps.fs, cursorPath);
  const position = adapter.currentPosition?.(source) ?? null;
  const window = computeWindow(prev, position);

  const ctx: HarnessContext = { ...source, window };
  const caps = adapter.extract(ctx);
  const segment: Segment = serializeSegment(buildInput(deps, detected, window, caps), cwd);

  // Ensure the self-ignoring temp tree (writes temp/.gitignore = `*`), then write
  // the buffer entry atomically (temp + rename — mirror flow-service, not observe).
  ensureTemp({ fs: deps.fs, proc: deps.proc });
  const sessionDir = sessionDirFor(cwd, detected.sessionId);
  deps.fs.mkdirp(sessionDir);
  const entryPath = posixJoin(sessionDir, `${nextSeq(deps.fs, sessionDir)}.json`);
  const tmp = `${entryPath}.tmp`;
  deps.fs.writeText(tmp, `${JSON.stringify(segment, null, 2)}\n`);
  deps.fs.rename(tmp, entryPath);

  // Advance the high-water mark crash-safely.
  writeCursor(deps.fs, cursorPath, window.to);
}

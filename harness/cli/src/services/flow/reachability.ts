import type { ExecPort, ExecResult } from '../../adapters/exec/exec-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import {
  isWithin,
  posixJoin,
  posixRelative,
  resolveInRepo,
  toPosix,
} from '../shared/posix-path.js';
import { type FlowServiceDeps, readFlowDoc } from './flow-service.js';

/**
 * Flow reachability (plan 081 Phase 2) — the deterministic "does this stream owe
 * a flight plan?" reading, behind the act seam.
 *
 * Two clauses are answered for one plan folder, and BOTH are always answered:
 *
 *   1. **Does the plan document validate?** Obtained by spawning THIS binary's
 *      own `plan validate <planDir> --json` through the injected {@link ExecPort}
 *      and reading its envelope. CLI-is-the-API (constitution P4): the plan
 *      family's semantics are consumed at the published surface, never by
 *      importing `services/dd/**` — which is also what keeps this module from
 *      pinning a plan-internal shape that another stream owns.
 *   2. **Does a flight plan exist and read back?** Via {@link readFlowDoc}, so
 *      `E301` absent · `E300` malformed · `E308` legacy · `E306` future-version
 *      are the SAME four classes the rest of the flow family reports, mapped to
 *      four distinct {@link FlowUnusableReason}s rather than collapsed into one
 *      "bad flow".
 *
 * The verdict composes them with the polarity Jordan ruled: a plan that is
 * missing or does not validate is an `error`; a plan that validates with an
 * unusable flight plan is a `degraded` WARNING (never a default-on gate); both
 * good is `ok`.
 *
 * Neither clause short-circuits the other. The measured failure this exists to
 * catch (AI-Substrate/pij#227: 9/9 streams merged green, 0/9 with a flight plan,
 * 2/9 with no plan document) is precisely what a check that stops at the first
 * bad clause — and then reports only the survivors — cannot see. So
 * {@link ReachabilityResult.examined} lists every artifact looked at and
 * {@link ReachabilityResult.excluded} lists the ones that could not be used.
 *
 * Pure over injected ports: no `node:*`, no `process`, no clock of its own. The
 * act resolves `cwd` (the repo root), the Node executable and this CLI's bin
 * path and passes them in.
 */

/** Hard deadline for the child `plan validate` when the caller names none. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** The plan document a plan folder is expected to carry (the plan family's own convention). */
const PLAN_DOC_NAME = 'plan.dd.json';
/** The flight plan a plan folder is expected to carry, absent an explicit override. */
const FLOW_DOC_NAME = 'the-flow.json';
/** The exit code {@link ExecPort} adapters resolve with after a timeout kill. */
const TIMEOUT_EXIT_CODE = 124;
/**
 * The kernel's published status → exit code contract (`src/output/exit.ts`,
 * Workshop 001), consumed here from OUTSIDE the process because this module
 * re-enters the CLI as a child rather than importing its exit path. A child
 * that exits non-zero in a way its own envelope does not account for did not
 * produce a reading — it crashed and happened to print JSON. The real-CLI
 * suite pins the live pairings (exit 1 + `error`), so drift is caught here.
 */
const SUPPORTED_EXIT_BY_STATUS: Record<string, number> = {
  ok: 0,
  degraded: 0,
  unconfigured: 2,
  error: 1,
};

export type ReachabilityVerdict = 'ok' | 'degraded' | 'error';

/**
 * Why a flight plan could not be used. One member per readFlowDoc failure class,
 * plus `unreadable` for any future code — an unmapped code must still be
 * reported honestly rather than silently read as one of the known four.
 */
export type FlowUnusableReason =
  /** `E301` — nothing at the path. The stream never created a flight plan. */
  | 'absent'
  /** `E308` — flow-shaped but pre-CLI (no `provenance`); the clean-break class. */
  | 'legacy'
  /** `E300` — the file is there and is not valid JSON. */
  | 'malformed'
  /** `E306` — valid, but written by a CLI major this one does not understand. */
  | 'future-version'
  /** Any other read failure — reported, never folded into the classes above. */
  | 'unreadable';

export interface ReachabilityOptions {
  /** The plan folder to read. Absolute, or relative to {@link ReachabilityOptions.cwd}. */
  planDir: string;
  /** Flight-plan override; defaults to `<planDir>/the-flow.json`. */
  flowPath?: string;
  /**
   * The repo root: the working directory the child CLI runs in, and the anchor
   * relative paths resolve against (and are displayed against in `next_action`).
   */
  cwd: string;
  /** The Node executable to spawn (the act passes the running one). */
  nodePath: string;
  /** This CLI's bin path — the same binary, re-entered at its published surface. */
  binPath: string;
  /** Child deadline; defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export interface ReachabilityDeps extends FlowServiceDeps {
  exec: ExecPort;
}

/** Clause 1 — the plan document, as the CLI itself reports it. */
export interface PlanClause {
  /** The plan document exists on disk. */
  present: boolean;
  /** `plan validate` reported no errors. The CLI is the sole authority here. */
  validates: boolean;
  /** Human-readable cause, taken verbatim from the CLI's envelope where there is one. */
  detail: string;
  /** Absolute POSIX path of the plan document that was looked for. */
  path: string;
  /** The envelope's error code (e.g. `E400`), when it failed. */
  code?: string;
}

/** Clause 2 — the flight plan, as `readFlowDoc` reports it. */
export interface FlowClause {
  /** A file exists at the path — false ONLY for the `absent` class. */
  present: boolean;
  /** It parsed and this CLI understands it. */
  readable: boolean;
  /** Which unusable class this is, when it is not readable. */
  reason?: FlowUnusableReason;
  /** The read failure's message, verbatim. */
  detail?: string;
  /** Absolute POSIX path of the flight plan that was looked for. */
  path: string;
  /** The `E30x` code behind {@link FlowClause.reason}. */
  code?: string;
}

export interface ReachabilityResult {
  verdict: ReachabilityVerdict;
  plan: PlanClause;
  flow: FlowClause;
  /** Every artifact this check LOOKED AT, present or not — the denominator. */
  examined: string[];
  /** The subset that could not be used — the honest "what is missing" count. */
  excluded: string[];
  /** The single next step, keyed on which clause failed. Repo-relative, runnable. */
  next_action: string;
}

/** The slice of the `plan validate` envelope this check reads. */
interface PlanValidateEnvelope {
  status: string;
  error?: { code?: string; message?: string };
  data?: { counts?: { error?: number; warn?: number } };
  next_action?: string;
}

/**
 * Parse stdout as an envelope, or refuse. `status` is the envelope's
 * discriminator, so a JSON object without one is some other output the child
 * happened to print — a bare `{}` from a child that died before it ran anything
 * must take the "no envelope" path, never read as an absence of errors.
 */
function parseEnvelope(raw: string): PlanValidateEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const status: unknown = (parsed as { status?: unknown }).status;
    return typeof status === 'string' ? (parsed as PlanValidateEnvelope) : null;
  } catch {
    return null;
  }
}

/**
 * A path as a human should copy it: repo-relative when it is inside the repo,
 * absolute otherwise. Used ONLY for `next_action`, so the create line it prints
 * is directly runnable — `flow create --plan-dir` REFUSES absolute values.
 */
function display(repoRoot: string, path: string): string {
  return isWithin(repoRoot, path) ? posixRelative(repoRoot, path) : path;
}

/** The final path segment — the plan folder's slug. */
function basename(path: string): string {
  const parts = path.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/**
 * Clause 1. Spawns `<node> <bin> plan validate <planDir> --json` and reads the
 * envelope. Every failure mode maps to `validates: false` with a detail that
 * NAMES what happened — a child that was killed, crashed, printed something
 * that is not an envelope, or could not be started at all is an error, never an
 * unexamined pass. In particular the timeout exit code is checked BEFORE stdout
 * is parsed: a killed child's partial output must never be read as a verdict.
 * A REJECTING exec port is caught here rather than propagated, which is what
 * makes {@link checkReachability}'s never-throws contract true.
 */
async function validatePlan(
  opts: ReachabilityOptions,
  deps: ReachabilityDeps,
  planDir: string,
  planPath: string,
): Promise<{ clause: PlanClause; next_action: string | null }> {
  const args = [opts.binPath, 'plan', 'validate', planDir, '--json'];
  const present = deps.fs.exists(planPath);
  let result: ExecResult;
  try {
    result = await deps.exec.run(opts.nodePath, args, {
      cwd: toPosix(opts.cwd),
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    // A port that REJECTS never produced a result to read. Every other child
    // failure resolves with a non-zero code, so this is the one path that could
    // escape as a throw and break the never-throws contract. It fails CLOSED:
    // an unrunnable child proves nothing about the plan, so it is an error, and
    // the cause is NAMED rather than reported as "no envelope".
    const message = err instanceof Error ? err.message : String(err);
    return {
      clause: {
        present,
        validates: false,
        detail: `\`plan validate\` could not be run: ${message} — the plan was not proven either way.`,
        path: planPath,
      },
      next_action: `Run \`harness plan validate ${planDir} --json\` directly — the child process could not be started.`,
    };
  }

  if (result.code === TIMEOUT_EXIT_CODE) {
    return {
      clause: {
        present,
        validates: false,
        detail: `\`plan validate\` timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms and was killed — the plan was not proven either way.`,
        path: planPath,
      },
      next_action: `Re-run \`harness plan validate ${planDir}\` directly to see why it did not finish.`,
    };
  }

  const envelope = parseEnvelope(result.stdout);
  if (envelope === null) {
    const stderr = result.stderr.trim();
    return {
      clause: {
        present,
        validates: false,
        detail: `\`plan validate\` produced no parseable JSON envelope (exit ${result.code})${stderr.length > 0 ? `: ${stderr}` : ''}`,
        path: planPath,
      },
      next_action: `Run \`harness plan validate ${planDir} --json\` directly — its output was not an envelope.`,
    };
  }

  const counts = envelope.data?.counts;
  const errors = typeof counts?.error === 'number' ? counts.error : null;
  const expectedExit = SUPPORTED_EXIT_BY_STATUS[envelope.status];
  if (result.code !== 0 && result.code !== expectedExit) {
    // The exit code is evidence about the CHILD; the envelope is evidence about
    // the plan. When they disagree — exit 127 with `{}`, exit 3 with an `ok`
    // envelope — the child is not reporting, and its stdout is not a verdict.
    return {
      clause: {
        present,
        validates: false,
        detail: `\`plan validate\` exited ${result.code}, which its own \`${envelope.status}\` envelope does not account for (expected ${expectedExit ?? 'a mapped exit code'}) — the plan was not proven either way.`,
        path: planPath,
      },
      next_action: `Run \`harness plan validate ${planDir} --json\` directly — the child exited ${result.code}.`,
    };
  }
  // A `degraded` envelope with zero errors still validates — warnings are not
  // errors. An `ok` envelope that nonetheless counts errors does NOT: when the
  // two disagree, the count wins, because it is the specific claim. Every other
  // status (`error`, `unconfigured`, anything unrecognised) is the CLI saying it
  // did not clear this plan, which is not the same as clearing it.
  const validates =
    (envelope.status === 'ok' || envelope.status === 'degraded') &&
    (errors === null || errors === 0);

  if (!validates) {
    return {
      clause: {
        present,
        validates: false,
        detail:
          envelope.error?.message ??
          (errors !== null
            ? `plan validate reported ${errors} error(s)`
            : `plan validate returned \`${envelope.status}\``),
        path: planPath,
        ...(envelope.error?.code !== undefined && { code: envelope.error.code }),
      },
      next_action:
        envelope.next_action ??
        `Fix the plan document at ${planPath}, or scaffold one with \`harness plan new <slug>\`.`,
    };
  }

  const warns = typeof counts?.warn === 'number' ? counts.warn : null;
  return {
    clause: {
      present,
      validates: true,
      detail:
        warns !== null && warns > 0
          ? `plan document validates (0 errors, ${warns} warning(s))`
          : 'plan document validates',
      path: planPath,
    },
    next_action: null,
  };
}

/** Clause 2. `readFlowDoc`'s failure codes, mapped 1:1 onto distinct reasons. */
function readFlow(
  flowPath: string,
  deps: ReachabilityDeps,
): { clause: FlowClause; next_action: string | null } {
  const read = readFlowDoc(flowPath, deps);
  if (read.ok) {
    return { clause: { present: true, readable: true, path: flowPath }, next_action: null };
  }
  const reason: FlowUnusableReason =
    read.code === ErrorCodes.FLOW_NOT_FOUND
      ? 'absent'
      : read.code === ErrorCodes.FLOW_LEGACY_FORMAT
        ? 'legacy'
        : read.code === ErrorCodes.FLOW_SCHEMA_INVALID
          ? 'malformed'
          : read.code === ErrorCodes.FLOW_SCHEMA_VERSION
            ? 'future-version'
            : 'unreadable';
  return {
    clause: {
      // Only `absent` proves nothing is there; every other class is a file that
      // exists and cannot be used — a different problem with a different fix.
      // `unreadable` is the unmapped-code case, so presence is probed, not assumed.
      present: reason === 'unreadable' ? deps.fs.exists(flowPath) : reason !== 'absent',
      readable: false,
      reason,
      detail: read.message,
      path: flowPath,
      code: read.code,
    },
    next_action: read.next_action,
  };
}

/**
 * Answer both reachability clauses for one plan folder.
 *
 * Never throws: a child that fails to spawn, rejects at the port, hangs, or
 * prints garbage becomes an `error` verdict whose `plan.detail` names the cause.
 */
export async function checkReachability(
  opts: ReachabilityOptions,
  deps: ReachabilityDeps,
): Promise<ReachabilityResult> {
  const repoRoot = toPosix(opts.cwd);
  const planDir = resolveInRepo(opts.planDir, repoRoot);
  const planPath = posixJoin(planDir, PLAN_DOC_NAME);
  const flowPath =
    opts.flowPath !== undefined && opts.flowPath.length > 0
      ? resolveInRepo(opts.flowPath, repoRoot)
      : posixJoin(planDir, FLOW_DOC_NAME);

  // Both clauses are read, always, in artifact order — never short-circuited on
  // the first failure. A verdict that names only the first thing it tripped over
  // is how a stream with neither artifact gets reported as one problem.
  const plan = await validatePlan(opts, deps, planDir, planPath);
  const flow = readFlow(flowPath, deps);

  const examined = [planPath, flowPath];
  const excluded: string[] = [];
  if (!plan.clause.validates) excluded.push(planPath);
  if (!flow.clause.readable) excluded.push(flowPath);

  const verdict: ReachabilityVerdict = !plan.clause.validates
    ? 'error'
    : flow.clause.readable
      ? 'ok'
      : 'degraded';

  const createLine =
    `harness flow create flight-plan --slug ${basename(planDir)}` +
    ` --path ${display(repoRoot, flowPath)}` +
    ` --plan-dir ${display(repoRoot, planDir)}`;

  const next_action =
    verdict === 'error'
      ? (plan.next_action ?? `Fix the plan document at ${planPath}.`)
      : verdict === 'degraded'
        ? flow.clause.reason === 'absent'
          ? createLine
          : (flow.next_action ?? `Fix the flight plan at ${flowPath}.`)
        : `Nothing owed — ${display(repoRoot, planDir)} has a validating plan document and a readable flight plan.`;

  return {
    verdict,
    plan: plan.clause,
    flow: flow.clause,
    examined,
    excluded,
    next_action,
  };
}

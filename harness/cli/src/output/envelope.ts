import type { Clock } from '../adapters/clock/clock-port.js';

/** The four output states. `unconfigured` is the honest "no mapped behaviour yet". */
export type Status = 'ok' | 'error' | 'degraded' | 'unconfigured';

export interface Evidence {
  /** Human label, e.g. "doctor report" or "coverage summary". */
  label: string;
  /** Repo-relative path where durable proof was written, if any. */
  path?: string;
  /** Set true when the command explicitly produced NO durable evidence. */
  none?: boolean;
}

/**
 * Optional, additive "an update is available" notice (plan 019). Set ONLY at the
 * exit chokepoint (exit.ts), never by the format* constructors — so existing
 * envelope snapshots / `toEqual` tests are unaffected when no update is known,
 * and the MCP-stable seam stays additive (P4).
 */
export interface UpdateAvailable {
  /** Currently-installed CLI version. */
  installed: string;
  /** Latest version available on the registry. */
  latest: string;
  /** Exact command to run to update — pinned to "harness update". */
  command: string;
}

/**
 * An additive, NON-fatal housekeeping notice (plan 034 follow-on). Like
 * {@link UpdateAvailable} it is set ONLY at the exit chokepoint (never by the
 * `format*` constructors), so it never disturbs envelope snapshots and never
 * changes the host command's status or exit code. Used by the well-known
 * `boot`/`checks` commands to surface unpushed telemetry (and, for `checks`, the
 * outcome of the best-effort auto-sync).
 */
export interface HousekeepingNotice {
  /** Machine tag, e.g. `telemetry-unpushed` | `telemetry-synced` | `telemetry-autosync-failed`. */
  kind: string;
  /** Human-readable one-liner. */
  message: string;
  /** Optional exact command that resolves it (e.g. `harness telemetry sync`). */
  command?: string;
  /** Optional structured extra (e.g. `{ count, sessions }`). */
  details?: unknown;
}

export interface Envelope {
  command: string;
  status: Status;
  /** ISO-8601, from an injected Clock (deterministic in tests). */
  timestamp: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  evidence?: Evidence[];
  next_action?: string;
  /** Optional additive update notice (plan 019); set only at the exit chokepoint. */
  update_available?: UpdateAvailable;
  /** Optional additive, non-fatal housekeeping notices; set only at the exit chokepoint. */
  housekeeping?: HousekeepingNotice[];
}

/**
 * Success. `next_action` is optional for `ok` only — every non-`ok` status has a
 * dedicated constructor below that REQUIRES `next_action` (workshop 001 field-presence rule).
 */
export function formatOk<T>(
  command: string,
  data: T,
  clock: Clock,
  opts?: { evidence?: Evidence[]; next_action?: string },
): Envelope {
  return {
    command,
    status: 'ok',
    timestamp: clock.nowIso(),
    data,
    ...(opts?.evidence && { evidence: opts.evidence }),
    ...(opts?.next_action && { next_action: opts.next_action }),
  };
}

/**
 * Succeeded with caveats (exit 0 by default). `next_action` is REQUIRED — the
 * contract guarantees a non-`ok` envelope always tells an agent what to do next.
 */
export function formatDegraded<T>(
  command: string,
  data: T,
  next_action: string,
  clock: Clock,
  opts?: { evidence?: Evidence[] },
): Envelope {
  return {
    command,
    status: 'degraded',
    timestamp: clock.nowIso(),
    data,
    ...(opts?.evidence && { evidence: opts.evidence }),
    next_action,
  };
}

/**
 * Honest "not built". `next_action` REQUIRED; `data` is optional so a command can
 * carry context (e.g. `harness run smoke --dry-run` → `{dry_run:true,slot,mapped_command:null}`,
 * workshop 001 worked example #4). Always maps to exit 2.
 */
export function formatUnconfigured(
  command: string,
  next_action: string,
  clock: Clock,
  opts?: { data?: unknown },
): Envelope {
  return {
    command,
    status: 'unconfigured',
    timestamp: clock.nowIso(),
    ...(opts?.data !== undefined && { data: opts.data }),
    next_action,
  };
}

export function formatError(
  command: string,
  code: string,
  message: string,
  clock: Clock,
  opts?: { details?: unknown; next_action?: string },
): Envelope {
  return {
    command,
    status: 'error',
    timestamp: clock.nowIso(),
    error: {
      code,
      message,
      ...(opts?.details !== undefined && { details: opts.details }),
    },
    next_action: opts?.next_action ?? message,
  };
}

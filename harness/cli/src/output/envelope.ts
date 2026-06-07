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
}

export function formatOk<T>(
  command: string,
  data: T,
  clock: Clock,
  opts?: { status?: 'ok' | 'degraded'; evidence?: Evidence[]; next_action?: string },
): Envelope {
  return {
    command,
    status: opts?.status ?? 'ok',
    timestamp: clock.nowIso(),
    data,
    ...(opts?.evidence && { evidence: opts.evidence }),
    ...(opts?.next_action && { next_action: opts.next_action }),
  };
}

export function formatUnconfigured(command: string, next_action: string, clock: Clock): Envelope {
  return {
    command,
    status: 'unconfigured',
    timestamp: clock.nowIso(),
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

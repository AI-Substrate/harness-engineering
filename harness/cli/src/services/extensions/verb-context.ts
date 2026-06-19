import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { BackgroundProcessPort } from '../../adapters/exec/background-port.js';
import type { ExecPort } from '../../adapters/exec/exec-port.js';
import type { FileSystemWritePort, FsPort } from '../../adapters/fs/fs-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import {
  type Envelope,
  formatDegraded,
  formatError,
  formatOk,
  formatUnconfigured,
} from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import type { Evidence, HarnessVerb, VerbContext, VerbResult } from './contract.js';

/** The ports the composition root injects to build a per-invocation `VerbContext`. */
export interface VerbContextDeps {
  exec: ExecPort;
  fs: FsPort;
  env: EnvPort;
  git: GitPort;
  clock: Clock;
  /** OPTIONAL write-side FS capability surfaced as `ctx.fsWrite` (plan 031). */
  fsWrite?: FileSystemWritePort;
  /** OPTIONAL detached-spawn capability surfaced as `ctx.background` (plan 031). */
  background?: BackgroundProcessPort;
}

/** The parsed invocation a verb is called with. */
export interface VerbInvocation {
  cwd: string;
  args: Record<string, string | undefined>;
  options: Record<string, unknown>;
}

/**
 * Build the `VerbContext` an author's handler receives. Surfaces the injected
 * ports (read-mostly) + envelope-helper closures so a verb never imports the
 * kernel. `ctx.exec` adapts the author-facing signature (optional args + cwd) to
 * `ExecPort.run`, defaulting cwd to the invocation cwd (WS-A Decision 3).
 */
export function buildVerbContext(deps: VerbContextDeps, invocation: VerbInvocation): VerbContext {
  return {
    cwd: invocation.cwd,
    args: invocation.args,
    options: invocation.options,
    exec: (command, args = [], opts) =>
      deps.exec.run(command, args, { cwd: opts?.cwd ?? invocation.cwd }),
    fs: deps.fs,
    ...(deps.fsWrite && { fsWrite: deps.fsWrite }),
    ...(deps.background && { background: deps.background }),
    env: deps.env,
    git: deps.git,
    clock: deps.clock,
    ok: <T>(data: T, opts?: { evidence?: Evidence[]; next_action?: string }): VerbResult => ({
      status: 'ok',
      data,
      ...(opts?.evidence && { evidence: opts.evidence }),
      ...(opts?.next_action && { next_action: opts.next_action }),
    }),
    degraded: <T>(data: T, next_action: string, opts?: { evidence?: Evidence[] }): VerbResult => ({
      status: 'degraded',
      data,
      next_action,
      ...(opts?.evidence && { evidence: opts.evidence }),
    }),
    unconfigured: (next_action: string, opts?: { data?: unknown }): VerbResult => ({
      status: 'unconfigured',
      next_action,
      ...(opts?.data !== undefined && { data: opts.data }),
    }),
    error: (
      code: string,
      message: string,
      opts?: { details?: unknown; next_action?: string },
    ): VerbResult => ({
      status: 'error',
      error: { code, message, ...(opts?.details !== undefined && { details: opts.details }) },
      next_action: opts?.next_action ?? message,
    }),
  };
}

/** Treat empty/whitespace-only strings as absent so a blank value can't satisfy P5. */
function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Finalize what a handler RETURNED into a canonical Envelope: the kernel adds
 * `command` (the verb name) + `timestamp` (from the clock) and maps status →
 * the right constructor, guaranteeing a non-blank `next_action` on every non-`ok`
 * status (P5) even if the author returned a raw object without one — a blank or
 * whitespace-only `next_action` is treated as missing. A JS extension that returns
 * an unknown `status` (outside the typed union) is mapped to an `E141` error
 * Envelope rather than falling through to `undefined`.
 */
export function finalizeVerbResult(result: VerbResult, name: string, clock: Clock): Envelope {
  switch (result.status) {
    case 'ok':
      return formatOk(name, result.data, clock, {
        ...(result.evidence && { evidence: result.evidence }),
        ...(nonBlank(result.next_action) && { next_action: result.next_action }),
      });
    case 'degraded':
      return formatDegraded(
        name,
        result.data,
        nonBlank(result.next_action) ?? 'Review the degraded result above.',
        clock,
        result.evidence ? { evidence: result.evidence } : undefined,
      );
    case 'unconfigured':
      return formatUnconfigured(
        name,
        nonBlank(result.next_action) ?? 'No behaviour is mapped for this verb yet.',
        clock,
        result.data !== undefined ? { data: result.data } : undefined,
      );
    case 'error': {
      const message = nonBlank(result.error?.message) ?? 'The verb reported an error.';
      return formatError(name, result.error?.code ?? ErrorCodes.UNKNOWN, message, clock, {
        ...(result.error?.details !== undefined && { details: result.error.details }),
        next_action: nonBlank(result.next_action) ?? message,
      });
    }
    default:
      return formatError(
        name,
        ErrorCodes.EXTENSION_RUNTIME_ERROR,
        `Verb '${name}' returned an invalid status '${String(result.status)}'.`,
        clock,
        {
          next_action: `This is a bug in the extension; a verb must return one of ok/degraded/unconfigured/error. Fix or remove the extension providing '${name}'.`,
        },
      );
  }
}

/**
 * Invoke a verb's handler with isolation: a returned `VerbResult` is finalized;
 * a thrown error becomes an `E141` error Envelope surfacing the message (never a
 * raw stack trace — honesty, AC-style). Awaits async handlers.
 */
export async function runVerb(
  verb: HarnessVerb,
  ctx: VerbContext,
  clock: Clock,
): Promise<Envelope> {
  try {
    const result = await verb.run(ctx);
    return finalizeVerbResult(result, verb.name, clock);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return formatError(
      verb.name,
      ErrorCodes.EXTENSION_RUNTIME_ERROR,
      `Verb '${verb.name}' threw at runtime: ${message}`,
      clock,
      {
        next_action: `This is a bug in the extension; fix or remove the extension providing '${verb.name}'.`,
      },
    );
  }
}

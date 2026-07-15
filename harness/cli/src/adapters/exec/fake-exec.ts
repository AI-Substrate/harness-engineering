import type { Clock } from '../clock/clock-port.js';
import type { ExecOptions, ExecPort, ExecResult } from './exec-port.js';

/** A scripted result — `ok` is derived from `code`, so callers script only the facts. */
export interface ExecScript {
  code: number;
  stdout?: string;
  stderr?: string;
  /** Simulated work duration, advanced through the optional fake clock. */
  durationMs?: number;
  /** Simulate a child that never exits until its timeout kills it. */
  hang?: boolean;
}

export interface FakeExecCall {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

/** A deterministic timeout kill observed at the exec port. */
export interface FakeExecKill {
  command: string;
  args: string[];
  signal: 'SIGKILL';
  timeoutMs: number;
}

/**
 * Deterministic exec for tests. Seeded with `{ 'cmd a b': {code,stdout?,stderr?} }`
 * keyed by full command line; records every option passed through the port. A
 * scripted `hang` plus `timeoutMs` advances the injected clock, records SIGKILL,
 * and resolves 124 without a wall-clock wait.
 */
export class FakeExec implements ExecPort {
  readonly calls: FakeExecCall[] = [];
  readonly kills: FakeExecKill[] = [];

  constructor(
    private readonly scripts: Record<string, ExecScript> = {},
    private readonly clock?: Clock,
  ) {}

  async run(command: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
    this.calls.push({
      command,
      args,
      cwd: opts.cwd,
      ...(opts.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }),
      ...(opts.env !== undefined && { env: { ...opts.env } }),
    });
    const key = [command, ...args].join(' ');
    const script = this.scripts[key] ?? this.scripts[command] ?? { code: 0 };

    const durationMs = script.hang ? Number.POSITIVE_INFINITY : (script.durationMs ?? 0);
    if (opts.timeoutMs !== undefined && opts.timeoutMs <= durationMs) {
      await this.clock?.sleep(Math.max(0, opts.timeoutMs));
      this.kills.push({
        command,
        args,
        signal: 'SIGKILL',
        timeoutMs: Math.max(0, opts.timeoutMs),
      });
      const timeoutMessage = `Command timed out after ${Math.max(0, opts.timeoutMs)}ms and was killed with SIGKILL.`;
      return {
        code: 124,
        stdout: script.stdout ?? '',
        stderr: script.stderr ? `${script.stderr}\n${timeoutMessage}` : timeoutMessage,
        ok: false,
      };
    }

    if (Number.isFinite(durationMs) && durationMs > 0) await this.clock?.sleep(durationMs);
    return {
      code: script.code,
      stdout: script.stdout ?? '',
      stderr: script.stderr ?? '',
      ok: script.code === 0,
    };
  }
}

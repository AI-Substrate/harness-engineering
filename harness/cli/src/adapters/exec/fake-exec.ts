import type { ExecPort, ExecResult } from './exec-port.js';

/** A scripted result — `ok` is derived from `code`, so callers script only the facts. */
export interface ExecScript {
  code: number;
  stdout?: string;
  stderr?: string;
}

/**
 * Deterministic exec for tests. Seeded with `{ 'cmd a b': {code,stdout?,stderr?} }`
 * keyed by full command line; records each `{command,args,cwd}` on `calls` (fakes
 * over mocks). An unscripted command resolves to a benign success (absent ≠ error,
 * mirroring FakeFs/FakeProcess); `ok` is always computed from `code`.
 */
export class FakeExec implements ExecPort {
  readonly calls: { command: string; args: string[]; cwd: string }[] = [];

  constructor(private readonly scripts: Record<string, ExecScript> = {}) {}

  run(command: string, args: string[], opts: { cwd: string }): Promise<ExecResult> {
    this.calls.push({ command, args, cwd: opts.cwd });
    const key = [command, ...args].join(' ');
    const script = this.scripts[key] ?? this.scripts[command] ?? { code: 0 };
    return Promise.resolve({
      code: script.code,
      stdout: script.stdout ?? '',
      stderr: script.stderr ?? '',
      ok: script.code === 0,
    });
  }
}

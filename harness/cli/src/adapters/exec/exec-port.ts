/**
 * Exec port — runs a REAL repo command (the P8 "wrap, don't rebuild" capability).
 *
 * Verbs invoke this through `ctx.exec` to wrap existing project commands (build,
 * lint, test…). Injected so verb/loader logic stays unit-testable with `FakeExec`
 * and never spawns a child directly — `NodeExec` is the only place a child is
 * spawned for the verb path (KF-06 adapter discipline).
 */
export interface ExecResult {
  /** Child process exit code (127 when the binary could not be spawned). */
  code: number;
  stdout: string;
  stderr: string;
  /** Convenience: `code === 0`. */
  ok: boolean;
}

export interface ExecOptions {
  cwd: string;
  /** Hard deadline. The adapter sends SIGKILL and resolves with code 124. */
  timeoutMs?: number;
  /** Overlay on the inherited process environment; `undefined` removes a key. */
  env?: Record<string, string | undefined>;
}

export interface ExecPort {
  /** Spawn `command args` with no shell, capturing code/stdout/stderr. */
  run(command: string, args: string[], opts: ExecOptions): Promise<ExecResult>;
}

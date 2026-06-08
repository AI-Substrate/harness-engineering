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

export interface ExecPort {
  /** Spawn `command args` in `opts.cwd` (no shell), capturing code/stdout/stderr. */
  run(command: string, args: string[], opts: { cwd: string }): Promise<ExecResult>;
}

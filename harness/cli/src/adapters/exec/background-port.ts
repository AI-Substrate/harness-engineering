/**
 * Background-process port — the ONE capability the blocking {@link ExecPort}
 * cannot provide: launch a **detached**, fire-and-forget child that keeps
 * running after the parent verb returns (plan 031, Key Finding 01). It replaces
 * the dogfood verbs' POSIX-only `bash -c 'nohup "$@" & echo $!'` shell-out with
 * a portable, injection-safe primitive.
 *
 * Injected so verbs stay unit-testable with `FakeBackground` (records intent,
 * spawns nothing). The real `NodeBackground` reuses {@link resolveSpawn} so the
 * `.cmd`/`.bat` launch is EINVAL-proof + injection-safe on Windows — never a
 * bare `.cmd` spawn (workshop 001).
 */
export interface SpawnDetachedInput {
  /** The command to run (a bare name, or an absolute/relative path). */
  command: string;
  args: string[];
  /** Working directory for the child (also the cwd `resolveSpawn` resolves against). */
  cwd: string;
  /**
   * Environment for the child. OMIT to inherit the parent process env (the
   * usual case — the worker needs the operator's PATH / tokens); pass a value
   * only to override it.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Absolute path to the log file the child's stdout+stderr are appended to.
   * A real file fd (not a pipe) so the stream survives the parent exit without
   * EPIPE (workshop 001 I3).
   */
  logPath: string;
}

export interface BackgroundProcessPort {
  /**
   * Spawn a detached, `unref`'d child that outlives the parent, with its
   * stdout+stderr appended to `input.logPath`. Returns the OS pid. Throws if the
   * spawn yields no pid (the caller maps the throw to an honest envelope).
   */
  spawnDetached(input: SpawnDetachedInput): { pid: number };
}

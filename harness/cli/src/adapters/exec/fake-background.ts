import type {
  BackgroundProcessPort,
  DetachedProcessHandle,
  SpawnDetachedInput,
} from './background-port.js';

/**
 * Deterministic background-spawn for tests. Spawns NOTHING — it records each
 * call's logical intent on `calls` (fakes over mocks — assert on history) and
 * returns a synthetic pid, so a verb that fires a detached worker stays
 * deterministic on ubuntu (workshop 001 §C3). The real win32 `.cmd` resolution
 * is proven separately by the `NodeBackground` adapter contract test.
 */
export class FakeBackground implements BackgroundProcessPort {
  readonly calls: SpawnDetachedInput[] = [];

  constructor(private readonly pid = 424242) {}

  spawnDetached(input: SpawnDetachedInput): DetachedProcessHandle {
    this.calls.push({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      ...(input.env && { env: input.env }),
      logPath: input.logPath,
    });
    return { pid: this.pid, exitCode: new Promise(() => {}) };
  }
}

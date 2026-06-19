import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import type { BackgroundProcessPort, SpawnDetachedInput } from './background-port.js';
import { resolveSpawn } from './windows-command.js';

/**
 * Real detached spawn — the portable replacement for `bash -c 'nohup "$@" &
 * echo $!'` (plan 031 T002, the riskiest piece). It is the background twin of
 * {@link NodeExec}: it reuses the SAME {@link resolveSpawn} resolver, so a
 * Windows `.cmd`/`.bat` shim is launched via `cmd.exe /d /s /c "<line>"` with
 * `windowsVerbatimArguments` — never a bare `.cmd` spawn, which throws `EINVAL`
 * on patched Node (≥20.12.2) and would also re-open the BatBadBut injection if
 * forced through `shell:true` (workshop 001 — `001-windows-cmd-launch-escaping.md`).
 *
 * Invariants (workshop 001 §C2 I1–I5):
 *  - I1: the spawn spec comes from `resolveSpawn` — never a hand-built `.cmd` spawn.
 *  - I2: `windowsVerbatimArguments` is passed THROUGH from the spec (`?? false`),
 *        never hard-coded `false` (that would corrupt the cmd `/s` line).
 *  - I3: stdio is `['ignore', logFd, logFd]` with a real append fd (not a pipe →
 *        no EPIPE once the parent exits).
 *  - I4: `detached:true` + `unref()` (+ `windowsHide:true`) so it survives the
 *        parent/terminal close.
 *  - I5: returns `child.pid`; throws if null.
 *
 * `platform` is an explicit seam (default `process.platform`) so the win32
 * resolution path is unit-testable on ubuntu (P3 — pass the parameter, never
 * patch `process.platform`).
 */
export class NodeBackground implements BackgroundProcessPort {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  spawnDetached(input: SpawnDetachedInput): { pid: number } {
    // Forward `env` to the resolver too (F005), so a win32 `.cmd`/PATH lookup
    // resolves against the SAME env the child runs with — not the parent's.
    const spec = resolveSpawn(input.command, input.args, input.cwd, this.platform, input.env);
    const logFd = openSync(input.logPath, 'a'); // real fd, NOT a pipe (no EPIPE post-exit)
    try {
      const child = spawn(spec.command, spec.args, {
        cwd: input.cwd,
        ...(input.env && { env: input.env }),
        detached: true, // own process group/session — survives the parent
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false, // I2 — honour the resolver
      });
      const pid = child.pid;
      child.unref(); // let the parent exit independently
      if (pid == null) throw new Error('detached spawn returned no pid');
      return { pid };
    } finally {
      // The child has its own dup of the fd; close the parent's copy so a verb
      // looping over many repos doesn't leak one descriptor per launch (F004).
      closeSync(logFd);
    }
  }
}

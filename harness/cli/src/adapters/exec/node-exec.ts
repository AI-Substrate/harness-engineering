import { spawn } from 'node:child_process';
import type { ExecOptions, ExecPort, ExecResult } from './exec-port.js';
import { resolveSpawn } from './windows-command.js';

/**
 * Real process execution — the only place a child is spawned for the verb path.
 * `shell: false` + an args array means no shell-injection surface (KF-06). On
 * Windows, {@link resolveSpawn} first maps `.cmd`/`.bat` shims to a `cmd.exe`
 * invocation (CreateProcess cannot exec them) WITHOUT reintroducing a shell —
 * see that module for the `/s` verbatim-quoting details. Never rejects: a spawn
 * error or non-zero exit resolves to an `ExecResult` so the verb handler can map
 * it to an Envelope rather than throwing through the kernel. This includes a
 * SYNCHRONOUS spawn throw (e.g. a null byte in the command), which is caught and
 * resolved as code 127 rather than rejecting the promise.
 */
export class NodeExec implements ExecPort {
  run(command: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: ExecResult): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(result);
      };

      try {
        const spec = resolveSpawn(command, args, opts.cwd);
        const child = spawn(spec.command, spec.args, {
          cwd: opts.cwd,
          shell: false,
          windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false,
          ...(opts.env !== undefined && { env: { ...process.env, ...opts.env } }),
        });
        child.stdout?.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', (err) => {
          finish({ code: 127, stdout, stderr: stderr + String(err.message ?? err), ok: false });
        });
        child.on('close', (code) => {
          const exitCode = code ?? 1;
          finish({ code: exitCode, stdout, stderr, ok: exitCode === 0 });
        });
        if (opts.timeoutMs !== undefined) {
          const timeoutMs = Math.max(0, opts.timeoutMs);
          timer = setTimeout(() => {
            child.kill('SIGKILL');
            const timeoutMessage = `Command timed out after ${timeoutMs}ms and was killed with SIGKILL.`;
            finish({
              code: 124,
              stdout,
              stderr: stderr.length > 0 ? `${stderr}\n${timeoutMessage}` : timeoutMessage,
              ok: false,
            });
          }, timeoutMs);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        finish({ code: 127, stdout, stderr: stderr + message, ok: false });
      }
    });
  }
}

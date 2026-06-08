import { spawn } from 'node:child_process';
import type { ExecPort, ExecResult } from './exec-port.js';

/**
 * Real process execution — the only place a child is spawned for the verb path.
 * `shell: false` + an args array means no shell-injection surface (KF-06). Never
 * rejects: a spawn error or non-zero exit resolves to an `ExecResult` so the verb
 * handler can map it to an Envelope rather than throwing through the kernel. This
 * includes a SYNCHRONOUS spawn throw (e.g. a null byte in the command), which is
 * caught and resolved as code 127 rather than rejecting the promise.
 */
export class NodeExec implements ExecPort {
  run(command: string, args: string[], opts: { cwd: string }): Promise<ExecResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      try {
        const child = spawn(command, args, { cwd: opts.cwd, shell: false });
        child.stdout?.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', (err) => {
          resolve({ code: 127, stdout, stderr: stderr + String(err.message ?? err), ok: false });
        });
        child.on('close', (code) => {
          const exitCode = code ?? 1;
          resolve({ code: exitCode, stdout, stderr, ok: exitCode === 0 });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        resolve({ code: 127, stdout, stderr: stderr + message, ok: false });
      }
    });
  }
}

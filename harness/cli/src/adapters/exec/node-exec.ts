import { spawn } from 'node:child_process';
import type { ExecPort, ExecResult } from './exec-port.js';

/**
 * Real process execution — the only place a child is spawned for the verb path.
 * `shell: false` + an args array means no shell-injection surface (KF-06). Never
 * rejects: a spawn error or non-zero exit resolves to an `ExecResult` so the verb
 * handler can map it to an Envelope rather than throwing through the kernel.
 */
export class NodeExec implements ExecPort {
  run(command: string, args: string[], opts: { cwd: string }): Promise<ExecResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
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
    });
  }
}

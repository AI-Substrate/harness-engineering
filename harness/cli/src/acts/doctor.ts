import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { NodeEnv } from '../adapters/env/node-env.js';
import { NodeFs } from '../adapters/fs/node-fs.js';
import { ExecGit } from '../adapters/git/exec-git.js';
import { NodeProcess } from '../adapters/process/node-process.js';
import { exitWithEnvelope } from '../output/exit.js';
import {
  createOutputPort,
  type OutputPort,
  processWriters,
  selectMode,
  type Writers,
} from '../output/output-port.js';
import {
  buildDoctorReport,
  doctorEnvelope,
  renderDoctorText,
} from '../services/doctor/doctor-service.js';
import { loadSlotRegistry } from '../services/slots/slot-registry.js';

/** Read the resolved tri-state `--json` flag from the root program's opts. */
function resolveJson(program: Command): boolean | undefined {
  const value = (program.opts() as { json?: unknown }).json;
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Register the `doctor` command — safe to run at session start. Constructs the
 * real adapters, injects them into the doctor service, and renders: human mode
 * writes the layered report to stderr + a summary to stdout; JSON mode emits
 * the envelope to stdout. Always exits 0 (reporting succeeded). `writers` and
 * `env` injectable for tests.
 */
export function registerDoctorAct(
  program: Command,
  writers: Writers = processWriters,
  env: NodeJS.ProcessEnv = process.env,
): void {
  program
    .command('doctor')
    .description('Report what is configured vs unconfigured (safe at session start)')
    .action(() => {
      const fs = new NodeFs();
      const clock = new SystemClock();
      const report = buildDoctorReport(
        { fs, proc: new NodeProcess(), git: new ExecGit(), env: new NodeEnv(), clock },
        loadSlotRegistry(fs),
      );
      const envelope = doctorEnvelope(report, clock);
      const mode = selectMode({ json: resolveJson(program) }, env, Boolean(process.stdout.isTTY));
      const io: OutputPort =
        mode === 'json'
          ? createOutputPort('json', writers)
          : {
              emit: (e) => {
                writers.err(renderDoctorText(report));
                writers.out(`doctor: ${e.status}\n`);
              },
            };
      exitWithEnvelope(envelope, io);
    });
}

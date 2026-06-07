import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { NodeEnv } from '../adapters/env/node-env.js';
import { NodeFs } from '../adapters/fs/node-fs.js';
import { ExecGit } from '../adapters/git/exec-git.js';
import { NodeProcess } from '../adapters/process/node-process.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import {
  buildDoctorReport,
  doctorEnvelope,
  renderDoctorText,
} from '../services/doctor/doctor-service.js';
import { loadSlotRegistry } from '../services/slots/slot-registry.js';

/**
 * Register the `doctor` command — safe to run at session start. Constructs the
 * real adapters, injects them into the doctor service, and renders: human mode
 * writes the layered report to stderr + a summary to stdout; JSON mode emits
 * the envelope to stdout. Always exits 0 (reporting succeeded). The resolved
 * `io` (mode + writers) is injected by the entrypoint.
 */
export function registerDoctorAct(program: Command, io: CliIo): void {
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
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: (e) => {
                io.writers.err(renderDoctorText(report));
                io.writers.out(`doctor: ${e.status}\n`);
              },
            };
      exitWithEnvelope(envelope, port);
    });
}

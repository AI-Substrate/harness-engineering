import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { NodeDb } from '../adapters/db/node-db.js';
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
import type { VerbRegistry } from '../services/extensions/registry.js';
import type { RecordRegistry } from '../services/record/registry.js';
import { readVersion } from '../version.js';

/**
 * Register the `doctor` command — safe to run at session start. Constructs the
 * real adapters, injects them + the verb registry + the merged record registry
 * (provided by the composition root) into the doctor service, and renders: human
 * mode writes the layered report to stderr + a summary to stdout; JSON mode emits
 * the envelope to stdout. Always exits 0 (reporting succeeded). `doctor`
 * enumerates extensions + record types (P7) without invoking any handler — and is
 * itself a CORE command, never an extension.
 */
export function registerDoctorAct(
  program: Command,
  io: CliIo,
  registry: VerbRegistry,
  recordRegistry?: RecordRegistry,
): void {
  program
    .command('doctor')
    .description('Report what is configured + which extensions loaded (safe at session start)')
    .action(() => {
      const clock = new SystemClock();
      const report = buildDoctorReport(
        {
          fs: new NodeFs(),
          proc: new NodeProcess(),
          git: new ExecGit(),
          env: new NodeEnv(),
          clock,
          runningVersion: readVersion(),
          // plan 070 — doctor asks the reconciler whether each owed capture lane
          // can actually be paid back. The adapter registry is the service's own
          // default (a caller cannot forget it and raise a false alarm); the db is
          // a port, so it is injected here — giving doctor the SAME sources sync
          // will use is what keeps its verdict from disagreeing with the recovery.
          db: new NodeDb(),
        },
        registry,
        recordRegistry,
      );
      const envelope = doctorEnvelope(report, clock, io.quiet === true);
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

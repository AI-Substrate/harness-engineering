import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { type Envelope, formatError, formatOk } from '../output/envelope.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { initGovernance } from '../services/init/init-service.js';

/** The ports the `init` act injects: `fs`+`proc` for the service, `clock` for the envelope timestamp. */
export interface InitActDeps {
  fs: FsPort;
  proc: ProcessPort;
  clock: Clock;
}

/**
 * Register the `init` command — the governance-doc INCEPTION writer. Stamps the
 * `.harness/engineering-harness.md` skeleton (scaffold-and-seed only) and returns
 * its path. A CORE command (reserved, like `help`/`doctor`/`new`/`record`; runs
 * even under `--no-extensions`). Idempotent + never-clobber. It owns no business
 * logic — the `init-service` resolves the path + writes, and this act maps the
 * outcome onto the Envelope + exit code (created/exists → ok 0, write failure →
 * error 1). `maturity_seed:'L0'` rides only on a fresh create — it names what
 * THIS run seeded, so an idempotent re-run that wrote nothing omits it.
 */
export function registerInitAct(program: Command, io: CliIo, deps: InitActDeps): void {
  program
    .command('init')
    .description(
      'Seed the engineering-harness governance doc skeleton at .harness/engineering-harness.md (idempotent; returns its path)',
    )
    .action(() => {
      const outcome = initGovernance(deps);

      if (outcome.ok) {
        const data = outcome.created
          ? { path: outcome.path, created: true, maturity_seed: 'L0' }
          : { path: outcome.path, created: false };
        const next_action = outcome.created
          ? 'Run eng-harness-0-adopt (or fill the TODO sections by hand) to populate boot, signals, and the injection map.'
          : 'Already present — left untouched. Edit it directly, or run eng-harness-0-adopt to fill the injection map.';
        const envelope = formatOk('init', data, deps.clock, {
          evidence: [{ label: 'governance doc', path: outcome.path }],
          next_action,
        });
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: () => {
                  io.writers.out(
                    outcome.created
                      ? `Created ${outcome.path}\n`
                      : `Already present: ${outcome.path} (left untouched)\n`,
                  );
                  io.writers.out('init: ok\n');
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const envelope: Envelope = formatError('init', outcome.code, outcome.message, deps.clock, {
        next_action: outcome.next_action,
      });
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: (e) => {
                io.writers.err(`harness init: ${e.error?.message ?? e.next_action ?? 'failed'}\n`);
                if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                io.writers.out(`init: ${e.status}\n`);
              },
            };
      exitWithEnvelope(envelope, port);
    });
}

import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { NodeFs } from '../adapters/fs/node-fs.js';
import { formatError } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort } from '../output/output-port.js';
import { loadSlotRegistry, runSlot } from '../services/slots/slot-registry.js';

/**
 * Register the `run <slot> [--dry-run]` dispatcher — the generic "run the command
 * mapped to <slot>" entry (workshop 001). `<slot>` is optional at the commander
 * level so we can emit a controlled E108 envelope when it is missing (rather than
 * commander's default usage error). Unknown slot → E110; known-but-unconfigured →
 * exit 2; `--dry-run` never executes. `io` is injected by the entrypoint.
 */
export function registerRunAct(program: Command, io: CliIo): void {
  program
    .command('run [slot]')
    .description('Run the harness command mapped to <slot> (unconfigured in this slice)')
    .option('--dry-run', 'Show intended behaviour without executing anything')
    .action((slot: string | undefined, options: { dryRun?: boolean }) => {
      const clock = new SystemClock();
      const env =
        slot === undefined
          ? formatError(
              'run',
              ErrorCodes.INVALID_ARGS,
              'Missing required argument: <slot>. Usage: harness run <slot> [--dry-run].',
              clock,
              {
                next_action:
                  'Provide a slot name, e.g. `harness run validate`. See `harness run --help`.',
              },
            )
          : runSlot(
              loadSlotRegistry(new NodeFs()),
              slot,
              { dryRun: options.dryRun === true },
              clock,
            );
      exitWithEnvelope(env, createOutputPort(io.mode, io.writers));
    });
}

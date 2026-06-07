import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { NodeFs } from '../adapters/fs/node-fs.js';
import { formatOk } from '../output/envelope.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { buildHelp, renderHelpText } from '../services/help/help-service.js';
import { loadSlotRegistry } from '../services/slots/slot-registry.js';

/**
 * Register the `help` orientation command. Human mode prints rich help text;
 * JSON mode emits a stable `formatOk('help', …)` envelope whose `data.slots[]`
 * is the machine-readable command map (AC-8). The resolved `io` (mode + writers)
 * is injected by the entrypoint.
 */
export function registerHelpAct(program: Command, io: CliIo): void {
  program
    .command('help')
    .description('Explain the harness: purpose, commands, output modes, safe first actions')
    .action(() => {
      const content = buildHelp(loadSlotRegistry(new NodeFs()));
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : { emit: () => io.writers.out(renderHelpText(content)) };
      exitWithEnvelope(formatOk('help', content, new SystemClock()), port);
    });
}

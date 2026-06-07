import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { NodeFs } from '../adapters/fs/node-fs.js';
import { formatOk } from '../output/envelope.js';
import { exitWithEnvelope } from '../output/exit.js';
import {
  createOutputPort,
  type OutputPort,
  processWriters,
  selectMode,
  type Writers,
} from '../output/output-port.js';
import { buildHelp, renderHelpText } from '../services/help/help-service.js';
import { loadSlotRegistry } from '../services/slots/slot-registry.js';

/** Read the resolved tri-state `--json` flag from the root program's opts. */
function resolveJson(program: Command): boolean | undefined {
  const value = (program.opts() as { json?: unknown }).json;
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Register the `help` orientation command. Human mode prints rich help text;
 * JSON mode emits a stable `formatOk('help', …)` envelope whose `data.slots[]`
 * is the machine-readable command map (AC-8). `writers` injectable for tests.
 */
export function registerHelpAct(program: Command, writers: Writers = processWriters): void {
  program
    .command('help')
    .description('Explain the harness: purpose, commands, output modes, safe first actions')
    .action(() => {
      const content = buildHelp(loadSlotRegistry(new NodeFs()));
      const clock = new SystemClock();
      const mode = selectMode(
        { json: resolveJson(program) },
        process.env,
        Boolean(process.stdout.isTTY),
      );
      const io: OutputPort =
        mode === 'json'
          ? createOutputPort('json', writers)
          : { emit: () => writers.out(renderHelpText(content)) };
      exitWithEnvelope(formatOk('help', content, clock), io);
    });
}

import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { formatOk } from '../output/envelope.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import type { VerbRegistry } from '../services/extensions/registry.js';
import { buildHelp, helpEmptyHint, renderHelpText } from '../services/help/help-service.js';

/**
 * Register the `help` orientation command. Human mode prints rich help text;
 * JSON mode emits a stable `formatOk('help', …)` envelope whose `data.verbs[]`
 * is the machine-readable, extension-owned command map (AC-1). The verb registry
 * is injected by the composition root (no longer reads the retired slot map);
 * an empty registry yields an honest "no extensions installed yet" next_action.
 */
export function registerHelpAct(program: Command, io: CliIo, registry: VerbRegistry): void {
  program
    .command('help')
    .description('Explain the harness: purpose, commands, output modes, safe first actions')
    .action(() => {
      const content = buildHelp(registry);
      const hint = helpEmptyHint(content);
      const envelope = formatOk(
        'help',
        content,
        new SystemClock(),
        hint ? { next_action: hint } : undefined,
      );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : { emit: () => io.writers.out(renderHelpText(content)) };
      exitWithEnvelope(envelope, port);
    });
}

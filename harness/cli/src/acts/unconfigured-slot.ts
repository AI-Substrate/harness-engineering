import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { exitWithEnvelope } from '../output/exit.js';
import { makeOutputPort } from '../output/output-port.js';
import { type CommandSlot, slotEnvelope } from '../services/slots/slot-registry.js';

/** Read the resolved tri-state `--json` flag from the root program's opts. */
function resolveJson(program: Command): boolean | undefined {
  const value = (program.opts() as { json?: unknown }).json;
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Register one slot command on the program — the single factory that builds all
 * eight stub commands. Thin by design: it constructs the clock, calls the pure
 * `slotEnvelope` service, resolves an OutputPort, and exits. No business logic.
 * The same factory will later dispatch a configured slot's handler unchanged.
 */
export function registerSlotAct(program: Command, slot: CommandSlot): void {
  const command = program.command(slot.name).description(slot.description);
  if (slot.acceptsDryRun) {
    command.option('--dry-run', 'Show intended behaviour without executing anything');
  }
  command.action((options: { dryRun?: boolean }) => {
    const env = slotEnvelope(slot, { dryRun: options.dryRun === true }, new SystemClock());
    const io = makeOutputPort(
      { json: resolveJson(program) },
      process.env,
      Boolean(process.stdout.isTTY),
    );
    exitWithEnvelope(env, io);
  });
}

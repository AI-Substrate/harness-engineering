import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort } from '../output/output-port.js';
import { type CommandSlot, slotEnvelope } from '../services/slots/slot-registry.js';

/**
 * Register one TOP-LEVEL slot command (`harness <slot>`) — the single factory
 * that builds the convenience stubs for every slot except `run` (which has its
 * own `run <slot>` dispatcher act). Thin: it calls the pure `slotEnvelope`
 * service and exits. The resolved `io` is injected by the entrypoint, so the
 * act never re-derives the output mode from `program.opts()`.
 */
export function registerSlotAct(program: Command, slot: CommandSlot, io: CliIo): void {
  const command = program.command(slot.name).description(slot.description);
  if (slot.acceptsDryRun) {
    command.option('--dry-run', 'Show intended behaviour without executing anything');
  }
  command.action((options: { dryRun?: boolean }) => {
    const env = slotEnvelope(slot, { dryRun: options.dryRun === true }, new SystemClock());
    exitWithEnvelope(env, createOutputPort(io.mode, io.writers));
  });
}

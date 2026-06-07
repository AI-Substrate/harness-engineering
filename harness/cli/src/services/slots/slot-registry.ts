import type { Clock } from '../../adapters/clock/clock-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import { type Envelope, formatUnconfigured } from '../../output/envelope.js';

/** Whether a command slot has real behaviour mapped yet. */
export type SlotStatus = 'configured' | 'unconfigured';

/**
 * A command slot descriptor — the extension seam.
 *
 * `name` is intentionally a plain `string`, NOT a closed union: a future
 * pi-style loader must be able to flip a known slot's status OR append a brand
 * new slot without a schema change (plan R7, workshop 002 Q4). Do not narrow it.
 */
export interface CommandSlot {
  /** Command name — open-ended on purpose (no closed `SlotName` union). */
  name: string;
  status: SlotStatus;
  /** One-line description shown by `help`. */
  description: string;
  /** What to do because the slot is unconfigured (shown to humans + agents). */
  next_action: string;
  /** True for slots that accept a safe `--dry-run` (run/validate). */
  acceptsDryRun?: boolean;
  // FUTURE (extension system): handler?: (ctx) => Envelope; // the only field extensions add.
}

export type SlotRegistry = CommandSlot[];

/**
 * The eight built-in slots — a SEED SET, not a closed universe. All start
 * `unconfigured`; the extension loader (out of scope) later flips a status or
 * appends a slot. `run`/`validate` accept a safe `--dry-run`.
 */
const BUILTIN_SLOTS: readonly CommandSlot[] = [
  {
    name: 'run',
    status: 'unconfigured',
    description: 'Run a mapped command for this repo.',
    next_action: 'No command mapped to this slot yet. An extension will provide it later.',
    acceptsDryRun: true,
  },
  {
    name: 'validate',
    status: 'unconfigured',
    description: 'Run the repo validation sequence.',
    next_action: 'No validation sequence mapped yet. An extension will provide it later.',
    acceptsDryRun: true,
  },
  {
    name: 'build',
    status: 'unconfigured',
    description: 'Build the project.',
    next_action: 'No build mapped yet. An extension will provide it later.',
  },
  {
    name: 'lint',
    status: 'unconfigured',
    description: 'Lint the project.',
    next_action: 'No lint mapped yet. An extension will provide it later.',
  },
  {
    name: 'test',
    status: 'unconfigured',
    description: 'Run the project test suite.',
    next_action: 'No test command mapped yet. An extension will provide it later.',
  },
  {
    name: 'smoke',
    status: 'unconfigured',
    description: 'Run a fast smoke check.',
    next_action: 'No smoke check mapped yet. An extension will provide it later.',
  },
  {
    name: 'health',
    status: 'unconfigured',
    description: 'Report runtime health.',
    next_action: 'No health check mapped yet. An extension will provide it later.',
  },
  {
    name: 'observe',
    status: 'unconfigured',
    description: 'Capture observability evidence.',
    next_action: 'Observe behaviour is out of scope for this slice; an extension will provide it.',
  },
];

/**
 * Load the command-slot registry. Takes `FsPort` so a future loader can read
 * repo-local extension config and merge handlers (Q3) — unused this slice.
 * Returns fresh copies so callers can't mutate the built-in seed set.
 */
export function loadSlotRegistry(_fs: FsPort): SlotRegistry {
  return BUILTIN_SLOTS.map((slot) => ({ ...slot }));
}

/**
 * Pure slot behaviour (the logic the factory act renders). An unconfigured slot
 * NEVER fakes success: it returns `status: unconfigured` + `next_action` (exit 2).
 * `--dry-run` carries `{dry_run, slot, mapped_command:null}` per workshop 001 #4.
 */
export function slotEnvelope(
  slot: CommandSlot,
  opts: { dryRun?: boolean },
  clock: Clock,
): Envelope {
  // FUTURE: if (slot.status === 'configured' && slot.handler) return slot.handler(ctx);
  const data = opts.dryRun ? { dry_run: true, slot: slot.name, mapped_command: null } : undefined;
  return formatUnconfigured(
    slot.name,
    slot.next_action,
    clock,
    data !== undefined ? { data } : undefined,
  );
}

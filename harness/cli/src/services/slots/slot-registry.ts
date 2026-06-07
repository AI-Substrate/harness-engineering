import type { Clock } from '../../adapters/clock/clock-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import { type Envelope, formatError, formatUnconfigured } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';

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
 * The built-in slot seed set, no I/O — used by the entrypoint to enumerate which
 * commands to register (keeps `index.ts` free of adapter construction). Returns
 * fresh copies so callers can't mutate the seed.
 */
export function builtinSlots(): SlotRegistry {
  return BUILTIN_SLOTS.map((slot) => ({ ...slot }));
}

/**
 * Load the command-slot registry. Takes `FsPort` so a future loader can read
 * repo-local extension config and merge handlers (Q3) — unused this slice.
 * Returns fresh copies so callers can't mutate the built-in seed set.
 */
export function loadSlotRegistry(_fs: FsPort): SlotRegistry {
  return builtinSlots();
}

/**
 * Pure slot behaviour for the TOP-LEVEL convenience commands (`harness <slot>`,
 * e.g. `harness smoke`). An unconfigured slot NEVER fakes success: it returns
 * `status: unconfigured` + `next_action` (exit 2). `--dry-run` carries
 * `{dry_run, slot, mapped_command:null}` per workshop 001 #4. `command` is the
 * slot's own name.
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

/**
 * The `run <slot>` DISPATCHER behaviour (workshop 001 worked examples). `command`
 * is always `run`; the named slot is the argument.
 * - missing slot → caller handles E108 (commander arg) before reaching here.
 * - unknown slot (not in registry) → `error` E110, exit 1.
 * - known but unconfigured slot → `unconfigured` + next_action, exit 2.
 * - `--dry-run` → `{dry_run, slot, mapped_command:null}`, exit 2, never executes.
 */
export function runSlot(
  registry: SlotRegistry,
  slotName: string,
  opts: { dryRun?: boolean },
  clock: Clock,
): Envelope {
  const slot = registry.find((entry) => entry.name === slotName);
  if (!slot) {
    return formatError('run', ErrorCodes.SLOT_UNKNOWN, `Unknown slot '${slotName}'.`, clock, {
      next_action: 'Run `harness help` to see the available slots.',
    });
  }
  // FUTURE: if (slot.status === 'configured' && slot.handler) return slot.handler(ctx);
  if (opts.dryRun) {
    return formatUnconfigured(
      'run',
      `Dry-run: slot '${slotName}' has no mapped command. Nothing would execute.`,
      clock,
      { data: { dry_run: true, slot: slotName, mapped_command: null } },
    );
  }
  return formatUnconfigured(
    'run',
    `No command is mapped to slot '${slotName}' yet. This will be provided by a harness extension. Run \`harness doctor\` to see configured slots.`,
    clock,
  );
}

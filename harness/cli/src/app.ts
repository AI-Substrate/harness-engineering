import { Command } from 'commander';
import { registerDoctorAct } from './acts/doctor.js';
import { registerHelpAct } from './acts/help.js';
import { registerRunAct } from './acts/run.js';
import { registerSlotAct } from './acts/unconfigured-slot.js';
import type { Clock } from './adapters/clock/clock-port.js';
import { SystemClock } from './adapters/clock/system-clock.js';
import { type Envelope, formatError, formatOk } from './output/envelope.js';
import { ErrorCodes } from './output/error-codes.js';
import { exitWithEnvelope } from './output/exit.js';
import { type CliIo, createOutputPort, processWriters, selectMode } from './output/output-port.js';
import { validateCommandMap } from './services/config/load-config.js';
import { builtinSlots } from './services/slots/slot-registry.js';
import { readVersion } from './version.js';

/**
 * Tri-state read of the output flag from argv. The entrypoint resolves this
 * ONCE — commander collapses `--json`/`--no-json` to a single boolean and loses
 * the "absent" state that lets env/TTY decide, so acts must never re-derive it.
 */
export function jsonFlag(argv: string[]): boolean | undefined {
  if (argv.includes('--no-json')) {
    return false;
  }
  if (argv.includes('--json')) {
    return true;
  }
  return undefined;
}

function orientationEnvelope(version: string): Envelope {
  return formatOk(
    'harness',
    {
      version,
      purpose: "Front door to this repo's engineering harness.",
      next_steps: ['harness help', 'harness doctor'],
    },
    new SystemClock(),
    { next_action: 'Run `harness help` for the command surface.' },
  );
}

/**
 * Map a thrown commander error (raised because `exitOverride` is set) to an
 * actionable envelope. Returns `null` for help/version display (commander
 * already printed; the caller exits 0). Unknown command/option/missing-arg →
 * `E108`; anything else (an unexpected bug) → `E100` — so no raw stack trace
 * ever escapes (AC-11).
 */
export function commanderErrorEnvelope(
  err: { code?: string; message?: string },
  clock: Clock,
): Envelope | null {
  if (
    err.code === 'commander.helpDisplayed' ||
    err.code === 'commander.version' ||
    err.code === 'commander.help'
  ) {
    return null;
  }
  const code =
    typeof err.code === 'string' && err.code.startsWith('commander.')
      ? ErrorCodes.INVALID_ARGS
      : ErrorCodes.UNKNOWN;
  return formatError('harness', code, err.message ?? 'Unexpected error.', clock, {
    next_action: 'Run `harness help` for usage.',
  });
}

/**
 * Build the composition root: global flags + every act registered with the
 * pre-resolved `io`. The 7 non-`run` slots register through the factory; `run`
 * is the `run <slot>` dispatcher. No business logic, no fs/process/git here.
 */
export function buildProgram(version: string, io: CliIo): Command {
  const program = new Command()
    .name('harness')
    .description("The agent-friendly front door to this repo's engineering harness.")
    .version(version, '-v, --version')
    .option('--json', 'force JSON output')
    .option('--no-json', 'force human output')
    .exitOverride();

  registerHelpAct(program, io);
  registerDoctorAct(program, io);
  registerRunAct(program, io);
  for (const slot of builtinSlots().filter((slot) => slot.name !== 'run')) {
    registerSlotAct(program, slot, io);
  }

  // Bare `harness` (no subcommand) prints an orientation envelope.
  program.action(() => {
    exitWithEnvelope(orientationEnvelope(version), createOutputPort(io.mode, io.writers));
  });
  return program;
}

export function main(argv: string[] = process.argv): void {
  const mode = selectMode({ json: jsonFlag(argv) }, process.env, Boolean(process.stdout.isTTY));
  const io: CliIo = { mode, writers: processWriters };

  // Validate the in-code command-map before use — bail with E120 if malformed.
  const check = validateCommandMap(builtinSlots(), new SystemClock());
  if (check.status === 'error') {
    exitWithEnvelope(check, createOutputPort(io.mode, io.writers));
  }

  try {
    buildProgram(readVersion(), io).parse(argv);
  } catch (err) {
    const envelope = commanderErrorEnvelope(
      err as { code?: string; message?: string },
      new SystemClock(),
    );
    if (envelope === null) {
      // help/version already displayed by commander.
      process.exit((err as { exitCode?: number }).exitCode ?? 0);
    }
    exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
  }
}

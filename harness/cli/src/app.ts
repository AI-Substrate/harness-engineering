import { Command } from 'commander';
import { registerDocsAct } from './acts/docs.js';
import { registerDoctorAct } from './acts/doctor.js';
import { registerHelpAct } from './acts/help.js';
import { registerInitAct } from './acts/init.js';
import { registerInstructionsAct } from './acts/instructions.js';
import { registerNewAct } from './acts/new.js';
import { registerObserveAct } from './acts/observe.js';
import { registerRecordAct } from './acts/record.js';
import { registerSkillsAct } from './acts/skills.js';
import { registerUpdateAct } from './acts/update.js';
import { registerVerbAct, type VerbActDeps } from './acts/verb.js';
import type { Clock } from './adapters/clock/clock-port.js';
import { SystemClock } from './adapters/clock/system-clock.js';
import { NodeEnv } from './adapters/env/node-env.js';
import { NodeExec } from './adapters/exec/node-exec.js';
import { NodeFs } from './adapters/fs/node-fs.js';
import { ExecGit } from './adapters/git/exec-git.js';
import { JitiLoader } from './adapters/loader/jiti-loader.js';
import type { ModuleLoaderPort } from './adapters/loader/module-loader-port.js';
import { NodeProcess } from './adapters/process/node-process.js';
import { type Envelope, formatError, formatOk } from './output/envelope.js';
import { ErrorCodes } from './output/error-codes.js';
import { exitWithEnvelope, setBannerDecorator } from './output/exit.js';
import {
  type CliIo,
  createOutputPort,
  processWriters,
  selectMode,
  type Writers,
} from './output/output-port.js';
import { helpStyleConfig, resolveUseColor } from './output/style.js';
import { validateVerbRegistry } from './services/config/load-config.js';
import { discoverExtensions } from './services/extensions/discovery.js';
import {
  buildExtensionRegistry,
  type ExtensionRegistry,
  type VerbRegistry,
} from './services/extensions/registry.js';
import {
  buildRecordRegistry,
  coreRecordTypes,
  type ExtensionRecordType,
} from './services/record/registry.js';
import { buildBannerDecorator } from './services/update/banner.js';
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

/**
 * Safe mode: skip extension discovery entirely (core commands only). Detected
 * from raw argv (`--no-extensions`) or env (`HARNESS_NO_EXTENSIONS=1`) BEFORE
 * parse, since the registry must be known before commander is built.
 *
 * NOTE (v1): the argv scan is a simple `includes`, so a `--no-extensions` placed
 * after a verb name (as a verb's own option) would also trigger safe mode. The
 * env var is the unambiguous path; revisit if a verb ever needs that flag.
 */
export function isExtensionsDisabled(argv: string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes('--no-extensions') || env.HARNESS_NO_EXTENSIONS === '1';
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
 * ever escapes.
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

/** Last-resort envelope for an unexpected error before/around parse — routed through the kernel. */
function unexpectedEnvelope(err: unknown, clock: Clock): Envelope {
  return formatError(
    'harness',
    ErrorCodes.UNKNOWN,
    err instanceof Error ? err.message : String(err),
    clock,
    { next_action: 'This is an unexpected harness error; please report it.' },
  );
}

/**
 * Discover + load the repo's extensions into the extension registry (verbs +
 * record types + provenance) in one pass, unless safe mode is on (then the
 * registry is empty — core commands + core record types only). Core record-type
 * names are reserved so an extension can never shadow them. Runs BEFORE parse so
 * each verb is a registered command (WS-A Decision 6).
 */
export async function loadRegistry(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: VerbActDeps,
  loader: ModuleLoaderPort,
): Promise<ExtensionRegistry> {
  if (isExtensionsDisabled(argv, env)) {
    return { verbs: [], recordTypes: [], records: [] };
  }
  const discovery = discoverExtensions(deps.fs, deps.proc);
  return buildExtensionRegistry(discovery.candidates, loader, {
    reservedRecordTypes: new Set(coreRecordTypes.map((t) => t.type)),
    rejected: discovery.rejected,
  });
}

/**
 * Build the composition root: global flags + core commands (incl. `record`, built
 * from the merged record registry = core ∪ extension) + one subcommand per
 * discovered verb, each registered with the pre-resolved `io` + injected ports. No
 * business logic, no fs/process/git here.
 */
export function buildProgram(
  version: string,
  io: CliIo,
  deps: VerbActDeps,
  registry: VerbRegistry & { recordTypes?: ExtensionRecordType[] },
): Command {
  const program = new Command()
    .name('harness')
    .description("The agent-friendly front door to this repo's engineering harness.")
    .version(version, '-v, --version')
    .option('--json', 'force JSON output')
    .option('--no-json', 'force human output')
    .option('--no-extensions', 'skip loading repo extensions (core commands only)')
    // Core commands sit under the default `Commands:` heading; each extension
    // verb overrides this with `Extensions:` (see registerVerbAct) so the two
    // surfaces read as distinct sections in `--help`. configureHelp accents the
    // headings; commander strips the ANSI itself on non-color output streams.
    .commandsGroup('Commands:')
    .configureHelp(helpStyleConfig())
    .exitOverride();

  const recordRegistry = buildRecordRegistry(coreRecordTypes, registry.recordTypes ?? []);

  // Cross-cutting: register the update banner ONCE so every command's exit
  // chokepoint surfaces a known update (JSON field + human stderr line) from a
  // single sync cache read. No-op until the cache holds a newer version (AC9);
  // with no resolvable home (test fakes) it never fires.
  setBannerDecorator(
    buildBannerDecorator({
      fs: deps.fs,
      env: deps.env,
      installed: version,
      mode: io.mode,
      writers: io.writers,
    }),
  );

  registerHelpAct(program, io, registry, deps.fs);
  registerDoctorAct(program, io, registry, recordRegistry);
  registerInitAct(program, io, deps);
  registerNewAct(program, io, deps);
  registerDocsAct(program, io);
  registerSkillsAct(program, io, deps);
  registerUpdateAct(program, io, deps, version);
  registerRecordAct(program, io, deps, recordRegistry);
  registerObserveAct(program, io, deps);
  registerInstructionsAct(program, io, { fs: deps.fs, clock: deps.clock }, registry);
  for (const verb of registry.verbs) {
    registerVerbAct(program, verb, deps, io);
  }

  // Bare `harness` (no subcommand) prints an orientation envelope.
  program.action(() => {
    exitWithEnvelope(orientationEnvelope(version), createOutputPort(io.mode, io.writers));
  });
  return program;
}

/** Injectable seams so the composition root is testable without real adapters/streams. */
export interface MainOverrides {
  deps: VerbActDeps;
  loader: ModuleLoaderPort;
  env: NodeJS.ProcessEnv;
  isTty: boolean;
  writers: Writers;
  version: string;
}

function defaultDeps(): VerbActDeps {
  return {
    exec: new NodeExec(),
    fs: new NodeFs(),
    env: new NodeEnv(),
    git: new ExecGit(),
    clock: new SystemClock(),
    proc: new NodeProcess(),
  };
}

/**
 * The async composition root (WS-A Decision 6): resolve output mode, discover +
 * load extensions, validate the assembled registry, then `await parseAsync`.
 * Three distinct error boundaries keep the kernel the sole exit point:
 *   1. an unexpected discovery/load error → `E100` (routed through the kernel);
 *   2. a malformed registry → the `E120` validation envelope;
 *   3. a commander parse error → `commanderErrorEnvelope` (help/version → exit 0).
 */
export async function main(
  argv: string[] = process.argv,
  overrides: Partial<MainOverrides> = {},
): Promise<void> {
  const deps = overrides.deps ?? defaultDeps();
  const loader = overrides.loader ?? new JitiLoader();
  const env = overrides.env ?? process.env;
  const isTty = overrides.isTty ?? Boolean(process.stdout.isTTY);
  const writers = overrides.writers ?? processWriters;
  const version = overrides.version ?? readVersion();
  const clock = deps.clock;

  const mode = selectMode({ json: jsonFlag(argv) }, env, isTty);
  const io: CliIo = { mode, writers, useColor: resolveUseColor({ mode, isTty, env }) };
  const port = createOutputPort(io.mode, io.writers);

  // Register the update banner BEFORE any exit — incl. the pre-build discovery /
  // registry-validation error envelopes below, which exit before buildProgram
  // (which re-registers it) runs (companion F004). Idempotent: same decorator.
  setBannerDecorator(
    buildBannerDecorator({
      fs: deps.fs,
      env: deps.env,
      installed: version,
      mode: io.mode,
      writers: io.writers,
    }),
  );

  let registry: VerbRegistry;
  try {
    registry = await loadRegistry(argv, env, deps, loader);
  } catch (err) {
    exitWithEnvelope(unexpectedEnvelope(err, clock), port);
    return;
  }

  const check = validateVerbRegistry(registry.verbs, clock);
  if (check.status === 'error') {
    exitWithEnvelope(check, port);
    return;
  }

  try {
    await buildProgram(version, io, deps, registry).parseAsync(argv);
  } catch (err) {
    const envelope = commanderErrorEnvelope(err as { code?: string; message?: string }, clock);
    if (envelope === null) {
      // help/version: commander already printed; returning lets Node exit 0.
      return;
    }
    exitWithEnvelope(envelope, port);
  }
}

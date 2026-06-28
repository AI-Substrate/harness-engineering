import { Command } from 'commander';
import { registerDocsAct } from './acts/docs.js';
import { registerDoctorAct } from './acts/doctor.js';
import { registerFlowAct } from './acts/flow.js';
import { registerHelpAct } from './acts/help.js';
import { registerInitAct } from './acts/init.js';
import { registerInstructionsAct } from './acts/instructions.js';
import { registerNewAct } from './acts/new.js';
import { registerObserveAct } from './acts/observe.js';
import { registerRecordAct } from './acts/record.js';
import { registerSkillsAct } from './acts/skills.js';
import { registerTelemetryAct } from './acts/telemetry.js';
import { registerUpdateAct } from './acts/update.js';
import { registerVerbAct, type VerbActDeps } from './acts/verb.js';
import type { Clock } from './adapters/clock/clock-port.js';
import { SystemClock } from './adapters/clock/system-clock.js';
import { NodeDb } from './adapters/db/node-db.js';
import { NodeEnv } from './adapters/env/node-env.js';
import { NodeBackground } from './adapters/exec/node-background.js';
import { NodeExec } from './adapters/exec/node-exec.js';
import { NodeFs } from './adapters/fs/node-fs.js';
import { ExecGit } from './adapters/git/exec-git.js';
import { ExecGitWrite } from './adapters/git/exec-git-write.js';
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
import { coreTelemetryAdapters } from './services/telemetry/adapters/index.js';
import {
  CAPTURE_DEPTH_ENV,
  type CaptureDeps,
  captureTelemetry,
} from './services/telemetry/capture-service.js';
import { buildHousekeepingDecorator } from './services/telemetry/housekeeping.js';
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
 * The telemetry command label (plan 034 Phase 3): the first non-flag token after
 * the binary+script (index ≥ 2), else `harness` (bare invocation). Top-level
 * command only (`flow nav …` → `flow`), matching the segment's single-token
 * `command` contract. Pure argv scan, no I/O.
 *
 * Safe because every global flag is boolean (`--json`/`--no-json`/`--no-extensions`/
 * `-v`/`-h` — none consume a following value); a value-taking global would break
 * this heuristic (revisit if one is ever added).
 */
export function deriveCommand(argv: string[]): string {
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (tok !== undefined && !tok.startsWith('-')) {
      return tok;
    }
  }
  return 'harness';
}

/**
 * Whether the kernel preamble should fire telemetry capture for this argv
 * (plan 034 Phase 3). Display-only invocations are excluded: `-h`/`--help`/
 * `-v`/`--version`, or the `help` subcommand.
 *
 * This is an argv-SHAPE scan, NOT a semantic "is this display-only?" check
 * (mirrors {@link jsonFlag} / {@link isExtensionsDisabled}). The only display-only
 * surfaces today are help/version; ANY new display-only verb must be added here.
 * A `-h`/`-v` placed anywhere excludes — the same flat-`includes` caveat the
 * safe-mode scan documents above; accepted (revisit if a verb needs its own
 * `-h`/`-v`).
 */
export function shouldCaptureForArgv(argv: string[]): boolean {
  if (
    argv.includes('-h') ||
    argv.includes('--help') ||
    argv.includes('-v') ||
    argv.includes('--version')
  ) {
    return false;
  }
  return deriveCommand(argv) !== 'help';
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

  // Cross-cutting: register the exit-chokepoint decorators ONCE so every
  // command's exit surfaces (a) a known update and (b) telemetry housekeeping for
  // the well-known boot/checks commands. Composed into one decorator (the slot
  // holds a single fn). Both are no-ops for ordinary commands / when nothing is
  // pending; with no resolvable home (test fakes) the update banner never fires.
  const banner = buildBannerDecorator({
    fs: deps.fs,
    env: deps.env,
    installed: version,
    mode: io.mode,
    writers: io.writers,
  });
  const housekeeping = buildHousekeepingDecorator({
    fs: deps.fs,
    env: deps.env,
    proc: deps.proc,
    gitWrite: deps.gitWrite ?? new ExecGitWrite(),
    mode: io.mode,
    writers: io.writers,
  });
  setBannerDecorator((env) => {
    banner(env);
    housekeeping(env);
  });

  registerHelpAct(program, io, registry, deps.fs);
  registerDoctorAct(program, io, registry, recordRegistry);
  registerInitAct(program, io, deps);
  registerNewAct(program, io, deps);
  registerDocsAct(program, io);
  registerSkillsAct(program, io, deps);
  registerUpdateAct(program, io, deps, version);
  registerRecordAct(program, io, deps, recordRegistry, version);
  registerObserveAct(program, io, deps);
  registerFlowAct(program, io, deps, version);
  registerTelemetryAct(program, io, { ...deps, gitWrite: deps.gitWrite ?? new ExecGitWrite() });
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
  /**
   * Telemetry capture seam (plan 034 Phase 3). Defaults to the real
   * `captureTelemetry`; tests inject a recording or throwing fake to assert
   * "invoked once / with command X" and AC-09 fail-safety without `vi.mock`.
   */
  capture: (deps: CaptureDeps) => void;
}

function defaultDeps(): VerbActDeps {
  // One NodeFs instance backs both the read port (`fs`) and the write port
  // (`fsWrite`) — NodeFs implements FsPort + FileSystemWritePort (plan 031).
  const nodeFs = new NodeFs();
  return {
    exec: new NodeExec(),
    fs: nodeFs,
    fsWrite: nodeFs,
    background: new NodeBackground(),
    env: new NodeEnv(),
    git: new ExecGit(),
    gitWrite: new ExecGitWrite(),
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

  // Register the exit-chokepoint decorators BEFORE any exit — incl. the pre-build
  // discovery / registry-validation error envelopes below, which exit before
  // buildProgram (which re-registers them) runs (companion F004). Housekeeping is
  // a no-op here (those early exits are never boot/checks) but kept for symmetry.
  const preBuildBanner = buildBannerDecorator({
    fs: deps.fs,
    env: deps.env,
    installed: version,
    mode: io.mode,
    writers: io.writers,
  });
  const preBuildHousekeeping = buildHousekeepingDecorator({
    fs: deps.fs,
    env: deps.env,
    proc: deps.proc,
    gitWrite: deps.gitWrite ?? new ExecGitWrite(),
    mode: io.mode,
    writers: io.writers,
  });
  setBannerDecorator((env) => {
    preBuildBanner(env);
    preBuildHousekeeping(env);
  });

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

  // Auto-capture preamble (plan 034 Phase 3): record one counts-only telemetry
  // segment for this command via the telemetry service — best-effort, before the
  // command runs. Display-only argv (help/version) is excluded. The whole
  // preamble is wrapped so telemetry can NEVER change the host command's output
  // or exit code (AC-09) — defense in depth over captureTelemetry's own internal
  // fail-safe. `env` is the EnvPort (`deps.env`), the ONLY env that carries the
  // harness session id + HARNESS_PLAN_ID — not the local `NodeJS.ProcessEnv`.
  if (shouldCaptureForArgv(argv)) {
    try {
      (overrides.capture ?? captureTelemetry)({
        fs: deps.fs,
        env: deps.env,
        clock: deps.clock,
        proc: deps.proc,
        git: deps.git,
        db: new NodeDb(),
        command: deriveCommand(argv),
        adapters: coreTelemetryAdapters,
      });
    } catch {
      // swallow — telemetry is invisible to the host command (AC-09)
    }
  }

  // Re-entrancy marker: bump the capture-depth in the REAL process env so any
  // harness subprocess THIS command spawns (the `checks` sub-verb fan-out, the
  // `flow render --check` drift gate, …) inherits a non-zero depth and self-
  // suppresses capture — only this top-level invocation (depth 0, captured above)
  // attributes a segment to the session. Uses `process.env` directly (not the
  // EnvPort): a spawned child inherits THAT, not the injected port.
  process.env[CAPTURE_DEPTH_ENV] = String((Number(process.env[CAPTURE_DEPTH_ENV] ?? '0') || 0) + 1);

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

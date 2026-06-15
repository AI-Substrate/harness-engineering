import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { ExecPort } from '../adapters/exec/exec-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { NodeVersionLookup } from '../adapters/version-lookup/node-version-lookup.js';
import { formatError, formatOk } from '../output/envelope.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { PACKAGE_NAME } from '../services/update/constants.js';
import {
  classifyInstallFailure,
  formatNpmCommand,
  normalizePin,
  npmInstallArgv,
} from '../services/update/install.js';
import { runCheck } from '../services/update/update-service.js';

const MAX_STDERR_TAIL = 800;

/** The ports the `update`/`self-install` acts inject — a subset of VerbActDeps (no git). */
export interface UpdateActDeps {
  exec: ExecPort;
  fs: FsPort;
  env: EnvPort;
  clock: Clock;
  proc: ProcessPort;
}

interface UpdateOpts {
  check?: boolean;
  pin?: string;
}

/**
 * Run a global `npm i -g <pkg>@<spec>` install and render the result (shared by
 * `harness update` and `self-install`). Announces the exact command first
 * (human → stderr; JSON folds it into the envelope), shells ONLY through the
 * injected ExecPort, and maps a failure onto an actionable envelope via
 * `classifyInstallFailure` (AC10). `installedAfter` is the version we expect to
 * land (null when unknown), surfaced as `data.installed_after`.
 */
async function installSpec(
  commandName: string,
  io: CliIo,
  deps: UpdateActDeps,
  installed: string,
  spec: string,
  installedAfter: string | null,
): Promise<void> {
  const argv = npmInstallArgv(spec);
  const command = formatNpmCommand(argv);
  const jsonPort = () => createOutputPort('json', io.writers);

  if (io.mode !== 'json') {
    io.writers.err(`harness ${commandName} — about to run:\n  ${command}\n`);
  }

  const result = await deps.exec.run('npm', argv, { cwd: deps.proc.cwd() });

  if (result.ok) {
    const envelope = formatOk(
      commandName,
      { installed_before: installed, installed_after: installedAfter, command },
      deps.clock,
      {
        next_action: `Done. Verify with \`harness --version\`${installedAfter ? ` (expecting ${installedAfter})` : ''}.`,
      },
    );
    const port: OutputPort =
      io.mode === 'json'
        ? jsonPort()
        : {
            emit: () => {
              if (result.stdout.trim()) io.writers.out(`${result.stdout.replace(/\n$/, '')}\n`);
              io.writers.out(`${commandName}: ok${installedAfter ? ` (${installedAfter})` : ''}\n`);
            },
          };
    exitWithEnvelope(envelope, port);
    return;
  }

  const failure = classifyInstallFailure(result, command, spec === 'latest' ? undefined : { pinned: spec });
  const envelope = formatError(commandName, failure.code, failure.message, deps.clock, {
    next_action: failure.next_action,
    details: { command, stderr_tail: result.stderr.slice(-MAX_STDERR_TAIL) },
  });
  const port: OutputPort =
    io.mode === 'json'
      ? jsonPort()
      : {
          emit: (e) => {
            if (result.stderr.trim()) io.writers.err(`${result.stderr.replace(/\n$/, '')}\n`);
            io.writers.err(`harness ${commandName}: ${e.error?.message ?? 'failed'}\n`);
            if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
          },
        };
  exitWithEnvelope(envelope, port);
}

/**
 * Register `harness update` (+ `--check` / `--pin`). A CORE command (like
 * `skills`/`doctor`): it keeps the globally-installed CLI current from the
 * GitHub Packages release (plan 018). `--check` is report-only (fresh lookup,
 * exit 0, no install); `--pin <vX.Y.Z>` installs one exact version; bare `update`
 * installs `@latest` unless already current. `installed` is the running version.
 */
export function registerUpdateAct(
  program: Command,
  io: CliIo,
  deps: UpdateActDeps,
  installed: string,
): void {
  program
    .command('update')
    .description('Update the globally-installed harness CLI from the registry')
    .option('--check', 'check for a newer version without installing (exit 0)')
    .option('--pin <version>', 'install one exact version (e.g. v0.3.0), not persisted')
    .action(async (opts: UpdateOpts) => {
      const lookup = new NodeVersionLookup(deps.exec, PACKAGE_NAME, deps.proc.cwd());
      const jsonPort = () => createOutputPort('json', io.writers);

      // --check: fresh lookup, report-only, exit 0, NEVER installs.
      if (opts.check) {
        const result = await runCheck(
          { fs: deps.fs, env: deps.env, clock: deps.clock, lookup },
          installed,
          { force: true },
        );
        const available = result.update_available !== null;
        const next_action = available
          ? `A newer version (${result.latest}) is available. Run \`harness update\` to upgrade.`
          : result.latest
            ? `You are on the latest version (${installed}).`
            : 'Could not determine the latest version (registry unreachable or auth missing).';
        const envelope = formatOk(
          'update',
          { installed, latest: result.latest, update_available: available },
          deps.clock,
          { next_action },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? jsonPort()
            : {
                emit: (e) => {
                  io.writers.out(
                    `update --check: installed ${installed}, latest ${result.latest ?? 'unknown'}` +
                      `${available ? ' — update available' : ''}\n`,
                  );
                  if (e.next_action) io.writers.err(`→ ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      // --pin <version>: install that exact version, one-time (no persisted pin).
      if (opts.pin) {
        const spec = normalizePin(opts.pin);
        await installSpec('update', io, deps, installed, spec, spec);
        return;
      }

      // bare update: install @latest, unless a lookup proves we're already current.
      const result = await runCheck(
        { fs: deps.fs, env: deps.env, clock: deps.clock, lookup },
        installed,
        { force: true },
      );
      if (result.latest && result.update_available === null) {
        const command = formatNpmCommand(npmInstallArgv('latest'));
        const envelope = formatOk(
          'update',
          { installed_before: installed, installed_after: installed, command, already_latest: true },
          deps.clock,
          { next_action: `Already on the latest version (${installed}).` },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? jsonPort()
            : { emit: () => io.writers.out(`update: already on latest (${installed})\n`) };
        exitWithEnvelope(envelope, port);
        return;
      }
      await installSpec('update', io, deps, installed, 'latest', result.latest);
    });
}

export { installSpec };

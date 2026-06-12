import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { ExecPort } from '../adapters/exec/exec-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { formatDegraded, formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import {
  DEFAULT_SKILLS_SOURCE,
  KNOWN_SKILL_TARGETS,
  LEGACY_SKILL_SLUGS,
  type SkillsInstallOptions,
  type SkillsRemoveOptions,
} from '../services/skills/contract.js';
import {
  buildInstallArgv,
  buildRemoveArgv,
  formatInstallCommand,
  resolveSkillsSource,
} from '../services/skills/skills-service.js';

const SKILLS_DOCS_URL = 'https://github.com/vercel-labs/skills';
const MAX_STDERR_TAIL = 800;

/** The ports the `skills` act injects — a subset of VerbActDeps (no fs/git/env needed). */
export interface SkillsActDeps {
  exec: ExecPort;
  proc: ProcessPort;
  clock: Clock;
}

interface InstallOpts {
  target?: string[];
  global?: boolean;
  source: string;
  branch?: string;
  skill?: string[];
}

/** `harness skills update` options — same as install minus the `-s` skill filter (update syncs the whole set). */
interface UpdateOpts {
  target?: string[];
  global?: boolean;
  source: string;
  branch?: string;
}

/**
 * Emit an actionable `E108` (invalid args) and exit 1 — shared by the install/update
 * subcommands. Never blocks on a prompt: the CLI is agent-first, so a bad flag combo
 * returns guidance, not a hang. JSON → a single envelope on stdout; human → stderr
 * lines prefixed with `label` (e.g. `harness skills install`).
 */
function failInvalidArgs(
  io: CliIo,
  deps: SkillsActDeps,
  label: string,
  message: string,
  next_action: string,
): void {
  const envelope = formatError('skills', ErrorCodes.INVALID_ARGS, message, deps.clock, {
    next_action,
  });
  const port: OutputPort =
    io.mode === 'json'
      ? createOutputPort('json', io.writers)
      : {
          emit: (e) => {
            io.writers.err(`${label}: ${e.error?.message ?? 'failed'}\n`);
            if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
          },
        };
  exitWithEnvelope(envelope, port);
}

/**
 * Register the `skills` command + its `install` subcommand — a first-class CORE
 * capability (reserved, like `help`/`doctor`/`new`/`docs`; it ships with the
 * published CLI so the harness can install its own skills in any repo). It owns
 * no install logic: it is a transparent PASS-THROUGH to Vercel's `npx skills add`
 * (Principle 8, wrap-don't-rebuild — that tool already owns the CLI-target × scope
 * matrix). The act:
 *   - builds the exact argv with the pure `buildInstallArgv` (always `-y`, so the
 *     blocking interactive picker never appears);
 *   - **announces the exact `npx …` command before running it** — to stderr in
 *     human mode, and inside the envelope (`data.command` + `next_action`) in JSON
 *     mode, so the `--json` stdout stays a single parseable envelope (Principle 4);
 *   - shells out ONLY through the injected `ExecPort` (no direct child/shell);
 *   - maps the result onto an Envelope + exit code (ok → 0, `E170` → 1).
 *
 * Targets are flags, not a blocking prompt: the harness CLI is agent-first and
 * non-blocking, so a missing `--target` returns `E108` with a `next_action` that
 * enumerates the valid targets. The *skill* (`eng-harness-0-adopt`) is what asks
 * the user, then runs this with flags.
 */
export function registerSkillsAct(program: Command, io: CliIo, deps: SkillsActDeps): void {
  const skills = program
    .command('skills')
    .description("Install this harness's skills via the Vercel `npx skills` CLI");

  // Bare `harness skills` → agent-friendly orientation (no blocking, exit 0).
  skills.action(() => {
    const envelope = formatOk(
      'skills',
      { subcommands: ['install', 'update'], installer: SKILLS_DOCS_URL },
      deps.clock,
      {
        next_action:
          'Run `harness skills install --target <cli> [--global]` (or `update` to refresh + prune).',
      },
    );
    const port: OutputPort =
      io.mode === 'json'
        ? createOutputPort('json', io.writers)
        : {
            emit: () =>
              io.writers.out(
                "harness skills — install this harness's skills.\n" +
                  '  harness skills install --target <cli> [--global]   # add / refresh\n' +
                  '  harness skills update  --target <cli> [--global]   # refresh to latest + prune renamed/removed\n',
              ),
          };
    exitWithEnvelope(envelope, port);
  });

  skills
    .command('install')
    .description(
      "Install this repo's skills into a CLI (pass-through to `npx skills add`, always -y)",
    )
    .option('-t, --target <cli...>', `CLI target(s), repeatable: ${KNOWN_SKILL_TARGETS.join(', ')}`)
    .option('-g, --global', 'install globally (omit for a project-local install)')
    .option('--source <repo>', 'skills source (owner/repo or local path)', DEFAULT_SKILLS_SOURCE)
    .option(
      '-b, --branch <ref>',
      'install from a branch (single-segment; rewrites a GitHub source to /tree/<ref>). Also accepted as --source owner/repo#ref',
    )
    .option('-s, --skill <slug...>', 'install only specific skill slug(s)')
    .action(async (opts: InstallOpts) => {
      const targets = opts.target ?? [];
      const jsonPort = () => createOutputPort('json', io.writers);

      // No target → at least one CLI target is required. Fail fast with an actionable
      // E108 (never block on a prompt — the CLI is agent-first).
      if (targets.length === 0) {
        failInvalidArgs(
          io,
          deps,
          'harness skills install',
          'no --target given: at least one CLI target is required.',
          `Pass --target <cli> (one or more of: ${KNOWN_SKILL_TARGETS.join(
            ', ',
          )}). Example: harness skills install --target github-copilot --global`,
        );
        return;
      }

      // Resolve --source (+ --branch / a `#ref` suffix) into the specifier the
      // Vercel installer truly accepts (a GitHub /tree/<ref> URL for a branch).
      const resolved = resolveSkillsSource(opts.source, opts.branch);
      if (!resolved.ok) {
        failInvalidArgs(
          io,
          deps,
          'harness skills install',
          resolved.reason,
          `Re-run with a valid source/branch. ${resolved.reason}`,
        );
        return;
      }

      const installOpts: SkillsInstallOptions = {
        source: resolved.source,
        targets,
        global: Boolean(opts.global),
        skills: opts.skill,
      };
      const argv = buildInstallArgv(installOpts);
      const command = formatInstallCommand(argv);

      // Announce BEFORE running. Human → stderr; JSON → folded into the envelope (data + next_action),
      // never prose on stdout (keeps `--json` stdout a single valid envelope).
      if (io.mode !== 'json') {
        io.writers.err(
          `harness skills install — about to run:\n  ${command}\n` +
            `(wraps the Vercel skills installer — more at ${SKILLS_DOCS_URL})\n`,
        );
      }

      const result = await deps.exec.run('npx', argv, { cwd: deps.proc.cwd() });

      if (result.ok) {
        const envelope = formatOk(
          'skills',
          {
            command,
            targets,
            global: Boolean(opts.global),
            source: resolved.source,
            ...(resolved.branch ? { branch: resolved.branch } : {}),
            installer: SKILLS_DOCS_URL,
          },
          deps.clock,
          {
            next_action: `Skills installed for ${targets.join(
              ', ',
            )}. Verify with your CLI's skills listing.`,
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? jsonPort()
            : {
                emit: () => {
                  if (result.stdout.trim()) io.writers.out(`${result.stdout.replace(/\n$/, '')}\n`);
                  io.writers.out(`skills install: ok (${targets.join(', ')})\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const envelope = formatError(
        'skills',
        ErrorCodes.SKILLS_INSTALL_FAILED,
        `\`npx skills add\` failed (exit ${result.code}).`,
        deps.clock,
        {
          next_action: `Check network + that \`npx\` is available, then re-run: ${command}`,
          details: { command, stderr_tail: result.stderr.slice(-MAX_STDERR_TAIL) },
        },
      );
      const port: OutputPort =
        io.mode === 'json'
          ? jsonPort()
          : {
              emit: (e) => {
                if (result.stderr.trim()) io.writers.err(`${result.stderr.replace(/\n$/, '')}\n`);
                io.writers.err(`harness skills install: ${e.error?.message ?? 'failed'}\n`);
                if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
              },
            };
      exitWithEnvelope(envelope, port);
    });

  skills
    .command('update')
    .description(
      "Update this repo's skills to latest AND prune renamed/removed ones (refresh via `npx skills add`, then `npx skills remove` the legacy slugs)",
    )
    .option('-t, --target <cli...>', `CLI target(s), repeatable: ${KNOWN_SKILL_TARGETS.join(', ')}`)
    .option('-g, --global', 'update the global install (omit for a project-local update)')
    .option('--source <repo>', 'skills source (owner/repo or local path)', DEFAULT_SKILLS_SOURCE)
    .option(
      '-b, --branch <ref>',
      'update from a branch (single-segment; rewrites a GitHub source to /tree/<ref>). Also accepted as --source owner/repo#ref',
    )
    .action(async (opts: UpdateOpts) => {
      const targets = opts.target ?? [];
      const jsonPort = () => createOutputPort('json', io.writers);

      // No target → at least one CLI target is required (same agent-first E108 as install).
      if (targets.length === 0) {
        failInvalidArgs(
          io,
          deps,
          'harness skills update',
          'no --target given: at least one CLI target is required.',
          `Pass --target <cli> (one or more of: ${KNOWN_SKILL_TARGETS.join(
            ', ',
          )}). Example: harness skills update --target github-copilot --global`,
        );
        return;
      }

      const resolved = resolveSkillsSource(opts.source, opts.branch);
      if (!resolved.ok) {
        failInvalidArgs(
          io,
          deps,
          'harness skills update',
          resolved.reason,
          `Re-run with a valid source/branch. ${resolved.reason}`,
        );
        return;
      }

      const global = Boolean(opts.global);
      const refreshArgv = buildInstallArgv({ source: resolved.source, targets, global });
      const refreshCommand = formatInstallCommand(refreshArgv);
      const removeOpts: SkillsRemoveOptions = { slugs: [...LEGACY_SKILL_SLUGS], targets, global };
      const pruneArgv = buildRemoveArgv(removeOpts);
      const pruneCommand = formatInstallCommand(pruneArgv);

      // Announce BOTH commands before running. Human → stderr; JSON → folded into the
      // envelope (refresh_command + prune_command), never prose on stdout.
      if (io.mode !== 'json') {
        io.writers.err(
          `harness skills update — about to run:\n  ${refreshCommand}\n  ${pruneCommand}\n` +
            `(refresh to latest, then prune renamed/removed skills — wraps the Vercel skills installer; more at ${SKILLS_DOCS_URL})\n`,
        );
      }

      const cwd = deps.proc.cwd();

      // 1) Refresh: install/refresh the current published set (also pulls any NEW skills).
      //    If this fails we DON'T prune — the existing skills stay intact (no regression).
      const refresh = await deps.exec.run('npx', refreshArgv, { cwd });
      if (!refresh.ok) {
        const envelope = formatError(
          'skills',
          ErrorCodes.SKILLS_INSTALL_FAILED,
          `\`npx skills add\` (refresh) failed (exit ${refresh.code}); skills left unchanged (prune not attempted).`,
          deps.clock,
          {
            next_action: `Check network + that \`npx\` is available, then re-run: harness skills update --target ${targets.join(
              ' --target ',
            )}${global ? ' --global' : ''}`,
            details: {
              command: refreshCommand,
              stderr_tail: refresh.stderr.slice(-MAX_STDERR_TAIL),
            },
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? jsonPort()
            : {
                emit: (e) => {
                  if (refresh.stderr.trim())
                    io.writers.err(`${refresh.stderr.replace(/\n$/, '')}\n`);
                  io.writers.err(`harness skills update: ${e.error?.message ?? 'failed'}\n`);
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      // 2) Prune: remove the renamed/removed legacy slugs (no-ops on any not installed).
      const prune = await deps.exec.run('npx', pruneArgv, { cwd });

      const baseData = {
        refresh_command: refreshCommand,
        prune_command: pruneCommand,
        pruned_candidates: [...LEGACY_SKILL_SLUGS],
        targets,
        global,
        source: resolved.source,
        ...(resolved.branch ? { branch: resolved.branch } : {}),
        installer: SKILLS_DOCS_URL,
      };

      if (prune.ok) {
        const envelope = formatOk('skills', baseData, deps.clock, {
          next_action: `Skills updated for ${targets.join(
            ', ',
          )} — refreshed to latest and pruned renamed/removed slugs. Verify with your CLI's skills listing.`,
        });
        const port: OutputPort =
          io.mode === 'json'
            ? jsonPort()
            : {
                emit: () => {
                  if (refresh.stdout.trim())
                    io.writers.out(`${refresh.stdout.replace(/\n$/, '')}\n`);
                  io.writers.out(
                    `skills update: ok (${targets.join(', ')}) — refreshed + pruned\n`,
                  );
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      // Refresh succeeded but prune failed → degraded (exit 0): latest IS installed, but
      // renamed copies may linger. Honest, recoverable — re-run the prune by hand.
      const envelope = formatDegraded(
        'skills',
        {
          ...baseData,
          prune_failed: true,
          prune_stderr_tail: prune.stderr.slice(-MAX_STDERR_TAIL),
        },
        `Refreshed to latest, but pruning renamed skills failed (exit ${prune.code}). Re-run the prune manually: ${pruneCommand}`,
        deps.clock,
      );
      const port: OutputPort =
        io.mode === 'json'
          ? jsonPort()
          : {
              emit: (e) => {
                if (refresh.stdout.trim()) io.writers.out(`${refresh.stdout.replace(/\n$/, '')}\n`);
                if (prune.stderr.trim()) io.writers.err(`${prune.stderr.replace(/\n$/, '')}\n`);
                io.writers.out(
                  `skills update: refreshed (${targets.join(', ')}); prune incomplete\n`,
                );
                if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
              },
            };
      exitWithEnvelope(envelope, port);
    });
}

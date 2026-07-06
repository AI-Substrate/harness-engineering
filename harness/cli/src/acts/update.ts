import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { ExecPort } from '../adapters/exec/exec-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { NodeVersionLookup } from '../adapters/version-lookup/node-version-lookup.js';
import { formatDegraded, formatError, formatOk, type Status } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import {
  KNOWN_SKILL_TARGETS,
  LEGACY_SKILL_SLUGS,
  PACKAGED_SKILLS_SOURCE,
} from '../services/skills/contract.js';
import {
  readSkillsLockFile,
  type SkillsLockScope,
  skillsLockPath,
  writeMergedSkillsLock,
} from '../services/skills/skills-lock.js';
import {
  buildInstallArgv,
  buildRemoveArgv,
  formatInstallCommand,
  resolvePackagedSkillsDir,
} from '../services/skills/skills-service.js';
import { PACKAGE_NAME } from '../services/update/constants.js';
import {
  classifyInstallFailure,
  formatNpmCommand,
  normalizePin,
  npmInstallArgv,
} from '../services/update/install.js';
import { isValidVersion } from '../services/update/semver.js';
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
  target?: string[];
  global?: boolean;
}

interface SkillsReconcilePlan {
  targets: string[];
  global: boolean;
  source: string;
}

/** Outcome of the binary (CLI) part of `update` — built without exiting so it can be combined with skills. */
interface BinaryOutcome {
  status: Status;
  data: Record<string, unknown>;
  next_action: string;
  /** One-line human summary (no trailing newline). */
  summary: string;
  error?: { code: string; message: string; details?: unknown };
  stdout?: string;
  stderr?: string;
}

/** Outcome of the skills part of `update` (report-only, or refresh+prune). */
interface SkillsOutcome {
  status: Status;
  skills: Record<string, unknown>;
  next_action: string;
  summary: string;
}

const severity = (s: Status): number =>
  s === 'error' ? 3 : s === 'unconfigured' ? 2 : s === 'degraded' ? 1 : 0;
const worst = (a: Status, b: Status): Status => (severity(a) >= severity(b) ? a : b);

function scopeFor(global: boolean): SkillsLockScope {
  return global ? 'global' : 'project';
}

function planCommandArgs(plan: SkillsReconcilePlan): string[] {
  const args = ['skills', 'update', '--target', ...plan.targets];
  if (plan.global) args.push('--global');
  if (plan.source !== PACKAGED_SKILLS_SOURCE) args.push('--source', plan.source);
  return args;
}

function collectLockedPlans(deps: UpdateActDeps): SkillsReconcilePlan[] {
  const cwd = deps.proc.cwd();
  const project = readSkillsLockFile(
    deps.fs,
    skillsLockPath({ cwd, env: deps.env, scope: 'project' }),
  ).installs.filter((i) => i.scope === 'project');
  const global = readSkillsLockFile(
    deps.fs,
    skillsLockPath({ cwd, env: deps.env, scope: 'global' }),
  ).installs.filter((i) => i.scope === 'global');
  return [...project, ...global].map((entry) => ({
    targets: entry.targets,
    global: entry.scope === 'global',
    source: entry.source,
  }));
}

function plansFor(deps: UpdateActDeps, opts: UpdateOpts): SkillsReconcilePlan[] {
  const targets = opts.target ?? [];
  if (targets.length > 0) {
    return [{ targets, global: Boolean(opts.global), source: PACKAGED_SKILLS_SOURCE }];
  }
  return collectLockedPlans(deps);
}

function stageSkillsSource(
  deps: UpdateActDeps,
  plan: SkillsReconcilePlan,
): { ok: true; source: string; staged?: string } | { ok: false; reason: string } {
  if (plan.source !== PACKAGED_SKILLS_SOURCE) return { ok: true, source: plan.source };
  const staged = deps.fs.mkdtemp('harness-skills-');
  const packagedDir = resolvePackagedSkillsDir();
  if (!deps.fs.copyDir(packagedDir, staged)) {
    return {
      ok: false,
      reason: `could not stage packaged skills from ${packagedDir} into ${staged}.`,
    };
  }
  return { ok: true, source: staged, staged };
}

function writeExplicitTargetLock(deps: UpdateActDeps, plan: SkillsReconcilePlan): boolean {
  const scope = scopeFor(plan.global);
  return writeMergedSkillsLock({
    fs: deps.fs,
    path: skillsLockPath({ cwd: deps.proc.cwd(), env: deps.env, scope }),
    entry: { scope, source: plan.source, targets: plan.targets },
  });
}

async function reconcilePlanInProcess(
  io: CliIo,
  deps: UpdateActDeps,
  plan: SkillsReconcilePlan,
  explicitTargets: boolean,
): Promise<SkillsOutcome> {
  const staged = stageSkillsSource(deps, plan);
  if (!staged.ok) {
    return {
      status: 'error',
      skills: {
        reconciled: true,
        refreshed: false,
        pruned: false,
        targets: plan.targets,
        global: plan.global,
        source: plan.source,
        stage_error: staged.reason,
      },
      next_action: 'Verify the npm package contains skills/ (run `npm pack --dry-run`) and retry.',
      summary: `skills: staging failed (${plan.targets.join(', ')})`,
    };
  }

  const targets = plan.targets;
  const global = plan.global;
  const refreshArgv = buildInstallArgv({ source: staged.source, targets, global });
  const refreshCommand = formatInstallCommand(refreshArgv);
  const pruneArgv = buildRemoveArgv({ slugs: [...LEGACY_SKILL_SLUGS], targets, global });
  const pruneCommand = formatInstallCommand(pruneArgv);
  if (io.mode !== 'json') {
    io.writers.err(
      `harness update — reconciling skills:\n  ${refreshCommand}\n  ${pruneCommand}\n`,
    );
  }
  const cwd = deps.proc.cwd();

  const refresh = await deps.exec.run('npx', refreshArgv, { cwd });
  if (!refresh.ok) {
    return {
      status: 'error',
      skills: {
        reconciled: true,
        refreshed: false,
        pruned: false,
        targets,
        global,
        source: plan.source,
        ...(staged.staged ? { staged_source: staged.staged } : {}),
        refresh_command: refreshCommand,
        stderr_tail: refresh.stderr.slice(-MAX_STDERR_TAIL),
      },
      next_action: `Skills refresh failed (exit ${refresh.code}); skills left unchanged. Re-run: ${refreshCommand}`,
      summary: `skills: refresh failed (${targets.join(', ')})`,
    };
  }

  const prune = await deps.exec.run('npx', pruneArgv, { cwd });
  const lockWritten = explicitTargets ? writeExplicitTargetLock(deps, plan) : undefined;
  if (prune.ok) {
    return {
      status: 'ok',
      skills: {
        reconciled: true,
        refreshed: true,
        pruned: true,
        targets,
        global,
        source: plan.source,
        ...(staged.staged ? { staged_source: staged.staged } : {}),
        ...(lockWritten !== undefined ? { lock_written: lockWritten } : {}),
        refresh_command: refreshCommand,
        prune_command: pruneCommand,
        pruned_candidates: [...LEGACY_SKILL_SLUGS],
      },
      next_action: `Skills reconciled for ${targets.join(', ')} (refreshed + pruned).`,
      summary: `skills: reconciled (${targets.join(', ')}) — refreshed + pruned`,
    };
  }

  return {
    status: 'degraded',
    skills: {
      reconciled: true,
      refreshed: true,
      pruned: false,
      targets,
      global,
      source: plan.source,
      ...(staged.staged ? { staged_source: staged.staged } : {}),
      ...(lockWritten !== undefined ? { lock_written: lockWritten } : {}),
      refresh_command: refreshCommand,
      prune_command: pruneCommand,
      prune_stderr_tail: prune.stderr.slice(-MAX_STDERR_TAIL),
    },
    next_action: `Skills refreshed but prune failed (exit ${prune.code}). Re-run the prune: ${pruneCommand}`,
    summary: `skills: refreshed (${targets.join(', ')}); prune incomplete`,
  };
}

/**
 * Run a global `npm i -g <pkg>@<spec>` and build the outcome (no exit). Announces
 * the exact command first (human → stderr), shells ONLY through the injected
 * ExecPort, and maps a failure via `classifyInstallFailure` (AC10).
 */
async function runNpmInstall(
  io: CliIo,
  deps: UpdateActDeps,
  commandName: string,
  installed: string,
  spec: string,
  installedAfter: string | null,
): Promise<BinaryOutcome> {
  const argv = npmInstallArgv(spec);
  const command = formatNpmCommand(argv);
  if (io.mode !== 'json') {
    io.writers.err(`harness ${commandName} — about to run:\n  ${command}\n`);
  }
  const result = await deps.exec.run('npm', argv, { cwd: deps.proc.cwd() });
  if (result.ok) {
    return {
      status: 'ok',
      data: { installed_before: installed, installed_after: installedAfter, command },
      next_action: `Done. Verify with \`harness --version\`${installedAfter ? ` (expecting ${installedAfter})` : ''}.`,
      summary: `${commandName}: ok${installedAfter ? ` (${installedAfter})` : ''}`,
      stdout: result.stdout,
    };
  }
  const failure = classifyInstallFailure(
    result,
    command,
    spec === 'latest' ? undefined : { pinned: spec },
  );
  return {
    status: 'error',
    data: { command },
    error: {
      code: failure.code,
      message: failure.message,
      details: { command, stderr_tail: result.stderr.slice(-MAX_STDERR_TAIL) },
    },
    next_action: failure.next_action,
    summary: `${commandName}: failed`,
    stderr: result.stderr,
  };
}

/** Emit a single binary envelope (self-install, and the update error-early path), then exit. */
function emitBinary(io: CliIo, deps: UpdateActDeps, commandName: string, o: BinaryOutcome): void {
  const jsonPort = () => createOutputPort('json', io.writers);
  if (o.status === 'error' && o.error) {
    const envelope = formatError(commandName, o.error.code, o.error.message, deps.clock, {
      next_action: o.next_action,
      details: o.error.details,
    });
    const port: OutputPort =
      io.mode === 'json'
        ? jsonPort()
        : {
            emit: (e) => {
              if (o.stderr?.trim()) io.writers.err(`${o.stderr.replace(/\n$/, '')}\n`);
              io.writers.err(`harness ${commandName}: ${e.error?.message ?? 'failed'}\n`);
              if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
            },
          };
    exitWithEnvelope(envelope, port);
    return;
  }
  const envelope = formatOk(commandName, o.data, deps.clock, { next_action: o.next_action });
  const port: OutputPort =
    io.mode === 'json'
      ? jsonPort()
      : {
          emit: () => {
            if (o.stdout?.trim()) io.writers.out(`${o.stdout.replace(/\n$/, '')}\n`);
            io.writers.out(`${o.summary}\n`);
          },
        };
  exitWithEnvelope(envelope, port);
}

/**
 * The skills half of `harness update`. With `--target` (and not `--check`) it
 * reconciles via the EXISTING skills-update path — refresh (`npx skills add`)
 * then prune the legacy slugs (`npx skills remove`), reusing the already-exported
 * helpers (KF-05). Refresh-fail ⇒ error; prune-fail ⇒ degraded. Without a target
 * (or under `--check`) it is REPORT-ONLY: it mutates nothing, lists the prune
 * candidates, and suggests the exact command (AC13/AC14).
 */
async function skillsOutcome(
  io: CliIo,
  deps: UpdateActDeps,
  opts: UpdateOpts,
  binaryUpgraded: boolean,
): Promise<SkillsOutcome> {
  const plans = opts.check ? [] : plansFor(deps, opts);
  const explicitTargets = (opts.target ?? []).length > 0;
  const reconcile = !opts.check && plans.length > 0;

  if (!reconcile) {
    return {
      status: 'ok',
      skills: {
        reconciled: false,
        prune_candidates: [...LEGACY_SKILL_SLUGS],
        suggested_command: 'harness skills update --target <cli>',
      },
      next_action: `To also refresh + prune this harness's skills, run: harness skills update --target <cli> (targets: ${KNOWN_SKILL_TARGETS.join(', ')}).`,
      summary: `skills: report-only — run \`harness skills update --target <cli>\` to refresh + prune (${LEGACY_SKILL_SLUGS.length} legacy slugs tracked)`,
    };
  }

  if (binaryUpgraded) {
    const commands: string[] = [];
    for (const plan of plans) {
      const args = planCommandArgs(plan);
      const command = `harness ${args.join(' ')}`;
      commands.push(command);
      if (io.mode !== 'json') {
        io.writers.err(`harness update — re-execing fresh binary for skills:\n  ${command}\n`);
      }
      const result = await deps.exec.run('harness', args, { cwd: deps.proc.cwd() });
      if (!result.ok) {
        return {
          status: 'error',
          skills: {
            reconciled: true,
            reexec: true,
            refreshed: false,
            pruned: false,
            targets: plan.targets,
            global: plan.global,
            source: plan.source,
            command,
            stderr_tail: result.stderr.slice(-MAX_STDERR_TAIL),
          },
          next_action: `Fresh-binary skills reconcile failed (exit ${result.code}). Re-run: ${command}`,
          summary: `skills: fresh-binary reconcile failed (${plan.targets.join(', ')})`,
        };
      }
    }
    const first = plans[0];
    return {
      status: 'ok',
      skills: {
        reconciled: true,
        reexec: true,
        refreshed: true,
        pruned: true,
        targets: first?.targets ?? [],
        global: first?.global ?? false,
        source: first?.source ?? PACKAGED_SKILLS_SOURCE,
        commands,
        ...(plans.length > 1 ? { plans } : {}),
      },
      next_action:
        'Skills reconciled by re-invoking the freshly-installed harness binary (fresh baked skills).',
      summary: `skills: reconciled via fresh binary (${plans
        .flatMap((p) => p.targets)
        .join(', ')})`,
    };
  }

  const outcomes: SkillsOutcome[] = [];
  for (const plan of plans) {
    const outcome = await reconcilePlanInProcess(io, deps, plan, explicitTargets);
    if (outcome.status === 'error') return outcome;
    outcomes.push(outcome);
  }

  if (outcomes.length === 1) return outcomes[0] as SkillsOutcome;

  const status = outcomes.reduce<Status>((acc, item) => worst(acc, item.status), 'ok');
  const plansData = outcomes.map((item) => item.skills);
  const targets = plans.flatMap((plan) => plan.targets);
  return {
    status,
    skills: {
      reconciled: true,
      refreshed: outcomes.every((item) => item.skills.refreshed === true),
      pruned: outcomes.every((item) => item.skills.pruned === true),
      targets,
      plans: plansData,
    },
    next_action:
      status === 'degraded'
        ? 'One or more skills prune steps failed; inspect skills.plans for the exact command to rerun.'
        : `Skills reconciled for ${targets.join(', ')} (refreshed + pruned).`,
    summary: `skills: reconciled (${targets.join(', ')})${status === 'degraded' ? '; prune incomplete' : ' — refreshed + pruned'}`,
  };
}

/** Compute the binary (CLI) outcome for the chosen mode (--check / --pin / bare). */
async function binaryOutcome(
  io: CliIo,
  deps: UpdateActDeps,
  installed: string,
  opts: UpdateOpts,
): Promise<BinaryOutcome> {
  const lookup = new NodeVersionLookup(deps.exec, PACKAGE_NAME, deps.proc.cwd());

  if (opts.check) {
    const result = await runCheck(
      { fs: deps.fs, env: deps.env, clock: deps.clock, lookup },
      installed,
      {
        force: true,
      },
    );
    const available = result.update_available !== null;
    return {
      status: 'ok',
      data: { installed, latest: result.latest, update_available: available },
      next_action: available
        ? `A newer version (${result.latest}) is available. Run \`harness update\` to upgrade.`
        : result.latest
          ? `You are on the latest version (${installed}).`
          : 'Could not determine the latest version (registry unreachable or auth missing).',
      summary: `update --check: installed ${installed}, latest ${result.latest ?? 'unknown'}${available ? ' — update available' : ''}`,
    };
  }

  if (opts.pin) {
    const spec = normalizePin(opts.pin);
    // --pin is for ONE concrete version (AC3). Reject dist-tags like `latest`/
    // `canary` — bare `harness update` is the way to track @latest (companion F005).
    if (!isValidVersion(spec)) {
      return {
        status: 'error',
        data: { pin: opts.pin },
        error: {
          code: ErrorCodes.INVALID_ARGS,
          message: `--pin needs a concrete version (e.g. v0.3.0), not '${opts.pin}'.`,
        },
        next_action: `Pass an exact version: harness update --pin v0.3.0 (run harness update --check for the latest, or bare harness update to track @latest).`,
        summary: `update --pin: invalid version '${opts.pin}'`,
      };
    }
    return runNpmInstall(io, deps, 'update', installed, spec, spec);
  }

  const result = await runCheck(
    { fs: deps.fs, env: deps.env, clock: deps.clock, lookup },
    installed,
    {
      force: true,
    },
  );
  if (result.latest && result.update_available === null) {
    const command = formatNpmCommand(npmInstallArgv('latest'));
    return {
      status: 'ok',
      data: {
        installed_before: installed,
        installed_after: installed,
        command,
        already_latest: true,
      },
      next_action: `Already on the latest version (${installed}).`,
      summary: `update: already on latest (${installed})`,
    };
  }
  return runNpmInstall(io, deps, 'update', installed, 'latest', result.latest);
}

/**
 * Register `harness update` (+ `--check` / `--pin` / `--target`) and `self-install`.
 * CORE commands that keep the globally-installed CLI current from the GitHub
 * Packages release (plan 018) AND reconcile this harness's skills. Every `update`
 * envelope carries a `skills` sub-object: report-only without `--target`,
 * refreshed+pruned with it. `installed` is the running version.
 */
export function registerUpdateAct(
  program: Command,
  io: CliIo,
  deps: UpdateActDeps,
  installed: string,
): void {
  program
    .command('update')
    .description(
      'Update the globally-installed harness CLI from the registry (and reconcile skills with --target)',
    )
    .option('--check', 'check for a newer version without installing (exit 0)')
    .option('--pin <version>', 'install one exact version (e.g. v0.3.0), not persisted')
    .option(
      '-t, --target <cli...>',
      `also reconcile skills for CLI target(s): ${KNOWN_SKILL_TARGETS.join(', ')}`,
    )
    .option('-g, --global', 'with --target: reconcile the global skills install')
    .action(async (opts: UpdateOpts) => {
      const binary = await binaryOutcome(io, deps, installed, opts);

      // Binary failure → pure error envelope; skip skills (fix the CLI update first).
      if (binary.status === 'error') {
        emitBinary(io, deps, 'update', binary);
        return;
      }

      const before = binary.data.installed_before;
      // U-1 (review 055): key the re-exec on "an install actually RAN", not a
      // version delta. A registry-lookup miss yields `installed_after: null`
      // even though `npm i -g @latest` still ran and upgraded the binary — a
      // `before !== after` test would then wrongly reconcile skills IN-PROCESS
      // (stale, from the pre-upgrade package). Only the already-latest early
      // return skips the install; every other non-error path installed one.
      const binaryUpgraded = binary.data.already_latest !== true && typeof before === 'string';
      const skills = await skillsOutcome(io, deps, opts, binaryUpgraded);
      const status = worst(binary.status, skills.status);
      const data = { ...binary.data, skills: skills.skills };
      const jsonPort = () => createOutputPort('json', io.writers);

      // Skills refresh failed → error/1 (AC14), with the combined data in details.
      if (status === 'error') {
        const envelope = formatError(
          'update',
          ErrorCodes.SKILLS_INSTALL_FAILED,
          'the CLI is current, but the skills refresh failed.',
          deps.clock,
          { next_action: skills.next_action, details: data },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? jsonPort()
            : {
                emit: (e) => {
                  io.writers.out(`${binary.summary}\n`);
                  io.writers.err(`harness update: ${e.error?.message ?? 'failed'}\n`);
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const next_action =
        status === 'degraded'
          ? skills.next_action
          : [binary.next_action, skills.next_action].filter(Boolean).join(' · ');
      const envelope =
        status === 'degraded'
          ? formatDegraded('update', data, next_action, deps.clock)
          : formatOk('update', data, deps.clock, { next_action });
      const port: OutputPort =
        io.mode === 'json'
          ? jsonPort()
          : {
              emit: () => {
                if (binary.stdout?.trim()) io.writers.out(`${binary.stdout.replace(/\n$/, '')}\n`);
                io.writers.out(`${binary.summary}\n`);
                io.writers.out(`${skills.summary}\n`);
                if (next_action) io.writers.err(`→ ${next_action}\n`);
              },
            };
      exitWithEnvelope(envelope, port);
    });

  program
    .command('self-install')
    .description('Install the harness CLI globally from the registry (first-time bootstrap)')
    .action(async () => {
      // Convenience global install from the public npm registry. A registry or
      // transport failure surfaces as a classified error + next_action via
      // classifyInstallFailure (AC4/AC10). No skills phase.
      const o = await runNpmInstall(io, deps, 'self-install', installed, 'latest', null);
      emitBinary(io, deps, 'self-install', o);
    });
}

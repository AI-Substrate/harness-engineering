import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { NodeDb } from '../adapters/db/node-db.js';
import { NodeEnv } from '../adapters/env/node-env.js';
import { NodeExec } from '../adapters/exec/node-exec.js';
import { NodeExecutableBit } from '../adapters/fs/node-executable-bit.js';
import { NodeFs } from '../adapters/fs/node-fs.js';
import { NodePathKind } from '../adapters/fs/node-path-kind.js';
import { ExecGit } from '../adapters/git/exec-git.js';
import { ExecGitAttribution } from '../adapters/git/exec-git-attribution.js';
import { NodeHash } from '../adapters/hash/node-hash.js';
import { NodeDownload } from '../adapters/http/node-download.js';
import { NodeSocketProbe } from '../adapters/net/node-socket-probe.js';
import type { SocketProbePort, SocketRelayPort } from '../adapters/net/socket-probe-port.js';
import { NodeProcess } from '../adapters/process/node-process.js';
import { formatDegraded, formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { readIngress } from '../services/doctor/collector/ingress.js';
import { installCollector, recheckCollector } from '../services/doctor/collector/install.js';
import { telemetryNudge } from '../services/doctor/collector/nudge.js';
import { regenerateGitAiPin } from '../services/doctor/collector/regenerate.js';
import type { CollectorDeps, HostTarget } from '../services/doctor/collector/types.js';
import {
  buildDoctorReport,
  doctorEnvelope,
  renderDoctorText,
} from '../services/doctor/doctor-service.js';
import type { VerbRegistry } from '../services/extensions/registry.js';
import type { RecordRegistry } from '../services/record/registry.js';
import { toPosix } from '../services/shared/posix-path.js';
import { readVersion } from '../version.js';

/**
 * The host the git-ai collector resolves against.
 *
 * `process.platform`/`process.arch` are read HERE, in the composition root,
 * because services may not touch the global process object (P2). `home` is the
 * one thing that can be genuinely missing; without it nothing about the
 * collector can be located, so the row is omitted rather than reported against a
 * guessed path.
 */
function collectorHostTarget(env: NodeEnv): HostTarget | undefined {
  const home = env.home();
  if (home === undefined || home.trim() === '') return undefined;
  const claudeConfigDir = env.get('CLAUDE_CONFIG_DIR');
  return {
    platform: process.platform,
    arch: process.arch,
    home: toPosix(home),
    ...(claudeConfigDir !== undefined && claudeConfigDir.trim() !== ''
      ? { claudeConfigDir: toPosix(claudeConfigDir) }
      : {}),
  };
}

/** The real collector lifecycle dependencies — network, exec, hash, mode bit. */
function realCollectorDeps(host: HostTarget, cwd: string): CollectorDeps {
  return {
    fs: new NodeFs(),
    paths: new NodePathKind(),
    hash: new NodeHash(),
    http: new NodeDownload(),
    exec: new NodeExec(),
    exe: new NodeExecutableBit(),
    clock: new SystemClock(),
    host,
    cwd,
  };
}

/**
 * Test-injectable sockets. TWO fields, not one, because the split IS ac-0007:
 * the report path is handed the PROBE only and structurally cannot replay, while
 * the nudge — the one mutating verb — is the only thing that gets a relay.
 */
export interface SocketOverrides {
  probe: SocketProbePort;
  relay?: SocketRelayPort;
}

interface CollectorOptions {
  installCollector?: boolean;
  recheckCollector?: boolean;
  regenerateCollectorPin?: string;
  pinOut?: string;
}

/**
 * Register the `doctor` command — safe to run at session start. Constructs the
 * real adapters, injects them + the verb registry + the merged record registry
 * (provided by the composition root) into the doctor service, and renders: human
 * mode writes the layered report to stderr + a summary to stdout; JSON mode emits
 * the envelope to stdout. Always exits 0 (reporting succeeded). `doctor`
 * enumerates extensions + record types (P7) without invoking any handler — and is
 * itself a CORE command, never an extension.
 *
 * The git-ai collector (plan 073) rides on this command in two distinct modes,
 * and the distinction is load-bearing:
 *
 * - **the report** always includes the `gitai-collector` row, which is a pure
 *   filesystem read of the state the install path wrote down. It invokes
 *   nothing, so P7 still holds for a bare `harness doctor`.
 * - **the lifecycle flags** (`--install-collector`, `--recheck-collector`,
 *   `--regenerate-collector-pin`) are the ONLY way anything is downloaded,
 *   executed or written. They are explicit, never implied by a plain run, and
 *   each emits its own envelope instead of the report.
 *
 * `collectorOverride` exists so an act-level test can drive the whole lifecycle
 * through offline fakes — no network, no git-ai, no daemon — which is the only
 * honest way to prove this wiring in CI.
 *
 * `sockets` exists for the same reason and closes the same gap one level
 * down (review F006): without it this act always constructed the REAL
 * {@link NodeSocketProbe}, so on any developer or CI machine whose global
 * `trace2.eventTarget` happens to be an `af_unix` path, a plain act test would
 * perform a genuine `net.createConnection`. That makes the suite
 * environment-dependent — the exact thing ac-000a forbids — so the seam is
 * production-default, test-injectable.
 */
export function registerDoctorAct(
  program: Command,
  io: CliIo,
  registry: VerbRegistry,
  recordRegistry?: RecordRegistry,
  collectorOverride?: CollectorDeps,
  sockets?: SocketOverrides,
): void {
  const doctor = program
    .command('doctor')
    .description('Report what is configured + which extensions loaded (safe at session start)')
    .option(
      '--install-collector',
      'Fetch + SHA-256-verify the pinned git-ai release and install its agent hooks (guards run first)',
    )
    .option(
      '--recheck-collector',
      'Re-run the hook install for coding harnesses that appeared since the last one (guards run again)',
    )
    .option(
      '--regenerate-collector-pin <version>',
      'Maintainer: hash all six published artifacts for a git-ai release tag and print the new pin source',
    )
    .option('--pin-out <path>', 'Write the regenerated pin source to this path instead of stdout')
    // Returns a PROMISE on both branches now (plan 074): the ingress probe is a
    // socket connect, which cannot be synchronous. The composition root parses
    // with `parseAsync` and awaits, so `exitWithEnvelope`'s process-exit is
    // reached exactly as before; a test driving this act must use `parseAsync`
    // too. The lifecycle branch was already async for the same reason.
    .action((opts: CollectorOptions): Promise<void> => {
      const clock = new SystemClock();
      const env = new NodeEnv();
      const proc = new NodeProcess();
      const host = collectorOverride?.host ?? collectorHostTarget(env);

      const wantsLifecycle =
        opts.installCollector === true ||
        opts.recheckCollector === true ||
        opts.regenerateCollectorPin !== undefined;

      if (wantsLifecycle) {
        if (host === undefined) {
          exitWithEnvelope(
            formatError(
              'doctor',
              ErrorCodes.DOCTOR_CHECK_FAILED,
              'no home directory is visible to this process, so the git-ai collector cannot be located',
              clock,
              { next_action: 'Set HOME (or USERPROFILE on Windows) and re-run.' },
            ),
            lifecyclePort(io),
          );
        }
        return runCollectorLifecycle(
          opts,
          collectorOverride ?? realCollectorDeps(host as HostTarget, toPosix(proc.cwd())),
          clock,
          io,
        );
      }
      return runReport();

      async function runReport(): Promise<void> {
        const fs = new NodeFs();
        const git = new ExecGit();
        const cwd = toPosix(proc.cwd());
        const attribution = new ExecGitAttribution(cwd);
        // ONE probe per doctor run, taken here in the composition root because a
        // socket connect is async and the report is a pure sync function of its
        // inputs (plan 074 · ac-0002). READ-ONLY: `NodeSocketProbe.probe`
        // connects and destroys without sending a byte, and doctor is handed the
        // PROBE port only — never the relay — so a bare doctor run structurally
        // cannot replay anything (ac-0007).
        const ingress = await readIngress({
          git: attribution,
          probe: sockets?.probe ?? new NodeSocketProbe(),
          fs,
          env,
        });
        const report = buildDoctorReport(
          {
            fs,
            proc,
            git,
            env,
            clock,
            runningVersion: readVersion(),
            // plan 070 — doctor asks the reconciler whether each owed capture lane
            // can actually be paid back. The adapter registry is the service's own
            // default (a caller cannot forget it and raise a false alarm); the db is
            // a port, so it is injected here — giving doctor the SAME sources sync
            // will use is what keeps its verdict from disagreeing with the recovery.
            db: new NodeDb(),
            // plan 073 — the collector row, wired by DEFAULT. A doctor that omits
            // it is indistinguishable from one that has no collector feature, and
            // "nothing is collecting your AI attribution" is the single thing this
            // row exists to be able to say.
            ...(host !== undefined ? { collectorHost: host } : {}),
            hash: new NodeHash(),
            ingress,
            // plan 074 · ac-0003 — the at-risk row, and ONLY inside a repo: a
            // window over a history that does not exist would report "unproven"
            // forever on every non-repo directory, which teaches operators to
            // ignore the row that matters most.
            ...(git.isRepo() ? { attribution } : {}),
          },
          registry,
          recordRegistry,
        );
        const envelope = doctorEnvelope(report, clock, io.quiet === true);
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(renderDoctorText(report));
                  io.writers.out(`doctor: ${e.status}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
      }
    });

  registerTelemetryNudge(doctor, io, sockets);
}

/**
 * `harness doctor telemetry-nudge` (plan 074 · ac-0006) — the RECOVERY verb.
 *
 * A subcommand of `doctor` and not a flag on it, because the distinction is the
 * whole of ac-0007: a bare `doctor` run is read-only and must stay so, while
 * this MUTATES — it rotates a buffer, writes into a socket, and can delete a
 * segment. Making recovery a separate, explicitly-typed verb is what keeps the
 * diagnostic honest about being a diagnostic.
 */
function registerTelemetryNudge(doctor: Command, io: CliIo, sockets?: SocketOverrides): void {
  doctor
    .command('telemetry-nudge')
    .description(
      'Replay buffered trace2 events into the git-ai collector (rotate → replay → confirm). Run from an UNSANDBOXED shell.',
    )
    .option(
      '--buffer <path>',
      'Replay this file instead of the default harness buffer (use it to retry a retained segment)',
    )
    .action(async (opts: { buffer?: string }): Promise<void> => {
      const clock = new SystemClock();
      const proc = new NodeProcess();
      const fs = new NodeFs();
      const cwd = toPosix(proc.cwd());
      const attribution = new ExecGitAttribution(cwd);
      const probe = sockets?.probe ?? new NodeSocketProbe();
      const relay = sockets?.relay ?? new NodeSocketProbe();
      const ingress = await readIngress({
        git: attribution,
        probe,
        fs,
        env: new NodeEnv(),
      });
      const outcome = await telemetryNudge({
        fs,
        proc,
        clock,
        relay,
        git: attribution,
        ingress,
        ...(opts.buffer !== undefined ? { bufferPath: toPosix(opts.buffer) } : {}),
      });
      // NEVER fails the run (ac-0006): a nudge that found nothing to do, or that
      // could not reach the ingress, is a report — not an error.
      const evidence = [
        outcome.segment === null
          ? { label: 'trace2 segment', none: true }
          : { label: `trace2 segment ${outcome.segment}` },
      ];
      const envelope =
        outcome.status === 'replayed'
          ? formatOk('doctor telemetry-nudge', outcome, clock, { evidence })
          : formatDegraded(
              'doctor telemetry-nudge',
              outcome,
              outcome.next_action ??
                'Nothing to recover here; re-run after a commit made through a blocked ingress.',
              clock,
              { evidence },
            );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: (e) => {
                io.writers.err(`${outcome.detail}\n`);
                if (outcome.next_action !== undefined) {
                  io.writers.err(`→ ${outcome.next_action}\n`);
                }
                io.writers.out(`telemetry-nudge: ${e.status}\n`);
              },
            };
      exitWithEnvelope(envelope, port);
    });
}

/** Human mode prints the lifecycle's own prose; JSON mode gets the envelope. */
function lifecyclePort(io: CliIo): OutputPort {
  return io.mode === 'json'
    ? createOutputPort('json', io.writers)
    : {
        emit: (e) => {
          const data = e.data as { text?: string } | undefined;
          io.writers.err(data?.text ?? `${e.next_action ?? ''}\n`);
          io.writers.out(`doctor: ${e.status}\n`);
        },
      };
}

/** Render one titled block of lines, or nothing at all when there are none. */
function renderLines(title: string, lines: readonly string[]): string {
  if (lines.length === 0) return '';
  return `${title}\n${lines.map((line) => `  ${line}`).join('\n')}\n`;
}

/**
 * The three lifecycle actions. Each emits its OWN envelope: these invoke things,
 * so folding their outcome into the doctor report would make the report a liar
 * about being read-only.
 */
async function runCollectorLifecycle(
  opts: CollectorOptions,
  deps: CollectorDeps,
  clock: SystemClock,
  io: CliIo,
): Promise<void> {
  const port = lifecyclePort(io);

  if (opts.regenerateCollectorPin !== undefined) {
    const result = await regenerateGitAiPin(
      { http: deps.http, hash: deps.hash },
      { version: opts.regenerateCollectorPin },
    );
    if (!result.ok) {
      exitWithEnvelope(
        formatError(
          'doctor',
          ErrorCodes.DOCTOR_CHECK_FAILED,
          `pin regeneration ABORTED — ${result.failures
            .map((failure) => `${failure.key} (${failure.file}): ${failure.reason}`)
            .join('; ')}`,
          clock,
          {
            next_action:
              'All six artifacts must hash before the pin moves; nothing was written. Fix the fetch and re-run.',
          },
        ),
        port,
      );
      return;
    }
    const written =
      opts.pinOut !== undefined && opts.pinOut.trim() !== ''
        ? (deps.fs.writeText(opts.pinOut, result.source), opts.pinOut)
        : null;
    exitWithEnvelope(
      formatOk(
        'doctor',
        {
          action: 'regenerate-collector-pin',
          version: result.version,
          digests: result.digests,
          written,
          text: written === null ? result.source : `pin written to ${written}\n`,
        },
        clock,
        {
          next_action:
            written === null
              ? 'Replace src/services/doctor/collector/pin.ts with the printed source and review all six digests.'
              : `Move ${written} over src/services/doctor/collector/pin.ts and review all six digests.`,
        },
      ),
      port,
    );
    return;
  }

  if (opts.recheckCollector === true) {
    const result = await recheckCollector(deps);
    // Two fields on purpose: `hooks` is what THIS attempt did, `coverage` is what
    // the machine has. A guard that refused to invoke git-ai changes the first
    // and must not change the second (phase-1 review, round 3).
    const data = {
      action: 'recheck-collector',
      newAgents: result.newAgents,
      hooks: result.hooks,
      coverage: result.coverage,
      warnings: result.warnings,
      manual: result.manualInstructions,
      text: `${[
        `new coding harnesses since the last hook install: ${
          result.newAgents.length === 0 ? '(none)' : result.newAgents.join(', ')
        }`,
        `hooks still installed for: ${
          result.coverage.agents.length === 0 ? '(none)' : result.coverage.agents.join(', ')
        }`,
        renderLines('warnings:', result.warnings),
        renderLines('to do this yourself:', result.manualInstructions),
      ]
        .filter((part) => part !== '')
        .join('\n')}\n`,
    };
    exitWithEnvelope(
      result.warnings.length === 0
        ? formatOk('doctor', data, clock)
        : formatDegraded(
            'doctor',
            data,
            result.manualInstructions.length > 0
              ? 'Hooks were NOT added for the new harness (existing hooks are unaffected) — follow the printed manual steps, then re-run `harness doctor`.'
              : 'Read the warnings above, then re-run `harness doctor` to see the collector row.',
            clock,
          ),
      port,
    );
    return;
  }

  const result = await installCollector(deps);
  const data = {
    action: 'install-collector',
    cli: result.cli,
    hooks: result.hooks,
    warnings: result.warnings,
    disclosures: result.disclosures,
    manual: result.manualInstructions,
    text: `${[
      `git-ai CLI: ${result.cli}`,
      `git-ai hooks: ${result.hooks}`,
      renderLines('what install-hooks changes (disclosed up front):', result.disclosures),
      renderLines('warnings:', result.warnings),
      renderLines('to do this yourself:', result.manualInstructions),
    ]
      .filter((part) => part !== '')
      .join('\n')}\n`,
  };

  if (result.cli === 'failed' || result.cli === 'unsupported-platform') {
    exitWithEnvelope(
      formatError(
        'doctor',
        ErrorCodes.DOCTOR_CHECK_FAILED,
        `the pinned git-ai CLI was not installed (${result.cli}) — ${result.warnings.join('; ')}`,
        clock,
        { next_action: 'Nothing was placed on disk. Re-run once the cause above is addressed.' },
      ),
      port,
    );
    return;
  }
  exitWithEnvelope(
    result.hooks === 'installed'
      ? formatOk('doctor', data, clock)
      : formatDegraded(
          'doctor',
          data,
          'The pinned CLI is installed, but the hooks are not — read the warnings above; nothing of yours was deleted.',
          clock,
        ),
    port,
  );
}

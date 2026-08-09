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
import {
  autoInstallCollector,
  COLLECTOR_OPT_OUT_ENV,
} from '../services/doctor/collector/auto-install.js';
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
import { readEnvOverrides } from '../services/hooks/agent-matrix.js';
import { autoInstallHooks } from '../services/hooks/hooks-verbs.js';
import type { RecordRegistry } from '../services/record/registry.js';
import { toPosix } from '../services/shared/posix-path.js';
import { readVersion } from '../version.js';
import { hooksDeps } from './hooks.js';

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
    // Every override the MATRIX declares, so backup and install resolve alike.
    envOverrides: readEnvOverrides((n) => env.get(n)),
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
 * - **the report** always includes the `gitai-collector` row. Since plan 077 a
 *   bare run also AUTO-INSTALLS the collector when it is missing or incomplete
 *   (packet §3a): the customer must have telemetry working without customising
 *   their machine, and "re-run with `--install-collector`" is a customisation
 *   task with an apologetic tone. It installs, then reports what it did.
 * - **the lifecycle flags** (`--install-collector`, `--recheck-collector`,
 *   `--regenerate-collector-pin`) remain the explicit overrides, and each emits
 *   its own envelope instead of the report.
 *
 * WHAT DID NOT CHANGE, because two places in this file used to assert it more
 * broadly than plan 074 ever did: ac-0007 is about the RECOVERY path — no bare
 * doctor or checks run mutates a SOCKET, a BUFFER, or a REF. That still holds,
 * and still by construction: this act is handed the probe port and never the
 * relay, so it cannot replay a buffered event or write a note however the
 * install path behaves. A bare doctor is no longer read-only with respect to
 * your machine's telemetry SETUP; it is still read-only with respect to your
 * git history.
 *
 * `collectorOverride` exists so an act-level test can drive the whole lifecycle
 * through offline fakes — no network, no git-ai, no daemon — which is the only
 * honest way to prove this wiring in CI. Since plan 077 it also governs the
 * auto-install, so a test run cannot reach the network by default.
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
  /**
   * Opt IN to the plan-077 auto-install. DEFAULTS TO FALSE, and the default is
   * the whole point.
   *
   * The production composition root and the act tests both call this with
   * `collectorOverride` undefined, so there is no way to tell them apart from
   * in here. An auto-install that defaulted ON would therefore run inside the
   * unit suite with REAL deps — downloading a release and invoking
   * `install-hooks` machine-wide on whatever box ran `vitest`. That is a
   * hermeticity violation of exactly the shape review F006 found for the socket
   * probe (ac-000a), except the blast radius is an install rather than a
   * connect.
   *
   * It went undetected locally precisely because this machine already has a
   * healthy collector, so the install path short-circuited and the suite stayed
   * green. A machine WITHOUT git-ai would have been silently modified by its own
   * test run. So the safe value is the default and production says otherwise
   * explicitly.
   */
  autoInstall = false,
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
        // AUTO-INSTALL (plan 077 · packet §3a), BEFORE the report is built so the
        // rows describe the machine as it now is rather than as it was a
        // moment ago. `autoInstallCollector` never throws and never returns a
        // reason to exit non-zero: telemetry setup must not break a command the
        // developer ran for an unrelated reason.
        //
        // Skipped entirely when the host has no home directory — the collector
        // cannot be located, and the report says so through its own row.
        const auto =
          host === undefined || !autoInstall
            ? null
            : await autoInstallCollector(
                collectorOverride ?? realCollectorDeps(host, toPosix(proc.cwd())),
                // The composition root reads the global, never the service (P2).
                env.get(COLLECTOR_OPT_OUT_ENV) === '1',
              );
        // OUR AGENT HOOKS, alongside the collector and with the SAME posture
        // (plan 082 tk-0002). Warn-only: it never throws, never changes the exit
        // code, and never suppresses a doctor row. A doctor that dies on our
        // optional step is worse than one that never had it — the operator ran it
        // to diagnose something else, and every other row is what they came for.
        //
        // It is NEVER SILENT, though: a swallowed failure means the machine now
        // differs from what the operator believes and nothing said so. Failures
        // come back as warnings and are printed beside the collector's.
        //
        // Composed through the hooks act's OWN `hooksDeps`, never a second copy:
        // doctor building its own would be free to resolve a different binary path
        // or home, and the config written on first run would then differ from the
        // one `harness hooks status` reads back.
        const hooks = !autoInstall ? null : autoInstallHooks(hooksDeps({ fs, clock, env }));
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
            collectorOptedOut: env.get(COLLECTOR_OPT_OUT_ENV) === '1',
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
        const base = doctorEnvelope(report, clock, io.quiet === true);
        // VISIBLE ON BOTH SURFACES, and the JSON one is not an afterthought: an
        // agent reads `doctor --json`, and a warning that exists only in the text
        // render is swallowed for exactly the reader most likely to act on it.
        //
        // Carried BESIDE the report rather than as a doctor LAYER, deliberately. A
        // failing layer flips the envelope to `degraded`, and our optional step must
        // not change the verdict on the machine's readiness — that is the same
        // never-break-the-command posture as exit 0, applied to the envelope.
        const envelope =
          hooks === null || hooks.action === 'not-needed'
            ? base
            : { ...base, data: { ...(base.data as Record<string, unknown>), agentHooks: hooks } };
        // TELL, DON'T ASK (packet §3a). An install the operator was never told
        // about is worse than one that did not happen: it changed their machine
        // and left them no way to know. Emitted on the text surface alongside
        // the report, and carried in the envelope for the JSON surface.
        const announcement =
          auto === null || auto.action === 'not-needed'
            ? null
            : [`git-ai collector: ${auto.detail}`, ...auto.warnings.map((w) => `  - ${w}`)].join(
                '\n',
              );
        const hooksAnnouncement =
          hooks === null || hooks.action === 'not-needed'
            ? null
            : [hooks.detail, ...hooks.warnings.map((w) => `  - ${w}`)].join('\n');
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(renderDoctorText(report));
                  if (announcement !== null) io.writers.err(`${announcement}\n`);
                  if (hooksAnnouncement !== null) io.writers.err(`${hooksAnnouncement}\n`);
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
 * whole of ac-0007: this MUTATES THE RECORD — it rotates a buffer, writes into a
 * socket, and can delete a segment — while a bare `doctor` run never touches a
 * socket, a buffer, or a ref. Making recovery a separate, explicitly-typed verb
 * is what keeps the diagnostic honest about being a diagnostic.
 *
 * THE SCOPE OF THAT SENTENCE NARROWED IN PLAN 077, and saying "a bare doctor is
 * read-only" flatly is now false (P2 of the cross-model review, 2026-08-09). A
 * bare doctor MAY place the pinned CLI, rewrite agent configs through
 * `install-hooks`, and reset an observed-empty global trace2 section. ac-0007
 * remains satisfied on its own terms — its subject is the socket/buffer/ref
 * triple, and doctor is still handed the PROBE port and never the relay, so it
 * structurally cannot replay an event or write a note. But the guarantee is now
 * "read-only with respect to your git HISTORY", not "read-only", and the two
 * were being used interchangeably in prose that a reader would take literally.
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
        // The composition root reads the global, never the service (P2). The
        // drain path's own default is the same value; passing it explicitly
        // keeps the guard visible at the wiring layer too (plan 075 · ac-0006).
        platform: process.platform,
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
 * The three lifecycle actions. Each emits its OWN envelope rather than folding
 * its outcome into the doctor report — an envelope that says what was INVOKED is
 * a different kind of statement from one that says what was OBSERVED, and
 * merging them loses which is which.
 *
 * This used to be justified as "the report would be a liar about being
 * read-only". That reason expired in plan 077: the report is now built AFTER an
 * automatic install on a bare run, so it already describes a machine harness
 * just changed. The separation is still right, for the reason above.
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
    let written: string | null = null;
    if (opts.pinOut !== undefined && opts.pinOut.trim() !== '') {
      deps.fs.writeText(opts.pinOut, result.source);
      written = opts.pinOut;
    }
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

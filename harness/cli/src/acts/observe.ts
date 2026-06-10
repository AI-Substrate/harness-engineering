import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { type Envelope, formatError, formatOk, formatUnconfigured } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { OBSERVATION_KINDS, OBSERVATION_SEVERITIES } from '../services/observe/buffer-codec.js';
import {
  captureObservation,
  clearObservations,
  listObservations,
  type ObserveDeps,
  type ObserveFailure,
} from '../services/observe/observe-service.js';

/** The ports the `observe` act injects into the observe service (a subset of VerbActDeps). */
export interface ObserveActDeps {
  fs: FsPort;
  proc: ProcessPort;
  clock: Clock;
  env: EnvPort;
}

interface ObserveOpts {
  kind?: string;
  target?: string;
  severity?: string;
  workaround?: string;
  suggestedEncoding?: string;
  agent?: string;
  list?: boolean;
  clear?: boolean;
}

/**
 * Register the `observe` command — CLI-owned in-flight friction capture into the
 * gitignored transient buffer (`.harness/temp/<bucket>/session-buffer.md`), plus
 * the `--list`/`--clear` drain surface that sweeps ALL buckets by default
 * (plan 015 D-12). A CORE command (reserved, like `record`/`instructions`). It
 * owns no business logic — `observe-service` resolves identity, validates,
 * assigns IDs, and appends; this act maps outcomes onto the Envelope + exit code
 * (ok → 0, unconfigured → 2, error → 1).
 */
export function registerObserveAct(program: Command, io: CliIo, deps: ObserveActDeps): void {
  const kinds = Object.keys(OBSERVATION_KINDS).join(' | ');
  program
    .command('observe')
    .description(
      'Capture one friction observation to the gitignored transient buffer (.harness/temp/)',
    )
    .argument('[description]', 'what you noticed (>=10 chars); omit with --list/--clear')
    .option('--kind <kind>', `entry kind: ${kinds}`)
    .option('--target <target>', 'free-form target, e.g. tooling | project-sensor | skill')
    .option('--severity <severity>', `severity: ${OBSERVATION_SEVERITIES.join(' | ')}`)
    .option('--workaround <text>', 'what you did to get past it')
    .option('--suggested-encoding <text>', 'a hint for the retro drain encoding flow')
    .option('--agent <slug>', 'bucket override (else HARNESS_AGENT env, else "agent")')
    .option('--list', 'list pending observations (all buckets by default)')
    .option('--clear', 'truncate pending observations (all buckets by default; files kept)')
    .action((description: string | undefined, opts: ObserveOpts) => {
      const serviceDeps: ObserveDeps = deps;

      if (opts.list) {
        const outcome = listObservations({ agent: opts.agent }, serviceDeps);
        if (!outcome.ok) {
          exitWithEnvelope(failureEnvelope(outcome, deps.clock), portFor(io, 'list'));
          return;
        }
        const envelope = formatOk(
          'observe',
          {
            observations: outcome.observations,
            buckets_scanned: outcome.buckets_scanned,
            malformed_skipped: outcome.malformed_skipped,
          },
          deps.clock,
          {
            next_action:
              'Drain: save what matters via `harness record retro`, then `harness observe --clear`.',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: () => {
                  for (const o of outcome.observations) {
                    io.writers.out(
                      `[${o.kind}${o.target ? `/${o.target}` : ''}] ${o.bucket}:${o.id} ${o.description}\n`,
                    );
                  }
                  io.writers.out(
                    `observe: ${outcome.observations.length} pending across ${outcome.buckets_scanned.length} bucket(s)` +
                      `${outcome.malformed_skipped > 0 ? `, ${outcome.malformed_skipped} malformed skipped` : ''}\n`,
                  );
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      if (opts.clear) {
        const outcome = clearObservations({ agent: opts.agent }, serviceDeps);
        if (!outcome.ok) {
          exitWithEnvelope(failureEnvelope(outcome, deps.clock), portFor(io, 'clear'));
          return;
        }
        const envelope = formatOk(
          'observe',
          {
            cleared: outcome.cleared,
            buckets_scanned: outcome.buckets_scanned,
            malformed_skipped: outcome.malformed_skipped,
          },
          deps.clock,
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: () => {
                  io.writers.out(`observe: cleared ${outcome.cleared} entr(y/ies)\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const outcome = captureObservation(
        {
          description,
          kind: opts.kind,
          target: opts.target,
          severity: opts.severity,
          workaround: opts.workaround,
          suggestedEncoding: opts.suggestedEncoding,
          agent: opts.agent,
        },
        serviceDeps,
      );
      if (!outcome.ok) {
        exitWithEnvelope(failureEnvelope(outcome, deps.clock), portFor(io, 'capture'));
        return;
      }
      const envelope = formatOk(
        'observe',
        { bucket: outcome.bucket, id: outcome.id, kind: outcome.kind, path: outcome.path },
        deps.clock,
        {
          evidence: [{ label: 'observation buffer', path: outcome.path }],
          next_action:
            'Keep working — drain at session end with `harness observe --list` then `harness record retro`.',
        },
      );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                io.writers.out(`Captured ${outcome.id} → ${outcome.path}\n`);
                io.writers.out('observe: ok\n');
              },
            };
      exitWithEnvelope(envelope, port);
    });
}

/** Map a service failure onto the canonical envelope (unconfigured → 2, error → 1). */
function failureEnvelope(outcome: ObserveFailure, clock: Clock): Envelope {
  return outcome.status === 'unconfigured'
    ? formatUnconfigured('observe', outcome.next_action, clock)
    : formatError('observe', outcome.code ?? ErrorCodes.UNKNOWN, outcome.message, clock, {
        next_action: outcome.next_action,
      });
}

/** Human-mode failure port (JSON mode uses the standard port). */
function portFor(io: CliIo, what: string): OutputPort {
  return io.mode === 'json'
    ? createOutputPort('json', io.writers)
    : {
        emit: (e) => {
          io.writers.err(`harness observe: ${e.error?.message ?? e.next_action ?? 'failed'}\n`);
          if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
          io.writers.out(`observe (${what}): ${e.status}\n`);
        },
      };
}

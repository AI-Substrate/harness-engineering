import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { GitWritePort } from '../adapters/git/git-write-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { getSessionEvidence } from '../services/telemetry/session-evidence.js';
import { syncTelemetry } from '../services/telemetry/sync-service.js';

/** The ports the `telemetry` act injects into the sync service (a subset of VerbActDeps). */
export interface TelemetryActDeps {
  fs: FsPort;
  proc: ProcessPort;
  clock: Clock;
  env: EnvPort;
  /** The git WRITE plumbing (orphan-ref flush) — injected by the composition root (never built here). */
  gitWrite: GitWritePort;
}

/**
 * Register the `telemetry` command family (plan 034 Phase 4). A CORE command
 * (reserved, like `flow`/`record`/`observe`) mirroring the `flow` family shape.
 * Its `sync` verb flushes the gitignored telemetry buffer to per-(date,session)
 * shard refs under `refs/harness-telemetry/` via plumbing — no business logic
 * here; `sync-service` does the work, this maps the outcome onto the Envelope +
 * exit code (ok → 0; a failed shard push / ref-update → error exit 1, the buffer
 * left intact for retry).
 */
export function registerTelemetryAct(program: Command, io: CliIo, deps: TelemetryActDeps): void {
  const telemetry = program
    .command('telemetry')
    .description(
      'Telemetry — flush counts-only segments to dated refs (`sync`) and read a pij session’s evidence (`get`)',
    );

  telemetry
    .command('sync')
    .description(
      'Flush buffered telemetry to refs/harness-telemetry/<date>/<session> shards (best-effort per-shard push)',
    )
    .action(() => {
      const result = syncTelemetry({
        fs: deps.fs,
        env: deps.env,
        proc: deps.proc,
        git: deps.gitWrite,
      });

      if (!result.ok) {
        const envelope = formatError(
          'telemetry',
          ErrorCodes.UNKNOWN,
          result.message ?? 'telemetry sync failed',
          deps.clock,
          {
            next_action:
              'Sync is best-effort; the buffer is intact and will retry on the next `harness telemetry sync`.',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(`harness telemetry sync: ${e.error?.message ?? 'failed'}\n`);
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const envelope = formatOk(
        'telemetry',
        {
          synced: result.segments,
          sessions: result.sessions,
          pushed: result.pushed,
          plans: result.plans,
        },
        deps.clock,
        {
          next_action:
            result.segments === 0
              ? 'Nothing buffered to flush.'
              : 'Segments flushed to refs/harness-telemetry/<date>/<session>; the scraper fetches refs/harness-telemetry/* in one pass.',
        },
      );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                io.writers.out(
                  result.segments === 0
                    ? 'telemetry sync: nothing to flush\n'
                    : `telemetry sync: flushed ${result.segments} segment(s) across ${result.sessions} session(s)${result.pushed ? ' and pushed' : ''}\n`,
                );
              },
            };
      exitWithEnvelope(envelope, port);
    });

  telemetry
    .command('get')
    .description(
      "Read a pij session's telemetry into a normalized, counts-only evidence object (the conformance scorer's telemetry lane)",
    )
    .argument('<pij-session-id>', 'The pij session id whose telemetry to resolve')
    .option(
      '--worktree <path>',
      'Worktree root whose buffer to read (overrides pij-folder resolution)',
    )
    .action(async (pijSessionId: string, options: { worktree?: string }) => {
      const evidence = await getSessionEvidence(
        pijSessionId,
        { fs: deps.fs, env: deps.env, proc: deps.proc },
        options.worktree ? { worktree: options.worktree } : undefined,
      );

      // Unknown id → honest error envelope (exit 1); the buffer is never mutated.
      if (evidence === null) {
        const envelope = formatError(
          'telemetry',
          ErrorCodes.UNKNOWN,
          `no telemetry found for pij session '${pijSessionId}'`,
          deps.clock,
          {
            next_action:
              'Check the id (`pij list`); telemetry is captured per command — run a harness command in that session, then retry. Use --worktree <path> if it ran from a git worktree.',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(`harness telemetry get: ${e.error?.message ?? 'not found'}\n`);
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const envelope = formatOk('telemetry', evidence, deps.clock, {
        next_action:
          'Counts-only evidence derived from the session event stream; the conformance scorer consumes it as its telemetry lane.',
      });
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                const gaps = evidence.gaps.length ? `, gaps: ${evidence.gaps.join(',')}` : '';
                io.writers.out(
                  `telemetry get: ${evidence.segments} segment(s), ${evidence.skill_order.length} skill(s), ${Object.keys(evidence.tools).length} tool(s)${gaps}\n`,
                );
              },
            };
      exitWithEnvelope(envelope, port);
    });
}

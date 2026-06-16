import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { GitPort } from '../adapters/git/git-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { type Envelope, formatError, formatOk, formatUnconfigured } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { createRecord } from '../services/record/record-service.js';
import type { RecordRegistry } from '../services/record/registry.js';

/** The ports the `record` act injects into the record service (a subset of VerbActDeps). */
export interface RecordActDeps {
  fs: FsPort;
  proc: ProcessPort;
  clock: Clock;
  /** Provenance `branch` + `repo` — forwarded to the record service. */
  git: GitPort;
  /** Provenance `agent` + `plan_id` — forwarded to the record service. */
  env: EnvPort;
}

interface RecordOpts {
  slug?: string;
  list?: boolean;
}

/**
 * Register the `record` command — scaffolds a record file from a record type's
 * template into `.harness/records/<type>/` and returns its path for the calling
 * agent to fill. A CORE command (reserved, like `help`/`doctor`/`new`/`docs`/
 * `skills`; runs even in `--no-extensions` mode). It owns no business logic — the
 * `record-service` resolves the type + path + writes, and this act maps the
 * outcome onto the Envelope + exit code (ok → 0, error → 1, unconfigured → 2).
 *
 * `harness record` (bare) and `harness record --list` both emit the orientation
 * listing of available types (core ∪ extension), non-blocking, exit 0.
 */
export function registerRecordAct(
  program: Command,
  io: CliIo,
  deps: RecordActDeps,
  registry: RecordRegistry,
  version: string,
): void {
  program
    .command('record')
    .description(
      'Scaffold a record file from a record type into .harness/records/<type>/ (returns its path)',
    )
    .argument('[type]', 'record type to create; omit (or use --list) to list available types')
    .option('--slug <slug>', 'optional filename slug (lowercased to [a-z0-9-])')
    .option('--list', 'list available record types (core ∪ extension)')
    .action((type: string | undefined, opts: RecordOpts) => {
      if (opts.list || type === undefined) {
        emitList(io, deps.clock, registry);
        return;
      }

      // `version` is the only provenance input not already on the act's ports
      // (git/env ride in via VerbActDeps); merge it in for the service.
      const outcome = createRecord({ type, slug: opts.slug }, registry, { ...deps, version });

      if (outcome.ok) {
        const envelope = formatOk(
          'record',
          { type: outcome.type, path: outcome.path, source: outcome.source },
          deps.clock,
          {
            evidence: [{ label: `${outcome.type} record`, path: outcome.path }],
            next_action: `Open and fill ${outcome.path}, then save.`,
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: () => {
                  io.writers.out(`Created ${outcome.path}\n`);
                  io.writers.out('record: ok\n');
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const envelope: Envelope =
        outcome.status === 'unconfigured'
          ? formatUnconfigured('record', outcome.next_action, deps.clock)
          : formatError('record', outcome.code ?? ErrorCodes.UNKNOWN, outcome.message, deps.clock, {
              next_action: outcome.next_action,
            });
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: (e) => {
                io.writers.err(
                  `harness record: ${e.error?.message ?? e.next_action ?? 'failed'}\n`,
                );
                if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                io.writers.out(`record: ${e.status}\n`);
              },
            };
      exitWithEnvelope(envelope, port);
    });
}

/** Emit the orientation listing of available record types (core ∪ extension). */
function emitList(io: CliIo, clock: Clock, registry: RecordRegistry): void {
  const types = registry.types.map((t) => ({
    type: t.type,
    description: t.description,
    source: t.source,
    ...(t.entryPath && { entryPath: t.entryPath }),
  }));
  const envelope = formatOk('record', { types }, clock, {
    next_action: 'Create one with `harness record <type> --slug "<name>"`.',
  });
  const port: OutputPort =
    io.mode === 'json'
      ? createOutputPort('json', io.writers)
      : { emit: () => io.writers.out(renderListText(registry)) };
  exitWithEnvelope(envelope, port);
}

/** Human-readable listing of record types. */
function renderListText(registry: RecordRegistry): string {
  const lines: string[] = ['harness record — available types:'];
  if (registry.types.length === 0) {
    lines.push('  (none)');
  }
  for (const t of registry.types) {
    const provenance =
      t.source === 'extension' ? `[extension] ${t.entryPath ?? ''}`.trim() : '[core]';
    lines.push(`  • ${t.type}\t${t.description}\t${provenance}`);
  }
  lines.push('', '  harness record <type> [--slug "<name>"]');
  return `${lines.join('\n')}\n`;
}

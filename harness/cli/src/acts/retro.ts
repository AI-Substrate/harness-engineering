import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { formatOk, formatUnconfigured } from '../output/envelope.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { listObservations, type ObserveDeps } from '../services/observe/observe-service.js';
import { buildRetroInsights, type RetroInsightsDocument } from '../services/retro/insights.js';
import {
  type RetroReadFilters,
  type RetroReadResult,
  readRetroRecords,
} from '../services/retro/record-reader.js';

export interface RetroActDeps {
  fs: FsPort;
  proc: ProcessPort;
  clock: Clock;
  env: EnvPort;
}

interface RetroInsightsOpts {
  plan?: string[];
  since?: string;
  kind?: string;
  agent?: string;
}

interface RetroInsightsData extends RetroInsightsDocument {
  scope: {
    plans: string[];
    since: string | null;
    kinds: string[];
    agents: string[];
  };
  sources: RetroReadResult['sources'];
  malformed_skipped: number;
  unsupported_versions: RetroReadResult['unsupported_versions'];
  buffer_pending: number | null;
  buffer_malformed_skipped: number | null;
  buffer_advisory?: string;
}

export function registerRetroAct(program: Command, io: CliIo, deps: RetroActDeps): void {
  const retro = program
    .command('retro')
    .description('Read committed retro records and compute deterministic cross-plan reports');

  retro
    .command('insights')
    .description(
      'Scan, deduplicate, cluster, rank, and report committed retro evidence (read-only)',
    )
    .option('--plan <slug>', 'include one plan slug; repeat to include multiple plans', collect, [])
    .option('--since <iso>', 'include records started at or after this ISO-8601 instant')
    .option('--kind <kind>', 'include only entries with this exact kind')
    .option('--agent <slug>', 'include only records produced by this agent slug')
    .action((opts: RetroInsightsOpts) => {
      const scope = buildScope(opts);
      if (opts.since !== undefined && !Number.isFinite(Date.parse(opts.since))) {
        const envelope = formatUnconfigured(
          'retro',
          'Pass `--since` as a valid ISO-8601 date or instant, then retry.',
          deps.clock,
          { data: { scope } },
        );
        exitWithEnvelope(envelope, failurePort(io));
        return;
      }

      const filters: RetroReadFilters = {};
      if (scope.plans.length > 0) filters.plans = scope.plans;
      if (scope.since !== null) filters.since = scope.since;
      if (scope.kinds.length > 0) filters.kinds = scope.kinds;
      if (scope.agents.length > 0) filters.agents = scope.agents;
      const read = readRetroRecords({ fs: deps.fs, repoRoot: deps.proc.cwd(), filters });
      const report = buildRetroInsights(read.records, { generatedAt: deps.clock.nowIso() });
      const observations = listObservations({}, deps as ObserveDeps);
      const data: RetroInsightsData = {
        ...report,
        scope,
        sources: read.sources,
        malformed_skipped: read.malformed_skipped,
        unsupported_versions: read.unsupported_versions,
        buffer_pending: observations.ok ? observations.observations.length : null,
        buffer_malformed_skipped: observations.ok ? observations.malformed_skipped : null,
        ...(!observations.ok && {
          buffer_advisory: `Pending-buffer count unavailable: ${observations.message}`,
        }),
      };
      const envelope = formatOk('retro', data, deps.clock, {
        evidence: [{ label: 'retro insights report', none: true }],
        ...(data.buffer_pending !== null &&
          data.buffer_pending > 0 && {
            next_action: `The observe buffer has ${data.buffer_pending} pending entr(y/ies); drain it separately if those should join a future committed-record report.`,
          }),
      });
      exitWithEnvelope(
        envelope,
        io.mode === 'json' ? createOutputPort('json', io.writers) : humanPort(io, data),
      );
    });
}

function buildScope(opts: RetroInsightsOpts): RetroInsightsData['scope'] {
  return {
    plans: sortedUnique(opts.plan ?? []),
    since: opts.since ?? null,
    kinds: opts.kind === undefined ? [] : [opts.kind],
    agents: opts.agent === undefined ? [] : [opts.agent],
  };
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function humanPort(io: CliIo, data: RetroInsightsData): OutputPort {
  return {
    emit: () => {
      const { headline } = data;
      io.writers.out(`Harness retro insights - ${data.generated_at}\n\n`);
      io.writers.out(
        `Scanned ${headline.records} retros across ${headline.agents.length} agent(s) and ${headline.plans_touched.length} plan(s)\n`,
      );
      io.writers.out(
        `Entries: ${headline.entries} (${headline.status_counts.open} open, ${headline.status_counts.suggested} suggested, ${headline.status_counts.encoded} encoded, ${headline.status_counts.wontfix} wontfix, ${headline.status_counts.stale} stale, ${headline.status_counts.other} other)\n`,
      );
      io.writers.out(
        `Sources: canonical ${data.sources.canonical.included}/${data.sources.canonical.scanned}, agents ${data.sources.agents.included}/${data.sources.agents.scanned}, retros ${data.sources.retros.included}/${data.sources.retros.scanned}\n`,
      );
      if (data.buffer_pending !== null && data.buffer_pending > 0) {
        io.writers.out(
          `Buffer advisory: ${data.buffer_pending} pending entr(y/ies) are not included in these numbers.\n`,
        );
      }
      io.writers.out('\nOpen clusters\n');
      if (data.sections.top_clusters.rows.length === 0) {
        io.writers.out('  (none)\n');
      } else {
        data.sections.top_clusters.rows.forEach((row, index) => {
          const flags = [
            row.proof_gap ? `proof:${row.proof_gap_signal}` : null,
            row.repeatedly_deferred ? 'repeatedly-deferred' : null,
          ].filter((flag): flag is string => flag !== null);
          io.writers.out(
            `  ${index + 1}. [${row.kind}/${row.target}] ${row.n} entr(y/ies)` +
              `${flags.length > 0 ? ` (${flags.join(', ')})` : ''}\n`,
          );
        });
      }
      io.writers.out(
        `\nSkipped: ${data.malformed_skipped} malformed, ${data.unsupported_versions.length} unsupported version(s)\n`,
      );
    },
  };
}

function failurePort(io: CliIo): OutputPort {
  return io.mode === 'json'
    ? createOutputPort('json', io.writers)
    : {
        emit: (envelope) => {
          io.writers.err(`harness retro: ${envelope.next_action ?? 'failed'}\n`);
          io.writers.out(`retro: ${envelope.status}\n`);
        },
      };
}

import type { Command } from 'commander';
import { SystemClock } from '../../adapters/clock/system-clock.js';
import { formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { emitRawAndExit, exitWithEnvelope } from '../../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../../output/output-port.js';
import type { DdDocsListResult } from '../../services/dd/docs/contract.js';
import { getDdDoc, listDdDocs } from '../../services/dd/docs/dd-docs-service.js';
import type { DdActDeps } from './shared.js';

function renderList(result: DdDocsListResult): string {
  const width = Math.max(2, ...result.docs.map((doc) => doc.id.length));
  const lines = ['harness dd docs — baked deterministic-document guidance', ''];
  for (const doc of result.docs) {
    lines.push(`  ${doc.id.padEnd(width)}  ${doc.title}`);
    lines.push(`  ${' '.repeat(width)}  ${doc.summary}`);
  }
  lines.push('', 'Run `harness dd docs get <id>` to print one.');
  return `${lines.join('\n')}\n`;
}

function listPort(io: CliIo): OutputPort {
  if (io.mode === 'json') return createOutputPort('json', io.writers);
  return { emit: (envelope) => io.writers.out(renderList(envelope.data as DdDocsListResult)) };
}

export function registerDocsCommands(dd: Command, io: CliIo, deps: DdActDeps): void {
  const docs = dd.command('docs').description('Read baked deterministic-document guidance');
  docs
    .command('list')
    .description('List baked dd documentation entries')
    .action(() => {
      const clock = deps.clock ?? new SystemClock();
      exitWithEnvelope(
        formatOk('dd docs list', listDdDocs(), clock, {
          next_action: 'Run `harness dd docs get <id>` to print one.',
        }),
        listPort(io),
      );
    });
  docs
    .command('get <id>')
    .description('Print one baked dd documentation entry')
    .action((id: string) => {
      const clock = deps.clock ?? new SystemClock();
      const lookup = getDdDoc(id);
      if ('notFound' in lookup) {
        exitWithEnvelope(
          formatError(
            'dd docs get',
            ErrorCodes.DD_DOCS_ENTRY_NOT_FOUND,
            `no baked dd doc with id "${id}"`,
            clock,
            { next_action: 'Run `harness dd docs list` to see the available ids.' },
          ),
          createOutputPort(io.mode, io.writers),
        );
      }
      if (io.mode === 'json') {
        exitWithEnvelope(
          formatOk('dd docs get', lookup, clock, {
            next_action: 'Run `harness dd schema list` to see the schemas this describes.',
          }),
          createOutputPort('json', io.writers),
        );
      }
      // Human mode dumps the markdown verbatim and exits NATURALLY, so a large
      // piped doc is never truncated by an early hard exit racing the stdout
      // flush (the `harness docs` precedent).
      emitRawAndExit(lookup.content, io.writers);
    });
}

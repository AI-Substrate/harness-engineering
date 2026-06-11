import type { Command } from 'commander';
import { SystemClock } from '../adapters/clock/system-clock.js';
import { formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { emitRawAndExit, exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import type { DocsListResult } from '../services/docs/contract.js';
import { getDoc, listDocs } from '../services/docs/docs-service.js';

/** Human-mode listing: one block per doc (id + title, then the summary). */
function renderList(result: DocsListResult): string {
  const width = Math.max(4, ...result.docs.map((doc) => doc.id.length));
  const lines: string[] = ['harness docs — bundled documentation', ''];
  for (const doc of result.docs) {
    lines.push(`  ${doc.id.padEnd(width)}  ${doc.title}`);
    lines.push(`  ${' '.repeat(width)}  ${doc.summary}`);
  }
  lines.push('', 'Run `harness docs <id>` to print one.');
  return `${lines.join('\n')}\n`;
}

/**
 * Register the `docs` command — the CLI front door to the bundled, curated
 * corpus (plan 007). A CORE command (reserved, like `help`/`doctor`/`new`); it
 * owns no business logic — the pure `DocsService` lists/resolves, and this act
 * maps the outcome onto output + exit code:
 *
 *   - `harness docs`        → `ok` envelope `{ docs: DocEntry[] }` (human table), exit 0
 *   - `harness docs <id>`   → the doc's RAW markdown to stdout (no envelope), exit 0
 *   - `harness docs <bad>`  → `error` envelope `E160`, exit 1
 *
 * The raw-dump path mirrors minih `agent-readme`: agent-pipe-friendly, EPIPE-safe
 * (the entrypoint swallows a broken stdout pipe). Exits route through the single
 * exit kernel (`exitWithEnvelope`).
 */
export function registerDocsAct(program: Command, io: CliIo): void {
  program
    .command('docs')
    .description('List the bundled docs, or print one by id (`harness docs <id>`)')
    .argument('[id]', 'doc id to print verbatim (omit to list all docs)')
    .action((id?: string) => {
      const clock = new SystemClock();

      if (id === undefined) {
        const result = listDocs();
        const envelope = formatOk('docs', result, clock, {
          next_action: 'Run `harness docs <id>` to print a doc.',
        });
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : { emit: () => io.writers.out(renderList(result)) };
        exitWithEnvelope(envelope, port);
        return;
      }

      const lookup = getDoc(id);
      if ('notFound' in lookup) {
        const envelope = formatError(
          'docs',
          ErrorCodes.DOC_NOT_FOUND,
          `no curated doc with id "${id}"`,
          clock,
          { next_action: 'Run `harness docs` to see the available ids.' },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(`harness docs: ${e.error?.message ?? 'failed'}\n`);
                  if (e.next_action) {
                    io.writers.err(`  → ${e.next_action}\n`);
                  }
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      // Found → write the raw markdown verbatim to stdout and let the process
      // exit NATURALLY with 0. We deliberately do NOT route this through
      // process.exit: a large doc piped/redirected could be truncated if the
      // process terminates before stdout flushes (companion F002 HIGH).
      emitRawAndExit(lookup.content, io.writers);
    });
}

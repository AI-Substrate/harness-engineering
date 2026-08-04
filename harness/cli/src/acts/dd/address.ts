import type { Command } from 'commander';
import { formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import type { CliIo } from '../../output/output-port.js';
import {
  formatAddress,
  isAddressFailure,
  normalizeAddress,
  parseAddress,
} from '../../services/dd/core/address.js';
import { resolveLink } from '../../services/dd/links/index.js';
import { codedLinkIssues, createLinkContext, type DdActDeps, nextActionFor } from './shared.js';

export function registerAddressCommands(dd: Command, io: CliIo, deps: DdActDeps): void {
  const address = dd.command('address').description('Generate and validate canonical dd addresses');

  address
    .command('generate <interior>')
    .description('Generate an address from an alternating name/id interior')
    .option('--path <path>', 'target .dd.json path (omit for bare-# same-document form)')
    .action(async (interior: string, opts: { path?: string }) => {
      const ctx = await createLinkContext(io, deps, { tracked: false });
      // Generation is a grammar question, not a repository question: the address
      // is assembled and then put through the same parser every consumer uses,
      // so a string this verb hands back can never be one `dd address validate`
      // would reject. That is the whole point of the verb — agents stop
      // hand-assembling addresses (workshop 001 § Tooling contract).
      const raw = `${opts.path ?? ''}#${interior}`;
      const parsed = parseAddress(raw);
      if (isAddressFailure(parsed)) {
        exitWithEnvelope(
          formatError(
            'dd address generate',
            ErrorCodes.DD_ADDRESS_INVALID,
            parsed.message,
            ctx.clock,
            {
              details: { interior, ...(opts.path && { path: opts.path }) },
              next_action:
                'Interior segments alternate schema name and minted id, each starting with a letter — for example `phases/ph-1a2b/brief`.',
            },
          ),
          ctx.port,
        );
      }

      const normalized = normalizeAddress(parsed);
      exitWithEnvelope(
        formatOk(
          'dd address generate',
          {
            address: formatAddress(normalized),
            file: normalized.file,
            form: normalized.file === null ? 'bare' : 'qualified',
            segments: normalized.segments.map((segment) => segment.value),
          },
          ctx.clock,
          {
            next_action: `Check it against the repository with \`harness dd address validate "${formatAddress(normalized)}" --resolve\`.`,
          },
        ),
        ctx.port,
      );
    });

  address
    .command('validate <address>')
    .description('Validate address syntax and optionally resolve its target')
    .option('--resolve', 'also resolve the target against the repository')
    .action(async (raw: string, opts: { resolve?: boolean }) => {
      const ctx = await createLinkContext(io, deps, { tracked: opts.resolve === true });
      const parsed = parseAddress(raw);
      if (isAddressFailure(parsed)) {
        exitWithEnvelope(
          formatError(
            'dd address validate',
            ErrorCodes.DD_ADDRESS_INVALID,
            parsed.message,
            ctx.clock,
            {
              details: { address: raw },
              next_action:
                'Generate the address instead of writing it: `harness dd address generate "<interior>" --path <file>`.',
            },
          ),
          ctx.port,
        );
      }

      const normalized = normalizeAddress(parsed);
      const syntax = {
        address: formatAddress(normalized),
        file: normalized.file,
        form: normalized.file === null ? ('bare' as const) : ('qualified' as const),
      };

      if (!opts.resolve) {
        // Without a repository to look in, the parser's `name`/`id` kinds are
        // positional hints and nothing more, so they are deliberately NOT
        // reported as classifications — `classified: false` says so out loud
        // rather than handing back a guess that reads like an answer.
        exitWithEnvelope(
          formatOk(
            'dd address validate',
            {
              ...syntax,
              classified: false,
              segments: normalized.segments.map((segment) => ({ value: segment.value })),
            },
            ctx.clock,
            {
              next_action:
                'Syntax is valid. Add `--resolve` to check the target exists and classify each segment against its schema.',
            },
          ),
          ctx.port,
        );
      }

      const resolution = resolveLink(
        raw,
        { schemaResolver: ctx.resolver, docLoader: ctx.loader },
        { repoRoot: ctx.repoRoot, fromPath: null },
      );
      if (!resolution.ok) {
        const issues = codedLinkIssues(resolution.issues);
        exitWithEnvelope(
          formatError(
            'dd address validate',
            issues[0]?.code ?? ErrorCodes.DD_LINK_UNRESOLVED,
            issues[0]?.message ?? `address did not resolve: ${raw}`,
            ctx.clock,
            {
              details: { ...syntax, classified: false, issues },
              next_action: nextActionFor(resolution.issues, raw),
            },
          ),
          ctx.port,
        );
      }

      const { target } = resolution;
      exitWithEnvelope(
        formatOk(
          'dd address validate',
          {
            ...syntax,
            classified: true,
            segments: target.segments,
            target: {
              path: target.path,
              schema: target.schema,
              kind: target.kind,
              sha: target.sha,
              tracked: target.tracked,
            },
          },
          ctx.clock,
          {
            next_action: `Run \`harness dd link resolve "${target.address}"\` to read the value it points at.`,
          },
        ),
        ctx.port,
      );
    });
}

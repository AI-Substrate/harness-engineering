import type { Command } from 'commander';
import { NodeFs } from '../../adapters/fs/node-fs.js';
import { formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import type { CliIo } from '../../output/output-port.js';
import { resolveLink, updateLedgerEntry, verifyBasis } from '../../services/dd/links/index.js';
import { resolveInRepo } from '../../services/shared/posix-path.js';
import { autoRegenerateSibling } from './build.js';
import {
  codedLinkIssues,
  createLinkContext,
  type DdActDeps,
  type DdLinkContext,
  nextActionFor,
} from './shared.js';

export function registerLinkCommands(dd: Command, io: CliIo, deps: DdActDeps): void {
  const link = dd.command('link').description('Resolve links and inspect recorded basis freshness');

  link
    .command('resolve <address>')
    .description('Resolve an address to its document/section/instance target')
    .action(async (address: string) => {
      const ctx = await createLinkContext(io, deps);
      const resolution = resolveLink(
        address,
        { schemaResolver: ctx.resolver, docLoader: ctx.loader },
        { repoRoot: ctx.repoRoot, fromPath: null },
      );
      if (!resolution.ok) {
        const issues = codedLinkIssues(resolution.issues);
        exitWithEnvelope(
          formatError(
            'dd link resolve',
            issues[0]?.code ?? ErrorCodes.DD_LINK_UNRESOLVED,
            issues[0]?.message ?? `address did not resolve: ${address}`,
            ctx.clock,
            {
              details: { address, issues },
              next_action: nextActionFor(resolution.issues, address),
            },
          ),
          ctx.port,
        );
      }
      const { target } = resolution;
      exitWithEnvelope(
        formatOk('dd link resolve', { address, target }, ctx.clock, {
          next_action: `Run \`harness dd link verify-basis ${target.address} --sha ${target.sha}\` to check its basis.`,
        }),
        ctx.port,
      );
    });

  link
    .command('verify-basis <address>')
    .description('Compare a recorded sha with the current target document')
    .requiredOption('--sha <sha>', 'recorded target document sha')
    .option(
      '--update <doc>',
      'explicit re-verification: move that document\u2019s recorded basis to the current sha',
    )
    .action(async (address: string, opts: { sha: string; update?: string }) => {
      const ctx = await createLinkContext(io, deps);
      // The address is anchored at the repository root, exactly as it is for
      // `link resolve` and `address validate` — an address typed on the command
      // line means the same thing whatever else is on the line. `--update` names
      // the document whose ledger moves; it is NOT the address's base, and
      // anchoring the address at it would silently resolve `docs/x.dd.json`
      // against `docs/` twice.
      const result = verifyBasis(
        address,
        opts.sha,
        { schemaResolver: ctx.resolver, docLoader: ctx.loader },
        { repoRoot: ctx.repoRoot, fromPath: null },
      );
      if (!result.ok) {
        const issues = codedLinkIssues(result.issues);
        exitWithEnvelope(
          formatError(
            'dd link verify-basis',
            issues[0]?.code ?? ErrorCodes.DD_BASIS_VERIFY_FAILED,
            issues[0]?.message ?? `address did not resolve: ${address}`,
            ctx.clock,
            {
              details: { address, issues },
              next_action: nextActionFor(result.issues, address),
            },
          ),
          ctx.port,
        );
      }

      const { verdict } = result;
      if (opts.update === undefined) {
        const data = {
          ...verdict,
          ...(verdict.state === 'stale' && { code: ErrorCodes.DD_BASIS_STALE }),
        };
        if (verdict.state === 'stale') {
          exitWithEnvelope(
            formatDegraded(
              'dd link verify-basis',
              data,
              'The target moved: recompute anything derived from it, then re-verify with `--update <doc>`.',
              ctx.clock,
            ),
            ctx.port,
          );
        }
        exitWithEnvelope(
          formatOk('dd link verify-basis', data, ctx.clock, {
            next_action: 'Nothing to do — the recorded basis still matches the target.',
          }),
          ctx.port,
        );
      }

      await updateBasis(ctx, resolveInRepo(opts.update, ctx.repoRoot), verdict, address, io);
    });
}

/**
 * The mutation half of `verify-basis` (the Phase 4 RESERVED-row leaf ruling).
 *
 * There is no separate re-verify verb: re-verification *is* this verb plus an
 * explicit flag, because the read is the write's precondition — resolving the
 * address and hashing the target is exactly the work the mutation needs, and a
 * second command would duplicate it and then have to agree with it forever.
 *
 * `--update` names the *referencing* document, because the ledger lives in the
 * citing file and not in the target. One option therefore carries both the
 * decision to mutate and the answer to "whose basis moves".
 *
 * This is also `autoRegenerateSibling`'s FIRST call site (P5 T004). Phase 3 built
 * and proved that helper with no consumer, because every dd verb shipped until
 * now was read-only; this is the first dd verb that mutates a document, so it is
 * the first that owes its `.dd.md` a regeneration. The posture is Phase 3's, not
 * a new one: warn on failure, never roll back — the ledger move already
 * succeeded, and a stale render is a smaller harm than a reverted mutation.
 */
async function updateBasis(
  ctx: DdLinkContext,
  docPath: string,
  verdict: { state: string; path: string; actual: string },
  address: string,
  io: CliIo,
): Promise<never> {
  const fail = (message: string, next_action?: string): never =>
    exitWithEnvelope(
      formatError('dd link verify-basis', ErrorCodes.DD_BASIS_VERIFY_FAILED, message, ctx.clock, {
        details: { document: docPath, path: verdict.path },
        ...(next_action && { next_action }),
      }),
      ctx.port,
    );

  const text = ctx.fs.readText(docPath);
  if (text === null) {
    return fail(
      `the referencing document is missing or unreadable: ${docPath}`,
      'Check the `--update` path, then re-run.',
    );
  }

  const update = updateLedgerEntry(text, docPath, verdict.path, verdict.actual);
  if (!update.ok) {
    return fail(
      update.message,
      `Add a references entry for ${verdict.path} to ${docPath} first — re-verification moves a recorded basis, it never mints one.`,
    );
  }

  try {
    new NodeFs().writeText(docPath, update.text);
  } catch (error) {
    return fail(
      `could not write the updated ledger to ${docPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // The document just changed on disk, so its sibling markdown is now stale by
  // construction. Regenerate it here rather than leaving `dd build --check` to
  // discover the drift later and call it a hand-edit.
  const regeneration = await autoRegenerateSibling(docPath, ctx.repoRoot, io);

  exitWithEnvelope(
    formatOk(
      'dd link verify-basis',
      {
        address,
        document: docPath,
        path: verdict.path,
        state: verdict.state,
        updated: update.previous !== update.entry.sha,
        previous: update.previous,
        sha: update.entry.sha,
        mode: update.entry.mode,
        sibling_regenerated: regeneration.regenerated,
        ...(regeneration.reason !== undefined && { sibling_reason: regeneration.reason }),
      },
      ctx.clock,
      {
        next_action: regeneration.regenerated
          ? verdict.state === 'stale'
            ? `Recompute anything that derived state through ${address} — the basis moved. Commit the document and its regenerated sibling together.`
            : 'The basis already matched; the ledger is unchanged in substance.'
          : `The ledger moved but the sibling markdown did not regenerate (${regeneration.reason ?? 'unknown'}) — run \`harness dd build ${docPath}\` before committing.`,
      },
    ),
    ctx.port,
  );
}

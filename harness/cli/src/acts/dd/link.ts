import type { Command } from 'commander';
import type { Clock } from '../../adapters/clock/clock-port.js';
import { SystemClock } from '../../adapters/clock/system-clock.js';
import { NodeEnv } from '../../adapters/env/node-env.js';
import { NodeExec } from '../../adapters/exec/node-exec.js';
import { NodeFs } from '../../adapters/fs/node-fs.js';
import { NodeHash } from '../../adapters/hash/node-hash.js';
import { NodeProcess } from '../../adapters/process/node-process.js';
import { formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../../output/output-port.js';
import type { DocLoader } from '../../services/dd/core/walk.js';
import {
  MemoizingDocLoader,
  resolveLink,
  updateLedgerEntry,
  verifyBasis,
} from '../../services/dd/links/index.js';
import type { DdLinkIssue, DdLinkIssueClass } from '../../services/dd/links/model.js';
import { ConventionSchemaResolver } from '../../services/dd/schema/resolve.js';
import { resolveInRepo, toPosix } from '../../services/shared/posix-path.js';
import { NodeSchemaFs } from './schema-fs.js';
import type { DdActDeps } from './shared.js';
import { FsDocLoader, trackedPaths } from './validate.js';

/**
 * Link-layer issue class → frozen E-code (P1 allocation; Phase 4 adds none).
 * Every code below is already named in `dd-surface.md` § E430-E439.
 */
export const LINK_ISSUE_CODES: Record<DdLinkIssueClass, string> = {
  'adapter-gap': ErrorCodes.DD_ADAPTER_NOT_FOUND,
  'link-scan-failed': ErrorCodes.DD_LINK_SCAN_FAILED,
  'link-scan-incomplete': ErrorCodes.DD_LINK_SCAN_FAILED,
  'link-unresolved': ErrorCodes.DD_LINK_UNRESOLVED,
};

export function codedLinkIssues(issues: readonly DdLinkIssue[]) {
  return issues.map((issue) => ({ ...issue, code: LINK_ISSUE_CODES[issue.class] }));
}

export interface DdLinkContext {
  clock: Clock;
  port: OutputPort;
  repoRoot: string;
  fs: NodeSchemaFs;
  resolver: ConventionSchemaResolver;
  loader: DocLoader;
}

/**
 * Compose the adapters every Phase 4 verb needs, once.
 *
 * `dd address`, `dd link`, `dd links`, `dd graph` and `dd doctor` all resolve
 * schemas the same way and load documents the same way, and a second copy of
 * that wiring is a second place for the two to drift apart. It lives in this
 * file rather than in `acts/dd/shared.ts` because that file belongs to Phase 1
 * and the parallel phases must not touch each other's files.
 *
 * `tracked` comes from one `git ls-files` snapshot (P2's `trackedPaths`), so an
 * untracked target is reported honestly instead of every readable file being
 * called tracked.
 */
export async function createLinkContext(
  io: CliIo,
  deps: DdActDeps,
  options: { tracked?: boolean } = {},
): Promise<DdLinkContext> {
  const clock = deps.clock ?? new SystemClock();
  const port = createOutputPort(io.mode, io.writers);
  const fs = new NodeSchemaFs();
  const repoRoot = toPosix(new NodeProcess().cwd());
  const home = new NodeEnv().home();
  const resolver = new ConventionSchemaResolver({
    fs,
    repoRoot,
    ...(home !== undefined && { home: toPosix(home) }),
  });
  const tracked = options.tracked === false ? null : await trackedPaths(new NodeExec(), repoRoot);
  const loader = new MemoizingDocLoader(new FsDocLoader(fs, new NodeHash(), tracked));
  return { clock, port, repoRoot, fs, resolver, loader };
}

export function nextActionFor(issues: readonly DdLinkIssue[], address: string): string {
  const reason = issues[0]?.reason;
  if (reason === 'no-base-document') {
    return 'Address the file explicitly — `<path>#<interior>`. A bare-"#" address only means something inside its own document.';
  }
  if (reason === 'malformed') {
    return 'Generate the address instead of writing it: `harness dd address generate "<interior>" --path <file>`.';
  }
  return `Check the target with \`harness dd links <target>\`, then fix ${address}.`;
}

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

      updateBasis(ctx, resolveInRepo(opts.update, ctx.repoRoot), verdict, address);
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
 */
function updateBasis(
  ctx: DdLinkContext,
  docPath: string,
  verdict: { state: string; path: string; actual: string },
  address: string,
): never {
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
      },
      ctx.clock,
      {
        next_action:
          verdict.state === 'stale'
            ? `Recompute anything that derived state through ${address} — the basis moved.`
            : 'The basis already matched; the ledger is unchanged in substance.',
      },
    ),
    ctx.port,
  );
}

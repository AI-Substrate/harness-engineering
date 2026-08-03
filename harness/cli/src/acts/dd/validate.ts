import type { Command } from 'commander';
import { SystemClock } from '../../adapters/clock/system-clock.js';
import { NodeEnv } from '../../adapters/env/node-env.js';
import { NodeExec } from '../../adapters/exec/node-exec.js';
import { NodeHash } from '../../adapters/hash/node-hash.js';
import { NodeProcess } from '../../adapters/process/node-process.js';
import { formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import { type CliIo, createOutputPort } from '../../output/output-port.js';
import { parse } from '../../services/dd/core/parse.js';
import type { DdIssue } from '../../services/dd/core/validate.js';
import { validateWalk } from '../../services/dd/core/walk.js';
import { ConventionSchemaResolver } from '../../services/dd/schema/resolve.js';
import { resolveInRepo, toPosix } from '../../services/shared/posix-path.js';
import { NodeSchemaFs } from './schema-fs.js';
import { DD_ISSUE_CODES, type DdActDeps, FsDocLoader, trackedPaths } from './shared.js';

interface ReportedIssue extends DdIssue {
  code: string;
}

export function registerValidateCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('validate <path>')
    .description('Validate one deterministic document and its outbound neighbourhood')
    .option('--depth <n>', 'outbound traversal depth (0 = this document only)', '3')
    .action(async (path: string, opts: { depth: string }) => {
      const clock = deps.clock ?? new SystemClock();
      const port = createOutputPort(io.mode, io.writers);
      const fs = new NodeSchemaFs();
      const proc = new NodeProcess();
      const home = new NodeEnv().home();

      const depth = Number(opts.depth);
      if (!Number.isInteger(depth) || depth < 0) {
        exitWithEnvelope(
          formatError(
            'dd validate',
            ErrorCodes.INVALID_ARGS,
            `--depth must be a non-negative integer, got "${opts.depth}"`,
            clock,
            { next_action: 'Re-run with `--depth 0` (this document only) or a positive integer.' },
          ),
          port,
        );
      }

      const repoRoot = toPosix(proc.cwd());
      const target = resolveInRepo(path, repoRoot);
      const text = fs.readText(target);
      if (text === null) {
        exitWithEnvelope(
          formatError(
            'dd validate',
            ErrorCodes.DD_DOCUMENT_INVALID,
            `document is missing or unreadable: ${target}`,
            clock,
            { next_action: 'Check the path, then re-run `harness dd validate <path>`.' },
          ),
          port,
        );
      }

      const doc = parse(text);
      if (Array.isArray(doc)) {
        exitWithEnvelope(
          formatError(
            'dd validate',
            ErrorCodes.DD_DOCUMENT_INVALID,
            `${target} is not a valid dd document`,
            clock,
            {
              details: { path: target, failures: doc },
              next_action: 'Fix the reported location, then re-run `harness dd validate <path>`.',
            },
          ),
          port,
        );
      }

      const resolver = new ConventionSchemaResolver({
        fs,
        repoRoot,
        ...(home !== undefined && { home: toPosix(home) }),
      });
      const loader = new FsDocLoader(
        fs,
        new NodeHash(),
        depth === 0 ? null : await trackedPaths(new NodeExec(), repoRoot),
      );

      // OD-1: direct invocation NEVER skips a document. `sweep_exclude` and the
      // fixture-path exclusion belong to the doctor's sweep, not to this verb —
      // pointing `dd validate` at a known-bad fixture must still fail.
      const issues: ReportedIssue[] = validateWalk(
        doc,
        target,
        { schemaResolver: resolver, docLoader: loader },
        { repoRoot, depth, mode: 'direct' },
      ).map((issue) => ({ ...issue, code: DD_ISSUE_CODES[issue.class] }));

      const blocking = issues.find((issue) => issue.severity === 'ERROR');
      const data = {
        path: target,
        schema: doc.dd.schema,
        depth,
        counts: {
          error: issues.filter((issue) => issue.severity === 'ERROR').length,
          warn: issues.filter((issue) => issue.severity === 'WARN').length,
        },
        issues,
      };

      if (blocking) {
        exitWithEnvelope(
          formatError('dd validate', blocking.code, blocking.message, clock, {
            details: data,
            next_action: `Fix ${blocking.owner} at ${blocking.location}, then re-run \`harness dd validate ${path}\`.`,
          }),
          port,
        );
      }
      if (issues.length > 0) {
        exitWithEnvelope(
          formatDegraded(
            'dd validate',
            data,
            `${issues.length} WARN-class finding(s) — review them, or narrow the walk with --depth.`,
            clock,
          ),
          port,
        );
      }
      exitWithEnvelope(
        formatOk('dd validate', data, clock, {
          next_action: 'Run `harness dd build <path>` to regenerate the sibling markdown.',
        }),
        port,
      );
    });
}

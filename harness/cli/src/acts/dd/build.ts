import type { Command } from 'commander';
import type { Clock } from '../../adapters/clock/clock-port.js';
import { SystemClock } from '../../adapters/clock/system-clock.js';
import { NodeEnv } from '../../adapters/env/node-env.js';
import { NodeFs } from '../../adapters/fs/node-fs.js';
import { NodeHash } from '../../adapters/hash/node-hash.js';
import { JitiLoader } from '../../adapters/loader/jiti-loader.js';
import { NodeProcess } from '../../adapters/process/node-process.js';
import { type Envelope, formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import { type CliIo, createOutputPort } from '../../output/output-port.js';
import { parse } from '../../services/dd/core/parse.js';
import { collectCustomTypes, loadAdapters } from '../../services/dd/render/adapters.js';
import type { DdAdapterIssue } from '../../services/dd/render/contract.js';
import {
  type DdRefreshedBasis,
  type DdRefreshIssue,
  refreshLiveReferences,
} from '../../services/dd/render/refresh.js';
import { renderDd } from '../../services/dd/render/renderer.js';
import { ConventionSchemaResolver } from '../../services/dd/schema/resolve.js';
import {
  isWithin,
  posixDirname,
  resolveInRepo,
  toPosix,
} from '../../services/shared/posix-path.js';
import { NodeSchemaFs } from './schema-fs.js';
import type { DdActDeps } from './shared.js';

/**
 * Adapter issue class → frozen E-code (T006 ruling a). Like `dd validate`, the
 * mapping lives in the act: `services/dd/render` stays free of `output/`, which is
 * exactly what the renderer-purity rules enforce.
 */
const ADAPTER_CODES: Record<DdAdapterIssue['class'], string> = {
  'adapter-not-found': ErrorCodes.DD_ADAPTER_NOT_FOUND,
  'adapter-load-failed': ErrorCodes.DD_ADAPTER_LOAD_FAILED,
  'adapter-runtime-failed': ErrorCodes.DD_ADAPTER_RUNTIME_FAILED,
  'adapter-output-invalid': ErrorCodes.DD_ADAPTER_OUTPUT_INVALID,
};

/** The sibling markdown for a dd document — always beside it, never elsewhere. */
export function siblingPath(documentPath: string): string {
  return `${documentPath.replace(/\.json$/, '')}.md`;
}

export interface BuildFailure {
  ok: false;
  code: string;
  message: string;
  next_action: string;
  details?: unknown;
}

export interface BuildSuccess {
  ok: true;
  path: string;
  sibling: string;
  schema: string;
  markdown: string;
  warnings: Array<DdAdapterIssue & { code: string }>;
  /** Live bases whose target has moved since the ledger recorded it. */
  refreshed: DdRefreshedBasis[];
  refreshIssues: Array<DdRefreshIssue & { code: string }>;
}

export type BuildResult = BuildSuccess | BuildFailure;

/**
 * Everything up to (but not including) the write: read, parse, resolve the schema,
 * load adapters, render. Shared by the verb and by {@link autoRegenerateSibling},
 * so a mutating verb's best-effort regeneration can never drift from what
 * `dd build` itself would have produced.
 */
export async function renderDocument(documentPath: string, repoRoot: string): Promise<BuildResult> {
  const fs = new NodeSchemaFs();
  const home = new NodeEnv().home();

  if (!isWithin(repoRoot, documentPath)) {
    return {
      ok: false,
      code: ErrorCodes.DD_BUILD_INPUT_INVALID,
      message: `document is outside the repository root: ${documentPath}`,
      next_action: 'Point `harness dd build` at a document inside this repository.',
    };
  }

  const text = fs.readText(documentPath);
  if (text === null) {
    return {
      ok: false,
      code: ErrorCodes.DD_BUILD_INPUT_INVALID,
      message: `document is missing or unreadable: ${documentPath}`,
      next_action: 'Check the path, then re-run `harness dd build <path>`.',
    };
  }

  const doc = parse(text);
  if (Array.isArray(doc)) {
    return {
      ok: false,
      code: ErrorCodes.DD_BUILD_INPUT_INVALID,
      message: `${documentPath} is not a valid dd document`,
      details: { path: documentPath, failures: doc },
      next_action: 'Fix the reported location, then re-run `harness dd build <path>`.',
    };
  }

  const resolver = new ConventionSchemaResolver({
    fs,
    repoRoot,
    ...(home !== undefined && { home: toPosix(home) }),
  });
  const resolution = resolver.resolveDetailed(doc.dd.schema, documentPath);
  const record = resolution.record;
  if (!record) {
    const blocking = resolution.issues.find((issue) => issue.severity === 'ERROR');
    return {
      ok: false,
      code: ErrorCodes.DD_SCHEMA_UNRESOLVABLE,
      message: blocking?.message ?? `schema not found: ${doc.dd.schema}`,
      details: { path: documentPath, schema: doc.dd.schema, issues: resolution.issues },
      next_action: 'Run `harness dd schema list` to see which schemas resolve from here.',
    };
  }

  const adapters = await loadAdapters({
    types: collectCustomTypes(doc, record.schema),
    schemaPath: record.path,
    fs,
    loader: new JitiLoader(),
  });

  // Live-ledger refresh (plan 3.4): recompute what this document's `live` entries
  // promise, so a cross-file row summary is current at render. It reads only —
  // `dd build` must not dirty the document it renders, or `--check` could never
  // be stable.
  const refresh = refreshLiveReferences({
    doc,
    path: documentPath,
    schema: record.schema,
    gateTerminal: record.gateTerminal,
    fs,
    hash: new NodeHash(),
  });

  let markdown: string;
  try {
    markdown = renderDd(doc, {
      path: documentPath,
      schema: record.schema,
      gateTerminal: record.gateTerminal,
      adapters,
      derived: refresh.derived,
    });
  } catch (error) {
    return {
      ok: false,
      code: ErrorCodes.DD_RENDER_FAILED,
      message: `render failed for ${documentPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      next_action:
        'Report this with the document — a render failure is a dd bug, not a data error.',
    };
  }

  return {
    ok: true,
    path: documentPath,
    sibling: siblingPath(documentPath),
    schema: record.name,
    markdown,
    warnings: adapters.issues.map((issue) => ({ ...issue, code: ADAPTER_CODES[issue.class] })),
    refreshed: refresh.refreshed,
    refreshIssues: refresh.issues.map((issue) => ({
      ...issue,
      code: ErrorCodes.DD_LIVE_BASIS_REFRESH_FAILED,
    })),
  };
}

/**
 * Best-effort sibling regeneration for a MUTATING dd verb: warn on failure, never
 * block the verb (plan 3.2). It is the `autoRenderSibling` posture from
 * `acts/flow.ts`, kept honest — a verb that changed state has already succeeded,
 * and a stale render is a smaller harm than a rolled-back mutation.
 *
 * Exported and proven, with no call site yet: every dd verb shipped so far is
 * read-only. Phase 4's re-verification verb is the first candidate (its mutation
 * semantics are a RESERVED row), and it should call this rather than re-derive
 * the render path.
 */
export async function autoRegenerateSibling(
  documentPath: string,
  repoRoot: string,
  io: CliIo,
): Promise<{ regenerated: boolean; reason?: string }> {
  try {
    const result = await renderDocument(documentPath, repoRoot);
    if (!result.ok) {
      io.writers.err(
        `warning: dd sibling not regenerated for ${documentPath}: ${result.message}\n`,
      );
      return { regenerated: false, reason: result.message };
    }
    const fs = new NodeFs();
    fs.mkdirp(posixDirname(result.sibling));
    fs.writeText(result.sibling, result.markdown);
    return { regenerated: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.writers.err(`warning: dd sibling not regenerated for ${documentPath}: ${reason}\n`);
    return { regenerated: false, reason };
  }
}

/**
 * `ok` unless the render was degraded by an adapter. Workshop-003 W1 rule 5 makes
 * that loudness mandatory, and the envelope status IS the severity a gate reads
 * (KF-05) — so a degraded render surfaces without failing the build.
 */
function envelopeFor(
  outcome: 'written' | 'checked',
  data: Record<string, unknown>,
  result: BuildSuccess,
  clock: Clock,
): Envelope {
  const evidence = [{ label: 'rendered markdown', path: result.sibling }];
  const degradations = [...result.warnings, ...result.refreshIssues];
  if (degradations.length === 0) {
    return formatOk('dd build', data, clock, {
      ...(outcome === 'written' && { evidence }),
      next_action:
        outcome === 'written'
          ? 'Commit the regenerated sibling alongside the document.'
          : 'Nothing to do — the committed markdown matches the document.',
    });
  }
  const causes = [
    ...(result.warnings.length > 0
      ? [
          `${result.warnings.length} adapter issue(s) (${[
            ...new Set(result.warnings.map((warning) => warning.type)),
          ].join(', ')}) — every affected value fell back to its raw form`,
        ]
      : []),
    ...(result.refreshIssues.length > 0
      ? [`${result.refreshIssues.length} live reference(s) could not be refreshed`]
      : []),
  ].join('; ');
  return formatDegraded(
    'dd build',
    data,
    `Rendered with ${causes}. Fix the cause, or accept the degraded render.`,
    clock,
    ...(outcome === 'written' ? [{ evidence }] : []),
  );
}

export function registerBuildCommand(dd: Command, io: CliIo, deps: DdActDeps): void {
  dd.command('build <path>')
    .description('Render one .dd.json file to its deterministic .dd.md sibling')
    .option('--check', 'report byte drift without writing')
    .action(async (path: string, opts: { check?: boolean }) => {
      const clock = deps.clock ?? new SystemClock();
      const port = createOutputPort(io.mode, io.writers);
      const repoRoot = toPosix(new NodeProcess().cwd());
      const target = resolveInRepo(path, repoRoot);

      const result = await renderDocument(target, repoRoot);
      if (!result.ok) {
        exitWithEnvelope(
          formatError('dd build', result.code, result.message, clock, {
            ...(result.details !== undefined && { details: result.details }),
            next_action: result.next_action,
          }),
          port,
        );
      }

      const data = {
        path: result.path,
        sibling: result.sibling,
        schema: result.schema,
        bytes: result.markdown.length,
        adapter_warnings: result.warnings,
        refreshed_bases: result.refreshed,
        refresh_issues: result.refreshIssues,
      };

      // --check: compare against the committed sibling and NEVER write. The drift
      // gate exists to fail CI, so drift is an error even though a degraded render
      // is not (T006 ruling b); an absent sibling is drift too — committed markdown
      // is just as wrong when it is missing as when it is stale.
      if (opts.check) {
        const committed = new NodeSchemaFs().readText(result.sibling);
        if (committed !== result.markdown) {
          exitWithEnvelope(
            formatError(
              'dd build',
              ErrorCodes.DD_RENDER_DRIFT,
              committed === null
                ? `no rendered sibling to check against: ${result.sibling}`
                : `${result.sibling} drifted from the render of ${result.path}`,
              clock,
              {
                details: { ...data, drift: true },
                next_action: `Regenerate with \`harness dd build ${path}\` and commit the result.`,
              },
            ),
            port,
          );
        }
        exitWithEnvelope(envelopeFor('checked', { ...data, drift: false }, result, clock), port);
      }

      try {
        const fs = new NodeFs();
        fs.mkdirp(posixDirname(result.sibling));
        fs.writeText(result.sibling, result.markdown);
      } catch (error) {
        exitWithEnvelope(
          formatError(
            'dd build',
            ErrorCodes.DD_RENDER_WRITE_FAILED,
            `failed to write ${result.sibling}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            clock,
            {
              details: data,
              next_action: 'Check directory permissions and disk space, then retry.',
            },
          ),
          port,
        );
      }

      exitWithEnvelope(envelopeFor('written', data, result, clock), port);
    });
}

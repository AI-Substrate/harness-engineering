import type { Command } from 'commander';
import type { Clock } from '../../adapters/clock/clock-port.js';
import { SystemClock } from '../../adapters/clock/system-clock.js';
import { NodeExec } from '../../adapters/exec/node-exec.js';
import { NodeFs } from '../../adapters/fs/node-fs.js';
import { NodeHash } from '../../adapters/hash/node-hash.js';
import { NodeProcess } from '../../adapters/process/node-process.js';
import { formatDegraded, formatError, formatOk } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import { type CliIo, createOutputPort } from '../../output/output-port.js';
import { isAddressFailure, parseAddress } from '../../services/dd/core/address.js';
import type { DdDoc } from '../../services/dd/core/model.js';
import { parse } from '../../services/dd/core/parse.js';
import {
  collectLinkCells,
  type DdIssue,
  resolveAddressFile,
} from '../../services/dd/core/validate.js';
import { validateWalk } from '../../services/dd/core/walk.js';
import { ConventionSchemaResolver } from '../../services/dd/schema/resolve.js';
import { isWithin, posixDirname, posixJoin, toPosix } from '../../services/shared/posix-path.js';
import { renderDocument } from '../dd/build.js';
import { NodeSchemaFs } from '../dd/schema-fs.js';
import { DD_ISSUE_CODES, type DdActDeps, FsDocLoader, trackedPaths } from '../dd/shared.js';
import { buildPlanScaffold } from './scaffold.js';

/** Plan folder names follow the repo's own convention: lowercase, hyphenated. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where plans live unless told otherwise — the house layout, not a new one. */
const DEFAULT_PLANS_DIR = 'docs/plans';

interface PlanContext {
  clock: Clock;
  port: ReturnType<typeof createOutputPort>;
  repoRoot: string;
  fs: NodeSchemaFs;
}

function context(io: CliIo, deps: DdActDeps): PlanContext {
  return {
    clock: deps.clock ?? new SystemClock(),
    port: createOutputPort(io.mode, io.writers),
    repoRoot: toPosix(new NodeProcess().cwd()),
    fs: new NodeSchemaFs(),
  };
}

/**
 * Accept either the plan document or the folder that holds it.
 *
 * A plan is a folder of documents, so `harness plan validate docs/plans/065-x` is
 * the way a person thinks about it; naming `plan.dd.json` explicitly still works
 * because that is what the path resolves to either way.
 */
function resolvePlanDocument(target: string, repoRoot: string): string {
  const absolute = target.startsWith('/') ? toPosix(target) : posixJoin(repoRoot, toPosix(target));
  if (absolute.endsWith('.dd.json')) return absolute;
  return posixJoin(absolute, 'plan.dd.json');
}

/**
 * Every document this plan owns: the plan itself, then each task file it links
 * to. The set comes from the plan's own declared links — a task file that nothing
 * points at is not part of the plan, and one that is reached is, whatever it is
 * called or wherever it sits.
 */
function planDocuments(doc: DdDoc, path: string, repoRoot: string, schemaName: string): string[] {
  const resolver = planResolver(repoRoot);
  const resolved = resolver.resolve(schemaName, path);
  if (!resolved.ok) return [path];
  const documents = [path];
  for (const cell of collectLinkCells(doc, resolved.schema)) {
    const address = parseAddress(cell.raw);
    if (isAddressFailure(address) || address.file === null) continue;
    const target = resolveAddressFile(path, address.file);
    if (!target.endsWith('.dd.json') || !isWithin(repoRoot, target)) continue;
    if (!documents.includes(target)) documents.push(target);
  }
  return documents;
}

function planResolver(repoRoot: string): ConventionSchemaResolver {
  return new ConventionSchemaResolver({ fs: new NodeSchemaFs(), repoRoot });
}

function readPlan(
  ctx: PlanContext,
  command: string,
  path: string,
): { doc: DdDoc; text: string } | never {
  const text = ctx.fs.readText(path);
  if (text === null) {
    exitWithEnvelope(
      formatError(
        command,
        ErrorCodes.DD_DOCUMENT_INVALID,
        `no plan document at ${path}`,
        ctx.clock,
        {
          next_action: `Scaffold one with \`harness plan new <slug>\`, or point at an existing plan folder.`,
        },
      ),
      ctx.port,
    );
  }
  const doc = parse(text);
  if (Array.isArray(doc)) {
    exitWithEnvelope(
      formatError(
        command,
        ErrorCodes.DD_DOCUMENT_INVALID,
        `${path} is not a dd document`,
        ctx.clock,
        {
          details: { path, failures: doc },
          next_action: 'Fix the reported location, then re-run.',
        },
      ),
      ctx.port,
    );
  }
  return { doc, text };
}

function registerNewCommand(plan: Command, io: CliIo, deps: DdActDeps): void {
  plan
    .command('new <slug>')
    .description('Scaffold a plan as deterministic documents, one task file per phase')
    .option('--title <title>', 'human title for the plan (default: the slug)')
    .option(
      '--phase <title>',
      'a phase title; repeat for more (default: one phase, "Phase 1")',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option('--dir <dir>', `parent directory for the plan folder (default: ${DEFAULT_PLANS_DIR})`)
    .action(async (slug: string, opts: { title?: string; phase: string[]; dir?: string }) => {
      const ctx = context(io, deps);
      if (!SLUG_PATTERN.test(slug)) {
        exitWithEnvelope(
          formatError(
            'plan new',
            ErrorCodes.SCAFFOLD_INVALID_NAME,
            `invalid plan slug: ${JSON.stringify(slug)}`,
            ctx.clock,
            {
              next_action:
                'Use a lowercase, hyphenated slug, e.g. `harness plan new deterministic-documents`.',
            },
          ),
          ctx.port,
        );
      }

      const parent = opts.dir ?? DEFAULT_PLANS_DIR;
      const folder = posixJoin(
        parent.startsWith('/') ? toPosix(parent) : posixJoin(ctx.repoRoot, toPosix(parent)),
        slug,
      );
      const scaffold = buildPlanScaffold({
        slug,
        ...(opts.title !== undefined && { title: opts.title }),
        phases: opts.phase.length > 0 ? opts.phase : ['Phase 1'],
      });
      const documents = [scaffold.plan, ...scaffold.taskFiles];

      // Refuse before writing ANYTHING: a scaffold that half-lands is worse than
      // one that does not land, because the second run then has to reason about
      // which half it is looking at.
      const existing = documents
        .map((document) => posixJoin(folder, document.relativePath))
        .filter((path) => ctx.fs.exists(path));
      if (existing.length > 0) {
        exitWithEnvelope(
          formatError(
            'plan new',
            ErrorCodes.SCAFFOLD_FILE_EXISTS,
            `refusing to overwrite ${existing.length} existing document(s) under ${folder}`,
            ctx.clock,
            {
              details: { folder, existing },
              next_action: 'Choose another slug or --dir, or remove the existing plan folder.',
            },
          ),
          ctx.port,
        );
      }

      const fs = new NodeFs();
      const written: string[] = [];
      for (const document of documents) {
        const path = posixJoin(folder, document.relativePath);
        try {
          fs.mkdirp(posixDirname(path));
          fs.writeText(path, document.json);
        } catch (error) {
          exitWithEnvelope(
            formatError(
              'plan new',
              ErrorCodes.SCAFFOLD_WRITE_FAILED,
              `could not write ${path}: ${error instanceof Error ? error.message : String(error)}`,
              ctx.clock,
              { details: { folder, written }, next_action: 'Check permissions, then retry.' },
            ),
            ctx.port,
          );
        }
        written.push(path);
      }

      // Render the siblings immediately, and let the render answer the question a
      // scaffold cannot answer for itself: does `builder/plan` actually RESOLVE
      // from here? Reporting that now turns a silent failure at first validate
      // into an honest one at creation.
      const rendered: string[] = [];
      const unresolved: string[] = [];
      for (const path of written) {
        const result = await renderDocument(path, ctx.repoRoot);
        if (result.ok) {
          fs.writeText(result.sibling, result.markdown);
          rendered.push(result.sibling);
        } else {
          unresolved.push(`${path}: ${result.message}`);
        }
      }

      const data = {
        folder,
        documents: written,
        rendered,
        phases: opts.phase.length > 0 ? opts.phase : ['Phase 1'],
      };
      if (unresolved.length > 0) {
        exitWithEnvelope(
          formatDegraded(
            'plan new',
            { ...data, unresolved },
            `The plan was written, but its markdown could not be rendered — most often because the \`builder/plan\` schema package does not resolve from ${folder}. Run \`harness dd schema list\` to see which roots are searched, then re-render with \`harness plan render ${folder}\`.`,
            ctx.clock,
          ),
          ctx.port,
        );
      }
      exitWithEnvelope(
        formatOk('plan new', data, ctx.clock, {
          evidence: written.map((path) => ({ label: 'plan document', path })),
          next_action: `Fill in the phases, then run \`harness plan validate ${folder}\`.`,
        }),
        ctx.port,
      );
    });
}

function registerValidateCommand(plan: Command, io: CliIo, deps: DdActDeps): void {
  plan
    .command('validate <target>')
    .description('Validate a plan and the task files it links to')
    .option('--depth <n>', 'outbound traversal depth (0 = the plan document only)', '3')
    .action(async (target: string, opts: { depth: string }) => {
      const ctx = context(io, deps);
      const path = resolvePlanDocument(target, ctx.repoRoot);
      const depth = Number(opts.depth);
      if (!Number.isInteger(depth) || depth < 0) {
        exitWithEnvelope(
          formatError(
            'plan validate',
            ErrorCodes.INVALID_ARGS,
            `--depth must be a non-negative integer, got "${opts.depth}"`,
            ctx.clock,
            { next_action: 'Re-run with `--depth 0` or a positive integer.' },
          ),
          ctx.port,
        );
      }

      const { doc } = readPlan(ctx, 'plan validate', path);
      const loader = new FsDocLoader(
        ctx.fs,
        new NodeHash(),
        depth === 0 ? null : await trackedPaths(new NodeExec(), ctx.repoRoot),
      );
      const issues: Array<DdIssue & { code: string }> = validateWalk(
        doc,
        path,
        { schemaResolver: planResolver(ctx.repoRoot), docLoader: loader },
        { repoRoot: ctx.repoRoot, depth, mode: 'direct' },
      ).map((issue) => ({ ...issue, code: DD_ISSUE_CODES[issue.class] }));

      const data = {
        path,
        depth,
        counts: {
          error: issues.filter((issue) => issue.severity === 'ERROR').length,
          warn: issues.filter((issue) => issue.severity === 'WARN').length,
        },
        issues,
      };
      const blocking = issues.find((issue) => issue.severity === 'ERROR');
      if (blocking) {
        exitWithEnvelope(
          formatError('plan validate', blocking.code, blocking.message, ctx.clock, {
            details: data,
            next_action: `Fix ${blocking.owner} at ${blocking.location}, then re-run \`harness plan validate ${target}\`.`,
          }),
          ctx.port,
        );
      }
      if (issues.length > 0) {
        exitWithEnvelope(
          formatDegraded(
            'plan validate',
            data,
            `${issues.length} WARN-class finding(s) — review them, or narrow the walk with --depth.`,
            ctx.clock,
          ),
          ctx.port,
        );
      }
      exitWithEnvelope(
        formatOk('plan validate', data, ctx.clock, {
          next_action: `Run \`harness plan render ${target}\` to regenerate the markdown.`,
        }),
        ctx.port,
      );
    });
}

function registerRenderCommand(plan: Command, io: CliIo, deps: DdActDeps): void {
  plan
    .command('render <target>')
    .description('Render a plan and every task file it links to')
    .option('--check', 'report byte drift without writing')
    .action(async (target: string, opts: { check?: boolean }) => {
      const ctx = context(io, deps);
      const path = resolvePlanDocument(target, ctx.repoRoot);
      const { doc } = readPlan(ctx, 'plan render', path);
      const documents = planDocuments(doc, path, ctx.repoRoot, doc.dd.schema);

      const fs = new NodeFs();
      const rendered: string[] = [];
      const drifted: string[] = [];
      const failed: Array<{ path: string; message: string }> = [];

      for (const document of documents) {
        const result = await renderDocument(document, ctx.repoRoot);
        if (!result.ok) {
          failed.push({ path: document, message: result.message });
          continue;
        }
        if (opts.check) {
          if (ctx.fs.readText(result.sibling) !== result.markdown) drifted.push(result.sibling);
          continue;
        }
        fs.mkdirp(posixDirname(result.sibling));
        fs.writeText(result.sibling, result.markdown);
        rendered.push(result.sibling);
      }

      const data = { path, documents, rendered, drifted, failed };
      if (failed.length > 0) {
        exitWithEnvelope(
          formatError(
            'plan render',
            ErrorCodes.DD_RENDER_FAILED,
            `${failed.length} document(s) in this plan could not be rendered`,
            ctx.clock,
            {
              details: data,
              next_action: `Run \`harness dd build ${failed[0]?.path}\` for the full diagnosis.`,
            },
          ),
          ctx.port,
        );
      }
      if (opts.check && drifted.length > 0) {
        exitWithEnvelope(
          formatError(
            'plan render',
            ErrorCodes.DD_RENDER_DRIFT,
            `${drifted.length} rendered sibling(s) drifted from their source`,
            ctx.clock,
            {
              details: data,
              next_action: `Regenerate with \`harness plan render ${target}\` and commit the result.`,
            },
          ),
          ctx.port,
        );
      }
      exitWithEnvelope(
        formatOk('plan render', data, ctx.clock, {
          ...(rendered.length > 0 && {
            evidence: rendered.map((sibling) => ({ label: 'rendered markdown', path: sibling })),
          }),
          next_action: opts.check
            ? 'Nothing to do — every rendered sibling matches its source.'
            : 'Commit each regenerated sibling alongside its document.',
        }),
        ctx.port,
      );
    });
}

/**
 * `harness plan` — a plan is a folder of deterministic documents.
 *
 * A CORE act rather than a `dd` subcommand, on cited authority (the brief asks
 * for "a first class plan verb (which uses dd under the hood)"), and the
 * distinction is real: `dd` verbs act on ONE document, while every verb here acts
 * on the whole plan — the overview plus every task file it links to. That is the
 * value the composition adds; scaffolding is just how a plan gets its first one.
 *
 * It composes dd's public seams and adds no dd surface of its own: `plan validate`
 * is dd's walk over the plan's document set, and `plan render` is `dd build`'s
 * exact render path (the same `renderDocument`, so a plan's markdown can never
 * disagree with the markdown `dd build` would have produced for the same file).
 */
export function registerPlanAct(program: Command, io: CliIo, deps: DdActDeps): void {
  const plan = program
    .command('plan')
    .description('Scaffold, validate and render plans authored as deterministic documents');
  registerNewCommand(plan, io, deps);
  registerValidateCommand(plan, io, deps);
  registerRenderCommand(plan, io, deps);
}

import type { Command } from 'commander';
import type { Clock } from '../../adapters/clock/clock-port.js';
import { SystemClock } from '../../adapters/clock/system-clock.js';
import { NodeEnv } from '../../adapters/env/node-env.js';
import { NodeExec } from '../../adapters/exec/node-exec.js';
import { NodeFs } from '../../adapters/fs/node-fs.js';
import { ExecGit } from '../../adapters/git/exec-git.js';
import type { GitPort } from '../../adapters/git/git-port.js';
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
import { resolveMapSeed, traverseCorpus } from '../../services/dd/links/index.js';
import {
  buildPlanIndex,
  itemKey,
  type PlanDocument,
  readPlanCheck,
} from '../../services/dd/plan/index.js';
import type { SchemaIssue } from '../../services/dd/schema/model.js';
import { ConventionSchemaResolver } from '../../services/dd/schema/resolve.js';
import {
  isWithin,
  posixDirname,
  posixJoin,
  resolveInRepo,
  toPosix,
} from '../../services/shared/posix-path.js';
import { renderDocument } from '../dd/build.js';
import { NodeSchemaFs } from '../dd/schema-fs.js';
import { DD_ISSUE_CODES, type DdActDeps, FsDocLoader, trackedPaths } from '../dd/shared.js';
import { renderPrBody } from './pr-body.js';
import { buildPlanScaffold } from './scaffold.js';

/** Plan folder names follow the repo's own convention: lowercase, hyphenated. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where plans live unless told otherwise — the house layout, not a new one. */
const DEFAULT_PLANS_DIR = 'docs/plans';

interface PlanContext {
  clock: Clock;
  port: ReturnType<typeof createOutputPort>;
  repoRoot: string;
  /** Absolute POSIX home, or undefined when the host cannot resolve one. */
  home: string | undefined;
  fs: NodeSchemaFs;
}

function context(io: CliIo, deps: DdActDeps): PlanContext {
  const home = new NodeEnv().home();
  return {
    clock: deps.clock ?? new SystemClock(),
    port: createOutputPort(io.mode, io.writers),
    repoRoot: toPosix(new NodeProcess().cwd()),
    home: home === undefined ? undefined : toPosix(home),
    fs: new NodeSchemaFs(),
  };
}

/**
 * Accept either the plan document or the folder that holds it.
 *
 * A plan is a folder of documents, so `harness plan validate docs/plans/065-x` is
 * the way a person thinks about it; naming `plan.dd.json` explicitly still works
 * because that is what the path resolves to either way. `resolveInRepo` does the
 * anchoring, so a Windows drive root (`C:/…`) or a UNC path is recognised as
 * already-absolute instead of being re-anchored below the repo.
 */
function resolvePlanDocument(target: string, repoRoot: string): string {
  const absolute = resolveInRepo(target, repoRoot);
  if (absolute.endsWith('.dd.json')) return absolute;
  return posixJoin(absolute, 'plan.dd.json');
}

/**
 * Every document this plan owns: the plan itself, then each task file it links
 * to. The set comes from the plan's own declared links — a task file that nothing
 * points at is not part of the plan, and one that is reached is, whatever it is
 * called or wherever it sits.
 *
 * A schema that will not resolve is a FAILURE, never a smaller set. Narrowing to
 * the plan document alone would let `plan render --check` report green while
 * never looking at a single task-file sibling — the exact shape of a check that
 * passes by not checking (P5 review F003).
 */
type PlanDocumentSet =
  | { ok: true; documents: string[] }
  | { ok: false; schema: string; message: string; issues: SchemaIssue[] };

function planDocuments(ctx: PlanContext, doc: DdDoc, path: string): PlanDocumentSet {
  const resolution = planResolver(ctx).resolveDetailed(doc.dd.schema, path);
  const record = resolution.record;
  if (!record) {
    const blocking = resolution.issues.find((issue) => issue.severity === 'ERROR');
    return {
      ok: false,
      schema: doc.dd.schema,
      message: blocking?.message ?? `schema not found: ${doc.dd.schema}`,
      issues: resolution.issues,
    };
  }
  const documents = [path];
  for (const cell of collectLinkCells(doc, record.schema)) {
    const address = parseAddress(cell.raw);
    if (isAddressFailure(address) || address.file === null) continue;
    const target = resolveAddressFile(path, address.file);
    if (!target.endsWith('.dd.json') || !isWithin(ctx.repoRoot, target)) continue;
    if (!documents.includes(target)) documents.push(target);
  }
  return { ok: true, documents };
}

/**
 * The same four roots every other dd verb searches — including `~/.dd`.
 *
 * Dropping `home` here made `plan validate` fail on a schema `dd validate`
 * resolves happily, which is the worst kind of difference: the composition
 * disagreeing with the thing it composes (P5 review F003).
 */
function planResolver(ctx: PlanContext): ConventionSchemaResolver {
  return new ConventionSchemaResolver({
    fs: ctx.fs,
    repoRoot: ctx.repoRoot,
    ...(ctx.home !== undefined && { home: ctx.home }),
  });
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
      const folder = posixJoin(resolveInRepo(parent, ctx.repoRoot), slug);
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

/**
 * Load every document of a plan, with its resolved schema — the input the
 * semantic layer reasons over.
 *
 * A document whose schema will not resolve is DROPPED from the semantic pass and
 * not silently treated as empty: the mechanical walk has already reported it as
 * an ERROR, and inventing item-level opinions about a document nobody can shape
 * would be a second, quieter wrong answer.
 */
function loadPlanDocuments(
  ctx: PlanContext,
  documents: readonly string[],
): { entries: PlanDocument[]; loader: FsDocLoader } {
  const loader = new FsDocLoader(ctx.fs, new NodeHash(), null);
  const resolver = planResolver(ctx);
  const entries: PlanDocument[] = [];
  for (const path of documents) {
    const loaded = loader.load(path);
    if (!loaded.ok) continue;
    const resolved = resolver.resolve(loaded.doc.dd.schema, loaded.path);
    if (!resolved.ok) continue;
    entries.push({ path: loaded.path, doc: loaded.doc, schema: resolved.schema });
  }
  return { entries, loader };
}

function registerValidateCommand(plan: Command, io: CliIo, deps: DdActDeps): void {
  plan
    .command('validate <target>')
    .description('Validate a plan and the task files it links to')
    .option('--depth <n>', 'outbound traversal depth (0 = the plan document only)', '3')
    .option(
      '--complete',
      'per-row accounting: every open item and every unclaimed criterion warns; green means exactly 0 errors and 0 warnings',
    )
    .option(
      '--address <address>',
      "scope the semantic checks to one address's reachable closure (implies per-row)",
    )
    .action(
      async (target: string, opts: { depth: string; complete?: boolean; address?: string }) => {
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
        // ONE implementation of "what does this plan's validator say" — the same
        // call the flow's check-kind gate makes (ac-7109). The verb reading a
        // second opinion is how a gate ends up refusing work the verb calls
        // finished, so the verb reads the gate's answer instead.
        const check = readPlanCheck(
          path,
          { schemaResolver: planResolver(ctx), docLoader: loader },
          {
            repoRoot: ctx.repoRoot,
            depth,
            ...(opts.complete === true && { complete: true }),
            ...(opts.address !== undefined && { address: opts.address }),
          },
        );
        if (!check.ok && check.reason === 'scope-unresolved') {
          exitWithEnvelope(
            formatError(
              'plan validate',
              ErrorCodes.DD_PLAN_SCOPE_UNRESOLVED,
              check.message,
              ctx.clock,
              {
                details: { path, address: opts.address },
                next_action:
                  'Resolve the address first with `harness dd link resolve <address>` to see where it stops.',
              },
            ),
            ctx.port,
          );
        }
        if (!check.ok) {
          exitWithEnvelope(
            formatError('plan validate', ErrorCodes.DD_DOCUMENT_INVALID, check.message, ctx.clock, {
              details: { path, reason: check.reason },
              next_action: 'Fix the reported location, then re-run.',
            }),
            ctx.port,
          );
        }

        const issues: Array<DdIssue & { code: string }> = check.issues.map((issue) => ({
          ...issue,
          code: DD_ISSUE_CODES[issue.class],
        }));
        const blocking = issues.find((issue) => issue.severity === 'ERROR');
        const warnCount = check.counts.warn;
        const data = {
          path,
          depth,
          mode: check.mode,
          ...(opts.address !== undefined && { address: opts.address }),
          counts: {
            error: check.counts.error,
            warn: warnCount,
            ...(check.counts.semantic ? { semantic: check.counts.semantic } : {}),
          },
          issues,
          findings: check.findings,
          ...(check.summary != null && { summary: check.summary }),
        };
        if (blocking) {
          exitWithEnvelope(
            formatError('plan validate', blocking.code, blocking.message, ctx.clock, {
              details: data,
              next_action: `Fix ${blocking.owner} at ${blocking.location}, then re-run \`harness plan validate ${target}\`.`,
            }),
            ctx.port,
          );
        }
        if (warnCount > 0) {
          const contradictions = check.counts.semantic?.contradictions ?? 0;
          exitWithEnvelope(
            formatDegraded(
              'plan validate',
              data,
              contradictions > 0
                ? `${contradictions} contradiction(s) and ${warnCount - contradictions} other WARN-class finding(s) — a row claims to be done while something it rests on is not.`
                : `${warnCount} WARN-class finding(s)${opts.complete === true ? ' — --complete is green only at exactly 0 errors and 0 warnings' : ' — review them, or narrow the walk with --depth'}.`,
              ctx.clock,
            ),
            ctx.port,
          );
        }
        exitWithEnvelope(
          formatOk('plan validate', data, ctx.clock, {
            next_action:
              opts.complete === true
                ? 'Nothing open, nothing unclaimed, nothing contradictory — this plan is complete by its own documents.'
                : (check.summary ??
                  `Run \`harness plan render ${target}\` to regenerate the markdown.`),
          }),
          ctx.port,
        );
      },
    );
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
      const documentSet = planDocuments(ctx, doc, path);
      if (!documentSet.ok) {
        exitWithEnvelope(
          formatError(
            'plan render',
            ErrorCodes.DD_SCHEMA_UNRESOLVABLE,
            `the plan's schema does not resolve, so the set of documents it owns cannot be determined: ${documentSet.message}`,
            ctx.clock,
            {
              details: { path, schema: documentSet.schema, issues: documentSet.issues },
              next_action:
                'Run `harness dd schema list` to see which schemas resolve from here, then re-run. (Rendering only the plan document would report green without checking a single task file.)',
            },
          ),
          ctx.port,
        );
      }
      const documents = documentSet.documents;

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

function registerPrBodyCommand(plan: Command, io: CliIo, deps: DdActDeps): void {
  plan
    .command('pr-body <target>')
    .description(
      "Render the plan's closed acceptance criteria, with their evidence, as PR markdown",
    )
    .option('--depth <n>', 'outbound traversal depth (0 = the plan document only)', '3')
    .option(
      '--link-base <url>',
      'absolute prefix every reference resolves against — pin it at the head sha so the links keep meaning what they meant',
    )
    .option(
      '--pin-head',
      "derive that prefix from this checkout's origin remote and HEAD commit (refuses rather than guessing a URL)",
    )
    .option('--heading <text>', 'the section heading, for composing into a larger body')
    .action(
      async (
        target: string,
        opts: { depth: string; linkBase?: string; pinHead?: boolean; heading?: string },
      ) => {
        const ctx = context(io, deps);
        const path = resolvePlanDocument(target, ctx.repoRoot);
        const depth = Number(opts.depth);
        if (!Number.isInteger(depth) || depth < 0) {
          exitWithEnvelope(
            formatError(
              'plan pr-body',
              ErrorCodes.INVALID_ARGS,
              `--depth must be a non-negative integer, got "${opts.depth}"`,
              ctx.clock,
              { next_action: 'Re-run with `--depth 0` or a positive integer.' },
            ),
            ctx.port,
          );
        }
        if (opts.pinHead === true && opts.linkBase !== undefined) {
          exitWithEnvelope(
            formatError(
              'plan pr-body',
              ErrorCodes.INVALID_ARGS,
              '--pin-head and --link-base both set the prefix; passing both leaves which one wins to luck',
              ctx.clock,
              {
                next_action:
                  'Pass one: `--pin-head` to derive it, `--link-base <url>` to state it.',
              },
            ),
            ctx.port,
          );
        }

        let linkBase = opts.linkBase ?? null;
        let pinnedSha: string | null = null;
        if (opts.pinHead === true) {
          const pinned = headBlobBase(new ExecGit(ctx.repoRoot));
          if (!pinned.ok) {
            exitWithEnvelope(
              formatError('plan pr-body', ErrorCodes.INVALID_ARGS, pinned.reason, ctx.clock, {
                next_action: pinned.hint,
              }),
              ctx.port,
            );
          }
          linkBase = pinned.base;
          pinnedSha = pinned.sha;
        }

        // Reads the plan document first so an unreadable/unresolvable one fails
        // here, with `plan pr-body`'s own message, rather than as a puzzling empty
        // index later.
        readPlan(ctx, 'plan pr-body', path);
        const loader = new FsDocLoader(
          ctx.fs,
          new NodeHash(),
          depth === 0 ? null : await trackedPaths(new NodeExec(), ctx.repoRoot),
        );
        // The SAME reading the validator and the departure gate take. A PR table
        // built from a second walk of the same documents could disagree with the
        // gate that let the work depart, and nobody downstream could tell which
        // account was wrong.
        const check = readPlanCheck(
          path,
          { schemaResolver: planResolver(ctx), docLoader: loader },
          { repoRoot: ctx.repoRoot, depth },
        );
        if (!check.ok || check.index === null) {
          exitWithEnvelope(
            formatError(
              'plan pr-body',
              ErrorCodes.DD_DOCUMENT_INVALID,
              check.ok
                ? 'the plan does not validate, so its criteria cannot be rendered as proof of anything'
                : check.message,
              ctx.clock,
              {
                details: { path },
                next_action: `Run \`harness plan validate ${target}\` and fix what it reports first.`,
              },
            ),
            ctx.port,
          );
        }

        const body = renderPrBody(check.index, {
          linkBase,
          ...(opts.heading !== undefined && { heading: opts.heading }),
        });
        if (!body.ok) {
          exitWithEnvelope(
            formatError('plan pr-body', ErrorCodes.DD_PLAN_INCOMPLETE, body.message, ctx.clock, {
              details: { path, reason: body.reason, open: body.open },
              next_action: body.next_action,
            }),
            ctx.port,
          );
        }
        exitWithEnvelope(
          formatOk(
            'plan pr-body',
            {
              path,
              markdown: body.markdown,
              criteria: body.criteria,
              count: body.criteria.length,
              ...(linkBase !== null && { link_base: linkBase }),
              ...(pinnedSha !== null && { pinned_sha: pinnedSha }),
            },
            ctx.clock,
            {
              next_action:
                'Paste `data.markdown` into the pull-request body, or pipe it there — every reference is already resolved.',
            },
          ),
          ctx.port,
        );
      },
    );
}

/**
 * The blob-URL prefix for THIS checkout, pinned at the commit the PR is opened on.
 *
 * Derived rather than assembled in prompt-ware, for the reason the plan's risk
 * register gives: broken PR links would discredit the surface on day one, and a
 * stage doc that says "concatenate the remote, the word blob, and the sha" is a
 * link-builder that works until somebody's remote is an SSH URL or their default
 * branch moved. It also has to be a SHA and not a branch — a branch-based link
 * silently starts pointing at different content the moment the branch advances,
 * which is the same class of quiet staleness the archive rewrite exists to stop.
 *
 * Returns a REASON when it cannot, never a plausible guess: an unrecognised
 * remote host, a detached/empty repository, or no remote at all each produce a
 * refusal the caller reports, so nobody pastes a 404 into a pull request.
 */
export function headBlobBase(
  git: GitPort,
): { ok: true; base: string; sha: string } | { ok: false; reason: string; hint: string } {
  const remote = git.remoteUrl();
  if (remote === null || remote.length === 0) {
    return {
      ok: false,
      reason:
        'this checkout has no `origin` remote, so there is no host to build blob links against',
      hint: 'Pass the prefix yourself with `--link-base <url>`, or add an origin remote.',
    };
  }
  const sha = git.currentCommit();
  if (sha === null) {
    return {
      ok: false,
      reason: 'HEAD does not resolve to a commit, so there is no revision to pin the links at',
      hint: 'Commit the work first — a link pinned at a branch silently changes meaning when the branch moves. Or state the prefix yourself with `--link-base <url>`.',
    };
  }
  // Both shapes git hands out for the same repository.
  const match =
    /^git@([^:]+):(.+?)(?:\.git)?$/.exec(remote) ??
    /^(?:https?|ssh):\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
  const host = match?.[1];
  const slug = match?.[2];
  if (host === undefined || slug === undefined) {
    return {
      ok: false,
      reason: `the origin remote is not a shape blob links can be built from: ${remote}`,
      hint: 'Pass the prefix yourself with `--link-base https://<host>/<owner>/<repo>/blob/<sha>/`.',
    };
  }
  return { ok: true, base: `https://${host}/${slug}/blob/${sha}/`, sha };
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
  registerPrBodyCommand(plan, io, deps);
}

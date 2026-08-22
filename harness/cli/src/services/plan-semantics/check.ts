import { isAddressFailure, parseAddress } from '@ai-substrate/dd';
import type { DdDoc } from '@ai-substrate/dd/core/model';
import {
  collectLinkCells,
  type DdIssue,
  resolveAddressFile,
  type SchemaResolver,
} from '@ai-substrate/dd/core/validate';
import { type DocLoader, validateWalk } from '@ai-substrate/dd/core/walk';
import { resolveMapSeed, traverseCorpus } from '@ai-substrate/dd/links';
import type { SchemaResolution } from '@ai-substrate/dd/schema';
import { isWithin, resolveInRepo } from '../shared/posix-path.js';
import { buildPlanIndex, itemKey, type PlanDocument } from './index-plan.js';
import type { PlanFinding, PlanIndex, PlanSemanticResult } from './model.js';
import { readPlanSemantics, scopeFrom } from './semantics.js';

/**
 * The whole `plan validate` verdict as ONE pure computation — mechanical half,
 * semantic half, and the green/not-green answer that follows from both.
 *
 * It exists because two callers need that verdict and they must never disagree:
 * the `harness plan validate` verb, and the flow's CHECK-KIND departure gate
 * (ac-7109). A gate that re-derived "green" would be a second opinion about the
 * same documents, and the day the two drifted, the gate would either refuse work
 * the verb calls finished or wave through work it calls broken. Neither failure is
 * discoverable from the outside. So there is one implementation, and the verb and
 * the gate are both thin over it.
 *
 * Pure over injected `schemaResolver` + `docLoader`, exactly like every other dd
 * layer: no filesystem, no clock, no envelope. That is what lets the gate matrix
 * drive a refusal without a repository on disk.
 */

/**
 * The check vocabulary a flow node may name — FROZEN, and deliberately not open.
 *
 * An unknown check kind is refused rather than defaulted, because every plausible
 * default is a lie: treating it as `plan-validate` runs a check the author did not
 * ask for, and treating it as "no check" silently downgrades a gate the author
 * believed they had. Refusing says the true thing — this flow asks for a check
 * this CLI does not have.
 */
export const PLAN_CHECK_KINDS = ['plan-validate'] as const;

export type PlanCheckKind = (typeof PLAN_CHECK_KINDS)[number];

export function isPlanCheckKind(value: unknown): value is PlanCheckKind {
  return typeof value === 'string' && (PLAN_CHECK_KINDS as readonly string[]).includes(value);
}

/** The schema seam: the narrow resolver plus the richer read the gate-terminal set hangs off. */
export interface PlanCheckSchemaResolver extends SchemaResolver {
  resolveDetailed(schemaRef: string, fromPath?: string): SchemaResolution;
}

export interface PlanCheckDeps {
  schemaResolver: PlanCheckSchemaResolver;
  docLoader: DocLoader;
}

export interface PlanCheckOptions {
  /** Absolute POSIX-logical repo root — relative addresses anchor here. */
  repoRoot: string;
  /** Outbound validate-walk depth, mirroring `plan validate --depth` (default 3). */
  depth?: number;
  /** Per-row accounting (`--complete`): every open row and unclaimed claim warns. */
  complete?: boolean;
  /** Scope the semantic half to one address's closure (`--address`); implies per-row. */
  address?: string | null;
}

export type PlanCheckFailureReason =
  /** No document at the path, or it is not a dd document. */
  | 'plan-unreadable'
  /** The document is a dd document whose schema cannot be read. */
  | 'schema-unresolvable'
  /** `--address` was given and does not name a row inside this plan. */
  | 'scope-unresolved';

export interface PlanCheckFailure {
  ok: false;
  reason: PlanCheckFailureReason;
  path: string;
  /** Verbatim from the layer that refused — never re-worded on the way up. */
  message: string;
}

export interface PlanCheckReading {
  ok: true;
  /** Absolute path of the plan document. */
  path: string;
  /** The plan document's content sha at evaluation time. */
  sha: string;
  /** The schema that governs the plan document. */
  schema: string;
  mode: 'complete' | 'scoped' | 'summary';
  /** The `--address` scope, when one was given. */
  address: string | null;
  /**
   * Zero errors and zero warnings. Under `complete` that is the strict-zero bar
   * ac-7107 rules; mid-flight it means "well-formed and not self-contradictory",
   * which is the honest reading of a run that was never asked about open rows.
   */
  green: boolean;
  /** The mechanical findings, unchanged — `dd validate`'s answer, not a new one. */
  issues: DdIssue[];
  /** The semantic findings, or `[]` when a blocking mechanical error stopped the read. */
  findings: PlanFinding[];
  counts: {
    error: number;
    warn: number;
    semantic: PlanSemanticResult['counts'] | null;
  };
  /** The one mid-flight summary line, when not in per-row mode. */
  summary: string | null;
  /** Every document this plan is accountable for, plan document first. */
  documents: string[];
  /**
   * The flattened item graph the semantic layer reasoned over, or `null` when a
   * blocking mechanical error stopped the read before one could be built.
   *
   * Exposed for the PR-body renderer (ac-7112), which must describe the SAME
   * corpus this verdict was reached on. Rebuilding the index at the act would be a
   * second reading of the same documents, and a PR table that disagreed with the
   * gate that let the work depart is precisely the loss this surface exists to
   * prevent.
   */
  index: PlanIndex | null;
}

export type PlanCheckResult = PlanCheckReading | PlanCheckFailure;

/**
 * Turn a check-gate address into the plan document to check and the scope to
 * check it at.
 *
 * TWO FORMS, deliberately. A check gate names a whole plan
 * (`docs/plans/071-x/plan.dd.json`) far more often than a row inside one, and a
 * bare path is not a dd ADDRESS at all — `parseAddress` requires exactly one `#`,
 * because an address's whole job is to name an interior. So a `#`-less string is
 * read as the document itself, and a full address is parsed and its interior kept
 * as the scope. One field on the link carries both, and the common case does not
 * have to write `#` followed by nothing.
 */
export function resolvePlanAddress(
  address: string,
  repoRoot: string,
): { ok: true; path: string; scope: string | null } | { ok: false; message: string } {
  const trimmed = address.trim();
  if (trimmed.length === 0) return { ok: false, message: 'the check gate has no address' };

  let file = trimmed;
  let scope: string | null = null;
  if (trimmed.includes('#')) {
    const parsed = parseAddress(trimmed);
    if (isAddressFailure(parsed)) return { ok: false, message: parsed.message };
    if (parsed.file === null) {
      return {
        ok: false,
        message: `a bare-"#" address names no plan document to check: ${address}`,
      };
    }
    file = parsed.file;
    scope = parsed.segments.length > 0 ? trimmed : null;
  }

  const path = resolveInRepo(file, repoRoot);
  if (!isWithin(repoRoot, path)) {
    return { ok: false, message: `address resolves outside the repository: ${path}` };
  }
  return { ok: true, path, scope };
}

function failure(reason: PlanCheckFailureReason, path: string, message: string): PlanCheckFailure {
  return { ok: false, reason, path, message };
}

/**
 * The documents a plan is accountable for: itself, plus every `.dd.json` it links
 * to inside the repository.
 *
 * A link that does not resolve, points outside the repo, or names a non-dd file is
 * SKIPPED rather than refused — those are mechanical findings `validateWalk`
 * already owns, and refusing here would make the semantic layer report the same
 * problem in a second, worse voice.
 */
export function planDocumentSet(
  doc: DdDoc,
  path: string,
  schema: PlanCheckSchemaResolver,
  repoRoot: string,
): { ok: true; documents: string[] } | { ok: false; message: string } {
  const resolution = schema.resolveDetailed(doc.dd.schema, path);
  const record = resolution.record;
  if (!record) {
    const blocking = resolution.issues.find((issue) => issue.severity === 'ERROR');
    return { ok: false, message: blocking?.message ?? `schema not found: ${doc.dd.schema}` };
  }
  const documents = [path];
  for (const cell of collectLinkCells(doc, record.schema)) {
    const address = parseAddress(cell.raw);
    if (isAddressFailure(address) || address.file === null) continue;
    const target = resolveAddressFile(path, address.file);
    if (!target.endsWith('.dd.json') || !isWithin(repoRoot, target)) continue;
    if (!documents.includes(target)) documents.push(target);
  }
  return { ok: true, documents };
}

/** Load every document in the set that loads and resolves; skip the ones that do not. */
function loadPlanDocuments(documents: readonly string[], deps: PlanCheckDeps): PlanDocument[] {
  const entries: PlanDocument[] = [];
  for (const path of documents) {
    const loaded = deps.docLoader.load(path);
    if (!loaded.ok) continue;
    const resolved = deps.schemaResolver.resolve(loaded.doc.dd.schema, loaded.path);
    if (!resolved.ok) continue;
    entries.push({ path: loaded.path, doc: loaded.doc, schema: resolved.schema });
  }
  return entries;
}

/**
 * Read a plan's full verdict.
 *
 * Order matters and is the verb's, preserved exactly: the mechanical walk runs
 * first, and a BLOCKING mechanical error stops the semantic read. Asking whether a
 * plan's story hangs together is meaningless while the documents are malformed,
 * and answering it anyway would bury the one finding that must be fixed first
 * under a pile of consequences.
 */
export function readPlanCheck(
  planPath: string,
  deps: PlanCheckDeps,
  options: PlanCheckOptions,
): PlanCheckResult {
  const loaded = deps.docLoader.load(planPath);
  if (!loaded.ok) return failure('plan-unreadable', planPath, loaded.message);

  const detailed = deps.schemaResolver.resolveDetailed(loaded.doc.dd.schema, loaded.path);
  const record = detailed.record;
  if (record === undefined) {
    const blocking = detailed.issues.find((issue) => issue.severity === 'ERROR');
    return failure(
      'schema-unresolvable',
      planPath,
      blocking?.message ?? `schema not found: ${loaded.doc.dd.schema}`,
    );
  }

  const set = planDocumentSet(loaded.doc, loaded.path, deps.schemaResolver, options.repoRoot);
  if (!set.ok) return failure('schema-unresolvable', planPath, set.message);

  const issues = validateWalk(loaded.doc, loaded.path, deps, {
    repoRoot: options.repoRoot,
    depth: options.depth ?? 3,
    mode: 'direct',
  });
  const errors = issues.filter((issue) => issue.severity === 'ERROR');
  const mechanicalWarns = issues.filter((issue) => issue.severity === 'WARN').length;

  const mode: PlanCheckReading['mode'] =
    options.complete === true ? 'complete' : options.address != null ? 'scoped' : 'summary';
  const base = {
    ok: true as const,
    path: loaded.path,
    sha: loaded.sha,
    schema: record.name,
    mode,
    address: options.address ?? null,
    issues,
    documents: set.documents,
  };

  if (errors.length > 0) {
    return {
      ...base,
      green: false,
      findings: [],
      counts: { error: errors.length, warn: mechanicalWarns, semantic: null },
      summary: null,
      index: null,
    };
  }

  const entries = loadPlanDocuments(set.documents, deps);
  const corpus = traverseCorpus(
    entries.map((entry) => entry.path),
    deps,
    { repoRoot: options.repoRoot, mode: 'direct', follow: false },
  );
  const index = buildPlanIndex(entries, corpus.edges, options.repoRoot);

  let scope: ReadonlySet<string> | undefined;
  if (options.address != null) {
    const seed = resolveMapSeed(options.address, deps, { repoRoot: options.repoRoot });
    if (!seed.ok) {
      return failure(
        'scope-unresolved',
        planPath,
        seed.issues[0]?.message ?? `address did not resolve: ${options.address}`,
      );
    }
    const key = itemKey(seed.path, seed.interior);
    if (!index.byKey.has(key)) {
      return failure(
        'scope-unresolved',
        planPath,
        `${options.address} resolves, but not to a row inside this plan`,
      );
    }
    scope = scopeFrom(index, key);
  }

  const semantic = readPlanSemantics(index, {
    ...(options.complete === true && { complete: true }),
    ...(scope !== undefined && { scope }),
  });
  const warn = mechanicalWarns + semantic.findings.length;

  return {
    ...base,
    green: warn === 0,
    findings: semantic.findings,
    counts: { error: 0, warn, semantic: semantic.counts },
    summary: semantic.summary,
    index,
  };
}

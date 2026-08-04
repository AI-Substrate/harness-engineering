import {
  type DocLoader,
  resolveLink,
  type SchemaResolver,
  verifyBasis,
} from '../dd/links/index.js';
import {
  isPlanCheckKind,
  type PlanCheckReading,
  type PlanCheckResult,
  readPlanCheck,
  resolvePlanAddress,
} from '../dd/plan/index.js';
import {
  type DdSchemaItem,
  type DdSection,
  deriveSchemaItems,
  deriveSchemaState,
  type SchemaRecord,
  type SchemaResolution,
} from '../dd/schema/index.js';
import { type DdLink, type DdLinkReading, ddLinkCheck } from './flow-events.js';

/**
 * The flow spine's dd gate (plan 065 Phase 6; workshop-002 Ruling 1; AC-10/AC-11).
 *
 * This module answers ONE question — "is the dd address this node links to
 * complete?" — and answers it by composing dd's published SDK seams rather than
 * re-implementing any of them:
 *
 *   - `resolveLink` (links) turns the address into a target: which document, which
 *     part of it, and the document's content sha;
 *   - `resolveDetailed` (schema) yields the target schema's OWN `gate_terminal`
 *     set, so a custom enum genuinely changes what "complete" means here;
 *   - `deriveSchemaState` / `deriveSchemaItems` (schema) compute the aggregate
 *     reading and the per-item states over that set;
 *   - `verifyBasis` (links) answers the separate, non-gating question of whether
 *     the target has moved since the recorded basis.
 *
 * **Every import above comes from a dd BARREL — `dd/links/index.js` and
 * `dd/schema/index.js` — and nothing here may ever import a dd module path.** The
 * flow is an external consumer of dd, and the difference between an SDK and a
 * shared folder is exactly this line. When the gate needs something dd does not
 * export, the fix is to expose a named seam on a barrel deliberately (as
 * `deriveSchemaItems` was, for the per-item read this file's refusal message
 * needs) — never to reach past one. The `flow-consumes-dd-sdk-only`
 * dependency-cruiser rule and `flow-dd-sdk-seam.test.ts` refuse the alternative.
 *
 * Nothing about the gate's *policy* lives in dd. The split is deliberate: dd
 * computes completion, the flow decides what completion is allowed to stop. Which
 * is why this file is pure over injected dependencies — it has no filesystem, no
 * clock, no envelope and no exit, and the act layer supplies the real adapters
 * exactly as it does for every dd verb.
 */

/**
 * The schema seam the gate needs: the frozen one-method `SchemaResolver` that
 * `resolveLink` consumes, PLUS the richer read that carries `gateTerminal`.
 *
 * The narrow seam alone is not enough. `SchemaResolver.resolve` returns the
 * `ResolvedDdSchema` the validator wants, and the gate-terminal set is
 * deliberately NOT on it — it is resolved once per schema package by the
 * declaration parser and hangs off the `SchemaRecord`. Asking for both is how the
 * gate reads the schema's declared terminal set instead of assuming the built-in
 * one, which is the difference between honouring workshop-002 Ruling 2 and
 * quietly ignoring it. `ConventionSchemaResolver` satisfies this structurally.
 */
export interface DdGateSchemaResolver extends SchemaResolver {
  resolveDetailed(schemaRef: string, fromPath?: string): SchemaResolution;
}

export interface DdGateDeps {
  schemaResolver: DdGateSchemaResolver;
  docLoader: DocLoader;
}

export interface DdGateOptions {
  /** Absolute POSIX-logical repo root — relative addresses anchor here. */
  repoRoot: string;
  /**
   * Absolute path of the document the address is written in. A flow's `dd_link`
   * is written in a `the-flow.json`, which is NOT a dd document, so the flow
   * passes `null`: relative addresses then anchor at the repo root, and a bare-`#`
   * address is reported rather than guessed (`resolveLink`'s no-base-document).
   */
  fromPath?: string | null;
}

/** Why a gate could not be evaluated — each maps 1:1 onto an E44x at the act. */
export type DdGateFailureReason =
  /** The `dd_link` carries no usable `address`. */
  | 'link-missing'
  /** The address does not resolve to anything in the repository. */
  | 'target-invalid'
  /** The target resolved, but its schema could not be read. */
  | 'schema-unresolvable'
  /** The link names a `check` this CLI does not implement. */
  | 'check-unknown';

export interface DdGateFailure {
  ok: false;
  reason: DdGateFailureReason;
  /** The address as written, for the diagnostic. */
  address: string;
  /** Human-readable cause, taken verbatim from the dd layer where there is one. */
  message: string;
}

export interface DdGateReading {
  ok: true;
  /**
   * Which question this gate asked. `completion` reads gate-terminal items at the
   * address; `check` runs a named validator over the plan at the address.
   */
  kind: 'completion' | 'check';
  /** The check the link named, for a `check`-kind reading. */
  check?: string;
  /** The address as written. */
  address: string;
  /** Absolute path of the resolved target document. */
  path: string;
  /** The target document's content sha at evaluation time. */
  sha: string;
  /** The schema that computed the reading. */
  schema: string;
  /** The gate-terminal set the schema declared (or dd's built-in default). */
  gate_terminal: readonly string[];
  /** Whether every collected item is gate-terminal — the gate's verdict. */
  complete: boolean;
  /** Gate-terminal item count. */
  terminal: number;
  /** Total collected item count. */
  total: number;
  /** Ids of the items that are not gate-terminal, in document order. */
  incomplete: string[];
  /** EVERY item with the state it carries, in document order (AC-11's per-item read). */
  items: DdGateItem[];
  /**
   * Check-kind only: what the validator said, QUOTED. Empty on a green check.
   *
   * These messages are produced by the validator and reproduced by the refusal
   * without interpretation — see {@link evaluateCheckGate}.
   */
  findings: DdGateFinding[];
}

/**
 * One thing the validator said, carried to the refusal unchanged.
 *
 * Every field here is data the CLI itself produced from a document's STRUCTURE —
 * never a string a document supplied. `message` is the validator's own sentence
 * (which may quote an address the document contains), and it is treated as text to
 * print, never as something to execute, resolve or believe: the untrusted-reading
 * discipline F004/F007 established for `dd_link` counts applies to gate findings
 * for the same reason, and is pinned by test.
 */
export interface DdGateFinding {
  /** `ERROR` or `WARN`, from the layer that produced it. */
  severity: string;
  /** The mechanical issue class or the semantic finding class. */
  class: string;
  /** The address or document location the finding is about. */
  address: string;
  /** The validator's own words — reproduced verbatim, never re-worded. */
  message: string;
}

/** One gated item: what it is called, what state it is in, and whether that passes. */
export type DdGateItem = DdSchemaItem;

export type DdGateResult = DdGateReading | DdGateFailure;

function failure(reason: DdGateFailureReason, address: string, message: string): DdGateFailure {
  return { ok: false, reason, address, message };
}

/**
 * Every item the section carries, in document order, each labelled with its state.
 *
 * Delegated wholesale to `deriveSchemaItems` — the dd SDK seam exposed for exactly
 * this read. An item whose state is outside every vocabulary the schema declares is
 * REPORTED WITH THE STATE IT ACTUALLY CARRIES, never refused and never flattened:
 * an out-of-vocabulary state is a document-validation finding `dd validate` already
 * owns, and the gate's answer for it is simply "not terminal", which it already is.
 * Naming it is what lets the refusal distinguish one bad state from another.
 */
function itemsOf(record: SchemaRecord, section: DdSection): DdGateItem[] {
  return deriveSchemaItems(record, section);
}

/**
 * Evaluate one `dd_link` — LIVE, every time.
 *
 * There is deliberately no caching and no short-circuit on a previously-recorded
 * `reading`. The recorded reading is a display artifact (see `DdLinkReading`); if
 * it were consulted here, ticking the last box in a linked document would not
 * open the gate, and un-ticking one would not close it. Both directions are
 * pinned by the gate matrix.
 */
export function evaluateDdGate(
  link: DdLink,
  deps: DdGateDeps,
  options: DdGateOptions,
): DdGateResult {
  const address = typeof link.address === 'string' ? link.address.trim() : '';
  if (address.length === 0) {
    return failure(
      'link-missing',
      String(link.address ?? ''),
      'the node carries a dd_link with no address',
    );
  }

  const check = ddLinkCheck(link);
  if (check !== undefined) return evaluateCheckGate(check, address, deps, options);

  const resolution = resolveLink(
    address,
    { schemaResolver: deps.schemaResolver, docLoader: deps.docLoader },
    { repoRoot: options.repoRoot, fromPath: options.fromPath ?? null },
  );
  if (!resolution.ok) {
    const issue = resolution.issues[0];
    // `schema-unresolvable` is separated from every other unresolved reason: an
    // address that names a real document whose schema cannot be read is a
    // different fix (install/repair the schema package) from an address that names
    // nothing (fix the address), and the two answer to different E-codes.
    const reason: DdGateFailureReason =
      issue?.reason === 'schema-unresolvable' ? 'schema-unresolvable' : 'target-invalid';
    return failure(reason, address, issue?.message ?? `address does not resolve: ${address}`);
  }

  const { target } = resolution;
  const detailed = deps.schemaResolver.resolveDetailed(target.schema, target.path);
  const record = detailed.record;
  if (record === undefined) {
    const blocking = detailed.issues.find((issue) => issue.severity === 'ERROR');
    return failure(
      'schema-unresolvable',
      address,
      blocking?.message ?? `schema "${target.schema}" could not be resolved for ${target.path}`,
    );
  }

  // The resolved target may be a whole section, one instance, or one part. Only
  // sections are `DdSection`s, so the value is wrapped: `deriveState` collects
  // `state` entries structurally from whatever it is handed, which is exactly what
  // lets a node gate on `#tasks` (a section) or on `#evidence/tk-9f2a` (one task's
  // evidence list) with the same call and the same meaning.
  const section: DdSection = { name: address, value: target.value };
  const derived = deriveSchemaState(record, section);

  return {
    ok: true,
    kind: 'completion',
    address,
    path: target.path,
    sha: target.sha,
    schema: record.name,
    gate_terminal: record.gateTerminal,
    complete: derived.complete,
    terminal: derived.terminal,
    total: derived.total,
    incomplete: derived.incomplete,
    items: itemsOf(record, section),
    findings: [],
  };
}

/**
 * The CHECK-kind gate (ac-7109): does the plan at this address pass its own
 * validator?
 *
 * The verdict is not re-derived here. `readPlanCheck` is the single implementation
 * `harness plan validate` runs too, reached through dd's `plan` barrel like every
 * other seam this file uses — so "the gate says green" and "the verb says green"
 * are the same sentence, not two implementations that agree until they do not.
 *
 * `--complete` is not optional for a gate. A departure is a completion claim, and
 * the mid-flight posture (opens as one info line, ac-7107) exists precisely so a
 * human reading a half-built plan is not nagged. A gate asking the mid-flight
 * question would pass a plan with every row still open, which is the one thing it
 * exists to stop.
 *
 * The address's INTERIOR, when it has one, scopes the check — so a phase node can
 * gate on its own subgraph and a last-review node on the whole plan, with one
 * mechanism and no second field. `resolveLink`'s job (which document?) and
 * `readPlanCheck`'s job (which rows?) meet at the same string.
 *
 * ONE ASSERTION, so the counts stay honest: a check gate asks a single question, so
 * `total` is 1 and `terminal` is 1 exactly when the answer is green. Reporting the
 * finding count as `total` would render `0/17 ✓` on a plan whose real problem is
 * that seventeen things are wrong — a badge that gets worse as you fix them.
 */
function evaluateCheckGate(
  check: string,
  address: string,
  deps: DdGateDeps,
  options: DdGateOptions,
): DdGateResult {
  if (!isPlanCheckKind(check)) {
    return failure(
      'check-unknown',
      address,
      `the node gates on check "${check}", which this CLI does not implement`,
    );
  }

  const target = resolvePlanAddress(address, options.repoRoot);
  if (!target.ok) return failure('target-invalid', address, target.message);

  const result = readPlanCheck(target.path, deps, {
    repoRoot: options.repoRoot,
    complete: true,
    address: target.scope,
  });
  if (!result.ok) return checkFailure(result, address);

  return {
    ok: true,
    kind: 'check',
    check,
    address,
    path: result.path,
    sha: result.sha,
    schema: result.schema,
    gate_terminal: [`${check} green`],
    complete: result.green,
    terminal: result.green ? 1 : 0,
    total: 1,
    incomplete: result.green ? [] : [address],
    items: [{ id: address, state: result.green ? 'green' : 'not-green', terminal: result.green }],
    findings: findingsOf(result),
  };
}

/** A plan-check refusal, mapped onto the gate's own failure vocabulary. */
function checkFailure(
  result: Extract<PlanCheckResult, { ok: false }>,
  address: string,
): DdGateFailure {
  const reason: DdGateFailureReason =
    result.reason === 'schema-unresolvable' ? 'schema-unresolvable' : 'target-invalid';
  return failure(reason, address, result.message);
}

/**
 * The validator's findings, mechanical first, each carrying the words the layer
 * that found it chose.
 *
 * Nothing is summarised, truncated or re-phrased. A gate that says "5 problems"
 * sends the reader back to the command line to ask what they were, which is the
 * refusal doing half its job; and a gate that re-words a finding invents a second
 * vocabulary for the same problem.
 */
function findingsOf(result: PlanCheckReading): DdGateFinding[] {
  const mechanical: DdGateFinding[] = result.issues.map((issue) => ({
    severity: issue.severity,
    class: issue.class,
    address: issue.location ?? issue.owner,
    message: issue.message,
  }));
  const semantic: DdGateFinding[] = result.findings.map((finding) => ({
    severity: finding.severity,
    class: finding.class,
    address: finding.address,
    message: finding.message,
  }));
  return [...mechanical, ...semantic];
}

/** Project a live reading into the recorded, renderer-visible form. */
export function readingOf(result: DdGateReading, at: string): DdLinkReading {
  return {
    status: result.complete ? 'complete' : 'incomplete',
    terminal: result.terminal,
    total: result.total,
    incomplete: [...result.incomplete],
    at,
  };
}

export interface DdGateDrift {
  address: string;
  path: string;
  /** The sha recorded on the node at the last evaluation. */
  recorded: string;
  /** The target document's sha now. */
  actual: string;
}

/**
 * Has the target moved since the basis was recorded? (workshop-001; T004.)
 *
 * Drift is INFORMATION, never a refusal — a moved upstream document means the
 * recorded reading can no longer be trusted, not that the gate has failed. So this
 * returns `null` for "nothing to say" in every ambiguous case: no recorded basis
 * (nothing to compare), an unresolvable address (the gate itself reports that),
 * or a fresh verdict. Only a genuine `stale` produces a warning.
 */
export function ddGateDrift(
  link: DdLink,
  deps: DdGateDeps,
  options: DdGateOptions,
): DdGateDrift | null {
  const address = typeof link.address === 'string' ? link.address.trim() : '';
  const recorded = link.basis_sha;
  if (address.length === 0 || typeof recorded !== 'string' || recorded.length === 0) return null;
  const result = verifyBasis(
    address,
    recorded,
    { schemaResolver: deps.schemaResolver, docLoader: deps.docLoader },
    { repoRoot: options.repoRoot, fromPath: options.fromPath ?? null },
  );
  if (!result.ok || result.verdict.state === 'fresh') return null;
  return {
    address,
    path: result.verdict.path,
    recorded: result.verdict.recorded,
    actual: result.verdict.actual,
  };
}

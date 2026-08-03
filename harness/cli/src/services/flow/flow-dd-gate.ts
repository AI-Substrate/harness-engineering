import { deriveState } from '../dd/core/derive.js';
import type { DdSection } from '../dd/core/model.js';
import type { SchemaResolver } from '../dd/core/validate.js';
import type { DocLoader } from '../dd/core/walk.js';
import { resolveLink, verifyBasis } from '../dd/links/index.js';
import {
  BUILTIN_COMPLETION_ENUM,
  deriveSchemaState,
  type SchemaRecord,
  type SchemaResolution,
} from '../dd/schema/index.js';
import type { DdLink, DdLinkReading } from './flow-events.js';

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
 *   - `deriveSchemaState` (schema → core `deriveState`) computes the reading over
 *     that set;
 *   - `verifyBasis` (links) answers the separate, non-gating question of whether
 *     the target has moved since the recorded basis.
 *
 * Nothing in dd is reached into directly, and nothing about the gate's *policy*
 * lives in dd. The split is deliberate: dd computes completion, the flow decides
 * what completion is allowed to stop. Which is why this file is pure over injected
 * dependencies — it has no filesystem, no clock, no envelope and no exit, and the
 * act layer supplies the real adapters exactly as it does for every dd verb.
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
  | 'schema-unresolvable';

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
}

/** One gated item: what it is called, what state it is in, and whether that passes. */
export interface DdGateItem {
  id: string;
  /**
   * The item's state value, or `'unknown'` when it is outside every vocabulary the
   * schema declares. Unknown is REPORTED rather than refused: an out-of-vocabulary
   * state is a document-validation finding that `dd validate` already owns, and the
   * gate's answer for it is simply "not terminal", which it already is.
   */
  state: string;
  terminal: boolean;
}

export type DdGateResult = DdGateReading | DdGateFailure;

function failure(reason: DdGateFailureReason, address: string, message: string): DdGateFailure {
  return { ok: false, reason, address, message };
}

/**
 * Every item the section carries, in document order, each labelled with its state.
 *
 * `deriveState` is the only structural collector dd exposes, and it reports the
 * items that FAILED a terminal set — so this asks it the same question once per
 * candidate vocabulary value. An empty terminal set fails everything, which yields
 * the complete ordered id list; a single-value set fails everything except the
 * items carrying that value, which names them.
 *
 * The alternative was a second walker over `section.value` here. That would be a
 * second answer to "what counts as an item", living one directory away from the
 * first, and the two would eventually disagree about a nested shape — at which
 * point the gate and `dd validate` would report different totals for the same
 * document. Several cheap calls over an in-memory value is the better trade.
 */
function itemsOf(
  record: SchemaRecord,
  section: DdSection,
  incomplete: readonly string[],
): DdGateItem[] {
  const ordered = deriveState(section, []).incomplete;
  const notTerminal = new Set(incomplete);
  const stateById = new Map<string, string>();
  for (const value of candidateStates(record)) {
    const missing = new Set(deriveState(section, [value]).incomplete);
    for (const id of ordered) {
      if (!missing.has(id) && !stateById.has(id)) stateById.set(id, value);
    }
  }
  return ordered.map((id) => ({
    id,
    state: stateById.get(id) ?? 'unknown',
    terminal: !notTerminal.has(id),
  }));
}

/** Every state value this schema could legitimately carry: its own enums, plus the built-in. */
function candidateStates(record: SchemaRecord): string[] {
  const values = new Set<string>(BUILTIN_COMPLETION_ENUM.values);
  for (const declared of Object.values(record.schema.enums ?? {})) {
    for (const value of declared.values) values.add(value);
  }
  for (const value of record.gateTerminal) values.add(value);
  return [...values];
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
    address,
    path: target.path,
    sha: target.sha,
    schema: record.name,
    gate_terminal: record.gateTerminal,
    complete: derived.complete,
    terminal: derived.terminal,
    total: derived.total,
    incomplete: derived.incomplete,
    items: itemsOf(record, section, derived.incomplete),
  };
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

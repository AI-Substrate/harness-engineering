import type { DdSeverity } from '../core/validate.js';
import type { DdAddressableKind } from '../links/map.js';

/**
 * One completable-or-not place in a plan, flattened across every document the
 * plan owns.
 *
 * The semantic layer reasons about ITEMS, not documents: "does this plan's story
 * hang together?" is a question about rows citing rows, and a document is only
 * where a row happens to live.
 */
export interface PlanItem {
  /** Walk identity: absolute path plus interior. */
  key: string;
  /** Absolute POSIX path of the document holding it. */
  path: string;
  interior: string[];
  /** Repo-relative `path#interior` — what a finding quotes and a human pastes. */
  address: string;
  /** JSON-ish location inside its document, or null for the document node. */
  location: string | null;
  kind: DdAddressableKind;
  /** The row's own `state`, when it has one. */
  state: string | null;
  /** The gate-terminal set governing THIS row, from its schema. */
  terminal: readonly string[] | null;
  /**
   * A row that carries its OWN state and a terminal set — something an agent
   * ticks. Only these are counted as "open", because a section cannot be ticked
   * and warning that one is open would be warning about its members twice.
   */
  completable: boolean;
  /**
   * A row whose doneness is COMPUTED from stateful members (a `done_when` list, a
   * section). Not completable — nobody ticks it — but very much checkable, which
   * is what a `derives` edge points at.
   */
  derived: boolean;
  /**
   * Whether anything can be said about this row's doneness at all. The
   * contradiction engine asks this before it asks `done`: a row with no state and
   * no stateful members cannot contradict anything.
   */
  checkable: boolean;
  /** Own state in its terminal set, or every derived member terminal. */
  done: boolean;
  /** Display label, read from the same conventional fields the map reads. */
  label: string | null;
  /**
   * True when this row lives in a section some schema declares as the TARGET of a
   * `satisfies` link — a claim that work is supposed to account for. Derived from
   * the RELATION, never from the section's name.
   */
  claim: boolean;
}

/** One citation between two items, carrying the relation that gives it meaning. */
export interface PlanEdge {
  /** Item key of the citing row. */
  from: string;
  /** Item key of the cited row, or null when the address reaches nothing indexable. */
  to: string | null;
  rel: string;
  address: string;
  location: string;
}

export type PlanFindingClass = 'contradiction' | 'open-completable' | 'orphan-claim';

export interface PlanFinding {
  class: PlanFindingClass;
  severity: DdSeverity;
  /** The address of the row the finding is ABOUT. */
  address: string;
  /** The document that must change to resolve it. */
  owner: string;
  location: string | null;
  message: string;
  /** The relation that produced a contradiction, when one did. */
  rel?: string;
  /** The address on the other end of a contradiction. */
  counterpart?: string;
}

export interface PlanIndex {
  items: PlanItem[];
  edges: PlanEdge[];
  byKey: Map<string, PlanItem>;
}

export interface PlanSemanticOptions {
  /**
   * Per-row accounting: every open completable and every unclaimed claim row
   * becomes its own WARN. Off, the same information is ONE info line — the
   * ruling against warning fatigue mid-flight (ac-7007).
   */
  complete?: boolean;
  /**
   * Restrict the semantic checks to one address's reachable closure. A scoped run
   * is always per-row: you asked about a specific thing, so "somewhere in this
   * plan, twelve things are open" would not be an answer to it.
   */
  scope?: ReadonlySet<string>;
}

export interface PlanSemanticResult {
  findings: PlanFinding[];
  /** Populated only when NOT in per-row mode — the one mid-flight summary line. */
  summary: string | null;
  counts: {
    items: number;
    completable: number;
    open: number;
    contradictions: number;
    orphans: number;
    /** Items actually considered, after any `--address` scoping. */
    in_scope: number;
  };
}

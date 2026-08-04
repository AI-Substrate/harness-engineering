import type { DdReferenceMode } from '../core/model.js';
import type { DdSeverity } from '../core/validate.js';

/**
 * Findings this layer owns. dd-core already names every class the single-document
 * validator can produce; these are the classes that only exist once an address is
 * actually followed to a target. The E-code mapping lives in the act, exactly as
 * it does for dd-core and the schema layer — this layer stays free of `output/`.
 */
export type DdLinkIssueClass =
  | 'adapter-gap'
  | 'link-scan-failed'
  | 'link-scan-incomplete'
  | 'link-unresolved';

/**
 * Why an address failed to reach a target. Workshop 001 rules every one of these
 * an ERROR, so the class does not discriminate them — the reason does, and it is
 * what a consumer switches on instead of matching message text.
 */
export type DdLinkUnresolvedReason =
  | 'file-unreadable'
  | 'id-not-found'
  | 'malformed'
  | 'no-base-document'
  | 'not-a-container'
  | 'part-unknown'
  | 'path-escape'
  | 'schema-unresolvable'
  | 'section-unknown';

export interface DdLinkIssue {
  class: DdLinkIssueClass;
  severity: DdSeverity;
  location: string;
  message: string;
  /** The document that must change to resolve the finding (F17 ownership rule). */
  owner: string;
  reason?: DdLinkUnresolvedReason;
}

/**
 * What a segment turned out to be once it was resolved against the schema shape
 * and the data — never against its position. P1's parser marks segments `name`/
 * `id` by alternating index, which is a hint only: `#meta/owner` puts a shape
 * part at an odd index, and `#phases/ph-1a2b/tasks/tk-3c4d` puts instances at
 * both odd indices. Only the shape knows which is which.
 */
export type DdSegmentKind = 'instance' | 'part' | 'section';

export interface DdResolvedSegment {
  value: string;
  kind: DdSegmentKind;
}

export interface DdLinkTarget {
  /** The canonical address, re-formatted from the parse (path separators normalized). */
  address: string;
  /** Absolute POSIX-logical path of the document the address landed in. */
  path: string;
  /** The resolved schema name of that document. */
  schema: string;
  /** Whether the address named its file or used the bare-`#` same-document form. */
  form: 'bare' | 'qualified';
  segments: DdResolvedSegment[];
  /** Kind of the final segment — what the address actually points at. */
  kind: DdSegmentKind;
  /** The addressed value itself. Resolution's whole job is to hand this back. */
  value: unknown;
  /** Content digest of the target document, as the basis ledger records it. */
  sha: string;
  tracked: boolean;
}

export type DdLinkResolution =
  | { ok: true; target: DdLinkTarget; issues: DdLinkIssue[] }
  | { ok: false; issues: DdLinkIssue[] };

/** One outbound edge: a schema-declared link cell that names another document. */
export interface DdLinkEdge {
  /** Absolute path of the document holding the cell. */
  from: string;
  /** Absolute path of the document the address lands in; null when it never resolved to a file. */
  to: string | null;
  /** The raw cell value. */
  address: string;
  /** JSON-ish location of the cell inside `from`. */
  location: string;
  /** The column's declared type path, when the schema pins one. */
  target?: string;
  /**
   * The RELATION this edge carries — `ref` unless the schema (or a links-bucket
   * entry) says otherwise. Carried on the edge so every reading of the graph
   * asks the same question the contradiction engine does.
   */
  rel: string;
  /** True for the bare-`#` same-document form (an edge back into `from`). */
  sameDocument: boolean;
}

export interface DdGraphNode {
  /** Absolute POSIX-logical path — the node's identity. */
  path: string;
  schema: string;
  sha: string;
  tracked: boolean;
  /** True when this document was reached by a link but is not itself a scan seed. */
  external: boolean;
}

export interface DdCorpusGraph {
  nodes: DdGraphNode[];
  edges: DdLinkEdge[];
  issues: DdLinkIssue[];
  /** Documents the traversal actually visited, in visit order. */
  visited: string[];
}

export type DdBasisState = 'fresh' | 'stale';

export interface DdBasisVerdict {
  state: DdBasisState;
  /** The address whose target the basis covers. */
  address: string;
  /** Absolute path of the target document. */
  path: string;
  recorded: string;
  actual: string;
  /** Ledger mode of the entry consulted, when the verdict came from a document's ledger. */
  mode?: DdReferenceMode;
}

/**
 * A render-layer adapter finding, repeated by the doctor as a WARN (AC-04).
 *
 * Phase 3 owns adapter loading and aggregates these; Phase 4 owns only the
 * consuming seam and codes against this shape, never against a Phase 3 module.
 * `kind` — not an E-code — is the discriminator, because this layer never names
 * the CLI's error vocabulary; `acts/dd/doctor.ts` maps it onto E423-E426.
 */
export interface DdAdapterGap {
  /** Absolute path of the document whose render hit the gap. */
  path: string;
  kind: 'load-failed' | 'not-found' | 'output-invalid' | 'runtime-failed';
  message: string;
  schema?: string;
  type?: string;
}

/** The Phase 3 export the doctor consumes. Injected, so Phase 5 wires the real one. */
export interface DdAdapterGapSource {
  adapterGaps(paths: readonly string[]): readonly DdAdapterGap[];
}

export function linkIssue(
  issueClass: DdLinkIssueClass,
  severity: DdSeverity,
  location: string,
  message: string,
  owner: string,
  reason?: DdLinkUnresolvedReason,
): DdLinkIssue {
  return { class: issueClass, severity, location, message, owner, ...(reason && { reason }) };
}

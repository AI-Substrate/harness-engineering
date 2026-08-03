import type { DdDerivedState } from '../core/derive.js';
import type { DdShape, ResolvedDdSchema } from '../core/model.js';

/**
 * What an adapter receives besides the value (workshop-003 W1): the column
 * declaration and the doc path, so a custom type can render a relative link.
 */
export interface DdAdapterContext {
  /** The declared custom type name — the adapter's own filename, minus extension. */
  type: string;
  /** Field or column name carrying the value. */
  field: string;
  /** The column's shape declaration, verbatim from the schema. */
  shape: DdShape;
  /** Path of the document being rendered, for relative links. */
  path: string;
  /** Where the value sits inside the document, e.g. `$.sections[tasks][0].spent`. */
  location: string;
}

/** The locked W1 contract: pure, synchronous, default-exported, value → markdown fragment. */
export type DdAdapter = (value: unknown, ctx: DdAdapterContext) => string;

/** Every way an adapter can fail to produce a fragment. Each maps to one frozen E42x code. */
export type DdAdapterIssueClass =
  | 'adapter-not-found'
  | 'adapter-load-failed'
  | 'adapter-runtime-failed'
  | 'adapter-output-invalid';

export interface DdAdapterIssue {
  class: DdAdapterIssueClass;
  /** Always WARN: a degraded render is loud, never fatal (W1 rules 4-5). */
  severity: 'WARN';
  /** The custom type whose adapter failed. */
  type: string;
  message: string;
  /** Absolute path of the adapter file, when one was looked for. */
  path?: string;
  /** Document location of the first value that hit this failure. */
  location?: string;
}

/**
 * The render-time adapter face. Pre-loaded and synchronous, because the renderer
 * is pure: every module import happens before `renderDd` is ever called.
 *
 * `render` returns `null` to mean "take the honest fallback" — the set has already
 * recorded WHY on {@link issues}, so the renderer never has to know the reason and
 * the act can put every one of them in the envelope.
 */
export interface DdAdapterSet {
  render(value: unknown, ctx: DdAdapterContext): string | null;
  /** Every issue seen so far, deduplicated by type — the WARN aggregation P4's doctor consumes. */
  readonly issues: readonly DdAdapterIssue[];
}

/**
 * Everything `renderDd` needs that it may not go and fetch. Cross-document facts
 * are **precomputed** by the caller (F-12): the renderer resolves same-document
 * addresses itself (pure computation over `doc`) and takes every cross-file
 * summary from {@link derived}.
 */
export interface DdRenderContext {
  /** Source document path. Only its basename is rendered, so output is cwd-independent. */
  path: string;
  schema: ResolvedDdSchema;
  /** The schema's gate-terminal set (P2 `SchemaRecord.gateTerminal`); defaults to the built-in. */
  gateTerminal?: readonly string[];
  /** Pre-loaded custom-type adapters; omitted means every custom type takes the fallback. */
  adapters?: DdAdapterSet;
  /** Cross-file derived summaries, keyed by the raw address string as written in the cell. */
  derived?: ReadonlyMap<string, DdDerivedState>;
}

import type { DdDoc, DdShape } from '../core/model.js';
import type { DdIssue } from '../core/validate.js';

/**
 * Why a mutation could not be performed. Like `DdLinkUnresolvedReason`, the class
 * is coarse and the REASON is what a consumer switches on — message text is for
 * humans and must never become a control surface.
 */
export type DdMutationRefusal =
  | 'address-malformed'
  | 'container-invalid'
  | 'id-conflict'
  | 'id-exhausted'
  | 'mint-prefix-unregistered'
  | 'schema-refused'
  | 'section-unknown'
  | 'target-exists'
  | 'target-unknown'
  | 'value-invalid';

export interface DdMutationFailure {
  ok: false;
  reason: DdMutationRefusal;
  message: string;
  /** Schema findings the mutation WOULD have introduced, when the refusal is `schema-refused`. */
  introduced?: DdIssue[];
}

/** What a segment turned out to be — asked of the shape, never of its position. */
export type DdCursorKind = 'section' | 'instance' | 'part';

export interface DdCursor {
  /**
   * The container holding the addressed value, or `null` when the address names a
   * whole section (whose container is the document's section list).
   */
  parent: unknown[] | Record<string, unknown> | null;
  /** Array index or object key inside `parent`; the section name when `parent` is null. */
  key: string | number;
  value: unknown;
  shape: DdShape | undefined;
  kind: DdCursorKind;
  /** Resolved segment trail, for reporting. */
  trail: string[];
}

export interface DdMutationResult {
  ok: true;
  doc: DdDoc;
  /** The value that was read, written, appended or removed. */
  value: unknown;
  kind: DdCursorKind;
  trail: string[];
  /** Set by `add --mint`: the id the CLI minted for the new item. */
  minted?: string;
}

export type DdLocateResult = ({ ok: true } & DdCursor) | DdMutationFailure;

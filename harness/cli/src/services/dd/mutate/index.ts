/**
 * The dd WRITER seam.
 *
 * dd shipped with a complete read surface and no way to change a document, so
 * every structural edit during plan 070's own authoring was ad-hoc
 * `json.load → poke → json.dump` — no validation before write, siblings left
 * stale by hand, ids minted by string arithmetic (which collided twelve ways in
 * one afternoon; DF-012/DF-008). This module is that hole closed: one place that
 * knows how to change a dd document correctly, exported as a barrel so acts —
 * and, later, the flow — consume a seam rather than a module path.
 *
 * It stays PURE. Reading files, rendering siblings and printing envelopes belong
 * to the act; what lives here is `(doc, address, value) → doc | refusal`.
 */
export { locate } from './locate.js';
export { collectIds, type DdMintResult, mintId, normalizePrefix } from './mint.js';
export type {
  DdCursor,
  DdCursorKind,
  DdLocateResult,
  DdMutationFailure,
  DdMutationRefusal,
  DdMutationResult,
} from './model.js';
export {
  coerceValue,
  type DdMutationDeps,
  type DdMutationOutcome,
  ddAdd,
  ddGet,
  ddRemove,
  ddSet,
  serializeDoc,
} from './mutate.js';

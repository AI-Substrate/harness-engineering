/**
 * TEMPORARY COPY of dd `core/constants` — no public `@ai-substrate/dd` home at the
 * pin (`@ai-substrate/dd/core/constants` → ERR_PACKAGE_PATH_NOT_EXPORTED).
 *
 * These are the VOCABULARY values, and copying them is **sanctioned, not a D-3
 * block**: Jordan's ontology ruling (2026-08-09, dd government `d8950eb`) puts
 * semantic ontology OUTSIDE dd — dd keeps mechanisms, consumers bring vocabulary.
 * So the builder OWNS these lists; they are not a borrowed copy waiting to be
 * re-imported. Only the MECHANISMS that read them (`derive`, `rel`) are temporary,
 * pending dd's mechanism-vocabulary seam (dd `6aaef35`). See ./README.md.
 *
 * This is the exact inversion of phase 1's rule, and it is deliberate: before the
 * ruling, a copied vocabulary was the two-vocabularies hazard the plan existed to
 * end; after it, dd holding the vocabulary was the layering error.
 */

/** The states a completable row can hold. */
export const COMPLETION_STATES = [
  'unchecked',
  'checked',
  'blocked',
  'human-skipped',
  'na',
] as const;
export type CompletionState = (typeof COMPLETION_STATES)[number];

/** The states that count as "done" at a gate unless a schema says otherwise. */
export const DEFAULT_GATE_TERMINAL_STATES = ['checked', 'human-skipped', 'na'] as const;

/**
 * The frozen five link RELATIONS — machine semantics carried on the edge, never
 * inferred from the field name.
 *
 * The set is closed at five but the NAMESPACE is open: an unknown relation is
 * legal and behaves as `ref`. That openness is load-bearing here — this plan's own
 * documents carry a non-builtin `satisfies-toward`, and the whole point is that it
 * attaches no extra meaning rather than being refused.
 */
export const BUILTIN_RELS = ['pressure', 'proven_by', 'satisfies', 'derives', 'ref'] as const;
export type BuiltinRel = (typeof BUILTIN_RELS)[number];

/** The relation an undeclared or unknown `rel` behaves as. */
export const DEFAULT_REL = 'ref' satisfies BuiltinRel;

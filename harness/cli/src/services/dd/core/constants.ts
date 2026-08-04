/**
 * The item kinds dd can mint an id for.
 *
 * A CLI constant rather than a schema declaration, which is a known limitation:
 * a new schema cannot introduce a new addressable item kind without a change
 * here (recorded as a dogfood finding on plan 071). `fn-` joined for fence rows
 * (tk-7171) and `fd-`/`vd-` for review findings and verdict rows (tk-7172);
 * each addition is deliberate, because a prefix becomes part of every
 * address that will ever name one of these rows — closer to a surface than to a
 * constant, which is why a test pins the list.
 */
export const ID_PREFIXES = ['ph-', 'tk-', 'ac-', 'bp-', 'lg-', 'dw-', 'fn-', 'fd-', 'vd-'] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

const PREFIX_PATTERN = ID_PREFIXES.map((prefix) => prefix.slice(0, -1)).join('|');

/** Minted ids are born once, unique per file, and carry exactly four lowercase hex digits. */
export const MINTED_ID_PATTERN = new RegExp(`^(?:${PREFIX_PATTERN})-[0-9a-f]{4}$`);

export const COMPLETION_STATES = [
  'unchecked',
  'checked',
  'blocked',
  'human-skipped',
  'na',
] as const;

export type CompletionState = (typeof COMPLETION_STATES)[number];

export const DEFAULT_GATE_TERMINAL_STATES = ['checked', 'human-skipped', 'na'] as const;

/** Top-level per-document basis ledger selected by the Phase 1 leaf ruling. */
export const REFERENCES_LEDGER_FIELD = 'references' as const;

/**
 * The frozen five link RELATIONS — machine semantics carried on the edge, never
 * inferred from the field name.
 *
 * A field called `proven_by` in one schema and `evidence` in another mean the
 * same thing to a reader and nothing at all to a machine. Declaring the relation
 * moves the meaning onto the edge, so the contradiction engine and the graph
 * walker are written ONCE against relations and never against a growing list of
 * blessed field names.
 *
 * The set is closed at five and pinned by the surface manifest, but the NAMESPACE
 * is open: an unknown relation is legal and behaves as `ref`. A schema may
 * therefore say something dd does not yet understand without being refused —
 * dd simply declines to attach extra meaning to it.
 *
 *  - `pressure`   — this assertion names the instrument that checks it.
 *  - `proven_by`  — this claim points at the record that evidences it.
 *  - `satisfies`  — this work accounts for that acceptance criterion.
 *  - `derives`    — this item's state is computed FROM the target.
 *  - `ref`        — a plain reference, carrying no further semantics.
 */
export const BUILTIN_RELS = ['pressure', 'proven_by', 'satisfies', 'derives', 'ref'] as const;

export type BuiltinRel = (typeof BUILTIN_RELS)[number];

/** The relation an undeclared or unknown `rel` behaves as. */
export const DEFAULT_REL = 'ref' satisfies BuiltinRel;

/**
 * The literal that makes "no instrument checks this" explicit and queryable.
 * Silence is a validation ERROR; this is the way to say it on purpose.
 */
export const PRESSURE_NOT_APPLICABLE = 'not-applicable' as const;

import type { CompletionState } from './constants.js';

export interface DdHeader {
  schema: string;
  spec?: string;
  sweep_exclude?: boolean;
}

export type DdReferenceMode = 'live' | 'pinned';

export interface DdReference {
  path: string;
  sha: string;
  mode: DdReferenceMode;
}

/**
 * One schema-named, addressable slot in a document's flat section list.
 *
 * `name` is the IDENTITY: it is what addresses resolve against and what the
 * rendered anchor is derived from, so it is stable and machine-facing.
 * `title` is DISPLAY ONLY — the heading a human reads. Retitling a section must
 * never move its address, which is why the two are separate fields rather than
 * one identifier doing both jobs.
 */
export interface DdSection {
  name: string;
  title?: string;
  value: unknown;
}

/** Stateful/linkable array members carry a born-once id; other fields stay schema-defined. */
export interface DdInstance {
  id: string;
  [field: string]: unknown;
}

export interface DdDoc {
  dd: DdHeader;
  sections: DdSection[];
  references: DdReference[];
}

export type DdFailureClass = 'json-invalid' | 'document-invalid';

export interface DdFailure {
  class: DdFailureClass;
  location: string;
  message: string;
}

export type DdPrimitiveType =
  | 'array'
  | 'bool'
  | 'enum'
  | 'int'
  | 'link'
  | 'number'
  | 'object'
  | 'state'
  | 'string'
  | 'text'
  | (string & {});

/** Recursive schema shape consumed by the hand-rolled validator. */
export interface DdShape {
  type: DdPrimitiveType;
  required?: readonly string[];
  fields?: Readonly<Record<string, DdShape>>;
  items?: DdShape;
  values?: readonly string[];
  enum?: string;
  target?: string;
  /**
   * The link RELATION this field's edges carry (`pressure`, `proven_by`,
   * `satisfies`, `derives`, `ref`, or an unknown string that behaves as `ref`).
   *
   * Only meaningful on `type: 'link'` — including a link nested in an array's
   * `items`, which is how `satisfies` (always an array) declares itself. The
   * semantics live HERE and never on the field name, so every consumer that
   * reasons about meaning reads one property instead of a list of blessed names.
   */
  rel?: string;
  gate_terminal?: readonly string[];
  allowAdditional?: boolean;
  /**
   * For `type: 'object'` — the shape every value of a DYNAMIC-KEY map must
   * satisfy (OD-8). Declared `fields` still win per key; `valuesShape` covers the
   * keys a schema cannot name in advance, which is what an evidence section is:
   * one list per task id (workshop-002 Ruling 3).
   *
   * Without it a map interior is invisible to the validator while remaining fully
   * visible to `deriveState`, which collects `state` structurally — so a typo'd
   * state, or `human-skipped` with no receipt, would silently move a computed
   * gate. When `valuesShape` is declared, unmatched keys are SHAPED rather than
   * forbidden, so `allowAdditional: false` keeps its meaning only in its absence.
   */
  valuesShape?: DdShape;
}

export interface DdSectionSchema {
  required?: boolean;
  /**
   * The human heading for this section, when the auto-derived one is not good
   * enough (`non_goals` derives "Non goals"; a schema may prefer "Non-goals").
   * Declared on the SCHEMA because a title is a property of the section KIND —
   * the same place `gate_terminal` lives — so every document using the schema
   * gets it for free. A document may still override per-section.
   */
  title?: string;
  shape: DdShape;
}

export interface DdEnumSchema {
  values: readonly string[];
  gate_terminal?: readonly string[];
}

export interface ResolvedDdSchema {
  name: string;
  sections: Readonly<Record<string, DdSectionSchema>>;
  enums?: Readonly<Record<string, DdEnumSchema>>;
}

export interface DdStateEntry {
  id?: string;
  state: CompletionState | string;
  note?: string;
  receipt?: string | { verbatim_words?: string };
}

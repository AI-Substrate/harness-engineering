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

/** One schema-named, addressable slot in a document's flat section list. */
export interface DdSection {
  name: string;
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
  gate_terminal?: readonly string[];
  allowAdditional?: boolean;
}

export interface DdSectionSchema {
  required?: boolean;
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

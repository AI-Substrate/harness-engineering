export const ID_PREFIXES = ['ph-', 'tk-', 'ac-', 'bp-', 'lg-', 'dw-'] as const;

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

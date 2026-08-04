import { ID_PREFIXES, MINTED_ID_PATTERN } from '../core/constants.js';
import type { DdDoc } from '../core/model.js';
import { isRecord } from '../core/value.js';
import type { DdMutationFailure } from './model.js';

/** Every `id` string anywhere in the document — ids are unique per FILE, not per section. */
export function collectIds(doc: DdDoc): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.id === 'string') ids.add(value.id);
    for (const [field, child] of Object.entries(value)) {
      if (field !== 'id') visit(child);
    }
  };
  for (const section of doc.sections) visit(section.value);
  return ids;
}

/** `tk`, `tk-` and `TK` all mean the same registered prefix; anything else does not. */
export function normalizePrefix(raw: string): string | null {
  const candidate = `${raw.trim().toLowerCase().replace(/-+$/, '')}-`;
  return ID_PREFIXES.includes(candidate as (typeof ID_PREFIXES)[number]) ? candidate : null;
}

export type DdMintResult = { ok: true; id: string } | DdMutationFailure;

/**
 * Mint the next collision-free id under a registered prefix.
 *
 * The number is the highest existing value for that prefix PLUS ONE, not the
 * first free slot — a plan numbering its ACs `ac-7001…ac-7019` gets `ac-701a`,
 * staying inside its own series, and an id freed by a deletion is never
 * resurrected onto a different item while stale references may still name it.
 *
 * This is the exact bug class DF-008 recorded: a hand-rolled mint derived from a
 * string slice produced twelve identical `dw-` ids across twelve tasks, and only
 * `dd validate`'s duplicate check caught it. With the CLI minting, that shape is
 * unrepresentable rather than merely detected.
 */
export function mintId(doc: DdDoc, prefix: string): DdMintResult {
  const normalized = normalizePrefix(prefix);
  if (normalized === null) {
    return {
      ok: false,
      reason: 'mint-prefix-unregistered',
      message: `"${prefix}" is not a registered id prefix (${ID_PREFIXES.join(', ')})`,
    };
  }
  const taken = collectIds(doc);
  // Zero is skipped so an empty section's first id is `<prefix>-0001` rather than
  // `<prefix>-0000`, which reads like an absent value in every table that renders it.
  let highest = 0;
  for (const id of taken) {
    if (!id.startsWith(normalized) || !MINTED_ID_PATTERN.test(id)) continue;
    const value = Number.parseInt(id.slice(normalized.length), 16);
    if (Number.isInteger(value) && value > highest) highest = value;
  }
  for (let candidate = highest + 1; candidate <= 0xffff; candidate += 1) {
    const id = `${normalized}${candidate.toString(16).padStart(4, '0')}`;
    if (!taken.has(id)) return { ok: true, id };
  }
  return {
    ok: false,
    reason: 'id-exhausted',
    message: `every four-hex id under "${normalized}" is taken in this document`,
  };
}

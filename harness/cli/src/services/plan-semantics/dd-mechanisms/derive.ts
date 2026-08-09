/**
 * TEMPORARY COPY of dd `core/derive` — no public `@ai-substrate/dd` home at the pin
 * (`@ai-substrate/dd/core/derive` → ERR_PACKAGE_PATH_NOT_EXPORTED).
 *
 * **Why the public cousin is not used.** `./schema` DOES export `deriveSchemaItems`
 * and `deriveSchemaState`, and dd's own docs say both project this very collector.
 * They are still not drop-ins here, for two independent reasons:
 *
 *  1. they take a full `SchemaRecord` (`name`, `description`, `version`, `path`,
 *     `root`, `schema`) and `buildPlanIndex` holds only a `ResolvedDdSchema` — the
 *     provenance fields would have to be fabricated, which is a shim wearing a
 *     public import's clothes;
 *  2. they decide `terminal` from the SCHEMA's own `gate_terminal` declaration,
 *     whereas the plan layer must apply the terminal set carried by the ENTRY
 *     (`entry.terminal ?? DEFAULT_GATE_TERMINAL_STATES`). Same collection, a
 *     different question.
 *
 * So only the collector is copied, and only the part the plan layer uses:
 * `deriveItems` plus its recursive walker. `deriveState`/`deriveRollup` are NOT
 * copied — nothing here calls them, and copying unused surface would widen the
 * drift-ownership footprint the ledger tracks for no benefit.
 *
 * MECHANISM, therefore temporary: replaced when dd's mechanism-vocabulary seam
 * lands (dd `6aaef35`). See ./README.md.
 */
import type { DdSection } from '@ai-substrate/dd/core/model';
import { isRecord } from './value.js';

/**
 * One evidence entry as the collector found it: what it is called, and the state
 * value it carries. The atom every completion answer is computed from.
 */
export interface DdStateEntry {
  id: string;
  state: string;
}

function collectStateEntries(value: unknown, entries: DdStateEntry[], location: string): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      collectStateEntries(entry, entries, `${location}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.state === 'string') {
    entries.push({
      id: typeof value.id === 'string' ? value.id : location,
      state: value.state,
    });
  }
  for (const [field, entry] of Object.entries(value)) {
    if (field !== 'id' && field !== 'state') {
      collectStateEntries(entry, entries, `${location}.${field}`);
    }
  }
}

/**
 * Every evidence entry the section carries, in document order, each with the state
 * value it holds.
 *
 * One collector, so a nested shape cannot be counted one way here and another way
 * somewhere else — which is exactly the failure two structural walkers a directory
 * apart eventually produce.
 */
export function deriveItems(section: DdSection): DdStateEntry[] {
  const entries: DdStateEntry[] = [];
  collectStateEntries(section.value, entries, `$.sections[${section.name}].value`);
  return entries;
}

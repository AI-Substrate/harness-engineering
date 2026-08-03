import { DEFAULT_GATE_TERMINAL_STATES } from './constants.js';
import type { DdSection } from './model.js';
import { isRecord } from './value.js';

export interface DdDerivedState {
  complete: boolean;
  status: 'complete' | 'incomplete';
  terminal: number;
  total: number;
  incomplete: string[];
}

export interface DdRollupInput {
  id: string;
  source?: string;
  section?: DdSection;
  children?: readonly DdRollupInput[];
}

export interface DdRollupState extends DdDerivedState {
  id: string;
  source?: string;
  children: DdRollupState[];
}

/**
 * One evidence entry as the collector found it: what it is called, and the state
 * value it carries. The atom every completion answer in dd is computed from.
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
 * This is the read model underneath `deriveState`, exposed deliberately: a caller
 * that needs to say WHAT state each item is in — not merely how many passed a
 * terminal set — would otherwise have to write a second walker over `section.value`,
 * and two structural collectors one directory apart eventually disagree about a
 * nested shape. Then the same document reports different totals depending on who
 * asked. One collector, two projections.
 */
export function deriveItems(section: DdSection): DdStateEntry[] {
  const entries: DdStateEntry[] = [];
  collectStateEntries(section.value, entries, `$.sections[${section.name}].value`);
  return entries;
}

/** Compute a completable section from its evidence-entry state values. */
export function deriveState(
  section: DdSection,
  gateTerminal: readonly string[] = DEFAULT_GATE_TERMINAL_STATES,
): DdDerivedState {
  const entries = deriveItems(section);
  const terminalSet = new Set(gateTerminal);
  const incomplete = entries
    .filter((entry) => !terminalSet.has(entry.state))
    .map((entry) => entry.id);
  const terminal = entries.length - incomplete.length;
  const complete = incomplete.length === 0;
  return {
    complete,
    status: complete ? 'complete' : 'incomplete',
    terminal,
    total: entries.length,
    incomplete,
  };
}

/**
 * Compose pre-resolved sections across document boundaries. The caller owns link
 * resolution; core owns the invariant that every descendant must be complete.
 */
export function deriveRollup(
  input: DdRollupInput,
  gateTerminal: readonly string[] = DEFAULT_GATE_TERMINAL_STATES,
): DdRollupState {
  const children = (input.children ?? []).map((child) => deriveRollup(child, gateTerminal));
  const own = input.section
    ? deriveState(input.section, gateTerminal)
    : { complete: true, status: 'complete' as const, terminal: 0, total: 0, incomplete: [] };
  const terminal = own.terminal + children.reduce((sum, child) => sum + child.terminal, 0);
  const total = own.total + children.reduce((sum, child) => sum + child.total, 0);
  const incomplete = [...own.incomplete, ...children.flatMap((child) => child.incomplete)];
  const complete = own.complete && children.every((child) => child.complete);
  return {
    id: input.id,
    ...(input.source && { source: input.source }),
    children,
    complete,
    status: complete ? 'complete' : 'incomplete',
    terminal,
    total,
    incomplete,
  };
}

import { DEFAULT_GATE_TERMINAL_STATES } from './constants.js';
import type { DdSection } from './model.js';

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

interface StateEntry {
  id: string;
  state: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectStateEntries(value: unknown, entries: StateEntry[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStateEntries(entry, entries);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.state === 'string') {
    entries.push({
      id: typeof value.id === 'string' ? value.id : `entry-${entries.length + 1}`,
      state: value.state,
    });
    return;
  }
  for (const entry of Object.values(value)) {
    collectStateEntries(entry, entries);
  }
}

/** Compute a completable section from its evidence-entry state values. */
export function deriveState(
  section: DdSection,
  gateTerminal: readonly string[] = DEFAULT_GATE_TERMINAL_STATES,
): DdDerivedState {
  const entries: StateEntry[] = [];
  collectStateEntries(section.value, entries);
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

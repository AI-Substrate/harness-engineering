import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { VerbRegistry } from '../extensions/registry.js';
import { posixDirname, posixJoin } from '../shared/posix-path.js';
import { CORE_INSTRUCTIONS } from './core-instructions.js';

/** The bare `harness instructions` payload (plan 014 AC-1). */
export interface CoreInstructionsPayload {
  /** The baked core agent briefing (a TS constant — versions with the CLI). */
  instructions: string;
  /** Verbs whose owning extension folder carries an `instructions.md` right now. */
  verbs_with_instructions: string[];
}

/**
 * What `harness instructions <verb>` resolves to. The act maps these onto the
 * envelope per D3: `ok` → ok/0, `unknown-verb`/`missing` → unconfigured/2 (gap
 * semantics, no error code), `unreadable` → error E145/1.
 */
export type VerbInstructionsOutcome =
  | { kind: 'ok'; verb: string; path: string; instructions: string }
  | { kind: 'unknown-verb'; verb: string }
  | { kind: 'missing'; verb: string; path: string }
  | { kind: 'unreadable'; verb: string; path: string };

/**
 * Verb → briefing path (plan 014 D5): find the record whose accepted `verbs[]`
 * contains the verb, take `dirname(entryPath)`, join `instructions.md`. The
 * contract stays untouched — no `instructions` field anywhere — and multi-verb
 * extensions share their folder's single file for free. `null` = unknown verb.
 */
export function instructionsPathFor(verbName: string, registry: VerbRegistry): string | null {
  const normalized = registry.extensions?.find((extension) =>
    extension.verbs.some((verb) => verb.name === verbName),
  );
  // Directly-constructed pre-v2 test registries have no normalized provenance;
  // production registries always take the first branch.
  const entryPath =
    normalized?.entryPath ??
    registry.records.find((record) => record.verbs.some((verb) => verb.name === verbName))
      ?.entryPath;
  if (entryPath === undefined) return null;
  // entryPath is POSIX from discovery (plan 017) — derive in POSIX space so the
  // surfaced briefing path stays forward-slash on every OS.
  return posixJoin(posixDirname(entryPath), 'instructions.md');
}

/**
 * Build the bare-invocation payload. `verbs_with_instructions` is an `FsPort`
 * existence probe per registered verb at build time (D4) — cheap, and honest
 * about what is queryable right now.
 */
export function buildCoreInstructions(registry: VerbRegistry, fs: FsPort): CoreInstructionsPayload {
  const verbs_with_instructions = registry.verbs
    .filter((verb) => {
      const path = instructionsPathFor(verb.name, registry);
      return path !== null && fs.exists(path);
    })
    .map((verb) => verb.name);
  return { instructions: CORE_INSTRUCTIONS, verbs_with_instructions };
}

/**
 * Load a verb's briefing from disk NOW (D4 — lazily at invocation, never cached
 * across calls, so an edit is visible on the next invocation with no rebuild).
 * FsPort semantics make the missing/unreadable split: `exists()` false → the
 * file was never authored (a gap); `exists()` true but `readText()` null → it
 * is there but unreadable (a fault).
 */
export function loadVerbInstructions(
  verbName: string,
  registry: VerbRegistry,
  fs: FsPort,
): VerbInstructionsOutcome {
  const path = instructionsPathFor(verbName, registry);
  if (path === null) {
    return { kind: 'unknown-verb', verb: verbName };
  }
  if (!fs.exists(path)) {
    return { kind: 'missing', verb: verbName, path };
  }
  const instructions = fs.readText(path);
  if (instructions === null) {
    return { kind: 'unreadable', verb: verbName, path };
  }
  return { kind: 'ok', verb: verbName, path, instructions };
}

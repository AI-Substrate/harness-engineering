import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { AgentSpec } from './agent-matrix.js';
import { resolveConfigFiles } from './agent-matrix.js';
import { removeFromArray, writeThroughSymlink } from './config-writer.js';
import { classifyOwnership, isOwnedByUs } from './hook-marker.js';

/**
 * UNINSTALL (plan 082 tk-000d) — surgical removal, never a restore.
 *
 * THE SYMMETRY IS THE MECHANISM. Install adds our entry through the
 * comment-preserving writer; uninstall removes it through the same writer, run
 * backwards. The file returns to its original bytes because **every byte we did not
 * write was never rewritten** — not because anything was copied back. It reads no
 * backup. (Restore-from-backup is a separate disaster-recovery concern, and
 * `backupAgentConfigs` is currently write-only: it flattens paths and nothing
 * reverses the mapping.)
 *
 * FOR A FILE WE CREATED, THE SYMMETRY IS DELETION. There are no original bytes to
 * return to, so "restore" is undefined; the honest inverse of *we made this file* is
 * *we remove it*. `install` reports `created` precisely so this decision has an
 * input.
 *
 * REFUSE, NEVER CLOBBER. Ownership is matched on OUR marker with exact-token
 * equality — never git-ai's `contains("git-ai") && contains("checkpoint")`, which
 * claims entries it did not write. Three states, not two:
 *
 * - `wholly-ours` → removed;
 * - `ours-with-foreign` → **reported and left byte-identical**. Our invocation is
 *   genuinely chained with somebody else's work in one entry, and deleting the entry
 *   would destroy theirs. A refusal that surprises someone is recoverable; a
 *   deletion that surprises them is not.
 * - `not-ours` → never touched.
 *
 * A FILE lacking our marker is refused outright — the guard git-ai implemented in
 * exactly one of its fifteen installers (`cline.rs`), and the posture `amp.rs`
 * rejects by calling `remove_file` with no check at all.
 */

export interface UninstallOutcome {
  agent: string;
  path: string;
  /** Entries surgically removed from this file. */
  removed: number;
  /** The file was created by us, so it was DELETED rather than edited. */
  deleted: boolean;
  /**
   * Entries we own but did not remove, because they carry foreign segments.
   * Reported so a refusal is visible rather than silent.
   */
  refused: { command: string; reason: string }[];
  /** True when the file exists but carries no marker of ours — left untouched. */
  unmarked: boolean;
}

export interface UninstallDeps {
  fs: FsPort;
  home: string;
  env: (name: string) => string | undefined;
  /**
   * Files this install CREATED, as absolute paths. Uninstall deletes these rather
   * than editing them — see the module doc.
   */
  createdFiles?: ReadonlySet<string>;
}

export function uninstallStrategyA(deps: UninstallDeps, spec: AgentSpec): UninstallOutcome[] {
  return resolveConfigFiles(spec, deps.home, deps.env).map((path) =>
    uninstallOneFile(deps, spec, path),
  );
}

function uninstallOneFile(deps: UninstallDeps, spec: AgentSpec, path: string): UninstallOutcome {
  const base: UninstallOutcome = {
    agent: spec.agent,
    path,
    removed: 0,
    deleted: false,
    refused: [],
    unmarked: false,
  };

  const text = deps.fs.readText(path);
  if (text === null) return base;

  let doc: { hooks?: Record<string, { command?: unknown }[]> };
  try {
    doc = JSON.parse(stripComments(text)) as typeof doc;
  } catch {
    // A config we cannot understand is one we must not rewrite.
    return { ...base, unmarked: true };
  }

  const marked = [spec.events.pre, spec.events.post].some((key) =>
    (doc.hooks?.[key] ?? []).some(
      (entry) => typeof entry.command === 'string' && isOwnedByUs(entry.command),
    ),
  );
  if (!marked) {
    // REFUSE rather than clobber — cline.rs's posture, not amp.rs's.
    return { ...base, unmarked: true };
  }

  // A file WE created has no original bytes to return to: delete it.
  if (deps.createdFiles?.has(path) === true) {
    deps.fs.deleteFile(path);
    return { ...base, deleted: true };
  }

  let current = text;
  let removed = 0;
  const refused: UninstallOutcome['refused'] = [];

  for (const key of [spec.events.pre, spec.events.post]) {
    // Re-parse each pass: an index is only valid against the text it came from, and
    // removing an entry shifts every later index in that array.
    for (;;) {
      let parsed: { hooks?: Record<string, { command?: unknown }[]> };
      try {
        parsed = JSON.parse(stripComments(current)) as typeof parsed;
      } catch {
        break;
      }
      const entries = parsed.hooks?.[key] ?? [];
      const index = entries.findIndex(
        (entry) =>
          typeof entry.command === 'string' &&
          classifyOwnership(entry.command) === 'wholly-ours' &&
          !refused.some((r) => r.command === entry.command),
      );
      if (index === -1) {
        for (const entry of entries) {
          if (
            typeof entry.command === 'string' &&
            classifyOwnership(entry.command) === 'ours-with-foreign' &&
            !refused.some((r) => r.command === entry.command)
          ) {
            refused.push({
              command: entry.command,
              reason: 'our invocation is chained with foreign work in the same entry',
            });
          }
        }
        break;
      }
      current = removeFromArray(current, ['hooks', key, index]);
      removed += 1;
    }
  }

  // AN ARRAY WE EMPTIED IS AN ARRAY WE CREATED — remove the key too.
  //
  // MEASURED asymmetry, found by the round-trip row: when an agent's config exists
  // but lacks the events key (a `settings.json` carrying only `model` and
  // `permissions`, say), `appendToArray` CREATES that key. Removing only our entry
  // then leaves `"PreToolUse": []` behind, and the file is not the bytes it started
  // as — install created something uninstall did not remove.
  //
  // THE ONE CASE THIS OVER-REACHES, stated rather than hidden: a user who already
  // had an EMPTY events array loses that empty key. It is semantically identical to
  // absent for hook loading, and it is the narrower error than leaving a key we
  // created — but it is a change to something we did not add, so it is asserted
  // rather than assumed.
  if (removed > 0) {
    for (const key of [spec.events.pre, spec.events.post]) {
      try {
        const parsed = JSON.parse(stripComments(current)) as {
          hooks?: Record<string, unknown[]>;
        };
        const arr = parsed.hooks?.[key];
        if (Array.isArray(arr) && arr.length === 0) {
          current = removeFromArray(current, ['hooks', key]);
        }
      } catch {
        break;
      }
    }
    writeThroughSymlink(deps.fs, path, current);
  }
  return { ...base, removed, refused };
}

const stripComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

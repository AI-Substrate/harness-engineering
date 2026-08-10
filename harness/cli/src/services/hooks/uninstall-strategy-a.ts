import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { AgentSpec } from './agent-matrix.js';
import { eventKeys, resolveConfigFiles } from './agent-matrix.js';
import { removeFromArray, removeValue, writeThroughSymlink } from './config-writer.js';
import { entryCommands, entryIsOwnedByUs, entryMayRemove } from './hook-marker.js';

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
  /**
   * Event-array keys THIS INSTALL CREATED, per absolute config path — the only
   * keys uninstall may remove (phase-2 review F003).
   *
   * ABSENT MEANS WE CREATED NOTHING. A missing entry is not "unknown, so guess"; it
   * is "no provenance, so not ours". See `install-record.ts` for why that direction
   * is the safe one.
   */
  createdKeys?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Root-field paths THIS INSTALL created, per absolute config path — the only root
   * fields uninstall may remove, and then only under the second condition below
   * (phase-5 review F2).
   *
   * ABSENT MEANS WE CREATED NOTHING, exactly as for {@link createdKeys}.
   */
  createdRootExtras?: ReadonlyMap<string, readonly string[][]>;
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

  let doc: { hooks?: Record<string, unknown[]> };
  try {
    doc = JSON.parse(stripComments(text)) as typeof doc;
  } catch {
    // A config we cannot understand is one we must not rewrite.
    return { ...base, unmarked: true };
  }

  const marked = eventKeys(spec).some((key) => (doc.hooks?.[key] ?? []).some(entryIsOwnedByUs));
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

  for (const key of eventKeys(spec)) {
    // Re-parse each pass: an index is only valid against the text it came from, and
    // removing an entry shifts every later index in that array.
    for (;;) {
      let parsed: { hooks?: Record<string, unknown[]> };
      try {
        parsed = JSON.parse(stripComments(current)) as typeof parsed;
      } catch {
        break;
      }
      const entries = parsed.hooks?.[key] ?? [];
      const index = entries.findIndex(
        (entry) => entryMayRemove(entry) && !refused.some((r) => r.command === describe(entry)),
      );
      if (index === -1) {
        for (const entry of entries) {
          if (
            entryIsOwnedByUs(entry) &&
            !entryMayRemove(entry) &&
            !refused.some((r) => r.command === describe(entry))
          ) {
            refused.push({
              command: describe(entry),
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

  // AN ARRAY WE EMPTIED IS REMOVED ONLY IF WE CREATED IT — and we know which,
  // because install wrote it down (phase-2 review F003).
  //
  // THE ASYMMETRY IS REAL AND STILL HANDLED: when an agent's config exists but lacks
  // the events key (a `settings.json` carrying only `model` and `permissions`),
  // `appendToArray` CREATES that key, and leaving `"PreToolUse": []` behind would
  // mean install created something uninstall did not remove.
  //
  // WHAT CHANGED IS THE TEST FOR "OURS". It used to be *this array is now empty*,
  // which answers a different question — a user who already had an empty
  // `PreToolUse: []` lost it. The cross-model review confirmed that as a contract
  // violation independent of whether any loader treats absent and empty alike: the
  // promise is surgical removal of what WE added. Emptiness is now necessary but no
  // longer sufficient; the key must ALSO appear in this install's provenance.
  //
  // NO PROVENANCE MEANS NO REMOVAL. An older install, or a deleted record, leaves a
  // key behind — recoverable cruft — rather than deleting a user's key, which is not.
  if (removed > 0) {
    const ourKeys = deps.createdKeys?.get(path);
    for (const key of eventKeys(spec)) {
      if (ourKeys?.has(key) !== true) continue;
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
    current = removeOurRootExtras(deps, path, current);
    writeThroughSymlink(deps.fs, path, current);
  }
  return { ...base, removed, refused };
}

/**
 * Remove root fields WE created — and only where nothing else in the file needs them
 * (plan 082, phase-5 review F2).
 *
 * THE PRINCIPLE IS UNCHANGED AND THE IMPLEMENTATION WAS TOO BROAD. Retention was
 * unconditional, justified by "a document-level switch is shared, so it is not ours
 * to clear". That justification holds only where something is there to share it
 * with. On a config with no other hook consumer, install + uninstall left
 * `{"tools":{"enableHooks":true},"hooks":{}}` behind: our write, never reversed,
 * protecting nobody. **Reversibility of our own writes is the principle; retaining
 * everything was a lazy way to satisfy it.**
 *
 * TWO CONDITIONS, BOTH REQUIRED:
 *
 * 1. **Provenance says we created it.** No record, or a record from an older build,
 *    means we created nothing — the same direction {@link UninstallDeps.createdKeys}
 *    fails in.
 * 2. **No foreign hook entry remains anywhere in this file's hook sections** after
 *    our own removal. Not just this agent's event keys: EVERY key under `hooks`,
 *    because the flag is document-level and so is the question.
 *
 * ANY DOUBT RETAINS. An unparseable document, a hook section that is not an array,
 * an entry we cannot classify — all of them count as a peer we cannot rule out. The
 * asymmetry is deliberate: retaining wrongly leaves recoverable cruft, while
 * removing wrongly edits a peer's configuration for it — and since no runtime has
 * been exercised with or without the field, that is a risk we could only take
 * blind.
 */
function removeOurRootExtras(deps: UninstallDeps, path: string, text: string): string {
  const ours = deps.createdRootExtras?.get(path);
  if (ours === undefined || ours.length === 0) return text;

  let doc: { hooks?: unknown };
  try {
    doc = JSON.parse(stripComments(text)) as typeof doc;
  } catch {
    return text;
  }
  if (foreignHooksRemain(doc.hooks)) return text;

  let current = text;
  for (const keyPath of ours) {
    if (keyPath.length === 0) continue;
    current = removeValue(current, [...keyPath]);
  }
  return current;
}

/**
 * Does ANY hook entry we do not own remain in this document?
 *
 * `true` is also the answer for anything we cannot read — a `hooks` block that is
 * not an object, a section that is not an array, an entry with no command we can
 * find. "I cannot tell" and "yes" must reach the same decision here, because only
 * one of them is safe.
 */
function foreignHooksRemain(hooks: unknown): boolean {
  if (hooks === undefined || hooks === null) return false;
  if (typeof hooks !== 'object' || Array.isArray(hooks)) return true;
  for (const section of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(section)) return true;
    for (const entry of section) {
      if (entryCommands(entry).length === 0) return true;
      // NOT `entryIsOwnedByUs`. An `ours-with-foreign` entry — one we refused to
      // remove precisely BECAUSE it chains somebody else's work — is owned by us and
      // still carries a peer's invocation. Only a wholly-ours entry is foreign-free.
      if (!entryMayRemove(entry)) return true;
    }
  }
  return false;
}

/**
 * A stable label for one entry, used to remember which ones we already refused.
 *
 * TWO SHAPES, ONE IDENTITY (plan 082 F005). A nested entry has no top-level
 * `command`, so keying a refusal on `entry.command` would key every nested entry on
 * `undefined` — they would all collapse into one, and the second would be reported
 * as already-refused. Joining the entry's commands gives a label that exists in both
 * shapes.
 */
const describe = (entry: unknown): string => entryCommands(entry).join(' ; ');

const stripComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

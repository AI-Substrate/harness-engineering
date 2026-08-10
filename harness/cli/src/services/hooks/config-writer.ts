import { applyEdits, modify, type ParseError, parse as parseJsonc } from 'jsonc-parser';
import type { FsPort } from '../../adapters/fs/fs-port.js';

/**
 * THE COMMENT- AND ORDER-PRESERVING CONFIG WRITER (plan 082 tk-0002).
 *
 * THE DEPENDENCY DECISION, RECORDED (dw-0008) — this is the first new RUNTIME
 * dependency this plan adds, and this repo has a supply-chain posture.
 *
 * **Chosen: `jsonc-parser`, pinned EXACTLY at `3.3.1`.**
 *
 * *Why a package rather than a hand-rolled CST.* The requirement is not "parse
 * JSONC" — `JSON.parse` on comment-stripped text does that in three lines. It is to
 * EDIT a document and re-print it with every byte we did not touch left alone.
 * That is a concrete-syntax-tree round-trip, and hand-rolling one means owning a
 * JSON scanner, comment and trailing-comma handling, and edit-offset arithmetic —
 * in the code path that writes to a customer's editor config. git-ai solves the
 * same problem with exactly one such writer (`utils.rs`, a `jsonc_parser` CST
 * round-trip); this is the same shape in TypeScript.
 *
 * *Why this package over the alternatives.*
 * - `comment-json` parses to objects with comments ATTACHED and re-serialises the
 *   whole document — so every byte is re-printed and only the comments it managed
 *   to reattach survive. That is the failure mode we are trying to prevent.
 * - `json5` is a different dialect, not an editor for this one.
 * - `jsonc-parser` returns MINIMAL TEXT EDITS (`modify` → `applyEdits`). Untouched
 *   bytes are untouched by construction rather than by careful re-printing, which
 *   is a much stronger guarantee than "we tried to preserve it". It is Microsoft's
 *   own JSONC parser (the one VS Code uses to edit `settings.json` — the identical
 *   problem), MIT, and has ZERO transitive dependencies.
 *
 * *Why it is DECLARED rather than reused.* It was already resolvable in
 * `node_modules` — but only transitively, via `markdownlint-cli2`, a DEV
 * dependency. A production install (`npm ci --omit=dev`) would not have had it, so
 * relying on that would have shipped a runtime `ERR_MODULE_NOT_FOUND` that no local
 * test could see.
 *
 * *Why EXACT rather than `^3.3.1`.* This code writes to files the user did not ask
 * us to reformat. A caret range lets a future install pull a version nobody
 * reviewed into that path. The repo already pins `jiti` exactly and its lockfile
 * remediation used `--save-exact`; this follows that, not the ecosystem default.
 *
 * WHAT IS PRESERVED, AND WHAT IS NOT — measured, not assumed:
 * - comments (leading, trailing, interior) — PRESERVED
 * - key order, including deliberately non-alphabetical order — PRESERVED
 * - every byte outside the edited array — BYTE-IDENTICAL
 * - the array we insert into — **REFORMATTED** to the document's indent style. A
 *   single-line `[{ "command": "x" }]` becomes multi-line. That is a real change to
 *   bytes the user wrote, it is bounded to the array we touch, and it is stated
 *   here rather than discovered in a diff.
 */

/** Where our entry goes: the event array at `hooks.<eventKey>`. */
export interface HookEntryTarget {
  /** JSON path to the event array, e.g. `['hooks','preToolUse']`. */
  path: (string | number)[];
  /** The entry to append. */
  entry: Record<string, unknown>;
}

/** Indentation the edits are formatted with. Two spaces matches every shipped config. */
const FORMATTING = { insertSpaces: true, tabSize: 2 } as const;

/**
 * Append `entry` to the array at `path`, preserving everything else.
 *
 * Returns the new document text. Throws nothing: an unparseable document returns
 * the input unchanged, because a config we cannot understand is one we must not
 * rewrite.
 */
export function appendToArray(text: string, target: HookEntryTarget): string {
  // MEASURED: `parseTree` does NOT reject a broken document. It is an EDITOR
  // parser and recovers from errors on purpose, so it returned a usable tree for
  // `{ this is not json at all` — and the writer cheerfully rewrote that garbage
  // into well-formed JSON, destroying whatever the user actually had. The errors
  // array is the only thing that answers "was this really valid?".
  const errors: ParseError[] = [];
  parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) return text;
  // `-1` is jsonc-parser's append index. Modifying an existing index would REPLACE.
  const edits = modify(text, [...target.path, -1], target.entry, {
    formattingOptions: FORMATTING,
    isArrayInsertion: true,
  });
  return applyEdits(text, edits);
}

/**
 * Write `contents` to `path`, FOLLOWING a symlink rather than replacing it (dw-0007).
 *
 * THE HAZARD THIS EXISTS FOR. Agent configs are routinely dotfile-managed — chezmoi,
 * stow, a personal dotfiles repo — which means `~/.cursor/hooks.json` is often a
 * SYMLINK into a git-tracked directory. The obvious atomic write (temp file, then
 * `rename` onto the target) would replace the symlink with a regular file, silently
 * detaching the config from its source of truth. The user's next dotfiles sync
 * reverts our install and nothing reports it.
 *
 * Backup does not save us either: a backup taken without following the link copies
 * the LINK, not the content. **Correct and destructive are independent properties.**
 *
 * So the path is canonicalised FIRST, and the write lands on the resolved target.
 * git-ai's `write_atomic` does the same, and it is the one thing in its installer
 * worth copying verbatim.
 *
 * Returns the path actually written, or `null` when it could not be resolved.
 */
export function writeThroughSymlink(fs: FsPort, path: string, contents: string): string | null {
  // A path that does not exist yet has nothing to resolve — write where asked.
  const target = fs.exists(path) ? fs.realpath(path) : path;
  if (target === null) return null;
  fs.writeText(target, contents);
  return target;
}

/**
 * Set the value at `path`, creating intermediate objects as needed, preserving
 * everything else (plan 082 F005).
 *
 * Used ONLY for root fields the upstream writer emits and the document lacks —
 * gemini's `tools.enableHooks` (`gemini.rs:99-106`), cursor's and firebender's
 * `version` (`cursor.rs:172-174`, `firebender.rs:143-148`). That is a parity claim
 * about what git-ai writes, NOT a claim that any agent requires these fields: no
 * runtime has been exercised with or without them. Callers check absence first: a
 * root key is shared with settings we have no business touching, so this must never
 * be pointed at a value the user already wrote.
 */
export function setValue(text: string, path: (string | number)[], value: unknown): string {
  const errors: ParseError[] = [];
  parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) return text;

  const edits = modify(text, path, value, { formattingOptions: FORMATTING });
  return applyEdits(text, edits);
}

/**
 * Remove the entry at `index` from the array at `path` — the same minimal-edit CST
 * round-trip as {@link appendToArray}, run backwards (plan 082 tk-000d).
 *
 * THIS IS UNINSTALL'S ONLY MECHANISM. It does NOT read a backup, and that is a
 * design decision rather than a gap: uninstall's symmetry is *surgically removing
 * what we added*, so the file returns to its original bytes because every byte we
 * did not write was never rewritten. Restore-from-backup is a separate
 * disaster-recovery concern with no implementation (backup flattens paths and
 * nothing reverses it) and is deliberately out of scope.
 *
 * Passing `undefined` as the value is jsonc-parser's array-element DELETE.
 */
export function removeFromArray(text: string, path: (string | number)[]): string {
  return removeAt(text, path);
}

/**
 * Remove the OBJECT KEY at `path` — the same minimal-edit round trip, pointed at a
 * root field rather than an array element (plan 082, phase-5 review F2).
 *
 * A separate name from {@link removeFromArray} because the CALLER's question is
 * different and the safety rules around it are different: an array element is one of
 * our entries, while a root key may be shared with a peer. `uninstall-strategy-a.ts`
 * owns the two conditions under which pointing this at a root field is permitted.
 */
export function removeValue(text: string, path: (string | number)[]): string {
  return removeAt(text, path);
}

/** Passing `undefined` as the value is jsonc-parser's DELETE, for both shapes. */
function removeAt(text: string, path: (string | number)[]): string {
  const errors: ParseError[] = [];
  parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) return text;

  const edits = modify(text, path, undefined, { formattingOptions: FORMATTING });
  return applyEdits(text, edits);
}

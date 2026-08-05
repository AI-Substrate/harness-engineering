import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixDirname } from '../shared/posix-path.js';
import { discoverExtensionsAt } from './discovery.js';

/**
 * FX004 — "you are not in a harness repo" was never the fact.
 *
 * `harness checks` from a directory with no loadable extensions used to fail with
 * `E108: Expected 0 arguments but got 1: checks` — a SYNTAX error for a diagnosable
 * state. The user did not type it wrong; the verb was never registered.
 *
 * THE MECHANISM IS ESTABLISHED, NOT INHERITED (packet ruling #3.3). Four probes:
 *
 *  1. cwd outside any repo                      -> E108           (verb absent)
 *  2. cwd = <repo>/harness/cli  (INSIDE a repo) -> E108           (verb absent)
 *  3. cwd = <repo>/docs         (INSIDE a repo) -> E108           (verb absent)
 *  4. cwd outside any repo, with a `.harness`
 *     symlinked in                              -> `checks` WORKS (verb present)
 *
 * So the discriminator is NOT inside-vs-outside a repo — probes 2/3 fail inside one
 * and probe 4 succeeds outside one. It is whether `<cwd>/.harness/extensions/` holds
 * a loadable extension, because `discoverExtensions` is cwd-relative and never walks
 * up (`discovery.ts`). The repo-root theory survived three tellings only because every
 * case anyone tried held "is a repo" and "cwd has extensions" together — the repo root
 * is WHERE `.harness/extensions` lives, so the two are confounded until probes 2/3/4
 * break them apart.
 *
 * That history is why this module asserts ONLY the fact it can establish, and treats
 * the remedy as a separate, VERIFIED claim (never a guess).
 */

/** Where a working directory WOULD be found — each state a different, honest claim. */
export type ExtensionRemedy =
  /** An ancestor directory was found AND verified to hold ≥1 loadable extension. */
  | { kind: 'ancestor'; dir: string }
  /** No ancestor holds one. Said plainly — NOT downgraded into a guess about a repo root. */
  | { kind: 'none' };

/** The established facts behind an unregistered verb, plus a remedy that was checked. */
export interface NoExtensionContext {
  /** The directory actually consulted by the loader (the cwd). */
  cwd: string;
  /** The verb the user asked for, echoed — never classified as "an extension verb". */
  requested: string;
  remedy: ExtensionRemedy;
}

/**
 * Walk from `cwd` UPWARD looking for a directory that holds a loadable extension.
 *
 * The loader deliberately does not do this; a diagnostic may (ruling #3.2), on two
 * conditions, both enforced here: the directory is only named after
 * {@link discoverExtensionsAt} CONFIRMS a resolvable entry there, and when nothing is
 * found the answer is `none` rather than a fallback guess. The alternative — "try the
 * repo root" — would re-teach the retracted mechanism under our own name, and a user
 * who followed it and succeeded would learn the wrong rule from us.
 *
 * `cwd` itself is skipped: the caller only reaches here because the loader already
 * found nothing there, so re-probing it could only produce a contradiction.
 */
export function findExtensionAncestor(fs: FsPort, cwd: string): ExtensionRemedy {
  let dir = posixDirname(cwd);
  let previous = cwd;
  // `posixDirname` is a fixed point at the root, which is the loop's terminator.
  while (dir !== previous) {
    if (discoverExtensionsAt(fs, dir).candidates.length > 0) return { kind: 'ancestor', dir };
    previous = dir;
    dir = posixDirname(dir);
  }
  return { kind: 'none' };
}

/**
 * The human/agent-readable message. Every sentence is a fact this build established:
 * the cwd it looked in, that nothing loadable was there, and — only when verified —
 * where something loadable actually is.
 */
export function noExtensionContextMessage(ctx: NoExtensionContext): string {
  const head =
    `No extensions are loadable from ${ctx.cwd} — ` +
    `\`${ctx.requested}\` is not a core command, and no extension verbs are registered. ` +
    'Extensions are discovered only in `<cwd>/.harness/extensions/`, which is not searched upward.';
  return ctx.remedy.kind === 'ancestor'
    ? `${head} A directory above this one does hold loadable extensions: ${ctx.remedy.dir} — run the command from there.`
    : `${head} No directory above this one holds any either, so there is no harness extension tree in scope here.`;
}

/** The actionable one-liner, matching the message's two honest states. */
export function noExtensionContextNextAction(ctx: NoExtensionContext): string {
  return ctx.remedy.kind === 'ancestor'
    ? `cd ${ctx.remedy.dir} && harness ${ctx.requested}`
    : 'Change to a directory whose `.harness/extensions/` holds an extension, or run `harness help` for the core commands available here.';
}

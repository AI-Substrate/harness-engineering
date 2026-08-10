/**
 * THE OWNED MARKER (plan 082 tk-0003) — what makes a hook entry ours.
 *
 * Three tasks depend on this (uninstall ownership, plugin-file ownership,
 * script-file ownership) and idempotency needs it to FIND our entry, so it is
 * decided here, once, before any writer assumes it.
 *
 * WHY NOT A SUBSTRING TEST. git-ai matches its own entries with
 * `contains("git-ai") && contains("checkpoint")`. That is the defect this file
 * exists to avoid, and it is not theoretical — MEASURED on the live
 * `~/.cursor/hooks.json` on this machine, git-ai's checkpoint invocation is not a
 * standalone entry at all. It is one PIPELINE STAGE inside a compound command
 * somebody else wrote:
 *
 *   python3 …/hook-probe.py PRE >/dev/null 2>&1; tee -a /tmp/cursor-hook-pre.jsonl \
 *     | /Users/…/.git-ai/bin/git-ai checkpoint cursor --hook-input stdin 2>>…
 *
 * git-ai's own predicate would claim that entire entry — an entry it did not
 * write, containing two other tools' invocations — and an uninstall would delete
 * all three. **One entry is not one tool's command.** That is the config-side
 * instance of what tk-000d learned on the command side.
 *
 * SO: EXACT-TOKEN MATCHING. An entry is ours only if one of its tokens is exactly
 * {@link HOOK_MARKER}. A command that merely CONTAINS the marker's text — as a
 * longer token, a path fragment, or a comment — is not ours and is never touched.
 *
 * WHY THE MARKER IS ITS OWN ARGUMENT rather than part of the binary path. The path
 * is quoted (it may contain spaces) and Windows-normalised (`C:\x\y.exe` becomes
 * `C:/x/y.exe`, and the `\\?\` prefix is stripped). A marker living inside the path
 * would be mangled by both. A standalone flag token is invariant under both
 * transformations, which is why {@link isOwnedByUs} can be asserted against a
 * quoted, space-bearing, forward-slashed path and still hold.
 *
 * WHERE IT LIVES, PER STRATEGY — fixed here before any writer is built:
 *
 * | strategy | file | marker location |
 * | --- | --- | --- |
 * | A — JSON config merge | the agent's config JSON | a token in the entry's `command` string |
 * | C — plugin file | our own TypeScript file | the same token in a header comment |
 * | D — script file | our own `/bin/sh` script | the same token in a `#` comment line |
 *
 * One literal, three locations. Strategies C and D own their whole file, so the
 * marker there answers "may I overwrite this?" rather than "which entry is mine?" —
 * but it is the SAME token, so a single grep finds every artifact we install.
 */

/**
 * The literal. Versioned, so a future incompatible entry shape can be recognised
 * and replaced rather than duplicated beside this one.
 *
 * It deliberately contains neither `git-ai` nor `checkpoint`, so git-ai's own
 * predicate cannot claim our entry (asserted in both directions).
 */
export const HOOK_MARKER = 'ai-substrate-harness-hook-v1';
/** The flag that carries the marker in a Strategy A command. */
export const HOOK_MARKER_FLAG = '--hook-owner';

/** Shell separators that end one command segment and begin the next. */
const SEGMENT_SPLIT = /(?:&&|\|\||[;|\n])/;

/**
 * Split a command line into bare tokens, quotes stripped.
 *
 * Segments first, then whitespace, so `…--hook-input stdin;other-tool` yields
 * `other-tool` rather than `stdin;other-tool` — the compound shape measured above
 * is the normal case, not an exotic one.
 */
export function commandTokens(command: string): string[] {
  return command
    .split(SEGMENT_SPLIT)
    .flatMap((segment) => segment.split(/\s+/))
    .map((token) => token.replace(/^['"]+|['"]+$/g, ''))
    .filter((token) => token.length > 0);
}

/**
 * What a hook entry is, from an ownership point of view.
 *
 * THREE STATES, NOT TWO, AND THAT IS THE POINT. A boolean forces the caller to
 * re-derive the distinction that matters, and it makes the WRONG behaviour the easy
 * one: "is it ours? yes → delete it".
 *
 * - `not-ours` — leave it entirely alone.
 * - `wholly-ours` — every segment is our invocation. Safe to remove.
 * - `ours-with-foreign` — our invocation is chained with somebody else's work in
 *   the SAME entry. **Never removed.** See {@link mayRemove}.
 */
export type HookOwnership = 'not-ours' | 'wholly-ours' | 'ours-with-foreign';

/**
 * Classify one entry's `command`.
 *
 * WHY `ours-with-foreign` EXISTS AT ALL — MEASURED, not imagined. On this machine a
 * third party (our own attribution POC) took git-ai's standalone hook invocation and
 * wrapped it into a chained command. That is the observed normal, not an exotic
 * case, and it will happen to ours: an entry like
 *
 *   other-tool --run && harness hooks fire cursor --hook-owner <marker>
 *
 * genuinely contains our invocation. Treating "contains our marker" as licence to
 * delete the ENTRY would destroy `other-tool --run` — which is EXACTLY what git-ai's
 * `contains("git-ai") && contains("checkpoint")` does to the POC entry here. The
 * same defect, more precisely targeted, with our name on it.
 */
export function classifyOwnership(command: string): HookOwnership {
  const segments = command
    .split(SEGMENT_SPLIT)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return 'not-ours';

  const ours = segments.filter((segment) => segmentTokens(segment).includes(HOOK_MARKER));
  if (ours.length === 0) return 'not-ours';
  return ours.length === segments.length ? 'wholly-ours' : 'ours-with-foreign';
}

/**
 * May uninstall remove this entry outright?
 *
 * **REFUSE is the decided posture** (plan 082 tk-0003, applied by tk-000d): an entry
 * that mixes our invocation with foreign segments is REPORTED and LEFT ALONE, never
 * deleted. Two reasons, and the first is the one that settles it:
 *
 * 1. A refusal that surprises someone is recoverable; a deletion that surprises them
 *    is not. "We never delete work we did not write" is a sentence we can keep.
 * 2. It is the same refuse-to-clobber posture already adopted for Strategies C and D
 *    (cline.rs's, rather than amp.rs's unconditional `remove_file`), so ownership
 *    behaves identically across all three strategies.
 *
 * The alternative — per-segment surgery, removing only our segment — is better
 * behaviour and more machinery, and it is deferred rather than silently skipped.
 * A mention of our marker in an `echo` also lands here, and refusing is the right
 * answer for that too.
 */
export const mayRemove = (command: string): boolean => classifyOwnership(command) === 'wholly-ours';

/**
 * Is this hook entry one WE installed — wholly or in part?
 *
 * The question idempotency and `status` ask ("is our hook already here?"). It is
 * deliberately NOT the question uninstall asks; use {@link mayRemove} for that.
 *
 * Exact token equality — never `includes`. A command containing
 * `ai-substrate-harness-hook-v1-experimental`, or a path with the marker in it, is
 * somebody else's and is left alone.
 */
export function isOwnedByUs(command: string): boolean {
  return classifyOwnership(command) !== 'not-ours';
}

/** Bare tokens of ONE already-split segment. */
function segmentTokens(segment: string): string[] {
  return segment
    .split(/\s+/)
    .map((token) => token.replace(/^['"]+|['"]+$/g, ''))
    .filter((token) => token.length > 0);
}

/**
 * Every command string an ENTRY carries — top-level and nested.
 *
 * TWO SHAPES, ONE OWNERSHIP QUESTION (plan 082 F005). A flat entry keeps its command
 * at `entry.command`; a NESTED matcher block keeps it at `entry.hooks[].command` and
 * has no top-level `command` at all. An ownership test reading only `entry.command`
 * therefore finds NOTHING in a nested config — so uninstall would silently refuse to
 * remove the very entry we installed, and the user could not clean up with our own
 * tool. That is not hypothetical: it is why three configs were repaired by hand.
 */
export function entryCommands(entry: unknown): string[] {
  if (typeof entry !== 'object' || entry === null) return [];
  const record = entry as { command?: unknown; hooks?: unknown };
  const out: string[] = [];
  if (typeof record.command === 'string') out.push(record.command);
  if (Array.isArray(record.hooks)) {
    for (const inner of record.hooks) {
      const nested = inner as { command?: unknown };
      if (typeof nested?.command === 'string') out.push(nested.command);
    }
  }
  return out;
}

/** Is this ENTRY — in either shape — one we installed? */
export const entryIsOwnedByUs = (entry: unknown): boolean => entryCommands(entry).some(isOwnedByUs);

/**
 * WHICH AGENT does this command of ours name? `null` when it names none.
 *
 * THE DISTINCTION THE WHOLE-SURFACE REVIEW FOUND MISSING (plan 082 F010 F3).
 * {@link isOwnedByUs} answers *"is this OURS"*, and every caller that needed
 * *"is this THIS AGENT's"* asked the broader question and read the broader answer
 * as the narrower one. That is not academic: `CLAUDE_CONFIG_DIR` pointed at
 * `.factory` makes claude-code and droid resolve to the SAME `settings.json` and
 * the SAME event arrays, and it is legal under the matrix. Claude installed first;
 * droid then saw a harness marker, called itself already-installed, and wrote
 * nothing. Detected agent, healthy report, no hook.
 *
 * READ FROM THE ARGUMENTS, NOT THE PATH. Our command is
 * `<invocation> hooks fire <agent> --phase …`, so the agent is the token after
 * `fire`. The path is quoted, Windows-normalised and legitimately different
 * between installs; the verb and its argument are invariant, which is the same
 * reasoning that put the marker in its own flag rather than inside the path.
 */
export function commandAgent(command: string): string | null {
  const tokens = commandTokens(command);
  const at = tokens.indexOf('fire');
  if (at === -1) return null;
  const agent = tokens[at + 1];
  return agent === undefined || agent.startsWith('-') ? null : agent;
}

/**
 * Is this entry ours AND this agent's?
 *
 * Both halves are required and neither implies the other: a foreign entry can
 * mention an agent name, and an entry of ours can belong to a DIFFERENT agent
 * sharing the same file.
 */
export const entryIsOwnedByAgent = (entry: unknown, agent: string): boolean =>
  entryCommands(entry).some((command) => isOwnedByUs(command) && commandAgent(command) === agent);

/**
 * May uninstall remove this ENTRY on THIS AGENT's behalf?
 *
 * UNIVERSAL, NOT EXISTENTIAL, AND THE DIFFERENCE IS A DELETED HOOK. The first
 * agent-qualified version of this was `entryMayRemove(entry) &&
 * entryIsOwnedByAgent(entry, agent)` — which proves every command in the entry is
 * OURS and that SOME command is the TARGET's. It does not prove every command is
 * the target's, and `uninstallStrategyA` removes the WHOLE entry. One valid nested
 * block carrying claude-code's and droid's commands was therefore removable on
 * behalf of either, and uninstalling droid deleted claude-code.
 *
 * **That was the defect this predicate was written to fix, reproduced inside the
 * fix for it**: the broad test was replaced by a narrower one that was still broad
 * in the dimension that mattered. So the question is asked of EVERY command:
 * wholly ours, and this agent's.
 *
 * A mixed-agent entry is consequently neither removable nor replaceable by one
 * agent. It must be REPORTED — see {@link entryIsSharedWithPeerAgent} — for the
 * same reason a foreign-chained entry is: a refusal nobody hears is
 * indistinguishable from a repair.
 */
export function entryMayRemoveForAgent(entry: unknown, agent: string): boolean {
  const commands = entryCommands(entry);
  return (
    commands.length > 0 &&
    commands.every(
      (command) => classifyOwnership(command) === 'wholly-ours' && commandAgent(command) === agent,
    )
  );
}

/**
 * Is this entry ours, carrying THIS agent, and ALSO carrying another agent's
 * harness command?
 *
 * The state that is safe to neither remove nor rewrite on one agent's behalf. It
 * is distinguished from a FOREIGN-chained entry deliberately, because the operator
 * action differs: a peer's command is ours to reconcile, someone else's work is
 * not ours to touch at all.
 */
export function entryIsSharedWithPeerAgent(entry: unknown, agent: string): boolean {
  const commands = entryCommands(entry).filter(isOwnedByUs);
  if (!commands.some((command) => commandAgent(command) === agent)) return false;
  return commands.some((command) => commandAgent(command) !== agent);
}

/** May uninstall remove this ENTRY outright, in either shape? */
export function entryMayRemove(entry: unknown): boolean {
  const commands = entryCommands(entry);
  return (
    commands.length > 0 && commands.every((command) => classifyOwnership(command) === 'wholly-ours')
  );
}

/**
 * Would a marker appear anywhere in this text? For file-based strategies (C, D)
 * where the whole file is ours and a line comment carries the token.
 */
export function fileIsOwnedByUs(contents: string): boolean {
  return contents.split(/\r?\n/).some((line) => commandTokens(line).includes(HOOK_MARKER));
}

/**
 * git-ai's OWN ownership test, reproduced so our entries can be asserted immune to
 * it — and so the reverse is asserted too.
 *
 * This is not a utility we call in production. It exists to be pointed at both
 * sides of the boundary in a test, because "our predicate is better" is an
 * argument and "neither predicate claims the other's entry" is a measurement.
 */
export function gitAiWouldClaim(command: string): boolean {
  return command.includes('git-ai') && command.includes('checkpoint');
}

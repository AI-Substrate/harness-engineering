import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { AgentSpec } from './agent-matrix.js';
import { eventKeys, phaseKeys, resolveConfigFiles } from './agent-matrix.js';
import { extractBinaryPath, extractInterpreterPath, INTERPRETER_FLAGS } from './binary-path.js';
import { appendToArray, isParseableJson, setValue, writeThroughSymlink } from './config-writer.js';
import {
  commandTokens,
  entryCommands,
  entryIsOwnedByAgent,
  entryIsSharedWithPeerAgent,
  entryMayRemove,
  HOOK_MARKER,
  HOOK_MARKER_FLAG,
} from './hook-marker.js';

/**
 * STRATEGY A — merge our hook entry into an agent's JSON config (plan 082 tk-0005).
 *
 * ONE code path for all seven agents. Everything that differs between them is read
 * from the matrix row, so adding an agent is adding a row — proven by driving a
 * FAKE agent row through this same function with no code change (dw-0010).
 *
 * THE ABSENT-FILE CASE IS FIRST-CLASS, NOT AN EDGE. It is not hypothetical:
 * `collector/evidence.ts` already records that git-ai created copilot's hooks file
 * fresh on this machine. A detected agent with no config yet is a NORMAL state, and
 * it is one situation with THREE consequences that must be kept together:
 *
 * 1. **Create** the file AND its parent directories, with a defined skeleton — an
 *    agent whose config we create must end up with a document the agent can read,
 *    not a fragment.
 * 2. **It is created-not-backed-up, NOT covered.** `backupAgentConfigs` skips a
 *    non-existent source, so no backup exists for this agent — and "no backup" and
 *    "backed up successfully" must never look the same to a caller. That is what
 *    {@link InstallOutcome.created} is for.
 * 3. **Uninstall's symmetry is DELETE, not restore.** There are no original bytes
 *    to restore, so restoring is undefined. Recorded here for tk-000d rather than
 *    solved here: the flag this install returns is the input that decision needs.
 */

/** The document written when an agent has no config at all. */
export interface Skeleton {
  hooks: Record<string, unknown[]>;
}

/**
 * An upgrade we DECLINED, because our invocation is chained with foreign work
 * in the same entry (F008 review F1).
 *
 * REPORTED, NEVER SILENT. The refusal is correct and it is not free: the entry
 * we left alone is still the bare-`.js` form, so on Windows that operator stays
 * unattributed and nothing has told them why. This carries the replacement so it
 * can be pasted in by hand.
 */
export interface RefusedUpgrade {
  path: string;
  /** The entry we left alone, as it stands on disk. */
  command: string;
  reason: string;
  /** The command we WOULD have written — the interpreter-first form. */
  replacement: string;
  /** One sentence an operator can act on, naming the replacement. */
  nextAction: string;
}

export interface InstallOutcome {
  agent: string;
  /** Absolute path written. */
  path: string;
  /**
   * WHAT THIS RUN DID TO THIS FILE — the distinction whose absence caused the
   * worst defect in this surface (plan 082 F010 F1).
   *
   * Compensation used to read `!alreadyPresent` as "we created this, so uninstall
   * reverses it". A legacy MIGRATION also reports `!alreadyPresent`, correctly —
   * it did write this run — but it REPLACED an entry the user already had. So the
   * compensation for a failed provenance write ran uninstall over a pre-existing
   * hook and DELETED IT, while the report said `rolled back`. Data loss on a
   * user's machine, on a failure path, announced as a recovery.
   *
   * FOUR VALUES, NOT THREE, because two of them are `!alreadyPresent` today and
   * have DIFFERENT REVERSALS:
   *
   * - `created-file` — the file did not exist. Reversal is DELETE; there are no
   *   original bytes to return to.
   * - `added-entry` — the file existed and we appended ours. Reversal is the
   *   ordinary surgical uninstall, so one removal implementation and its refusals
   *   keep applying.
   * - `rewritten-entry` — an entry that was ALREADY THERE was migrated in place.
   *   Reversal is RESTORE THE PREVIOUS BYTES. Removing it is not a reversal; it is
   *   the loss.
   * - `already-present` — nothing was written, so there is nothing to reverse.
   *
   * Never inferred. {@link created} and {@link alreadyPresent} are DERIVED from
   * this field so the two answers cannot drift apart again.
   */
  change: InstallChange;
  /**
   * The file's bytes BEFORE this run wrote, or `null` when it did not exist.
   *
   * The only provenance that can undo a migration, and knowable only here — by the
   * time compensation runs, the previous entry exists nowhere.
   */
  previousText: string | null;
  /**
   * The bytes this run wrote, or `null` when it wrote none.
   *
   * NOT redundant with {@link previousText}: it is the EVIDENCE a rollback checks
   * before restoring. A blanket byte-restore is only safe while the file still
   * holds exactly what we put there, and two agents can legitimately share one
   * file — so a restore that skipped this check could revert a peer's committed
   * install (see `restoreIfStillOurs`).
   */
  writtenText: string | null;
  /**
   * TRUE when this install CREATED the file (and possibly its parents).
   *
   * Load-bearing beyond reporting: a created file has NO BACKUP — `backupAgentConfigs`
   * skips a non-existent source — so uninstall must DELETE it rather than restore
   * bytes that never existed. A boolean here is what stops "we created it" and "we
   * modified it" being indistinguishable later, which is when the wrong uninstall
   * gets written.
   */
  created: boolean;
  /** TRUE when our entry was already present, so nothing was written (idempotency). */
  alreadyPresent: boolean;
  /**
   * Event-array keys that did NOT exist in this file before we wrote — i.e. keys
   * `appendToArray` created (plan 082, phase-2 review F003).
   *
   * PROVENANCE, RECORDED AT THE ONLY MOMENT IT IS KNOWABLE. Uninstall used to infer
   * "we created this key" from "this array is now empty", which is not the same
   * question: a user who already had an empty `PreToolUse: []` lost it. The cross-model
   * review confirmed that as a contract violation independent of whether any loader
   * treats absent and empty alike — the promise is surgical removal of what WE added,
   * and an empty array we did not add is not ours to remove.
   *
   * By the time uninstall runs, the difference is unrecoverable from the file itself.
   * So it is captured here and persisted (`install-record.ts`).
   */
  createdKeys: string[];
  /**
   * Root-field paths THIS INSTALL created — e.g. `['tools','enableHooks']` or
   * `['version']` (plan 082, phase-5 review F2).
   *
   * SAME PROVENANCE PROBLEM AS `createdKeys`, ONE LEVEL UP, and it was missed
   * because retention was made unconditional instead. Uninstall retained every root
   * field on the argument that it might belong to a peer — true when a peer exists,
   * and on a config with no other hook consumer it just meant
   * `{"tools":{"enableHooks":true}}` left behind forever: our write, rationalised as
   * shared.
   *
   * KNOWABLE ONLY HERE. Afterwards the field exists and nothing in the file says who
   * put it there. Recorded per PATH, and the path shape carries the second half of
   * the answer: an ABSENT `tools` records `['tools']` (we made the whole object, we
   * may remove the whole object), while a `tools` that merely lacked the flag records
   * `['tools','enableHooks']` (we made one key, we may remove one key).
   */
  createdRootExtras: string[][];
  /**
   * Upgrades this run DECLINED — an entry of ours chained with foreign work.
   *
   * On the outcome rather than thrown, for the same reason the outcome is per
   * FILE: a refusal that reaches nobody is indistinguishable from a repair, and
   * the entry we declined to touch is the one that cannot run.
   */
  refusedUpgrades: RefusedUpgrade[];
}

/**
 * The ARGUMENTS half of our hook command — the one source of truth for the tail.
 *
 * SPLIT OUT BECAUSE THE POWERSHELL VARIANT USED TO REBUILD IT BY ARITHMETIC:
 * `command.slice(binary.length)` (F008). That is a second source of truth about
 * the same value, derived by measuring a string with a number, and it broke the
 * moment the invocation stopped being one token. Both variants now compose the
 * SAME tail behind their own invocation syntax, so a change to the arguments
 * cannot reach one and miss the other.
 */
export const hookArgs = (agent: string, phase: 'pre' | 'post'): string =>
  `hooks fire ${agent} --phase ${phase} --hook-input stdin ${HOOK_MARKER_FLAG} ${HOOK_MARKER}`;

/** The command we install for one agent and phase. */
export const hookCommand = (binary: string, agent: string, phase: 'pre' | 'post'): string =>
  `${binary} ${hookArgs(agent, phase)}`;

/**
 * The skeleton for an agent with no config.
 *
 * Built FROM THE MATRIX ROW, so it carries that agent's own event-key casing —
 * a skeleton hard-coded to `PreToolUse` would produce a config gemini and cursor
 * silently ignore. Both keys are present even though only one is filled, because a
 * config missing a key the agent expects is a different shape from an empty one.
 */
export function skeletonFor(spec: AgentSpec): Skeleton {
  const hooks: Record<string, unknown[]> = {};
  for (const key of eventKeys(spec)) hooks[key] = [];
  return { hooks };
}

/**
 * Install our hook entry into every config file this agent uses.
 *
 * Returns one outcome PER FILE — which is what makes windsurf's two paths visible
 * to a caller instead of collapsing into a single "installed" (dw-0014). Half-working
 * is the failure mode this plan keeps meeting, and a single return value is how it
 * hides.
 */
/** What one run did to one config file. See {@link InstallOutcome.change}. */
export type InstallChange = 'created-file' | 'added-entry' | 'rewritten-entry' | 'already-present';

/**
 * Install our hook entry into every config file this agent uses.
 *
 * Returns one outcome PER FILE — which is what makes windsurf's two paths visible
 * to a caller instead of collapsing into a single "installed" (dw-0014). Half-working
 * is the failure mode this plan keeps meeting, and a single return value is how it
 * hides.
 *
 * PLAN EVERYTHING, THEN COMMIT, THEN ROLL BACK ON FAILURE — one agent, one unit
 * (plan 082 F010 F2). This used to `.map()` straight over the paths, so windsurf's
 * FIRST file committed, its SECOND threw, and the outcome array was never
 * returned: the caller reported the agent FAILED while a file sat installed and
 * unknown to provenance, which means uninstall would never clean it up. **We
 * reported per agent and committed per file.** Now the writes are computed first
 * (no side effects), committed second, and any that landed before a failure are
 * put back — so the unit we report is the unit we commit.
 *
 * The thrown error carries what was COMMITTED AND COULD NOT BE PUT BACK, because a
 * partial state that reaches nobody is exactly the orphan this change exists to
 * prevent. See {@link PartialInstallError}.
 */
export function installStrategyA(
  fs: FsPort,
  spec: AgentSpec,
  home: string,
  env: (name: string) => string | undefined,
  binary: string,
): InstallOutcome[] {
  // PHASE 1 — PLAN. Reads only. A failure here has written nothing, so it can
  // simply propagate: there is no state to unwind.
  const planned = resolveConfigFiles(spec, home, env).map((path) =>
    planOneFile(fs, spec, path, binary),
  );

  // PHASE 2 — COMMIT. Two lists, and the distinction is load-bearing: `outcomes`
  // is what the caller records and reports, `written` is what a failure may need
  // to undo. Pushing a NO-OP plan into the rollback set made `revertWrite` compare
  // a file's bytes against `null`, refuse, and report an UNTOUCHED file as a write
  // that could not be rolled back.
  const outcomes: InstallOutcome[] = [];
  const written: InstallOutcome[] = [];
  try {
    for (const plan of planned) {
      commitOneFile(fs, plan);
      outcomes.push(plan.outcome);
      if (plan.outcome.writtenText !== null) written.push(plan.outcome);
    }
  } catch (error) {
    // PHASE 3 — ROLL BACK what this agent already wrote. Anything that cannot be
    // put back is NAMED rather than dropped.
    const stranded = written.filter((outcome) => !revertWrite(fs, outcome));
    throw new PartialInstallError(error instanceof Error ? error.message : String(error), stranded);
  }
  return outcomes;
}

/**
 * A commit that failed after some of this agent's files were already written, and
 * could not be fully undone.
 *
 * Carries the outcomes still ON DISK so the caller can RECORD them. Provenance for
 * a file we cannot remove is what lets a later `uninstall` finish the job; without
 * it the file is invisible to every tool we ship — installed, unrecorded, and
 * unremovable, which is the one state this family promises cannot exist.
 */
export class PartialInstallError extends Error {
  constructor(
    message: string,
    /** Written, still present, and not yet recorded anywhere. */
    readonly stranded: InstallOutcome[],
  ) {
    super(message);
    this.name = 'PartialInstallError';
  }
}

/**
 * Undo one committed write. `true` when the file is back to its previous state.
 *
 * RESTORE ONLY WHAT IS STILL OURS. A blanket byte-restore assumes nothing else
 * touched the file since we wrote it, and that assumption is false in a case this
 * very review established: two agents can resolve to the SAME config file
 * (`CLAUDE_CONFIG_DIR` pointed at `.factory`). Writing our previous bytes back
 * over a file a peer has since written to would silently un-install the peer —
 * fixing a partial install by causing a different one. So the current bytes must
 * still be exactly what we wrote; otherwise we report `false` and let the caller
 * record and name the state rather than guess at it.
 *
 * EXPORTED, AND USED BY THE PROVENANCE COMPENSATION TOO. There were briefly two
 * implementations of this rule — one here for a mid-commit failure, one in
 * `hooks-verbs` for a failed provenance write — and a mutation that removed the
 * still-ours check from the second SURVIVED THE WHOLE SUITE, because only the
 * first was pinned. Two copies of a safety rule is one copy and a rumour.
 */
export function revertWrite(fs: FsPort, outcome: InstallOutcome): boolean {
  try {
    if (fs.readText(outcome.path) !== outcome.writtenText) return false;
    if (outcome.previousText === null) {
      fs.deleteFile(outcome.path);
      return true;
    }
    writeThroughSymlink(fs, outcome.path, outcome.previousText);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the ENTRY we append, in this agent's own shape (plan 082 F005).
 *
 * ONE PLACE ANSWERS "what does an entry look like here", because F005 is what
 * happens when the answer is assumed instead: the flat shape went into three
 * configs that require the nested one and disabled all three files outright.
 *
 * The nested form wraps the command in a matcher block — and it is OUR OWN block,
 * never git-ai's. Appending into a `matcher: "*"` block somebody else wrote would
 * mean editing an entry we do not own, which is the posture `hook-marker.ts`
 * exists to refuse. Claude Code, gemini and droid all accept multiple blocks per
 * event, so our own block is both valid and clean to remove.
 */
export function buildEntry(
  spec: AgentSpec,
  binary: string,
  phase: 'pre' | 'post',
): Record<string, unknown> {
  const command = hookCommand(binary, spec.agent, phase);
  const extras = spec.entryExtras ?? {};

  if (spec.powershellVariant === true) {
    // BOTH PARTS, from the same structured pair the command uses (F008). The
    // previous form extracted ONE path and re-prefixed it, which for an
    // interpreter-first invocation produced `& 'node' hooks fire …` — node with
    // no script, a second broken command string beside the one we had just
    // fixed.
    const interpreter = extractInterpreterPath(binary);
    const script = extractBinaryPath(binary) ?? binary;
    // `& '<path>'` with embedded single quotes doubled — powershell's own escaping,
    // and the form git-ai writes (github_copilot.rs:59-69).
    const psQuote = (path: string) => `'${path.replace(/'/g, "''")}'`;
    /*
     * WHEN THE COMMAND NAMES OUR WRAPPER, POWERSHELL NAMES ITS TWIN — never the same
     * file. `harness-hook.sh` is POSIX shell and cannot run on a Windows host; the
     * `.ps1` beside it is the same resolution logic in the other dialect.
     *
     * They are DELIBERATELY not inferred from one another beyond this path swap.
     * npm's own `cmd-shim` has divergent resolution between its `.cmd` and `.ps1`
     * variants (npm/cmd-shim#51), and our own Windows run found four defects in the
     * `.ps1` that its POSIX twin did not have — quote stripping, a literal backtick-t,
     * a .NET Core-only overload, and a null-binding conversion. Two files, tested
     * separately, sharing only a name.
     */
    const wrapperPs = script.endsWith('harness-hook.sh')
      ? script.replace(/harness-hook\.sh$/, 'harness-hook.ps1')
      : null;
    /*
     * THE INTERPRETER FLAGS TRAVEL WITH THE INTERPRETER, on both strings.
     *
     * They did not. `command` carried `--no-warnings` and this reconstruction
     * dropped it, so the two fields IN ONE ENTRY ran different commands — the posix
     * one silenced Node's warnings and the Windows one did not. A hook's stdout is
     * parsed by the agent, so a stray warning is not cosmetic.
     *
     * Moot for a wrapper entry, which names no interpreter at all — the wrapper owns
     * the flags now. Kept for the fallback pair, which still emits both parts.
     */
    const flags = INTERPRETER_FLAGS.length === 0 ? '' : ` ${INTERPRETER_FLAGS.join(' ')}`;
    const invocation =
      wrapperPs !== null
        ? `& ${psQuote(wrapperPs)}`
        : interpreter === null
          ? `& ${psQuote(script)}`
          : `& ${psQuote(interpreter)}${flags} ${psQuote(script)}`;
    Object.assign(extras, { powershell: `${invocation} ${hookArgs(spec.agent, phase)}` });
  }

  if (spec.entryShape === 'nested') {
    return {
      matcher: spec.matcher ?? '*',
      hooks: [{ type: 'command', command, ...extras }],
    };
  }
  return { command, ...extras };
}

/**
 * Fields the DOCUMENT ROOT needs, limited to those genuinely absent.
 *
 * A root key is shared with settings we have no business touching, so an existing
 * value is left exactly as the user wrote it — we add what is missing and nothing
 * else. Gemini's `tools.enableHooks` is the reason this exists at all: git-ai sets
 * it on every gemini install and asserts it (`gemini.rs:99-106`, `:478-480`), and
 * we were not setting it.
 *
 * MATCHED-NOT-VERIFIED (phase-5 review F3): that is a parity claim about the
 * upstream WRITER, not a claim that gemini's runtime gates dispatch on the flag.
 * No runtime has been exercised either way.
 *
 * WHAT IT RETURNS IS ALSO PROVENANCE. The list is exactly what this install is
 * about to create, which is the only moment that is knowable — `installOneFile`
 * records it so uninstall can reverse our own write and nobody else's.
 */
export function missingRootExtras(
  text: string,
  spec: AgentSpec,
): [path: string[], value: unknown][] {
  const wanted = spec.rootExtras;
  if (wanted === undefined) return [];
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(stripComments(text)) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: [string[], unknown][] = [];
  for (const [key, value] of Object.entries(wanted)) {
    const current = doc[key];
    if (current === undefined) {
      out.push([[key], value]);
      continue;
    }
    // A nested object (gemini's `tools`) merges KEY BY KEY, so an existing `tools`
    // block carrying the user's own settings keeps them and gains only what is
    // missing. Replacing the whole object would silently delete them.
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const existing = (typeof current === 'object' && current !== null ? current : {}) as Record<
        string,
        unknown
      >;
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (existing[inner] === undefined) out.push([[key, inner], innerValue]);
      }
    }
  }
  return out;
}

/** One file's intended write, computed without touching the disk. */
interface FilePlan {
  outcome: InstallOutcome;
  /** Directory to create first, when this plan creates the file. */
  mkdir: string | null;
}

/**
 * Decide what to write to ONE file. READS ONLY — no write, no mkdir.
 *
 * Separated from the commit so an agent's files can be planned together and
 * committed together (F010 F2). Anything that throws here has changed nothing.
 */
function planOneFile(fs: FsPort, spec: AgentSpec, path: string, binary: string): FilePlan {
  // ABSENT and UNREADABLE are different worlds and must not share a value.
  // `readText` swallows every error to null, so `exists ? readText : null`
  // recorded a locked/denied/EBUSY file — all live states on Windows with the
  // editor running — as `created: true`. That flag feeds the install record,
  // and uninstall DELETES paths recorded as created: misrecord it and the
  // delete branch runs on a user's file (only the marker guard, checking a
  // different fact, stood in front of it — protection by coincidence).
  // Measured on the from-zero fixture (2026-08-10): cursor's hooks.json was
  // present, unread, recorded created, and never written. Refusing loudly here
  // turns that into a named per-agent failure.
  const fileExists = fs.exists(path);
  const raw = fileExists ? fs.readText(path) : null;
  if (fileExists && raw === null) {
    throw new Error(
      `${path} exists but could not be read (locked, permission-denied, or transiently held by another process) — refusing to plan against a config we cannot see. Nothing was modified; re-run when the file is readable.`,
    );
  }
  // A LEADING UTF-8 BOM IS STRIPPED, AND NOTHING ELSE IS — the same one-code-
  // point strip as `parseHookPayload`, for the same reason found the same way:
  // PowerShell (and Windows editors) routinely write agent configs with an
  // `EF BB BF` prefix, `JSON.parse` and jsonc-parser both reject it, and every
  // predicate in this planner then reads false. The writers below decline the
  // unparseable text unchanged (correctly), `text === before` holds, and the
  // whole file reports ALREADY-PRESENT — an install that wrote nothing and
  // claimed success, measured on the from-zero Windows fixture (2026-08-10).
  // The stripped text is what we plan against and write back (the written file
  // is clean); `raw` stays as `previousText` so a rollback is byte-faithful.
  const existing = raw !== null && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const created = existing === null;

  const before = existing ?? `${JSON.stringify(skeletonFor(spec), null, 2)}\n`;

  // REFUSED LOUDLY, NEVER SILENTLY SKIPPED. The writers return unparseable text
  // unchanged, which from here is indistinguishable from "nothing to do" — so
  // the question is asked FIRST, with the writers' own predicate. Throwing here
  // has changed nothing (this function only reads), and the per-agent catch in
  // `installHooks` turns it into a named failure the operator can act on.
  if (!created && !isParseableJson(before)) {
    throw new Error(
      `${path} is not parseable JSON, so no hook can be installed into it — repair or remove the file and re-run. Nothing was modified.`,
    );
  }
  // Sampled BEFORE the first write, because afterwards every key exists.
  const createdKeys = eventKeys(spec).filter((key) => !hasEventKey(before, key));

  /*
   * ONE PATH, NOT TWO (F010 review R2). There used to be an "already present"
   * branch and a "fresh install" branch, and the first could only repair SOME of
   * the configuration: it upgraded entries and added root extras, and never
   * noticed a MISSING ENTRY. Deleting cursor's post-tool entry was therefore
   * permanent — half the bracket gone, `status` still reporting installed.
   *
   * The two branches asked different questions of the same file. Now there is one
   * sequence — migrate, converge the root, add the phases this agent lacks — and
   * ALREADY-PRESENT MEANS WHAT IT SHOULD ALWAYS HAVE MEANT: the text did not
   * change. That collapses the branches honestly instead of adding a third.
   */
  const upgrade = upgradeLegacyEntries(before, spec, binary, path);
  let text = upgrade.text ?? before;

  // ADDS WHAT IS ABSENT AND NOTHING ELSE: a root key is shared with settings we
  // have no business touching, so a value the user changed is theirs and stays.
  const rootExtras = missingRootExtras(text, spec);
  for (const [keyPath, value] of rootExtras) text = setValue(text, keyPath, value);

  for (const [phase, key] of phaseKeys(spec)) {
    // PER AGENT, PER EVENT KEY. An entry belonging to a PEER in this array does
    // not make this agent installed, and an entry of ours that is already here
    // must not be duplicated.
    if (hasAgentEntry(text, key, spec.agent)) continue;
    text = appendToArray(text, {
      path: ['hooks', key],
      // The ENTRY comes from the matrix row's shape, never from a branch on the
      // agent name — see `buildEntry` for what F005 cost when it was assumed.
      //
      // AND IT IS ALWAYS OUR OWN, SEPARATE ENTRY. We never merge into a block
      // that already exists, so we cannot manufacture the mixed-agent entry that
      // uninstall and upgrade must refuse.
      entry: buildEntry(spec, binary, phase),
    });
  }

  const base = {
    agent: spec.agent,
    path,
    // `raw`, not the BOM-stripped text: a rollback must restore the exact bytes
    // that were on disk, BOM included.
    previousText: raw,
    created,
    createdKeys,
    refusedUpgrades: upgrade.refused,
  };

  if (text === before && !created) {
    return {
      mkdir: null,
      outcome: {
        ...base,
        change: 'already-present',
        alreadyPresent: true,
        // We wrote nothing this run, so we created no root field this run. An EARLIER
        // run's provenance is in the record and is merged, never overwritten.
        createdRootExtras: [],
        writtenText: null,
      },
    };
  }

  return {
    // Parent directories too: copilot's config lives at `.copilot/hooks/git-ai.json`
    // and windsurf's second file at `.codeium/windsurf/hooks.json`, so the parent is
    // routinely more than one level deep and routinely absent.
    mkdir: created ? parentOf(path) : null,
    outcome: {
      ...base,
      // `rewritten-entry` ONLY when an entry that already existed was migrated:
      // that is the one case whose reversal is a byte-restore rather than a
      // removal, and conflating it with the others is what deleted a user's hook.
      // A created file stays `created-file` whatever else happened.
      change: created ? 'created-file' : upgrade.text !== null ? 'rewritten-entry' : 'added-entry',
      // NOT `alreadyPresent`: we WROTE this run. Reporting a repair as "already
      // present" would tell a user on the platform this fixes that nothing needed
      // doing, on the run that did it.
      alreadyPresent: false,
      createdRootExtras: rootExtras.map(([keyPath]) => keyPath),
      writtenText: text,
    },
  };
}

/** Perform one planned write. The ONLY place this strategy touches the disk. */
function commitOneFile(fs: FsPort, plan: FilePlan): void {
  if (plan.mkdir !== null) fs.mkdirp(plan.mkdir);
  if (plan.outcome.writtenText === null) return;
  // `null` is writeThroughSymlink DECLINING — the existing path could not be
  // resolved — and ignoring it recorded a write that never happened as an
  // install (from-zero fixture, 2026-08-10: no throw, no file, a clean record).
  // A declined write must fail the agent BY NAME, exactly like a throwing one:
  // the catch in `installStrategyA` rolls back this agent's earlier files and
  // surfaces the reason instead of a success line.
  const written = writeThroughSymlink(fs, plan.outcome.path, plan.outcome.writtenText);
  if (written === null) {
    throw new Error(
      `${plan.outcome.path} exists but its real path could not be resolved (locked, permission-denied, or a broken link) — the hook entry was NOT written`,
    );
  }
}

/**
 * Rewrite entries of ours that predate F008 — the UPGRADE path.
 *
 * Returns the new document text, or `null` when there is nothing to upgrade.
 *
 * WHY THIS EXISTS. Idempotency finds our entry BY MARKER, so a legacy entry
 * short-circuits install as `alreadyPresent` — correct for duplication, wrong
 * for repair. Without this, a Windows user who upgrades the CLI and re-runs
 * `harness hooks install` is told everything is fine while the command that
 * cannot execute stays exactly where it was. The fix would never reach the only
 * platform that needs it.
 *
 * `entryMayRemove`, NOT `entryIsOwnedByUs` (F008 review F1). The loose predicate
 * means "ANY command in this entry is ours", and this function REPLACES THE
 * WHOLE ENTRY — so gating on it destroyed foreign work chained into a legacy
 * entry (`… --hook-owner … && other-tool --run`). The strict predicate already
 * existed: F005 built the three-state ownership model precisely so we would
 * refuse to clobber a mixed entry, `uninstall-strategy-a.ts` states the rule in
 * a comment, and this path walked around both.
 *
 * REFUSE, DO NOT PERFORM SURGERY. Splicing our segment out of somebody else's
 * shell command line is more machinery and a worse failure mode than declining;
 * "we never rewrite work we did not write" is a sentence we can keep. The
 * refusal is REPORTED with the replacement command, because a silent refusal
 * leaves the user with a hook that cannot run and no way to know why.
 *
 * WHY IT IS OTHERWISE NARROW. It rewrites ONLY when the configured command lacks
 * an interpreter while the one we would now write has one. An unconditional
 * rewrite would churn every config on every run — and, because `installHooks`
 * rolls back "what THIS run wrote", could uninstall a good hook to compensate
 * for an unrelated failure.
 */
function upgradeLegacyEntries(
  text: string,
  spec: AgentSpec,
  binary: string,
  path: string,
): { text: string | null; refused: RefusedUpgrade[] } {
  const wanted = requiredInvocationParts(binary);
  if (wanted === null) return { text: null, refused: [] };

  let doc: { hooks?: Record<string, unknown[]> };
  try {
    doc = JSON.parse(stripComments(text)) as typeof doc;
  } catch {
    return { text: null, refused: [] };
  }

  let out = text;
  let changed = false;
  const refused: RefusedUpgrade[] = [];
  for (const [phase, key] of phaseKeys(spec)) {
    const entries = doc.hooks?.[key];
    if (!Array.isArray(entries)) continue;
    for (const [index, entry] of entries.entries()) {
      // AGENT-QUALIFIED, AND UNIVERSALLY SO (F010 review R1). This rewrites the
      // WHOLE entry as THIS agent's command, so entering on "some command here is
      // this agent's" would delete a peer's command BY REWRITING IT — worse than
      // deleting it outright, because the file still looks installed afterwards.
      if (!entryIsOwnedByAgent(entry, spec.agent)) continue;
      if (entryCommands(entry).every((command) => invocationIsCurrent(command, wanted))) continue;

      const replacement = hookCommand(binary, spec.agent, phase);
      if (entryIsSharedWithPeerAgent(entry, spec.agent)) {
        refused.push({
          path,
          command: entryCommands(entry).join(' ; '),
          reason: "this entry also carries another agent's harness command",
          replacement,
          nextAction: `Left unchanged so the other agent's hook survives — rewriting this entry for ${spec.agent} would replace theirs. Split the commands into separate entries, then re-run install; ${spec.agent}'s should read: ${replacement}`,
        });
        continue;
      }
      if (!entryMayRemove(entry)) {
        for (const command of entryCommands(entry)) {
          refused.push({
            path,
            command,
            reason: 'our invocation is chained with foreign work in the same entry',
            replacement,
            nextAction: `Left unchanged so the foreign work in it survives. This entry still names a bare script, which Windows dispatches to WScript.exe by file association, so it cannot run our code. Replace OUR segment of it by hand with: ${replacement}`,
          });
        }
        continue;
      }

      // Rebuilt from the matrix row, exactly as a fresh install would write it —
      // so an upgraded entry and a new one cannot drift apart.
      const rebuilt = buildEntry(spec, binary, phase) as Record<string, unknown>;
      out = setValue(out, ['hooks', key, index], rebuilt);
      changed = true;
    }
  }
  return { text: changed ? out : null, refused };
}

/**
 * What an installed command must NAME to be current, or `null` when this binary
 * cannot say.
 *
 * TWO SHAPES, BECAUSE THIS BINARY NOW WRITES TWO. Since plan 085 a fresh install
 * names the shipped WRAPPER as a single token and lets it resolve an interpreter at
 * FIRE time; before that it named an absolute interpreter captured at INSTALL time.
 *
 * THE WRAPPER SHAPE IS WHY THIS FUNCTION HAD TO CHANGE, AND THE FAILURE WAS SILENT.
 * The old rule was "current means it names an interpreter". A wrapper command names
 * none, so `requiredInvocationParts` returned `null`, `upgradeLegacyEntries` returned
 * immediately, and the ENTIRE upgrade path went inert the moment the wrapper shipped
 * — reinstating, exactly, the failure the paragraph above it warns about: a user
 * re-runs `hooks install`, is told `already-present`, and keeps the command that
 * cannot execute. A control defeated by removing its caller, which is not a
 * different bug from having no control.
 */
type WantedInvocation =
  | { readonly kind: 'wrapper' }
  | { readonly kind: 'interpreter'; readonly flags: readonly string[] };

function requiredInvocationParts(binary: string): WantedInvocation | null {
  if (namesWrapper(binary)) return { kind: 'wrapper' };
  if (extractInterpreterPath(binary) === null) return null;
  return { kind: 'interpreter', flags: INTERPRETER_FLAGS.filter((flag) => binary.includes(flag)) };
}

/**
 * Is the first token one of our shipped wrappers?
 *
 * BY BASENAME, NEVER BY FULL PATH — the deliberate looseness this file already
 * demands. A global install, an npx run and a dev checkout name three different
 * absolute paths and all three are correct, so a path comparison would rewrite every
 * config on every run for two users sharing a machine. Both twins count: Windows
 * entries carry the `.ps1` in their `powershell` field, and an entry is judged by
 * every command in it.
 */
function namesWrapper(command: string): boolean {
  const first = commandTokens(command)[0] ?? '';
  return first.endsWith('harness-hook.sh') || first.endsWith('harness-hook.ps1');
}

/**
 * Does this installed command already carry the invocation this binary writes?
 *
 * STRUCTURAL QUESTIONS, DELIBERATELY NOT STRING EQUALITY. For the wrapper shape it
 * asks whether the command's first token IS a wrapper — which is false for every
 * pre-085 entry, so those get rewritten and the fix finally reaches installs that
 * already exist. For the legacy shape it asks whether the command names an
 * INTERPRETER (the F008 repair: a bare `.js` first token is dispatched to WScript.exe
 * on Windows, so those entries cannot run our code) and whether it carries the
 * interpreter FLAGS this binary now requires (the F010 F5 repair: without
 * `--no-warnings` a hostile `NO_COLOR`/`FORCE_COLOR` pair makes Node speak inside an
 * agent's tool loop).
 *
 * IT MUST NOT BECOME `command === whatWeWouldWrite`. THE BINARY PATH LEGITIMATELY
 * DIFFERS BETWEEN INSTALLS, so string equality would churn every config on every run.
 * And churn is not merely noisy here: `installHooks` compensates a failed provenance
 * write by undoing "what THIS run wrote", so a needless rewrite hands the
 * compensation a healthy hook to undo. Both branches below are therefore stable
 * once satisfied: rewrite once, then read as current forever.
 */
function invocationIsCurrent(command: string, wanted: WantedInvocation): boolean {
  if (wanted.kind === 'wrapper') return namesWrapper(command);
  if (extractInterpreterPath(command) === null) return false;
  const tokens = commandTokens(command);
  return wanted.flags.every((flag) => tokens.includes(flag));
}

/**
 * Does this document already carry this event array?
 *
 * PRESENT-BUT-EMPTY COUNTS AS PRESENT — that is the whole distinction F003 turns on.
 * A key holding `[]` is a key the user has, and we did not create it.
 */
function hasEventKey(text: string, key: string): boolean {
  try {
    const doc = JSON.parse(stripComments(text)) as { hooks?: Record<string, unknown> };
    return doc.hooks !== undefined && Object.hasOwn(doc.hooks, key);
  } catch {
    return false;
  }
}

/**
 * Does THIS AGENT already have an entry in THIS event array?
 *
 * AGENT-QUALIFIED AND PER-KEY. Asked of the whole document it answered "is this
 * agent installed at all", which let a file with one of its two entries deleted
 * read as complete. Two agents legally share a file when `CLAUDE_CONFIG_DIR`
 * names another agent's directory, so a PEER's entry in this array proves nothing
 * about us either.
 */
function hasAgentEntry(text: string, key: string, agent: string): boolean {
  let doc: { hooks?: Record<string, unknown[]> };
  try {
    doc = JSON.parse(stripComments(text)) as typeof doc;
  } catch {
    return false;
  }
  const entries = doc.hooks?.[key];
  return Array.isArray(entries) && entries.some((entry) => entryIsOwnedByAgent(entry, agent));
}

const stripComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

/** Parent directory, POSIX-style. The matrix composes POSIX paths. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

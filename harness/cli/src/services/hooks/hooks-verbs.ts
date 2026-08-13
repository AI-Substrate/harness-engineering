import type { InvocationProbe } from '../../adapters/exec/invocation-probe-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { AgentMarker } from '../doctor/collector/agents.js';
import { detectAgents, UNDETECTED_INSTALLERS } from '../doctor/collector/agents.js';
import { BACKUP_MANIFEST_NAME, restoreAgentConfigs } from '../doctor/collector/backup.js';
import type { AgentSpec } from './agent-matrix.js';
import { AGENT_MATRIX, eventKeys, resolveConfigFiles } from './agent-matrix.js';
import { extractBinaryPath, extractInterpreterPath, transientSegment } from './binary-path.js';
import { writeThroughSymlink } from './config-writer.js';
import { unacceptedOptions } from './fire-options.js';
import { FileHookJournal } from './hook-journal.js';
import { commandAgent, entryCommands, isOwnedByUs } from './hook-marker.js';
import { hookJournalPath, hookStateDir } from './hook-payload.js';
import {
  ensureRecordWritable,
  forgetInstalled,
  installRecordPath,
  readInstallRecord,
  recordInstall,
} from './install-record.js';
import type { InstallChange, InstallOutcome, RefusedUpgrade } from './install-strategy-a.js';
import { installStrategyA, PartialInstallError, revertWrite } from './install-strategy-a.js';
import { uninstallStrategyA } from './uninstall-strategy-a.js';

/**
 * THE HOOKS VERB FAMILY — install / status / uninstall / list (plan 082 tk-0008).
 *
 * THE OPT-OUT IS HONOURED HERE, IN THE VERB, not only at doctor's call site
 * (dw-001e). A guard that lives only in the caller is bypassed the moment anyone
 * invokes the verb directly — which is exactly what a user reaching for
 * `harness hooks install` does. Asserted on the FILESYSTEM (nothing written), never
 * on a status message: a message is what a broken implementation prints while
 * writing anyway.
 *
 * THE VALUE SEMANTICS ARE FIXED HERE so doctor's call site and this verb cannot
 * disagree (dw-001f). **Any non-empty value opts out.** `=1`, `=true`, `=yes`,
 * `=0` and `=false` all opt OUT — because someone who exports `HARNESS_NO_HOOKS=0`
 * is reaching for the off switch, and a variable named NO_HOOKS that installs hooks
 * when set to `0` is a trap. Only unset or empty means "proceed".
 *
 * THE CUT LINE IS EXPLICIT (dw-001d). Strategies C and D are the acceptable
 * casualties if time runs short, which leaves matrix rows with no writer. A silent
 * skip there is this plan's own defect class arriving from the installer side, so an
 * unimplemented strategy is reported NOT SUPPORTED by `list` and `status`, and
 * REFUSED BY NAME by `install`.
 *
 * ---
 *
 * **A CONTRACT IS ENFORCED BY A ROW OR IT IS PROSE.** Plan 082's actual finding,
 * recorded here because this surface produced every instance of it.
 *
 * The last one was written INSIDE the function it describes:
 * {@link autoInstallHooks} says "BUT IT IS NEVER SILENT" forty lines above code
 * that silently dropped `refusedUpgrades`. The one before it was a rule stated
 * two files away — `uninstall-strategy-a.ts` spells out that marker presence is
 * not permission to replace, and the upgrade path walked past it. THE DISTANCE
 * SHRANK FROM TWO FILES TO FOUR LINES AND THE OUTCOME WAS IDENTICAL, SO DISTANCE
 * WAS NEVER THE VARIABLE. Neither comment was a guard; both read like one.
 *
 * FOUR ROUNDS, FOUR DISGUISES OF ONE DEFECT — and naming them together is what
 * makes the fifth recognisable:
 *
 * 1. **A check that cannot refuse.** `binaryState: 'resolves'` is `fs.exists`; it
 *    was true on a machine where the command could not execute. Hence
 *    {@link ExecutionState}, and the rule that a gate is not verified until it
 *    has refused.
 * 2. **A predicate answering a NARROWER question than the one being asked.**
 *    `entryIsOwnedByUs` means "any command here is ours" and was used to
 *    authorise replacing the WHOLE entry — destroying foreign work chained into
 *    it.
 * 3. **A green that could not go red for the second command.** `--probe`
 *    promised to execute EACH configured command and executed `[0]`, so `runs`
 *    could be reported while another command was inert.
 * 4. **A refusal that could not reach the path everyone takes.** The warning
 *    surfaced through `harness hooks install` and was silent through
 *    `autoInstallHooks` — the doctor / first-run entry point.
 *
 * The family resemblance: each was a signal that was structurally incapable of
 * carrying bad news, and each read as correct until somebody CONSTRUCTED the
 * adversarial case rather than reading the code.
 */

/** Which write strategy an agent needs. Only A is implemented in this phase. */
export type Strategy = 'A' | 'C' | 'D';

/** Implemented strategies. The single place a cut changes. */
export const IMPLEMENTED_STRATEGIES: readonly Strategy[] = ['A'];

/** Agents that need a strategy we have not built. Named, never omitted. */
export const UNIMPLEMENTED_AGENTS: readonly { agent: string; strategy: Strategy }[] = [
  { agent: 'amp', strategy: 'C' },
  { agent: 'opencode', strategy: 'C' },
  { agent: 'pi', strategy: 'C' },
  { agent: 'cline', strategy: 'D' },
];

/** One row of `harness hooks list --json`. The contract (dw-001c). */
export interface AgentReport {
  agent: string;
  /** Is the agent present on this machine? */
  detected: boolean;
  /** Do we have a writer for it? False for a cut strategy. */
  supported: boolean;
  /** Is OUR marked entry already in its config? */
  installed: boolean;
  /** Present only when `supported` is false — why, by name. */
  unsupportedReason?: string;
  /** Present when detection cannot reach this agent at all. */
  undetectable?: boolean;
}

/** Is the opt-out engaged? See the module doc for the value semantics. */
export const hooksDisabled = (env: (name: string) => string | undefined): boolean => {
  const raw = env('HARNESS_NO_HOOKS');
  return raw !== undefined && raw.length > 0;
};

/**
 * Values a user plausibly wrote MEANING "no, do not disable hooks" — and which
 * presence-based semantics decline on anyway.
 */
const AFFIRMATIVE_LOOKING = new Set(['0', 'false', 'no', 'off']);

/**
 * The decline, in words, naming the variable AND the value that caused it.
 *
 * WHY THE VALUE IS IN THE MESSAGE. Presence-based semantics are a legitimate and
 * common convention, and this keeps them — but someone who exports
 * `HARNESS_NO_HOOKS=0` almost certainly means *no, do NOT disable hooks*, and gets
 * the opposite. Silently, and invisibly: hooks simply never install, and the machine
 * looks configured. That is this plan's own silent-failure class arriving through an
 * environment variable.
 *
 * So the safe thing still happens — we decline, because declining is the recoverable
 * direction — and it is made OBSERVABLE rather than silent. A user who got it wrong
 * finds out, which is the only property none of the alternatives had: a second
 * convention (`0` means proceed) would leave `HARNESS_NO_HOOKS=` ambiguous, and a
 * README line only reaches the reader who went looking.
 */
export function optOutNotice(env: (name: string) => string | undefined): string {
  const raw = env('HARNESS_NO_HOOKS') ?? '';
  const base = `agent hooks were NOT installed — HARNESS_NO_HOOKS is set to "${raw}"`;
  return AFFIRMATIVE_LOOKING.has(raw.trim().toLowerCase())
    ? `${base}. ANY non-empty value declines, including this one: if you meant to ALLOW hooks, UNSET the variable rather than setting it to "${raw}"`
    : base;
}

export interface HooksDeps {
  fs: FsPort;
  home: string;
  env: (name: string) => string | undefined;
  /** Already normalised and quoted — see `binary-path.ts`. */
  binary: string;
  /**
   * OPTIONAL execution probe (plan 082, F008). Absent ⇒ `executionState:
   * 'unchecked'` — an honest "we did not look", never a green.
   */
  probe?: InvocationProbe;
}

/** Every agent we know about, with what we can say about each. */
export function listAgents(deps: HooksDeps): AgentReport[] {
  const detected = new Set(
    detectAgents(deps.fs, deps.home).map((m: AgentMarker) => m.id.toLowerCase()),
  );
  const supported = AGENT_MATRIX.map((spec) => ({
    agent: spec.agent,
    detected: detected.has(spec.detectId.toLowerCase()),
    // READ FROM THE ROW, not hard-coded (plan 082 F005). A Strategy A row can be
    // known and still be REFUSED: firebender's entry shape is readable from git-ai's
    // source but no install has ever been exercised against a real one. F005
    // established that a wrong shape does not merely fail — it can disable the host
    // application's whole config — so an unexercised agent is reported, not guessed
    // at on a user's machine.
    supported: spec.supported,
    ...(spec.supported ? {} : { unsupportedReason: spec.unsupportedReason }),
    installed: isInstalled(deps, spec),
  }));

  const unsupported = UNIMPLEMENTED_AGENTS.map(({ agent, strategy }) => ({
    agent,
    detected: detected.has(agent.toLowerCase()),
    supported: false,
    installed: false,
    unsupportedReason: `strategy ${strategy} is not implemented`,
    // Cline is editor-level, so marker detection cannot reach it — "not detected"
    // and "not installed" are different facts and must not collapse.
    ...(UNDETECTED_INSTALLERS.some((id) => id.toLowerCase() === agent.toLowerCase())
      ? { undetectable: true }
      : {}),
  }));

  return [...supported, ...unsupported];
}

export interface InstallReport {
  /** Nothing was attempted because the opt-out is engaged. */
  optedOut: boolean;
  /** Present only when opted out: which variable, which value, and what to do. */
  optedOutDetail?: string;
  /**
   * Nothing was attempted because the invocation names a path that will not
   * survive — an npx cache, a worktree, a source checkout, `scratch/`.
   *
   * ITS OWN FIELD, not folded into {@link InstallReport.refused}. That list means
   * *we have no writer for this agent*, a stated design limit with nothing to do
   * about it. This means *we have a writer, and the path we would write is a lie*,
   * which is an action item and applies to EVERY agent at once — so it is a
   * property of the run, exactly like {@link InstallReport.optedOut}.
   */
  transientBinary: boolean;
  /** Present only when refused: which segment, which path, and what to do. */
  transientBinaryDetail?: string;
  /**
   * `change` travels with each entry because collapsing it is how a no-op read
   * as an install: `InstallChange` has four values precisely so the caller can
   * see half-working (its own docstring, dw-0014), and the one consumer that had
   * to honour that dropped it — a from-zero Windows run reported "installed for
   * cursor" over an outcome that wrote nothing (PM review of the 2026-08-10
   * fixture run). Render `already-present` distinctly; never as a fresh install.
   */
  installed: { agent: string; path: string; created: boolean; change: InstallChange }[];
  /** Agents refused BY NAME, never silently skipped. */
  refused: { agent: string; reason: string }[];
  /**
   * Legacy entries we declined to UPGRADE because foreign work is chained into
   * them (F008 review F1).
   *
   * A THIRD list, not folded into `refused`: that one means "we have no writer
   * for this agent" — a stated design limit with nothing for the user to do.
   * This means "we wrote for this agent, and left one entry alone that cannot
   * run", which is an action item and carries the command to paste.
   */
  refusedUpgrades: RefusedUpgrade[];
  /**
   * Agents whose write THREW, with the reason — distinct from `refused`.
   *
   * The two are different diagnoses and collapsing them would hide the one that
   * means something is wrong with the machine: `refused` is *we have no writer for
   * this agent*, a stated design limit; `failed` is *we have a writer and it did
   * not work* — an unwritable path, a config that is a directory, a full disk.
   *
   * FAILURE IS PER AGENT, NOT FATAL (plan 082 tk-0002). `installStrategyA` throws on
   * a write failure, so one agent with a broken config path used to abort every
   * agent after it in the loop. Doctor calls this on first run, where that would
   * mean one damaged config silently costing a user every other install.
   */
  failed: { agent: string; reason: string }[];
}

/** Install into every DETECTED, SUPPORTED agent. */
export function installHooks(deps: HooksDeps): InstallReport {
  if (hooksDisabled(deps.env)) {
    // The verb says it too, in the same words: a decline the operator did not intend
    // must be visible wherever they reached for it, not only through doctor.
    return {
      optedOut: true,
      optedOutDetail: optOutNotice(deps.env),
      transientBinary: false,
      installed: [],
      refused: [],
      refusedUpgrades: [],
      failed: [],
    };
  }

  /*
   * ASKED BEFORE THE FIRST CONFIG IS TOUCHED, for the same reason the record probe
   * below is: refusing is free while nothing has been written.
   *
   * THE PATH IS THE INSTALL. A hook entry is nothing but an invocation string, so a
   * path that will not survive is not a lesser install — it is a config that names
   * a program which will not be there, written into a user's agent, reported as
   * healthy, and failing in SILENCE because the hook contract is exit-0.
   *
   * REFUSED RATHER THAN REPAIRED. We do not substitute a path we think is better:
   * where harness is supposed to live when it is hooked is a product decision, and
   * guessing one here is the same class of error as writing this one.
   *
   * THE ESCAPE HATCH IS DELIBERATE AND NAMED. This repo installs its own hooks from
   * a worktree while dogfooding, which this check correctly refuses — so there is
   * an opt-in, it is an env var (doctor installs too, and a CLI flag would not
   * reach that call site), and the refusal message names it. An operator who means
   * it can proceed; nobody gets there by accident.
   */
  const script = extractBinaryPath(deps.binary) ?? deps.binary;
  const segment = transientSegment(script);
  if (segment !== null && deps.env('HARNESS_HOOKS_ALLOW_DEV_BINARY') !== '1') {
    return {
      optedOut: false,
      transientBinary: true,
      transientBinaryDetail: `refusing to install: the hook would invoke ${script}, which is under \`${segment}\` and will not survive (an npx cache is garbage-collected, a worktree moves, a checkout is cleaned). A hook exits 0 and prints nothing, so when that path goes the failure is silent. Install harness durably and re-run, or set HARNESS_HOOKS_ALLOW_DEV_BINARY=1 to install this path anyway.`,
      installed: [],
      refused: [],
      refusedUpgrades: [],
      failed: [],
    };
  }

  const reports = listAgents(deps);
  const installed: InstallReport['installed'] = [];
  const refused: InstallReport['refused'] = [];
  const refusedUpgrades: InstallReport['refusedUpgrades'] = [];
  const failed: InstallReport['failed'] = [];

  // ASKED BEFORE THE FIRST CONFIG IS TOUCHED (phase-3 review F001). An install we
  // cannot record is an install uninstall cannot fully reverse, and the promise this
  // family makes to an operator is reversibility. So the question is asked while the
  // answer is still free: nothing has been written, so refusing costs nothing and
  // leaves the machine exactly as it was.
  const stateDir = hookStateDir(deps.home);
  const canRecord = ensureRecordWritable(deps.fs, stateDir);

  for (const report of reports) {
    if (!report.detected) continue;
    if (!report.supported) {
      refused.push({
        agent: report.agent,
        reason: report.unsupportedReason ?? 'no writer for this agent',
      });
      continue;
    }
    const spec = AGENT_MATRIX.find((s) => s.agent === report.agent);
    if (spec === undefined) continue;
    if (!canRecord) {
      // BY NAME, like every other failure here — an agent that silently got no hook
      // is the shape this plan exists to stop.
      failed.push({
        agent: report.agent,
        reason: unrecordableReason(stateDir, { kind: 'nothing' }),
      });
      continue;
    }
    try {
      const outcomes = installStrategyA(deps.fs, spec, deps.home, deps.env, deps.binary);
      // Provenance FIRST, before anything can fail afterwards: a config we wrote and
      // did not record is one uninstall will under-remove, which is the safe
      // direction but still a divergence between the disk and what we know.
      if (!recordInstall(deps.fs, hookStateDir(deps.home), outcomes)) {
        // The probe above passed and the write still failed — a disk that filled, a
        // directory removed underneath us. Undo what THIS run wrote, so the config is
        // returned to the state whose provenance we could not keep.
        failed.push({
          agent: report.agent,
          reason: unrecordableReason(stateDir, compensate(deps, outcomes)),
        });
        continue;
      }
      for (const outcome of outcomes) {
        installed.push({
          agent: outcome.agent,
          path: outcome.path,
          created: outcome.created,
          change: outcome.change,
        });
        refusedUpgrades.push(...outcome.refusedUpgrades);
      }
    } catch (err) {
      /*
       * A PARTIAL INSTALL IS RECORDED AND NAMED, NEVER SILENTLY HELD (F010 F2).
       *
       * `installStrategyA` now rolls back an agent's committed files when a later
       * one fails, but a rollback can itself fail — and a file that is written,
       * unrecorded and unreported is invisible to every tool we ship: uninstall
       * will not remove it because provenance never heard of it, and status will
       * not explain it. Recording it is what makes a later `uninstall` able to
       * finish the job, and naming it is what tells the operator to run one.
       */
      if (err instanceof PartialInstallError && err.stranded.length > 0) {
        recordInstall(deps.fs, hookStateDir(deps.home), err.stranded);
        failed.push({
          agent: report.agent,
          reason: `${err.message}; ${strandedDetail(err.stranded)}`,
        });
        continue;
      }
      failed.push({
        agent: report.agent,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { optedOut: false, transientBinary: false, installed, refused, refusedUpgrades, failed };
}

/**
 * What happened to the config we could not record — and, when it went wrong, WHICH
 * FILES it went wrong on.
 *
 * A SHAPE, NOT A SCALAR, and that is the whole of this fix. `compensate` reduced
 * every failed restore to the word `stranded`, discarding the outcomes it had just
 * examined — so the operator was told "this agent's config still carries our entry
 * and must be removed by hand" and never told WHICH FILE, on a machine that can
 * carry seven agent configs. The information existed and was thrown away one line
 * before the sentence that needed it.
 */
type Compensation =
  | { kind: 'nothing' }
  | { kind: 'nothing-written' }
  | { kind: 'rolled-back' }
  | { kind: 'stranded'; paths: readonly string[] };

/**
 * What to tell an operator about files a failed install left behind.
 *
 * NAMES THE PATHS AND THE NEXT ACTION. "windsurf failed" with a file still
 * installed is the report that produced this defect: the agent looked untouched
 * and was not.
 */
function strandedDetail(stranded: readonly { path: string }[]): string {
  const one = stranded.length === 1;
  const paths = stranded.map((o) => o.path).join(', ');
  return `${one ? 'this file was' : 'these files were'} written and could not be rolled back: ${paths}. ${one ? 'Its' : 'Their'} provenance HAS been recorded, so \`harness hooks uninstall\` can remove ${one ? 'it' : 'them'}`;
}

function unrecordableReason(stateDir: string, outcome: Compensation): string {
  const head = `install provenance could not be written to ${installRecordPath(stateDir)}`;
  if (outcome.kind === 'nothing') return `${head}; nothing was installed for this agent`;
  if (outcome.kind === 'nothing-written')
    return `${head}; this run wrote nothing for this agent, so its existing install was left alone`;
  if (outcome.kind === 'rolled-back') return `${head}; the entries just written were rolled back`;
  // NAMES THE FILE. "A config of yours still carries our entry" is not an action an
  // operator can take on a machine with seven agent configs; this one is.
  const one = outcome.paths.length === 1;
  return `${head}, AND the rollback also failed — ${one ? 'this file' : 'these files'} still ${one ? 'carries' : 'carry'} our entry and must be edited by hand: ${outcome.paths.join(', ')}`;
}

/**
 * Undo what this run wrote, using the provenance we hold IN MEMORY.
 *
 * SCOPED TO WHAT THIS RUN WROTE, BY CONSTRUCTION — for every kind of change,
 * without exception. That sentence is the whole fix, and it took three rounds to
 * arrive at because each earlier attempt scoped the reversal to what the AGENT
 * OWNS and then corrected the cases where that reached too far:
 *
 * 1. the legacy UPGRADE reported `!alreadyPresent`, so compensation ran a
 *    whole-agent uninstall over an entry the USER already had, and deleted it;
 * 2. an explicit discriminant fixed that route, and then the completeness REPAIR
 *    of a partial config — an `added-entry` — walked through the same door: the
 *    uninstall removed the phase that was already there along with the phase this
 *    run appended.
 *
 * **The discriminant answers HOW to reverse. It never answered WHAT to reverse.**
 * A reversal expressed as "remove this agent's entries" can always reach something
 * this run did not write; a reversal expressed as "put these exact bytes back"
 * cannot. So compensation no longer calls {@link uninstallStrategyA} at all — the
 * whole-agent removal path belongs to the `uninstall` verb, where the user asked
 * for it and where the previous bytes are genuinely unknown.
 *
 * WHAT THE BYTE-RESTORE GIVES US THAT THE REMOVAL PATH DID NOT:
 * - foreign work chained into an entry is preserved automatically — it is in the
 *   previous bytes — so the refusals that path carried are not needed here;
 * - a key or root field that existed before is restored exactly, with no
 *   provenance bookkeeping to get wrong;
 * - a file we created is removed, because its previous state was absence.
 *
 * And it REFUSES rather than forces: if the file no longer holds exactly what we
 * wrote, someone else has touched it — two agents can share one config — so we
 * report `stranded` and name it instead of overwriting a peer.
 */
function compensate(deps: HooksDeps, outcomes: InstallOutcome[]): Compensation {
  const written = outcomes.filter((outcome) => outcome.writtenText !== null);
  if (written.length === 0) return { kind: 'nothing-written' };
  const stranded = written.filter((outcome) => !revertWrite(deps.fs, outcome));
  // The PATHS travel with the verdict. Reducing them to a word here is what left
  // the operator without the one fact they needed.
  return stranded.length === 0
    ? { kind: 'rolled-back' }
    : { kind: 'stranded', paths: stranded.map((outcome) => outcome.path) };
}

/**
 * Whether the OPTIONS in an installed command are ones this binary declares
 * (plan 082, F004).
 *
 * WHY THIS IS A SEPARATE FIELD FROM {@link BinaryState}, and it is the whole
 * lesson: `binaryState: 'resolves'` stats the BINARY. The binary existed. Every
 * hook on every machine was reported healthy while none of them could run,
 * because the ARGUMENTS were rejected and `status` had no way to see it.
 *
 * - `absent` — no entry of ours, so there is nothing to judge.
 * - `accepted` — every option the command names is one this binary declares.
 * - `unknown-options` — the config and this binary disagree about at least one
 *   option. `fire` tolerates them (it will still run), so this is a DRIFT report
 *   rather than a fatality: usually a config written by a different version.
 *
 * WHAT IT DOES NOT PROVE, stated plainly because the failure it replaces was
 * exactly a status field read as more than it measured: this is a STATIC check of
 * option names against this binary's declaration. It does not execute the command.
 * It cannot see a binary that is a different program, a broken node install, or a
 * runtime failure inside `fire`. For that, the journal (`fires.recorded`) is the
 * only honest evidence — which is why `fireSummary` distinguishes "never fired"
 * from "fired and failed" rather than collapsing them.
 */
export type CommandState = 'absent' | 'accepted' | 'unknown-options';

/**
 * Does the installed command ACTUALLY RUN OUR CODE? (plan 082, F008 §4.)
 *
 * THE FIELD FAILURE THIS EXISTS FOR, measured on a Windows 11 guest 2026-08-10:
 * `binaryState` said `resolves` and `commandState` said `accepted` on a machine
 * where the hook had never executed one line of our code. Both fields were
 * telling the truth. `resolves` is `fs.exists` and the file existed; `accepted`
 * is a static comparison of option NAMES and the names were right. THE DEFECT IS
 * NOT EITHER FIELD — IT IS THAT `resolves` + `accepted` TOGETHER READ AS
 * "WORKING" AND NOTHING COULD CONTRADICT THEM.
 *
 * So this is the only field that requires POSITIVE EVIDENCE that our process ran.
 * Exit 0 is explicitly NOT evidence: exit 0 is exactly what Windows Script Host
 * returned after failing to execute our ES module.
 *
 * - `absent` — no entry of ours; nothing to execute and nothing to claim.
 * - `unchecked` — NOT MEASURED. Status is called from paths that must not spawn
 *   a child, and "we did not look" is a real answer. Folding it into `runs`
 *   re-creates the false green; folding it into `inert` cries wolf on every
 *   working install.
 * - `runs` — the configured invocation was executed and returned our evidence.
 * - `inert` — it was executed and did not. Installed, and dead.
 *
 * A GATE IS NOT VERIFIED UNTIL IT HAS REFUSED. `binaryState` alone, once the
 * command names an interpreter, would stat `node.exe` on a machine that is by
 * definition running node — a green light that cannot go red, which is not a
 * check but a decoration occupying the slot where a check should be.
 */
export type ExecutionState = 'absent' | 'unchecked' | 'runs' | 'inert';

/** How a configured binary reads, as three states rather than a boolean. */
export type BinaryState =
  /** No entry of ours, so there is no binary to judge. */
  | 'absent'
  /** Our entry names a path that exists. */
  | 'resolves'
  /** Our entry names a path that does NOT exist — installed but inert. */
  | 'unresolvable';

/** What the journal says about recent fires (plan 082 tk-000c). */
export interface FireSummary {
  /**
   * `false` when the journal has no entries at all.
   *
   * DISTINCT from "all fires succeeded", and the distinction is the point: a repo
   * where the hook has never fired and a repo where every fire worked are different
   * facts, and collapsing them makes an inert install look healthy.
   */
  recorded: boolean;
  total: number;
  failed: number;
  /** Newest failures, with the cause the journal recorded. */
  failures: { at: string; cause: string }[];
  /**
   * How many fires could not READ their payload at all (plan 082 F009).
   *
   * ITS OWN COUNT, DELIBERATELY NOT ADDED TO {@link failed}. "Our emit failed" and
   * "we could not read the agent's input" call for different operator actions and
   * different diagnoses — one points at the collector, the other at the agent
   * client — and a single number is useless for both. The same call was made in
   * F008, where folding refused-upgrades into refusals would have collapsed two
   * meanings into one.
   */
  unparseable: number;
  /**
   * Newest unreadable payloads: WHEN, HOW MUCH arrived and the BOUNDED HEX HEAD.
   *
   * Never the body — it carries `user_email` and `transcript_path`. The head is
   * what makes a new prefix diagnosable in seconds instead of three sessions: a
   * leading `ef bb bf` here IS the Cursor-on-Windows BOM, named on sight.
   */
  unreadable: { at: string; rawLen: number; headHex: string }[];
}

export interface StatusReport extends AgentReport {
  /** Config files we would write, and whether each exists. */
  files: { path: string; exists: boolean }[];
  /**
   * The binary the installed entry points at, and whether it RESOLVES.
   *
   * An entry naming a file that no longer exists is indistinguishable from a
   * working hook if status only checks that the entry is present — and because a
   * hook exits 0 by design, nothing else would report it either.
   */
  binaryResolves?: boolean;
  configuredBinary?: string;
  /**
   * The path segment that makes the configured invocation NON-DURABLE, or absent
   * when nothing does — `node_modules`, `_npx`, `worktrees`, `scratch`, `src`, `dist`.
   *
   * SEPARATE FROM {@link StatusReport.binaryResolves}, and the gap between them is
   * the whole point. `binaryResolves` asks *is the file there RIGHT NOW*, which is
   * green for every one of these paths on the day it was installed and only turns
   * red once the damage is done. This asks *will it be there tomorrow* — the npx
   * cache npm has not collected yet, the worktree nobody has moved yet. A hook
   * exits 0 and prints nothing, so `unresolvable` gets discovered by someone
   * wondering why months of telemetry are missing. This is discoverable first.
   */
  transientBinarySegment?: string;
  /**
   * Three states, never a boolean (dw-0027). `absent` and `unresolvable` are
   * different diagnoses — "we never installed" versus "we installed and the target
   * is gone" — and a boolean forces the reader to infer which, from a field that
   * cannot express it.
   */
  binaryState: BinaryState;
  /**
   * Whether the installed command's options are ones this binary declares.
   *
   * Read TOGETHER with `binaryState`: a hook is only credibly working when the
   * binary resolves AND its options are accepted. Neither alone is "works" — see
   * {@link CommandState} for what this still does not prove.
   */
  commandState: CommandState;
  /** The specific options this binary does not declare, when `unknown-options`. */
  unacceptedOptions?: string[];
  /**
   * Whether the configured command was EXECUTED and proved our code ran.
   *
   * The only field here that is not a static read. See {@link ExecutionState}
   * for why `resolves` + `accepted` were not enough.
   */
  executionState: ExecutionState;
  /** Why, in words, when the state is `inert` — how many failed, and which one first. */
  executionDetail?: string;
  /**
   * EVERY configured command of ours that produced no evidence.
   *
   * A list, not a count: an agent can have four commands across two files, and
   * "one of them is broken" is not a fact anyone can act on.
   */
  inertCommands?: string[];
}

export function statusHooks(deps: HooksDeps): StatusReport[] {
  return listAgents(deps).map((report) => {
    const spec = AGENT_MATRIX.find((s) => s.agent === report.agent);
    if (spec === undefined)
      return {
        ...report,
        files: [],
        binaryState: 'absent',
        commandState: 'absent',
        executionState: 'absent',
      };

    const files = resolveConfigFiles(spec, deps.home, deps.env).map((path) => ({
      path,
      exists: deps.fs.exists(path),
    }));
    const configured = configuredBinaryFor(deps, spec);
    if (configured === null)
      return {
        ...report,
        files,
        binaryState: 'absent',
        commandState: 'absent',
        executionState: 'absent',
      };

    // Across EVERY entry of ours, not just the first: windsurf writes two files
    // and each agent writes a pre and a post command, so a check that looked at
    // one would report health for a set it had not examined.
    const unaccepted = [...new Set(ourCommands(deps, spec).flatMap(unacceptedOptions))];
    const resolves = deps.fs.exists(configured);
    // The CONFIGURED path, not the running one: status reports on what is on disk
    // in the user's agent, which may have been written by a different harness on a
    // different day — which is exactly the case that produced this field.
    const transient = transientSegment(configured);
    const execution = probeExecution(deps, spec);
    return {
      ...report,
      files,
      configuredBinary: configured,
      binaryResolves: resolves,
      ...(transient === null ? {} : { transientBinarySegment: transient }),
      binaryState: resolves ? 'resolves' : 'unresolvable',
      commandState: unaccepted.length === 0 ? 'accepted' : 'unknown-options',
      ...(unaccepted.length === 0 ? {} : { unacceptedOptions: unaccepted }),
      ...execution,
    };
  });
}

/**
 * Run the probe against EVERY configured command of ours, or report that we did
 * not look.
 *
 * EVERY, NOT THE FIRST (F008 review F2). This destructured `ourCommands()[0]`
 * and returned that single verdict for the whole agent, so `runs` could be
 * reported while another configured command was inert — a false green on
 * windsurf's two files and on every agent's pre/post pair, which mid-upgrade is
 * all of them. The one command guaranteed to be probed was the one least likely
 * to be wrong. The CLI's promise ("execute each configured command") was the
 * correct behaviour; the implementation did not meet it, so the implementation
 * moved.
 *
 * EACH COMMAND SUPPLIES ITS OWN PAIR. A config can legitimately hold one command
 * of each form mid-upgrade, so the interpreter and script are read per command
 * rather than taken from the agent's first entry.
 *
 * ANY MISSING EVIDENCE REFUSES, and the detail says HOW MANY and WHICH: `inert`
 * on an agent with four commands, with nothing naming the failure, sends an
 * operator hunting through JSON. A refusal must be findable, not merely correct.
 *
 * `unchecked` when no probe is injected — see {@link ExecutionState}.
 */
function probeExecution(
  deps: HooksDeps,
  spec: AgentSpec,
): {
  executionState: ExecutionState;
  executionDetail?: string;
  inertCommands?: string[];
} {
  const probe = deps.probe;
  if (probe === undefined) return { executionState: 'unchecked' };

  const commands = ourCommands(deps, spec);
  if (commands.length === 0) return { executionState: 'absent' };

  const inert: { command: string; detail: string }[] = [];
  for (const command of commands) {
    const script = extractBinaryPath(command);
    if (script === null) {
      inert.push({ command, detail: 'the command names no path we can identify' });
      continue;
    }
    const result = probe(extractInterpreterPath(command), script);
    if (result.evidence) continue;
    inert.push({
      command,
      detail:
        result.detail ??
        (result.ok
          ? 'the command ran and produced no self-test evidence — our code did not run'
          : 'the command could not be executed'),
    });
  }

  if (inert.length === 0) return { executionState: 'runs' };
  const [first] = inert;
  return {
    executionState: 'inert',
    executionDetail: `${inert.length} of ${commands.length} configured command(s) produced no evidence that our code ran — first: ${first.command} (${first.detail})`,
    inertCommands: inert.map((entry) => entry.command),
  };
}

/** Is our marked entry present in any of this agent's config files? */
function isInstalled(deps: HooksDeps, spec: AgentSpec): boolean {
  return ourCommands(deps, spec).length > 0;
}

/** The binary path our installed entry names, or `null` when we are not installed. */
function configuredBinaryFor(deps: HooksDeps, spec: AgentSpec): string | null {
  const [command] = ourCommands(deps, spec);
  return command === undefined ? null : extractBinaryPath(command);
}

/**
 * Every command OF OURS installed in this agent's configs — the one thing `list`,
 * `status` and `configuredBinary` all read.
 *
 * ONE READER FOR BOTH ENTRY SHAPES (plan 082, phase-5 review F1). This used to
 * parse `entry.command` and nothing else, which does not exist in a NESTED entry —
 * there the command lives at `entry.hooks[].command`. So immediately after a
 * successful install into claude-code, gemini or droid, `status` reported
 * `installed: false, binaryState: absent, commandState: absent`. Our WRITER had
 * learned both shapes and our READER had not.
 *
 * That is the same two-readers-disagree shape as F005 itself — a validator and a
 * detector keyed on different fields — except that this time we owned both readers.
 * So it now goes through {@link entryCommands}, the SAME function uninstall matches
 * ownership with. Not a second implementation that agrees today: one implementation,
 * which cannot drift.
 */
/**
 * Every command OF OURS AND OF THIS AGENT installed in this agent's configs — the
 * one thing `list`, `status` and `configuredBinary` all read.
 *
 * ONE READER FOR BOTH ENTRY SHAPES (plan 082, phase-5 review F1). This used to
 * parse `entry.command` and nothing else, which does not exist in a NESTED entry —
 * there the command lives at `entry.hooks[].command`. So immediately after a
 * successful install into claude-code, gemini or droid, `status` reported
 * `installed: false, binaryState: absent, commandState: absent`. Our WRITER had
 * learned both shapes and our READER had not.
 *
 * That is the same two-readers-disagree shape as F005 itself — a validator and a
 * detector keyed on different fields — except that this time we owned both readers.
 * So it now goes through {@link entryCommands}, the SAME function uninstall matches
 * ownership with. Not a second implementation that agrees today: one implementation,
 * which cannot drift.
 *
 * AND IT IS AGENT-QUALIFIED (plan 082 F010 F3). `status` answers a PER-AGENT
 * question, and this fed it a per-HARNESS answer: with two agents resolving to one
 * config file, droid was credited with claude-code's command — a healthy status for
 * an agent with no hook. The marker proves the entry is OURS; only the `hooks fire
 * <agent>` argument proves whose.
 */
function ourCommands(deps: HooksDeps, spec: AgentSpec): string[] {
  const out: string[] = [];
  for (const path of resolveConfigFiles(spec, deps.home, deps.env)) {
    const raw = deps.fs.readText(path);
    if (raw === null) continue;
    let doc: { hooks?: Record<string, unknown[]> };
    try {
      doc = JSON.parse(stripComments(raw)) as typeof doc;
    } catch {
      continue;
    }
    for (const key of eventKeys(spec)) {
      for (const entry of doc.hooks?.[key] ?? []) {
        out.push(
          ...entryCommands(entry).filter(
            (command) => isOwnedByUs(command) && commandAgent(command) === spec.agent,
          ),
        );
      }
    }
  }
  return out;
}

const stripComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

/**
 * What the fire journal says — the compensating control (plan 082 tk-000c).
 *
 * ac-000b is why the exit-0 constitutional deviation was granted: every hook path
 * exits 0 and prints nothing by design, so **the exit code carries no information**
 * and a runtime failing on every fire is indistinguishable from one working
 * perfectly. The journal is the only observable, and this is the surface that
 * exposes it. Nothing here may assert on, or derive anything from, an exit code.
 *
 * IT ALSO COMPACTS. `status` is the FIRST real caller of {@link FileHookJournal.compact},
 * so it is where the rotation fix stops being a unit property and becomes a live
 * one — the doubled-rotation defect reduced 2001 records to 1 before it was fixed
 * with an exclusive claim PLUS a re-check after taking it.
 */
export function fireSummary(deps: HooksDeps): FireSummary {
  const journal = new FileHookJournal(deps.fs, hookJournalPath(deps.home), hookStateDir(deps.home));
  // Bound the disk here, on a reader, never on the fire path.
  journal.compact();

  const entries = journal.read();
  const failures = entries
    .filter((entry) => entry.outcome.kind === 'failed')
    .map((entry) => ({
      at: entry.at,
      cause: entry.outcome.kind === 'failed' ? entry.outcome.cause : '',
    }));

  /*
   * A THIRD LIST, NOT A BIGGER `failed`. A payload we could not read is a
   * different fault with a different owner than an emit that failed, and the
   * count is only actionable while the two stay apart.
   *
   * This list is why the F009 fix does not stop at the journal. The failure it
   * makes observable would otherwise be recorded by the file and dropped by the
   * surface operators actually read — the journal's own blindness, rebuilt one
   * layer up.
   */
  const unreadable = entries
    .filter((entry) => entry.outcome.kind === 'unparseable')
    .map((entry) => ({
      at: entry.at,
      rawLen: entry.outcome.kind === 'unparseable' ? entry.outcome.rawLen : 0,
      headHex: entry.outcome.kind === 'unparseable' ? entry.outcome.headHex : '',
    }));

  return {
    // `recorded: false` is NOT "everything succeeded" — see the field doc.
    recorded: entries.length > 0,
    total: entries.length,
    failed: failures.length,
    failures: failures.slice(-10),
    unparseable: unreadable.length,
    unreadable: unreadable.slice(-10),
  };
}

/** What `harness hooks restore` reports. */
export interface RestoreReport {
  /** The backup directory used, or null when none could be chosen. */
  from: string | null;
  /** Absolute paths rewritten from their copy. */
  restored: string[];
  /** Absolute paths REMOVED — they did not exist when the backup was taken. */
  deleted: string[];
  /** Recorded-absent paths that were already absent; a rerun, not a problem. */
  alreadyAbsent: string[];
  /** Anything that could not be put back, with the reason. */
  failed: string[];
  /** True only when a restore actually ran and nothing failed. */
  ok: boolean;
  detail: string;
}

/** `<home>/.git-ai/harness-backups`. */
export function backupsRoot(home: string): string {
  return `${home.replace(/\/+$/, '')}/.git-ai/harness-backups`;
}

/**
 * Put the agent configs back from a backup — the recovery verb (plan 082 tk-0001).
 *
 * WHY THIS IS A VERB AND NOT ONLY A LIBRARY FUNCTION. Phase 2's most important
 * finding was that `install`, `status` and `list` had been built, asserted and
 * checked off while none of them was reachable from the command line: a capability
 * that cannot be invoked has not been delivered. `restoreAgentConfigs` was the same
 * defect wearing different clothes — a proven round trip nobody at a terminal could
 * run.
 *
 * And the asymmetry decides it. Everyone who needs this verb is, by definition,
 * someone for whom something has ALREADY gone wrong, possibly at three in the
 * morning with a broken editor config, possibly not the person who wrote it. Every
 * other verb in this family exists for convenience; this one exists for recovery,
 * which is exactly when "write a script against the library" stops being an answer.
 *
 * OPERATOR-FACING, SO IT MAY FAIL LOUDLY. The exit-0-and-silent contract binds
 * `fire` alone, because `fire` runs inside an agent's tool loop. This runs at a
 * terminal, and a restore that fails silently would be the worst verb in the family:
 * the operator would believe their configs were back.
 *
 * NEWEST BY DEFAULT. Backup directories are named from an ISO timestamp with `:`
 * and `.` replaced, which sorts lexicographically in the same order as
 * chronologically — so "newest" is the last name, not a stat of the directory.
 */
export function restoreHooks(deps: HooksDeps, from?: string): RestoreReport {
  const empty = { restored: [], deleted: [], alreadyAbsent: [] };
  let dir = from?.trim();

  if (dir === undefined || dir === '') {
    const root = backupsRoot(deps.home);
    const names = deps.fs
      .readdir(root)
      .filter((name) => deps.fs.exists(`${root}/${name}/${BACKUP_MANIFEST_NAME}`))
      .sort();
    const newest = names.at(-1);
    if (newest === undefined) {
      // An empty success here is the harm this whole module names: an operator
      // told their configs are back stops looking for them.
      const detail = `no restorable backup found under ${root} — nothing there carries a ${BACKUP_MANIFEST_NAME}`;
      return { from: null, ...empty, failed: [detail], ok: false, detail };
    }
    dir = `${root}/${newest}`;
  }

  const outcome = restoreAgentConfigs(deps.fs, dir);
  return {
    from: dir,
    restored: outcome.restored,
    deleted: outcome.deleted,
    alreadyAbsent: outcome.alreadyAbsent,
    failed: outcome.failed,
    ok: outcome.failed.length === 0,
    detail: outcome.detail,
  };
}

/** What `harness hooks uninstall` reports. */
export interface UninstallReport {
  /** Per agent, per file — never collapsed, so a half-uninstall is visible. */
  removed: { agent: string; path: string; entries: number; deleted: boolean }[];
  /** Files carrying no marker of ours: left untouched, reported by name. */
  untouched: { agent: string; path: string }[];
  /** Entries we own but did not remove because they carry foreign work. */
  refused: { agent: string; path: string; command: string; reason: string }[];
  /** Agents whose uninstall THREW, with the reason. Per agent, never fatal. */
  failed: { agent: string; reason: string }[];
  /**
   * Detected agents we have NO writer for, named rather than skipped.
   *
   * The same seam `install` carries, and it matters more on the way out: an operator
   * removing our hook needs to know which detected agents this verb did not touch,
   * or they will believe a machine is clean that is not. A silent skip here is the
   * cut becoming an omission.
   */
  unsupported: { agent: string; reason: string }[];
}

/**
 * Remove our hook from every detected, supported agent (plan 082 tk-000d; wired by
 * the phase-2 review's F001).
 *
 * WHY THIS EXISTS SEPARATELY FROM `uninstallStrategyA`. It did not, and that was the
 * finding: the strategy function had no caller outside its own unit test, so the
 * delivered binary answered `unknown command 'uninstall'` while the task that named
 * the verb was checked. THE TENTH INSTANCE of one shape in this plan, and the most
 * instructive, because the guard built to prevent it — the subcommand-name assertion
 * in `app.test.ts` — carried a deliberate exclusion for `uninstall` ("absent until
 * tk-000d"). tk-000d landed; the exclusion did not move. **The exception outlived its
 * reason and the guard then certified the exact gap it was written to catch.**
 *
 * IT READS PROVENANCE, NEVER GUESSES IT. The keys it may remove come from the install
 * record; see `install-record.ts`.
 */
export function uninstallHooks(deps: HooksDeps): UninstallReport {
  const stateDir = hookStateDir(deps.home);
  const record = readInstallRecord(deps.fs, stateDir);
  const createdFiles = new Set(record.entries.filter((e) => e.createdFile).map((e) => e.path));
  const createdKeys = new Map<string, ReadonlySet<string>>(
    record.entries.map((e) => [e.path, new Set(e.createdKeys)]),
  );
  // A record written before phase-5 has no root-extra provenance at all, and an
  // absent list must read as "we created nothing" rather than "unknown, so guess".
  const createdRootExtras = new Map<string, readonly string[][]>(
    record.entries.map((e) => [e.path, e.createdRootExtras ?? []]),
  );

  const removed: UninstallReport['removed'] = [];
  const untouched: UninstallReport['untouched'] = [];
  const refused: UninstallReport['refused'] = [];
  const failed: UninstallReport['failed'] = [];
  const unsupported: UninstallReport['unsupported'] = [];
  const done: string[] = [];

  for (const report of listAgents(deps)) {
    if (!report.detected) continue;
    if (!report.supported) {
      unsupported.push({
        agent: report.agent,
        reason: report.unsupportedReason ?? 'no writer for this agent',
      });
      continue;
    }
    const spec = AGENT_MATRIX.find((s) => s.agent === report.agent);
    if (spec === undefined) continue;
    try {
      for (const outcome of uninstallStrategyA(
        {
          fs: deps.fs,
          home: deps.home,
          env: deps.env,
          createdFiles,
          createdKeys,
          createdRootExtras,
        },
        spec,
      )) {
        for (const r of outcome.refused) {
          refused.push({ agent: outcome.agent, path: outcome.path, ...r });
        }
        if (outcome.unmarked) {
          untouched.push({ agent: outcome.agent, path: outcome.path });
          // PRUNE ON "NO LONGER OURS", NOT ON "WE REMOVED IT".
          //
          // MEASURED, and by a route nobody predicted: after a real recovery on a
          // real machine, one config had been restored BY HAND from a byte snapshot.
          // Uninstall correctly found no marker and reported it untouched — and kept
          // its provenance entry forever, because pruning was keyed on removal.
          // `unmarked` is the positive statement that the file carries nothing of
          // ours, which is exactly the condition under which our record of it is
          // stale.
          done.push(outcome.path);
          continue;
        }
        if (outcome.removed > 0 || outcome.deleted) {
          removed.push({
            agent: outcome.agent,
            path: outcome.path,
            entries: outcome.removed,
            deleted: outcome.deleted,
          });
          // Only when nothing was refused: a file still carrying an entry of ours is
          // a file whose provenance we still need.
          if (outcome.refused.length === 0) done.push(outcome.path);
        }
      }
    } catch (err) {
      failed.push({
        agent: report.agent,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  forgetInstalled(deps.fs, stateDir, done);
  return { removed, untouched, refused, failed, unsupported };
}
/** What doctor learned from trying to install our hooks. */
export interface HooksAutoInstall {
  action: 'not-needed' | 'opted-out' | 'installed' | 'failed';
  /** One line for the operator. */
  detail: string;
  /** Warning rows — never fatal. Empty when everything worked. */
  warnings: string[];
}

/**
 * Install our agent hooks from `harness doctor`, alongside the git-ai collector
 * (plan 082 tk-0002).
 *
 * **WARN-ONLY, ALWAYS. NEVER THROWS, NEVER CHANGES AN EXIT CODE.** A doctor that
 * dies on our optional step is worse than a doctor that never had it: the operator
 * ran it to diagnose something else, and every other row is what they came for.
 * The failure posture is the load-bearing part of this task, not the install.
 *
 * **BUT IT IS NEVER SILENT.** A swallowed failure is the defect, not the safe
 * default — the machine now differs from what the operator believes and nothing
 * said so. Failures come back as `warnings`, which doctor prints.
 *
 * **THE OPT-OUT IS THE VERB'S, NOT A SECOND COPY OF IT** (dw-0008). This calls
 * {@link hooksDisabled}, the same predicate `harness hooks install` uses, so the
 * call site and the verb cannot disagree about what a value MEANS. That matters
 * because the neighbouring collector opt-out tests `=== '1'`, and a hooks call site
 * copying that pattern would install hooks for someone who exported
 * `HARNESS_NO_HOOKS=0` — a variable named NO_HOOKS doing the opposite of what its
 * name says, at the exact moment the operator was reaching for the off switch. One
 * predicate, one answer; the same lesson as `detectId` and `configPathsFor`.
 */
export function autoInstallHooks(deps: HooksDeps | null): HooksAutoInstall {
  if (deps === null) {
    return {
      action: 'not-needed',
      detail: 'agent hooks were not installed: no home directory to install into',
      warnings: [],
    };
  }
  if (hooksDisabled(deps.env)) {
    return { action: 'opted-out', detail: optOutNotice(deps.env), warnings: [] };
  }

  let report: InstallReport;
  try {
    report = installHooks(deps);
  } catch (err) {
    // The last line of defence. `installHooks` already catches per agent, so
    // reaching here means something outside the per-agent loop broke — detection,
    // or the matrix. Doctor still finishes.
    const reason = err instanceof Error ? err.message : String(err);
    return {
      action: 'failed',
      detail: 'agent hooks could NOT be installed',
      warnings: [`agent hooks: ${reason}`],
    };
  }

  const failures = report.failed.map((f) => `agent hooks: ${f.agent} — ${f.reason}`);
  /*
   * REFUSALS ARE WARNINGS TOO, and this is the path that matters (F008
   * re-verdict). `autoInstallHooks` is the doctor / first-run entry point — how
   * almost every real user installs — and it built its warnings from `failed`
   * alone. So a refused legacy upgrade surfaced through `harness hooks install`,
   * which few people run, and was SILENT here: a Windows user with a chained
   * legacy entry got "installed", no warning, and a hook that cannot run.
   *
   * That contradicted the "BUT IT IS NEVER SILENT" contract stated forty lines
   * above it. PROXIMITY TO A STATED CONTRACT — even one's own, even in the same
   * function — IS NOT PROTECTION. A contract is enforced by a row or it is prose.
   *
   * `nextAction` is included, not just the reason, and so is the OFFENDING
   * COMMAND: the whole point of the refusal is that the user must repair this
   * entry by hand, so they need to know WHICH entry (an agent can hold four) and
   * WHAT TO WRITE. A warning missing either half sends them to read our source.
   */
  const refusals = report.refusedUpgrades.map(
    (r) => `agent hooks: ${r.path} — ${r.reason}: ${r.command} — ${r.nextAction}`,
  );
  const warnings = [...failures, ...refusals];
  if (report.installed.length === 0) {
    return {
      action: failures.length > 0 ? 'failed' : 'not-needed',
      detail:
        failures.length > 0
          ? 'agent hooks could NOT be installed for any detected agent'
          : 'no detected agent needed an agent hook installed',
      warnings,
    };
  }
  return {
    /*
     * KEYED ON FAILURES, NOT ON `warnings.length`. A refused upgrade is an ACTION
     * ITEM, not a failed install — the install did everything it was allowed to
     * do, and declined exactly one entry on purpose. Doctor prints warnings
     * whatever the action is (`acts/doctor.ts:358`), so the message is delivered
     * either way; calling a working install `failed` would spend the word on a
     * case where nothing failed, and teach operators to discount it.
     */
    action: failures.length > 0 ? 'failed' : 'installed',
    // WRITTEN and ALREADY-PRESENT are different claims and render as such: an
    // outcome that wrote nothing must never appear inside "installed for …",
    // because that phrasing is exactly how a silent no-op on cursor shipped as a
    // success line while the file sat untouched (from-zero fixture, 2026-08-10).
    detail: installDetail(report.installed),
    warnings,
  };
}

function installDetail(installed: InstallReport['installed']): string {
  const agents = (entries: InstallReport['installed']) => [...new Set(entries.map((i) => i.agent))];
  const written = installed.filter((i) => i.change !== 'already-present');
  const present = installed.filter((i) => i.change === 'already-present');
  // Only mention already-present for agents that got NO fresh write this run —
  // a multi-file agent with one written file and one untouched file is an
  // install, not a hedge.
  const writtenAgents = agents(written);
  const presentOnly = agents(present).filter((agent) => !writtenAgents.includes(agent));
  if (writtenAgents.length === 0) {
    return `agent hooks already present for ${presentOnly.join(', ')} — nothing was written this run`;
  }
  return `agent hooks installed for ${writtenAgents.join(', ')}${
    presentOnly.length === 0 ? '' : `; already present for ${presentOnly.join(', ')}`
  }`;
}

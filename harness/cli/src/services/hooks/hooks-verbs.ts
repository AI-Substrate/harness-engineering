import type { InvocationProbe } from '../../adapters/exec/invocation-probe-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { AgentMarker } from '../doctor/collector/agents.js';
import { detectAgents, UNDETECTED_INSTALLERS } from '../doctor/collector/agents.js';
import { BACKUP_MANIFEST_NAME, restoreAgentConfigs } from '../doctor/collector/backup.js';
import type { AgentSpec } from './agent-matrix.js';
import { AGENT_MATRIX, eventKeys, resolveConfigFiles } from './agent-matrix.js';
import { extractBinaryPath, extractInterpreterPath } from './binary-path.js';
import { unacceptedOptions } from './fire-options.js';
import { FileHookJournal } from './hook-journal.js';
import { entryCommands, isOwnedByUs } from './hook-marker.js';
import { hookJournalPath, hookStateDir } from './hook-payload.js';
import {
  ensureRecordWritable,
  forgetInstalled,
  installRecordPath,
  readInstallRecord,
  recordInstall,
} from './install-record.js';
import type { InstallOutcome } from './install-strategy-a.js';
import { installStrategyA } from './install-strategy-a.js';
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
  installed: { agent: string; path: string; created: boolean }[];
  /** Agents refused BY NAME, never silently skipped. */
  refused: { agent: string; reason: string }[];
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
      installed: [],
      refused: [],
      failed: [],
    };
  }

  const reports = listAgents(deps);
  const installed: InstallReport['installed'] = [];
  const refused: InstallReport['refused'] = [];
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
      failed.push({ agent: report.agent, reason: unrecordableReason(stateDir, 'nothing') });
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
          reason: unrecordableReason(stateDir, compensate(deps, spec, outcomes)),
        });
        continue;
      }
      for (const outcome of outcomes) {
        installed.push({ agent: outcome.agent, path: outcome.path, created: outcome.created });
      }
    } catch (err) {
      failed.push({
        agent: report.agent,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { optedOut: false, installed, refused, failed };
}

/** One sentence, four endings — what happened to the config we could not record. */
type Compensation = 'nothing' | 'nothing-written' | 'rolled-back' | 'stranded';

function unrecordableReason(stateDir: string, outcome: Compensation): string {
  const head = `install provenance could not be written to ${installRecordPath(stateDir)}`;
  if (outcome === 'nothing') return `${head}; nothing was installed for this agent`;
  if (outcome === 'nothing-written')
    return `${head}; this run wrote nothing for this agent, so its existing install was left alone`;
  if (outcome === 'rolled-back') return `${head}; the entries just written were rolled back`;
  return `${head}, AND the rollback also failed — this agent's config still carries our entry and must be removed by hand`;
}

/**
 * Undo the entries this run wrote, using the provenance we hold IN MEMORY.
 *
 * The record on disk is precisely what we could not write, so the in-memory outcomes
 * are the only provenance that exists — and they are exactly the provenance uninstall
 * would have read. Running the real uninstall path rather than a bespoke unwind keeps
 * one removal implementation, including its refusals.
 *
 * ONLY WHAT THIS RUN WROTE, AND THAT IS THE LOAD-BEARING HALF. An `alreadyPresent`
 * file was installed by an EARLIER run whose record very likely DID persist; removing
 * its entry to compensate for our own failed write would undo a good install and
 * leave a record claiming a file that no longer carries our marker. A compensation
 * that over-reaches is a worse failure than the one it is compensating for, because
 * the first is a config we cannot fully remove and this one is a config we removed
 * without being asked.
 */
function compensate(deps: HooksDeps, spec: AgentSpec, outcomes: InstallOutcome[]): Compensation {
  const ours = outcomes.filter((o) => !o.alreadyPresent);
  if (ours.length === 0) return 'nothing-written';
  try {
    uninstallStrategyA(
      {
        fs: deps.fs,
        home: deps.home,
        env: deps.env,
        createdFiles: new Set(ours.filter((o) => o.created).map((o) => o.path)),
        createdKeys: new Map(ours.map((o) => [o.path, new Set(o.createdKeys)])),
        createdRootExtras: new Map(ours.map((o) => [o.path, o.createdRootExtras])),
      },
      spec,
    );
    return 'rolled-back';
  } catch {
    return 'stranded';
  }
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
  /** Why, in words, when the state is `inert`. */
  executionDetail?: string;
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
    const execution = probeExecution(deps, spec, configured);
    return {
      ...report,
      files,
      configuredBinary: configured,
      binaryResolves: resolves,
      binaryState: resolves ? 'resolves' : 'unresolvable',
      commandState: unaccepted.length === 0 ? 'accepted' : 'unknown-options',
      ...(unaccepted.length === 0 ? {} : { unacceptedOptions: unaccepted }),
      ...execution,
    };
  });
}

/**
 * Run the probe against the CONFIGURED pair, or report that we did not look.
 *
 * `unchecked` when no probe is injected — see {@link ExecutionState}. The detail
 * string names the failure in terms an operator can act on, because "inert" on
 * its own sends them to read our source to find out what we tried.
 */
function probeExecution(
  deps: HooksDeps,
  spec: AgentSpec,
  script: string,
): { executionState: ExecutionState; executionDetail?: string } {
  if (deps.probe === undefined) return { executionState: 'unchecked' };

  const [command] = ourCommands(deps, spec);
  const interpreter = command === undefined ? null : extractInterpreterPath(command);
  const result = deps.probe(interpreter, script);
  if (result.evidence) return { executionState: 'runs' };
  return {
    executionState: 'inert',
    executionDetail:
      result.detail ??
      (result.ok
        ? 'the command ran and produced no self-test evidence — our code did not run'
        : 'the command could not be executed'),
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
        out.push(...entryCommands(entry).filter(isOwnedByUs));
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

  return {
    // `recorded: false` is NOT "everything succeeded" — see the field doc.
    recorded: entries.length > 0,
    total: entries.length,
    failed: failures.length,
    failures: failures.slice(-10),
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

  const warnings = report.failed.map((f) => `agent hooks: ${f.agent} — ${f.reason}`);
  if (report.installed.length === 0) {
    return {
      action: warnings.length > 0 ? 'failed' : 'not-needed',
      detail:
        warnings.length > 0
          ? 'agent hooks could NOT be installed for any detected agent'
          : 'no detected agent needed an agent hook installed',
      warnings,
    };
  }
  return {
    action: warnings.length > 0 ? 'failed' : 'installed',
    detail: `agent hooks installed for ${[...new Set(report.installed.map((i) => i.agent))].join(', ')}`,
    warnings,
  };
}

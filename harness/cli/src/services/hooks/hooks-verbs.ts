import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { AgentMarker } from '../doctor/collector/agents.js';
import { detectAgents, UNDETECTED_INSTALLERS } from '../doctor/collector/agents.js';
import { BACKUP_MANIFEST_NAME, restoreAgentConfigs } from '../doctor/collector/backup.js';
import type { AgentSpec } from './agent-matrix.js';
import { AGENT_MATRIX, resolveConfigFiles } from './agent-matrix.js';
import { extractBinaryPath } from './binary-path.js';
import { FileHookJournal } from './hook-journal.js';
import { isOwnedByUs } from './hook-marker.js';
import { hookJournalPath, hookStateDir } from './hook-payload.js';
import { installStrategyA } from './install-strategy-a.js';

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

export interface HooksDeps {
  fs: FsPort;
  home: string;
  env: (name: string) => string | undefined;
  /** Already normalised and quoted — see `binary-path.ts`. */
  binary: string;
}

/** Every agent we know about, with what we can say about each. */
export function listAgents(deps: HooksDeps): AgentReport[] {
  const detected = new Set(
    detectAgents(deps.fs, deps.home).map((m: AgentMarker) => m.id.toLowerCase()),
  );
  const supported = AGENT_MATRIX.map((spec) => ({
    agent: spec.agent,
    detected: detected.has(spec.detectId.toLowerCase()),
    supported: true,
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
  installed: { agent: string; path: string; created: boolean }[];
  /** Agents refused BY NAME, never silently skipped. */
  refused: { agent: string; reason: string }[];
}

/** Install into every DETECTED, SUPPORTED agent. */
export function installHooks(deps: HooksDeps): InstallReport {
  if (hooksDisabled(deps.env)) {
    return { optedOut: true, installed: [], refused: [] };
  }

  const reports = listAgents(deps);
  const installed: InstallReport['installed'] = [];
  const refused: InstallReport['refused'] = [];

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
    for (const outcome of installStrategyA(deps.fs, spec, deps.home, deps.env, deps.binary)) {
      installed.push({ agent: outcome.agent, path: outcome.path, created: outcome.created });
    }
  }
  return { optedOut: false, installed, refused };
}

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
}

export function statusHooks(deps: HooksDeps): StatusReport[] {
  return listAgents(deps).map((report) => {
    const spec = AGENT_MATRIX.find((s) => s.agent === report.agent);
    if (spec === undefined) return { ...report, files: [], binaryState: 'absent' };

    const files = resolveConfigFiles(spec, deps.home, deps.env).map((path) => ({
      path,
      exists: deps.fs.exists(path),
    }));
    const configured = configuredBinaryFor(deps, spec);
    if (configured === null) return { ...report, files, binaryState: 'absent' };
    const resolves = deps.fs.exists(configured);
    return {
      ...report,
      files,
      configuredBinary: configured,
      binaryResolves: resolves,
      binaryState: resolves ? 'resolves' : 'unresolvable',
    };
  });
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

function ourCommands(deps: HooksDeps, spec: AgentSpec): string[] {
  const out: string[] = [];
  for (const path of resolveConfigFiles(spec, deps.home, deps.env)) {
    const raw = deps.fs.readText(path);
    if (raw === null) continue;
    let doc: { hooks?: Record<string, { command?: unknown }[]> };
    try {
      doc = JSON.parse(stripComments(raw)) as typeof doc;
    } catch {
      continue;
    }
    for (const key of [spec.events.pre, spec.events.post]) {
      for (const entry of doc.hooks?.[key] ?? []) {
        if (typeof entry.command === 'string' && isOwnedByUs(entry.command))
          out.push(entry.command);
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

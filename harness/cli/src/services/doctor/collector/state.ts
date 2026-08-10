import { posixJoin, toPosix } from '../../shared/posix-path.js';
import { HARNESS_DIR, TEMP_DIR } from '../../shared/temp.js';
import type { CollectorFsPort, PlatformKey } from './types.js';

/**
 * The collector's WRITTEN-DOWN state (plan 073 · ac-0008 point 3, ac-000a).
 *
 * Doctor's health row is a pure filesystem read — it never invokes git-ai, never
 * shells out, never installs anything (the doctor P7 rule). That is only
 * possible because the install path leaves a record behind: what was pinned,
 * what digest was verified, whether the hooks went on, which agents they went on
 * for, and — every single time — what the global trace2 config looked like when
 * we looked.
 *
 * That last one is the ruling's condition 3 made durable. An empty trace2 config
 * that nobody wrote down is indistinguishable, later, from one that something
 * erased. Recording the observation is what keeps "we never had trace2" and "we
 * destroyed your trace2" separable a year from now.
 */

export const COLLECTOR_STATE_SCHEMA = 'gitai-collector/1';
export const COLLECTOR_STATE_FILE = 'gitai-collector.json';

/** How many trace2 observations to keep — a bounded ledger, not a growing log. */
export const TRACE2_HISTORY_LIMIT = 10;

export type CliInstallStatus =
  | 'installed'
  | 'already-current'
  | 'failed'
  | 'unsupported-platform'
  | 'not-installed';

export type HooksInstallStatus =
  | 'installed'
  | 'skipped-trace2'
  | 'skipped-skills'
  /**
   * The digest-verified binary cannot execute on this machine, so the vendor
   * command was never invoked (plan 082 · F007). A refusal, not a failure — see
   * `HooksStage` in install.ts for why the two must not be one word.
   */
  | 'binary-unusable'
  | 'unverified'
  | 'failed'
  | 'not-attempted';

export interface Trace2Observation {
  observed: 'empty' | 'present' | 'unknown';
  entries: string[];
  at: string;
  /**
   * WHY we looked. `guard` is the pre-`install-hooks` read that decides whether
   * the hooks may go on at all; `post-install` is the verification read taken
   * afterwards, because git-ai's safety flag fails open and the only trustworthy
   * statement about what it changed is a fresh read of the config. Keeping them
   * distinct matters: after a successful install the post read is legitimately
   * `present` (git-ai's own two keys), and a reader that confused the two would
   * conclude the guard had been bypassed.
   */
  phase: 'guard' | 'post-install';
}

/**
 * The LAST hook-install ATTEMPT, kept apart from hook COVERAGE on purpose
 * (phase-1 review, round 3).
 *
 * These are two different kinds of fact and they were previously one field:
 *
 * - `hooks` is a fact about the MACHINE — which agents git-ai has actually been
 *   hooked for, verified by re-reading the global config at the time.
 * - `last_attempt` is a fact about ONE ATTEMPT — that on this date we tried to
 *   add coverage and a precondition guard refused to let us.
 *
 * Collapsing the second onto the first is how following our own advice made the
 * report worse: hooks were on for Claude and Codex, Cursor appeared, the
 * operator ran `--recheck-collector`, the trace2 guard blocked (correctly), and
 * the block overwrote coverage with `agents: []` — after which doctor announced
 * that NO attribution was being collected. That is false, and it also discarded
 * the new-agent gap the re-check had just found. A blocked attempt changes
 * nothing on the machine, so it may not change what we say about the machine.
 */
export interface HookAttempt {
  status: HooksInstallStatus;
  at: string;
  detail: string;
  /** Agent ids this attempt was meant to cover and could not. */
  uncovered: string[];
}

export interface CollectorState {
  schema: typeof COLLECTOR_STATE_SCHEMA;
  updated_at: string;
  manifest: {
    version: string;
    expect_schema_version: string;
    platform: PlatformKey | null;
    artifact: string | null;
    sha256: string | null;
  };
  cli: {
    status: CliInstallStatus;
    path: string | null;
    /** The digest actually verified on disk — never copied from the pin. */
    digest: string | null;
    verified_at: string | null;
    executable: boolean;
    detail: string;
  };
  hooks: {
    status: HooksInstallStatus;
    at: string | null;
    /**
     * Agents whose hook install we can EVIDENCE — a config file we watched get
     * created or change across the invocation (`evidence.ts`). This is the number
     * the report may stand behind.
     */
    agents: string[];
    /**
     * Agents git-ai NAMED, from its `install-hooks` output or (when that yields
     * nothing parseable) our marker scan. A superset of `agents`, and a CLAIM
     * rather than a measurement.
     *
     * IT EXISTS TO STOP THE HONEST NUMBER CAUSING A DISHONEST ONE. Narrowing
     * `agents` to the evidenced set is right for reporting, but
     * `agentsMissingHooks` computes `detected − covered`, and feeding it the
     * narrow set turns every hooked-but-unevidenced agent into a reported GAP —
     * "Gemini is NOT instrumented" about an agent that is. That would replace an
     * overclaim with an underclaim and drive the automatic re-check to re-run
     * `install-hooks` forever chasing agents it already hooked.
     *
     * So: the gap is computed against what was claimed (never invent a gap), and
     * the report shows what was evidenced (never invent coverage). Optional
     * because states written before plan 077 do not carry it; readers fall back
     * to `agents`, which is what those states meant by it.
     */
    claimed?: string[];
    detail: string;
  };
  /**
   * The outcome of the most recent install/re-check attempt, or `null` if none
   * has ever been recorded. NEVER a substitute for {@link CollectorState.hooks}
   * — see {@link HookAttempt}.
   */
  last_attempt: HookAttempt | null;
  /** Newest-first, bounded. Written on EVERY guard read, including re-checks. */
  trace2: Trace2Observation[];
  note_schema: {
    expected: string;
    observed: string | null;
    status: 'match' | 'mismatch' | 'unknown';
  };
}

/** Where the state lives — beside the other gitignored doctor state. */
export function collectorStatePath(cwd: string): string {
  return posixJoin(toPosix(cwd), HARNESS_DIR, TEMP_DIR, COLLECTOR_STATE_FILE);
}

/** A state object for a machine that has never run the installer. */
export function emptyCollectorState(
  now: string,
  manifest: { version: string; expect_schema_version: string },
): CollectorState {
  return {
    schema: COLLECTOR_STATE_SCHEMA,
    updated_at: now,
    manifest: {
      version: manifest.version,
      expect_schema_version: manifest.expect_schema_version,
      platform: null,
      artifact: null,
      sha256: null,
    },
    cli: {
      status: 'not-installed',
      path: null,
      digest: null,
      verified_at: null,
      executable: false,
      detail: 'git-ai has not been installed by harness on this machine',
    },
    hooks: { status: 'not-attempted', at: null, agents: [], detail: 'hooks not attempted' },
    last_attempt: null,
    trace2: [],
    note_schema: { expected: manifest.expect_schema_version, observed: null, status: 'unknown' },
  };
}

/**
 * Read the recorded state. A missing, unreadable, malformed or foreign-schema
 * file all read as `null` — the caller then reports "could not determine",
 * never "healthy" and never "not installed" (ac-000b).
 */
export function readCollectorState(fs: CollectorFsPort, cwd: string): CollectorState | null {
  const path = collectorStatePath(cwd);
  if (!fs.exists(path)) return null;
  const raw = fs.readText(path);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CollectorState>;
    if (parsed.schema !== COLLECTOR_STATE_SCHEMA) return null;
    if (parsed.cli === undefined || parsed.hooks === undefined) return null;
    // A state file written before `last_attempt` existed is still OURS and still
    // schema-current; it simply records no attempt. Normalising here keeps every
    // reader from having to know that.
    return { ...parsed, last_attempt: parsed.last_attempt ?? null } as CollectorState;
  } catch {
    return null;
  }
}

/** Persist state (creating the temp dir if needed). Never throws to the caller. */
export function writeCollectorState(
  fs: CollectorFsPort,
  cwd: string,
  state: CollectorState,
): boolean {
  try {
    const path = collectorStatePath(cwd);
    fs.mkdirp(posixJoin(toPosix(cwd), HARNESS_DIR, TEMP_DIR));
    fs.writeText(path, `${JSON.stringify(state, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Append a trace2 observation, newest first, bounded to the history limit. */
export function recordTrace2Observation(
  state: CollectorState,
  observation: Trace2Observation,
): CollectorState {
  return {
    ...state,
    trace2: [observation, ...state.trace2].slice(0, TRACE2_HISTORY_LIMIT),
  };
}

/**
 * What the hook install CLAIMED to cover — the set a coverage GAP is computed
 * against, never the set a report boasts about.
 *
 * One accessor rather than `state.hooks.claimed ?? state.hooks.agents` repeated
 * at each site, because the fallback is the whole compatibility story: a state
 * written before plan 077 has no `claimed`, and what those states meant by
 * `agents` was the claim. Spelling that out five times is five chances to get it
 * backwards, and getting it backwards invents a coverage gap.
 */
export function claimedHookAgents(state: CollectorState): string[] {
  return state.hooks.claimed ?? state.hooks.agents;
}

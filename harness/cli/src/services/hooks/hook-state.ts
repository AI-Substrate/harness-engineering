import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { IndexState } from '../../adapters/git/git-port.js';
import type { HashPort } from '../../adapters/hash/hash-port.js';

/**
 * What the PRE phase records so the POST phase can decide (plan 082 tk-0003).
 *
 * PRE runs before the agent's tool call, POST after it. Between them the tool may
 * have committed — and a commit destroys the evidence that would prove who
 * authored it. So the decision inputs have to be captured on the way IN.
 */
export interface PreRecord {
  /** HEAD at PRE. `null` on an unborn branch — a repo with no commits yet. */
  head: string | null;
  /**
   * The index at PRE. THE discriminator: a genuine agent edit arrives with a
   * CLEAN index, while all seven measured defeaters arrive ALREADY-STAGED
   * (see {@link IndexState}).
   */
  index: IndexState;
  /**
   * When it was recorded, ISO-8601. DIAGNOSTIC ONLY — never a decision input.
   * It is here so a stale-state bug can be seen in the journal, not so the guard
   * can start reasoning about time; a time-based rule would make the outcome
   * depend on how long the agent's tool call happened to take.
   */
  recordedAt: string;
  /**
   * The bracket's own command line, verbatim, from the PRE payload's
   * `tool_input.command`. `null` when the client did not supply one.
   *
   * Recorded at PRE because that is the only moment it exists: POST receives its
   * own payload, and by then the command that mattered has already run. It is the
   * input to the second guard layer (see `scan-command.ts`).
   */
  command: string | null;
}

/** A record that failed to parse is reported as such, never silently defaulted. */
export type PreRead =
  | { status: 'ok'; record: PreRecord }
  | { status: 'absent' }
  | { status: 'unreadable' };

/**
 * The PRE/POST handoff, on disk (plan 082 tk-0003).
 *
 * Two properties are load-bearing, and they are different properties solving
 * different races:
 *
 * 1. **The PRE write is an ATOMIC REPLACE** — temp file, then rename. A reader
 *    therefore sees either the whole previous record or the whole new one, never
 *    a half-written file. Writing in place would let a POST fire read a truncated
 *    JSON document mid-write and classify on nonsense. Each fire writes to a
 *    UNIQUE temp name, so two racing PRE writes cannot corrupt each other's
 *    intermediate file either.
 *
 * 2. **The POST decision is an EXCLUSIVE CLAIM** — {@link claimTransition}. Two
 *    POST fires racing on the same commit would both read the same prior state
 *    and both emit, and the collector would see two sessions for one commit. The
 *    claim marker is created with `O_EXCL`, so exactly one caller can win. This
 *    is NOT what the atomic write solves: an atomic write makes reads coherent, it
 *    does not make a decision unique.
 *
 * State is keyed by a hash of the repository root, one file per repository. A
 * single shared file keyed by repo path — the POC's shape — has a lost-update
 * race the moment two repositories fire at once, because each writer rewrites the
 * whole document from a snapshot it took earlier.
 */
/**
 * How many claim markers a repository keeps. Small enough that the directory
 * stays trivial, large enough that a burst of commits in one session cannot push
 * a still-relevant marker out and let a re-fire double-emit.
 */
export const CLAIM_KEEP = 50;

export class HookStateStore {
  constructor(
    private readonly fs: FsPort,
    private readonly hash: HashPort,
    /** Directory holding one state file per repository. Created on demand. */
    private readonly stateDir: string,
    /**
     * A token unique to THIS fire, used only to name the temp file. Injected
     * rather than read from `process` so the service stays port-pure and a test
     * can make the temp path deterministic.
     */
    private readonly uniqueToken: () => string,
  ) {}

  /** The state file for `repoRoot`. Hashed, so no repo path can escape `stateDir`. */
  private pathFor(repoRoot: string): string {
    return `${this.stateDir}/${this.hash.sha256Hex(repoRoot).slice(0, 32)}.json`;
  }

  /**
   * Record the PRE observation for `repoRoot`, replacing any previous one.
   *
   * Returns whether the record was durably written. A failure is reported rather
   * than thrown: the caller is a hook that must never break the agent it observes,
   * and a missing record makes POST stay silent, which is the safe direction.
   */
  recordPre(repoRoot: string, record: PreRecord): boolean {
    const target = this.pathFor(repoRoot);
    const temp = `${target}.${this.uniqueToken()}.tmp`;
    try {
      this.fs.mkdirp(this.stateDir);
      this.fs.writeText(temp, JSON.stringify(record));
      // rename(2) is atomic on the same filesystem, and temp is a sibling of
      // target so it always is. This is the only step that makes the new record
      // visible; until it runs, readers keep seeing the old one intact.
      this.fs.rename(temp, target);
      return true;
    } catch {
      try {
        this.fs.deleteFile(temp);
      } catch {
        // A leaked temp file is inert — it is never read, and the next fire uses
        // a different name. Failing here would turn a cleanup miss into an outage.
      }
      return false;
    }
  }

  /**
   * The PRE record for `repoRoot`.
   *
   * `absent` (no prior fire) and `unreadable` (a file that would not parse) are
   * kept apart because they mean different things to a human reading the journal,
   * even though the guard's response to both is the same: stay silent. A guard
   * that cannot see its own inputs must never guess at them.
   */
  readPre(repoRoot: string): PreRead {
    const raw = this.fs.readText(this.pathFor(repoRoot));
    if (raw === null) return { status: 'absent' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'unreadable' };
    }
    if (typeof parsed !== 'object' || parsed === null) return { status: 'unreadable' };
    const { head, index, recordedAt, command } = parsed as Record<string, unknown>;
    const headOk = head === null || typeof head === 'string';
    const indexOk = index === 'clean' || index === 'already-staged' || index === 'unknown';
    // An ABSENT command reads as null rather than making the record unreadable:
    // records written before this field existed, and clients that send no command,
    // are both legitimate. The scan treats null as `unavailable`, which abstains.
    const commandValue = typeof command === 'string' ? command : null;
    if (!headOk || !indexOk || typeof recordedAt !== 'string') return { status: 'unreadable' };
    return {
      status: 'ok',
      record: {
        head: head as string | null,
        index: index as IndexState,
        recordedAt,
        command: commandValue,
      },
    };
  }

  /**
   * Claim the right to act on `repoRoot` moving to `head`. `true` for exactly one
   * caller; `false` for every other, including a later fire seeing the same
   * transition again.
   *
   * The marker is keyed by the DESTINATION head, so it is idempotent per commit
   * rather than per invocation: a retry of the same transition is correctly
   * refused, while the next real commit gets its own marker.
   *
   * A won claim PRUNES this repository's older markers (see {@link CLAIM_KEEP}).
   */
  claimTransition(repoRoot: string, head: string): boolean {
    try {
      this.fs.mkdirp(this.stateDir);
    } catch {
      return false;
    }
    const marker = `${this.pathFor(repoRoot)}.${head}.claim`;
    const won = this.fs.createExclusive(marker, '');
    if (won) this.pruneClaims(repoRoot);
    return won;
  }

  /**
   * Keep this repository's newest {@link CLAIM_KEEP} markers and delete the rest.
   *
   * WHY THIS EXISTS AT ALL — it is not tidiness, it is the guard's own failure
   * mode. One marker per commit, never removed, is unbounded growth in a hidden
   * directory on the customer's machine. When that directory eventually meets an
   * inode or quota limit, `createExclusive` starts returning `false`; `false`
   * means "someone else won", so the guard fails closed and SILENTLY STOPS
   * EMITTING — while every path still exits 0 and still looks healthy. A cap
   * turns an eventual silent outage into a bounded directory.
   *
   * Pruning is BEST-EFFORT and can never affect the claim: the claim already
   * succeeded before this runs, and a prune failure leaves inert files behind
   * rather than taking an emission with it.
   */
  private pruneClaims(repoRoot: string): void {
    try {
      const prefix = `${this.hash.sha256Hex(repoRoot).slice(0, 32)}.`;
      const names = this.fs.listRegularFilesNoFollow(this.stateDir);
      if (names === null) return;
      const mine = names.filter((n) => n.startsWith(prefix) && n.endsWith('.claim'));
      if (mine.length <= CLAIM_KEEP) return;
      // Newest first. An unreadable mtime sorts oldest, so a file we cannot age is
      // a prune candidate rather than an immortal one.
      const aged = mine
        .map((name) => ({ name, at: this.fs.mtimeMs(`${this.stateDir}/${name}`) ?? -1 }))
        .sort((a, b) => b.at - a.at);
      for (const { name } of aged.slice(CLAIM_KEEP)) {
        try {
          this.fs.deleteFile(`${this.stateDir}/${name}`);
        } catch {
          // One undeletable marker must not stop the rest of the prune.
        }
      }
    } catch {
      // Best-effort by contract. The claim stands either way.
    }
  }
}

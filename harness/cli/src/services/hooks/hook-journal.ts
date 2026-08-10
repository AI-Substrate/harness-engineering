import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { FireOutcome, HookJournal, HookPhase } from './commit-intercept.js';

/**
 * The fire journal (plan 082 tk-000b) — the ONLY thing that makes a silent
 * failure visible during Phase 1.
 *
 * `harness hooks status` is a Phase 2 deliverable and Phase 2 depends on Phase 1,
 * so Phase 1 cannot assert on it. Without this file, a Phase-1 runtime that fails
 * on every fire would be indistinguishable from one working perfectly: every path
 * exits 0 and prints nothing by design, so **the exit code carries no
 * information** and no assertion anywhere may rest on it. The journal is the
 * observable. Phase 2's status verb merely reads it.
 *
 * APPEND-ONLY JSONL, ONE ATOMIC WRITE PER RECORD — and that is a correctness
 * property, not a style choice (plan 082 tk-0011).
 *
 * This class used to read the file, push a line, trim, and write the whole thing
 * back. Within one process that is safe, because `record()` is synchronous and
 * cannot interleave — which is exactly why the in-process concurrency test was
 * green and blind to this. But the runtime is ONE `harness hooks fire` PROCESS PER
 * AGENT TOOL CALL, and two of those overlap with nothing serialising them: both
 * read the same bytes, and the second write erases the first's record.
 *
 * MEASURED, not theorised — N real concurrent processes against a temp HOME:
 *
 *   24 -> 22     8 -> 8 (not every run)     8 -> 6     4 -> 3     3 -> 2
 *
 * It fires at THREE parallel tool calls. And the record most likely to be lost in
 * a burst is a `failed` one — precisely what this file exists to expose. A lossy
 * journal reads exactly like a quiet one.
 *
 * Note what the CLAIM MARKER does not do for us here. `createExclusive` makes the
 * emit DECISION unique; it does not serialise the RECORD. Every fire journals: PRE
 * fires never take a claim at all, and claim-losers journal `lost-the-claim`. So
 * the claim excludes none of this concurrency.
 *
 * WHERE THE 500-LINE BOUND WENT. It was the trim that forced the whole-file
 * rewrite, so it cannot live in `record()`. It is now enforced in two places, and
 * they bound different things:
 *
 * - {@link read} bounds what any CONSUMER sees — newest {@link JOURNAL_KEEP}.
 * - {@link compact} bounds what the DISK holds, by ROTATION (a rename), never by a
 *   rewrite. It is called by readers, never on the fire path.
 */

/** How many fire records a reader returns, newest last. */
export const JOURNAL_KEEP = 500;

/**
 * Rotate once the live file exceeds this many lines. Deliberately well above
 * {@link JOURNAL_KEEP} so rotation is rare: each rotation discards the previous
 * generation, and a threshold near KEEP would make that discard frequent enough to
 * drop history a reader could still have shown.
 */
export const JOURNAL_ROTATE_AT = 2000;

/**
 * How long a rotation claim may sit before it is treated as abandoned.
 *
 * A rotation is a single `rename(2)` — microseconds. This bound is not a timeout
 * for slow work; it exists so a process killed mid-rotation cannot disable
 * rotation permanently and let the journal grow without bound. Generous on
 * purpose: clearing a LIVE claim is harmless (the re-check catches it) but doing so
 * needlessly is churn.
 */
export const ROTATE_CLAIM_STALE_MS = 60_000;

export interface JournalEntry {
  at: string;
  phase: HookPhase;
  /**
   * The repository the fire concerned — `null` ONLY for an `unparseable` outcome,
   * where the document never named one. Every other outcome has a repo by
   * construction, because the guards it passed required one.
   */
  repoRoot: string | null;
  outcome: FireOutcome;
  /**
   * A UTF-8 BOM was stripped from the payload this entry describes.
   *
   * Rides an entry that was being written anyway — a stripped BOM is worth a TRACE
   * (so a change on the wire is visible the first time) but not a line of its own.
   * The hook fires on every tool call; a record per strip would be a firehose.
   */
  strippedBom?: true;
}

export class FileHookJournal implements HookJournal {
  constructor(
    private readonly fs: FsPort,
    /** Absolute path to the JSONL file. Its parent is created on demand. */
    private readonly path: string,
    private readonly dir: string,
  ) {}

  /** The previous generation, kept so a rotation loses no record a reader wanted. */
  private get rotatedPath(): string {
    return `${this.path}.1`;
  }

  /**
   * Append one outcome in ONE `O_APPEND` write. NEVER throws — a journal that
   * cannot be written must not become an agent-visible failure, and the fire it
   * describes has already happened either way.
   *
   * NOTHING here reads or rewrites the file. That is the property under test
   * (dw-003d): the moment this path reads-then-writes, concurrent fires start
   * losing each other's records again.
   */
  record(entry: JournalEntry): void {
    try {
      this.fs.mkdirp(this.dir);
      // ONE line, ONE write, newline included. O_APPEND's atomicity is per write()
      // call, so emitting the record and the newline separately would let another
      // process splice its record into the middle of this one.
      this.fs.appendText(this.path, `${JSON.stringify(entry)}\n`);
    } catch {
      // Deliberately swallowed. See the class doc.
    }
  }

  /**
   * Every retained entry, oldest first, bounded to the newest {@link JOURNAL_KEEP}.
   *
   * Reads the rotated generation first so a rotation that happened mid-history is
   * invisible to the caller.
   */
  read(): JournalEntry[] {
    const entries = [...this.parse(this.rotatedPath), ...this.parse(this.path)];
    return entries.slice(-JOURNAL_KEEP);
  }

  /**
   * Bound what the disk holds. Called by READERS (the status verb), never during a
   * fire — an unbounded log in a hidden directory degrades quietly on a customer's
   * machine, which is the same failure shape as the unpruned claim markers.
   *
   * ROTATION BY RENAME, not a rewrite, and that is what keeps it loss-free. A
   * compaction that read the file and wrote a trimmed copy back would race exactly
   * as `record()` used to, and would lose the NEWEST records — the wrong direction.
   * `rename(2)` is atomic, and a process holding the old descriptor keeps writing
   * to the same inode, which is now the rotated file and is still read by
   * {@link read}. So a fire concurrent with a rotation loses nothing.
   *
   * THE ROTATION ITSELF IS SERIALISED, and it has to be. MEASURED: two readers
   * that both pass the threshold check before either renames will rotate TWICE,
   * and the second rename puts a freshly-recreated one-line live file over the
   * rotated generation. A journal of 2001 records became **1**, and `read()`
   * returned a single entry — the entire history destroyed by a bound that exists
   * to preserve the recent past. The loss is of OLD records, so it is not the
   * wrong-direction failure the rename was chosen to avoid, but a `failed` entry
   * that has scrolled into the rotated generation is exactly the kind nobody has
   * looked at yet.
   *
   * Two things prevent it, and BOTH are needed:
   *
   * 1. an exclusive claim, so only one rotator runs at a time — the same `O_EXCL`
   *    primitive the commit guard uses to make its decision unique;
   * 2. a RE-CHECK of the live file's length *after* taking the claim. The claim
   *    alone is not enough: the second rotator's guard was passed before the first
   *    rename, and a stale guard is what does the damage.
   *
   * A crashed rotator would otherwise leave its claim behind and disable rotation
   * for good — silent unbounded growth, the failure shape this whole method exists
   * to prevent — so a claim older than {@link ROTATE_CLAIM_STALE_MS} is treated as
   * abandoned and cleared.
   *
   * Returns whether it rotated. Never throws.
   */
  compact(): boolean {
    try {
      if (this.parse(this.path).length <= JOURNAL_ROTATE_AT) return false;
      if (!this.claimRotation()) return false;
      try {
        // THE RE-CHECK. Another rotator may have rotated between our first check
        // and our claim, leaving a live file of a handful of records; renaming that
        // over the rotated generation is the measured 2001-to-1 loss.
        if (this.parse(this.path).length <= JOURNAL_ROTATE_AT) return false;
        this.fs.rename(this.path, this.rotatedPath);
        return true;
      } finally {
        this.fs.deleteFile(this.rotateClaimPath);
      }
    } catch {
      // A failed rotation is not a failure of the thing being journalled.
      return false;
    }
  }

  /** Take the exclusive right to rotate, clearing a claim abandoned by a dead process. */
  private claimRotation(): boolean {
    if (this.fs.createExclusive(this.rotateClaimPath, 'rotating')) return true;
    const age = this.fs.mtimeMs(this.rotateClaimPath);
    if (age === null) return false;
    if (Date.now() - age < ROTATE_CLAIM_STALE_MS) return false;
    // Abandoned. Clearing it is safe: the worst case is two rotators, which the
    // re-check above already makes harmless.
    this.fs.deleteFile(this.rotateClaimPath);
    return this.fs.createExclusive(this.rotateClaimPath, 'rotating');
  }

  private get rotateClaimPath(): string {
    return `${this.path}.rotating`;
  }

  private parse(path: string): JournalEntry[] {
    const raw = this.fs.readText(path);
    if (raw === null) return [];
    const entries: JournalEntry[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        entries.push(JSON.parse(line) as JournalEntry);
      } catch {
        // One corrupt line must not hide the others.
      }
    }
    return entries;
  }
}

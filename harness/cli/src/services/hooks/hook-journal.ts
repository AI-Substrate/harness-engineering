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
 * Append-only JSONL, one line per fire. Bounded by line count rather than left to
 * grow: this file is written on EVERY agent tool call, and an unbounded log in a
 * hidden directory is the same failure shape as the unpruned claim markers — it
 * degrades quietly, on the customer's machine, long after anyone is watching.
 */

/** How many fire records are kept. A rewrite trims to this on every append. */
export const JOURNAL_KEEP = 500;

export interface JournalEntry {
  at: string;
  phase: HookPhase;
  repoRoot: string;
  outcome: FireOutcome;
}

export class FileHookJournal implements HookJournal {
  constructor(
    private readonly fs: FsPort,
    /** Absolute path to the JSONL file. Its parent is created on demand. */
    private readonly path: string,
    private readonly dir: string,
  ) {}

  /**
   * Append one outcome. NEVER throws — a journal that cannot be written must not
   * become an agent-visible failure, and the fire it describes has already
   * happened either way.
   */
  record(entry: JournalEntry): void {
    try {
      this.fs.mkdirp(this.dir);
      const existing = this.fs.readText(this.path) ?? '';
      const lines = existing.split('\n').filter((line) => line.trim().length > 0);
      lines.push(JSON.stringify(entry));
      // Keep the NEWEST — a truncation that kept the oldest would freeze the
      // journal at the first 500 fires and never show a current failure.
      const kept = lines.slice(-JOURNAL_KEEP);
      this.fs.writeText(this.path, `${kept.join('\n')}\n`);
    } catch {
      // Deliberately swallowed. See the class doc.
    }
  }

  /** Every recorded entry, oldest first. `[]` when the journal is absent or unreadable. */
  read(): JournalEntry[] {
    const raw = this.fs.readText(this.path);
    if (raw === null) return [];
    const entries: JournalEntry[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        entries.push(JSON.parse(line) as JournalEntry);
      } catch {
        // One corrupt line must not hide the other 499.
      }
    }
    return entries;
  }
}

import type { Clock } from '../../adapters/clock/clock-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import { classifyHeadTransition, type TransitionReason } from './classify-head-transition.js';
import type { HookStateStore } from './hook-state.js';
import { scanCommand } from './scan-command.js';

/** Which half of the bracket is firing. */
export type HookPhase = 'pre' | 'post';

/**
 * What one fire did — the value the journal records and the tests assert on.
 *
 * NOTE what is not here: an exit code. The verb exits 0 unconditionally by design
 * (a hook must never break the agent it observes), so the exit code carries NO
 * information and no assertion may rest on it. This outcome is the observable.
 */
export type FireOutcome =
  | { kind: 'recorded'; phase: 'pre' }
  | { kind: 'emitted'; head: string }
  | { kind: 'silent'; reason: TransitionReason | 'lost-the-claim' }
  | { kind: 'failed'; cause: string }
  /**
   * The payload could not be read at all, so no fire was ever attempted.
   *
   * NOT produced by {@link CommitIntercept} — it is written by the act BEFORE the
   * guards that used to return early, because those guards are where an
   * unparseable payload vanished. It is the only outcome that names no repository.
   */
  | { kind: 'unparseable'; reason: 'payload-not-json'; rawLen: number; headHex: string };

/**
 * How the runtime tells the collector a commit happened here (implemented over
 * the socket port in tk-0008). Injected, so every provocation row can assert on
 * the DECISION without a daemon, a socket or a network.
 */
export interface CommitEmitter {
  emit(input: { repoRoot: string; message: string }): Promise<{ ok: boolean; detail: string }>;
}

/** Where an outcome is written so a silent failure is visible (tk-000b). */
export interface HookJournal {
  record(entry: {
    at: string;
    phase: HookPhase;
    /** The agent slug whose hook fired — see {@link JournalEntry.agent}. */
    agent: string;
    /** `null` only for a payload so malformed it never named a repository. */
    repoRoot: string | null;
    outcome: FireOutcome;
  }): void;
}

export interface CommitInterceptDeps {
  /** A git port already bound to the repository being observed. */
  git: GitPort;
  state: HookStateStore;
  clock: Clock;
  emitter: CommitEmitter;
  journal: HookJournal;
  /**
   * WHICH AGENT this intercept is firing for, carried onto every journal record.
   *
   * A CONSTRUCTOR DEP, not a `fire()` argument: one intercept serves one agent's
   * hook invocation, so the agent cannot vary per call — and making it a parameter
   * would let a caller pass a different one for PRE than for POST, which would
   * corrupt attribution in precisely the records meant to fix it.
   */
  agent: string;
}

/**
 * The commit intercept (plan 082 tk-0007) — PRE records, POST decides.
 *
 * Three ordering properties are load-bearing, and each one is a bug the POC has:
 *
 * 1. **PRE records the INDEX as well as HEAD.** HEAD alone cannot separate a
 *    genuine commit from the seven transitions that deliver content authored
 *    elsewhere; the index at PRE can, and only if it is captured before the commit
 *    erases it.
 *
 * 2. **The claim is taken BEFORE the emit, not after.** The POC writes its state
 *    AFTER emitting, which leaves the read-then-write window where two concurrent
 *    POST fires both read the old state and both emit. Here the exclusive claim is
 *    what authorises the emit, so at most one fire can ever reach it.
 *
 * 3. **Every failure is an OUTCOME, never a throw.** The caller is a hook wired
 *    into an agent's tool loop; an exception escaping it would break the agent it
 *    is supposed to observe silently.
 */
export class CommitIntercept {
  constructor(private readonly deps: CommitInterceptDeps) {}

  async fire(phase: HookPhase, repoRoot: string, command?: string | null): Promise<FireOutcome> {
    let outcome: FireOutcome;
    try {
      outcome = phase === 'pre' ? this.pre(repoRoot, command ?? null) : await this.post(repoRoot);
    } catch (error) {
      // Nothing below may escape into the agent's tool call.
      outcome = { kind: 'failed', cause: error instanceof Error ? error.message : String(error) };
    }
    try {
      this.deps.journal.record({
        at: this.deps.clock.nowIso(),
        agent: this.deps.agent,
        phase,
        repoRoot,
        outcome,
      });
    } catch {
      // A journal that cannot be written must not turn into an agent-visible
      // failure. The outcome is still returned to the caller.
    }
    return outcome;
  }

  private pre(repoRoot: string, command: string | null): FireOutcome {
    const { git, state, clock } = this.deps;
    const written = state.recordPre(repoRoot, {
      head: git.currentCommit(),
      // Read BEFORE the tool call runs. After the commit this is unrecoverable.
      index: git.indexState(),
      recordedAt: clock.nowIso(),
      // The bracket's command line, kept for the second guard layer. Only PRE can
      // see it — POST's payload describes a different moment.
      command,
    });
    return written ? { kind: 'recorded', phase: 'pre' } : { kind: 'failed', cause: 'state-write' };
  }

  private async post(repoRoot: string): Promise<FireOutcome> {
    const { git, state, emitter } = this.deps;
    const prior = state.readPre(repoRoot);
    if (prior.status !== 'ok') {
      // No baseline, or one we could not parse. A transition cannot be
      // established from a state we never observed — never guess on first sight.
      this.rebase(repoRoot);
      return { kind: 'silent', reason: 'no-prior-state' };
    }

    const head = git.currentCommit();
    const reflog = git.readReflog('HEAD', 1);
    const outcome = classifyHeadTransition({
      prev: prior.record.head,
      head,
      parents: git.headParents() ?? [],
      reflogSubject:
        reflog.status === 'ok' && reflog.entries.length > 0 ? reflog.entries[0].subject : null,
      indexAtPre: prior.record.index,
      commandScan: scanCommand(prior.record.command),
    });

    if (outcome.decision === 'silent' || head === null) {
      this.rebase(repoRoot);
      return { kind: 'silent', reason: outcome.reason };
    }

    // The claim AUTHORISES the emit — taken first, so two racing POSTs on the same
    // commit cannot both proceed. Losing is a normal outcome, not a failure.
    if (!state.claimTransition(repoRoot, head)) {
      this.rebase(repoRoot);
      return { kind: 'silent', reason: 'lost-the-claim' };
    }

    const message = `HEAD ${head}`;
    const sent = await emitter.emit({ repoRoot, message });
    this.rebase(repoRoot);
    return sent.ok ? { kind: 'emitted', head } : { kind: 'failed', cause: sent.detail };
  }

  /**
   * Move the recorded baseline to where HEAD is now, so the NEXT transition is
   * measured from what we last saw rather than from a stale point.
   *
   * Deliberately runs on every POST path including the silent ones: a checkout
   * that was correctly ignored still moved HEAD, and leaving the old baseline in
   * place would make the following commit look like a multi-commit jump and be
   * silently dropped too.
   */
  private rebase(repoRoot: string): void {
    const { git, state, clock } = this.deps;
    state.recordPre(repoRoot, {
      head: git.currentCommit(),
      index: git.indexState(),
      recordedAt: clock.nowIso(),
      // The rebased baseline carries NO command: it describes where HEAD is now,
      // not a bracket anyone observed. Carrying the old one forward would let a
      // past command silence a future commit.
      command: null,
    });
  }
}

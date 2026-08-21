/**
 * THE SCORING RULES, AS A PURE FUNCTION (plan 082 phase 4).
 *
 * This file has NO I/O and no imports. That is deliberate: the verdict is the part
 * that must be reproducible from recorded evidence, and the two control runs on this
 * machine are pinned against it in `scoring.test.ts`. Everything that touches the
 * filesystem, the agent config, git or the clock lives in `extension.ts` and hands
 * an {@link Evidence} object to {@link scoreRun}.
 *
 * WHAT IS BEING VALIDATED, and the name matters because it was got wrong once:
 * **that git-ai's attribution capture survives a sandboxed agent.** Our hook relay
 * is ONE COMPONENT of that, alongside git-ai's own checkpoint channel and the
 * agent's hook configuration. A run in which our relay emits perfectly and no note
 * appears is a FAILURE of the thing under test, even though our part worked.
 *
 * THE THREE RULES THIS ENCODES
 *
 * 1. **REPORT AND REFUSE, NEVER ACT.** Nothing here mutates anything, and the verb
 *    that calls it never edits a user's agent config. A second commit-signal relay
 *    INVALIDATES a run; it is not something to delete on the operator's behalf.
 *    Who removes what is their call.
 * 2. **INCONCLUSIVE IS A FIRST-CLASS VERDICT.** A well-executed non-experiment is
 *    the normal outcome, not a failure. A scorer that cannot say INCONCLUSIVE will
 *    report a confounded run as a PASS — which is the mistake this whole phase
 *    exists to make impossible.
 * 3. **SCORE ON IDENTITY, NEVER ON COUNT.** The note is read for path, line range
 *    and actor kind and cross-checked against ground truth. A note count moves for
 *    unrelated reasons and would certify a run on somebody else's note.
 */

/**
 * The two channels, because conflating them is the error this file was written
 * after — and it was made by someone who had read the two-channel model.
 *
 * - `checkpoint` (channel 1) — `git-ai checkpoint <agent>`. Records WHAT THE AGENT
 *   WROTE into the working log. Necessary for attribution and **cannot produce a
 *   note on its own**. Its presence does NOT confound a run; removing it would
 *   break the very thing under test.
 * - `commit-signal` (channel 2) — anything that tells the daemon a COMMIT HAPPENED
 *   (our relay's synthetic trace2 events; the POC's `harness-commit-hook.mjs`).
 *   **Two of these confound a run**, because either could have caused the note.
 * - `unknown` — a command we cannot classify. Treated as a POSSIBLE commit signal,
 *   because the safe assumption about a stranger's command is that it might be one.
 * - `inert` — recognised and known to send nothing (a logger, a `tee`).
 */
export type Channel = 'checkpoint' | 'commit-signal' | 'unknown' | 'inert';

export interface RelayEntry {
  /** Where it was found, e.g. `~/.cursor/hooks.json preToolUse[0]`. */
  readonly source: string;
  /** The command string, verbatim. Reported so a refusal NAMES what it refused over. */
  readonly command: string;
  readonly channel: Channel;
  /** True for the entry this harness installed. */
  readonly ours: boolean;
  /**
   * The operator's explicit declaration that an `unknown` entry is not a commit
   * signal, recorded as evidence.
   *
   * WHY AN ACKNOWLEDGEMENT RATHER THAN A CLEVERER CLASSIFIER. We cannot know what a
   * third party's script does by reading its command line, and guessing would make
   * the verb's central refusal unreliable in the direction that certifies a bad run.
   * So the tool refuses to guess, the human declares, and **the declaration becomes
   * part of the record** — visible in the verdict rather than assumed inside it.
   */
  readonly acknowledged?: boolean;
  /**
   * A stable key for the RELAY, as distinct from the ENTRY.
   *
   * MEASURED, NOT ANTICIPATED. The first real `--begin` on a live machine reported
   * **four** commit-signal relays where there were two: every agent config carries a
   * PRE entry and a POST entry for the same relay, so counting entries makes a
   * correctly configured machine look doubly confounded and the census refuses
   * every run. Identity is the program; phase is not part of it.
   *
   * Falls back to the command string when a caller does not supply one.
   */
  readonly identity?: string;
}

/**
 * The SHELL-SIDE connectivity probe — the one that must run INSIDE the agent's
 * sandboxed shell.
 *
 * THIS IS NOT THE HOOK-SIDE PROBE, and the distinction is load-bearing enough to
 * have burned a careful reader already. The hook runner is NOT sandboxed: a
 * hook-side `control=OK trace2=OK` is the PREMISE of the design (it is where we
 * emit from), not evidence that no sandbox is engaged. Reading the hook-side log
 * and concluding the sandbox was off inverts the entire result.
 *
 * The valid condition is shell-side **REFUSED on both sockets**. `connected` means
 * git-ai reached the daemon unaided and the run cannot attribute the outcome.
 */
export interface SandboxProbe {
  readonly context: 'shell';
  readonly control: 'refused' | 'connected' | 'unknown';
  readonly trace2: 'refused' | 'connected' | 'unknown';
  /** e.g. `seatbelt`, or `unset`. Reported, never scored on its own. */
  readonly sandboxEnv?: string;
}

/** One line of our hook journal, reduced to what scoring uses. */
export interface JournalEntry {
  readonly at: string;
  readonly phase: 'pre' | 'post';
  readonly kind: 'recorded' | 'emitted' | 'silent' | 'failed';
  /** Present on `emitted`: the head the relay reported. */
  readonly head?: string;
  readonly reason?: string;
}

/** One `path → lines` claim parsed out of the note body. */
export interface NoteClaim {
  readonly path: string;
  /** `session` for `s_…::t_…` (the agent), `human` for `h_…`. */
  readonly actor: 'session' | 'human';
  /** Raw range text as the note wrote it, e.g. `1-3` or `2-3,5-13`. */
  readonly lines: string;
}

export interface NoteEvidence {
  /**
   * ALWAYS `refs/notes/ai`. `--ref=git-ai` prints nothing, and "no note" is the
   * TOTAL-LOSS SIGNATURE — so the wrong ref manufactures a false negative that
   * looks exactly like the failure the whole exercise is hunting.
   */
  readonly ref: string;
  readonly sha: string;
  readonly present: boolean;
  readonly claims: readonly NoteClaim[];
}

/** What the agent reported writing — written down BEFORE any note is read. */
export interface GroundTruth {
  readonly path: string;
  readonly lines: string;
}

export interface BinaryIdentity {
  readonly path: string;
  /**
   * A CONTENT STAMP, recorded at `--begin` and re-read at `--end`.
   *
   * CONTENT, NOT MTIME, for two reasons and the second is why it changed. A digest
   * asks "is this the same program?", which is the actual question; an mtime asks
   * "was this file touched?", which answers it only by luck. And there is no stat
   * capability on the verb context — reaching for one meant shelling out to a node
   * one-liner, which is a builtin import inside an extension and a constitution
   * violation the repo's own `windows-check` caught.
   */
  readonly stampBefore: string;
  readonly stampAfter: string;
}

export interface Evidence {
  readonly agent: string;
  readonly repo: string;
  readonly binary?: BinaryIdentity;
  readonly relays: readonly RelayEntry[];
  /** ABSENT when the operator never supplied one — which is itself a verdict. */
  readonly sandbox?: SandboxProbe;
  /** Journal entries within the run window only. */
  readonly journal: readonly JournalEntry[];
  readonly note?: NoteEvidence;
  readonly groundTruth?: readonly GroundTruth[];
}

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface Score {
  readonly verdict: Verdict;
  /** The single sentence that decided it. */
  readonly because: string;
  /** Everything that contributed, in the order it was checked. */
  readonly findings: readonly string[];
  /** What the operator should do next — always present, never empty. */
  readonly next_action: string;
}

/**
 * Distinct relays that could plausibly send a commit signal: channel 2, plus
 * unacknowledged strangers.
 *
 * DE-DUPLICATED BY {@link RelayEntry.identity}, because a relay installed correctly
 * appears at least twice — once on PRE and once on POST. Counting entries reports
 * every healthy machine as confounded.
 */
export function commitSignalRelays(relays: readonly RelayEntry[]): RelayEntry[] {
  const seen = new Set<string>();
  const out: RelayEntry[] = [];
  for (const relay of relays) {
    const possible =
      relay.channel === 'commit-signal' ||
      (relay.channel === 'unknown' && relay.acknowledged !== true);
    if (!possible) continue;
    const key = relay.identity ?? relay.command;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(relay);
  }
  return out;
}

/** The post entry that reported an emission, if any. */
export function emittedEntry(journal: readonly JournalEntry[]): JournalEntry | undefined {
  return journal.find((e) => e.kind === 'emitted' && e.phase === 'post');
}

/** `2-3,5-13,20` → {2,3,5,…,13,20}. Tolerant: unparsable pieces are ignored, never thrown on. */
export function expandRanges(text: string): Set<number> {
  const out = new Set<number>();
  for (const piece of text.split(',')) {
    const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(piece);
    if (range !== null) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) out.add(i);
      continue;
    }
    const single = /^\s*(\d+)\s*$/.exec(piece);
    if (single !== null) out.add(Number(single[1]));
  }
  return out;
}

/**
 * Does the note claim, as the AGENT's, every path and range the agent reported writing?
 *
 * IDENTITY, NOT COUNT (rule 3). Ranges are compared as normalised sets of line
 * numbers so `1-3` and `1,2,3` agree — the note's formatting is not the claim under
 * test.
 */
export function identityMatches(
  note: NoteEvidence,
  truth: readonly GroundTruth[],
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const expected of truth) {
    const claim = note.claims.find((c) => c.path === expected.path && c.actor === 'session');
    if (claim === undefined) {
      missing.push(`${expected.path}: no agent claim in the note`);
      continue;
    }
    const want = expandRanges(expected.lines);
    const got = expandRanges(claim.lines);
    const absent = [...want].filter((line) => !got.has(line));
    if (absent.length > 0) {
      missing.push(
        `${expected.path}: agent lines ${absent.join(',')} not claimed (note says ${claim.lines})`,
      );
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * THE VERDICT.
 *
 * ORDER IS THE DESIGN. Every INCONCLUSIVE gate runs BEFORE any PASS/FAIL check,
 * because a confounded run has no PASS or FAIL to give — asking "did the note
 * appear?" of a run with two relays produces an answer that means nothing, and
 * printing that answer is how a non-experiment gets recorded as a result.
 */
export function scoreRun(evidence: Evidence): Score {
  const findings: string[] = [];

  // ── INCONCLUSIVE gates, in precedence order ────────────────────────────────

  // 0. The binary under test must be the same program throughout. A config naming a
  //    development tree does not name a fixed artifact; it names whatever that tree
  //    last compiled, so a rebuild mid-run measures two programs.
  const binary = evidence.binary;
  if (binary !== undefined && binary.stampBefore !== binary.stampAfter) {
    return {
      verdict: 'INCONCLUSIVE',
      because: `the binary under test changed during the run (${binary.path}: ${binary.stampBefore} -> ${binary.stampAfter})`,
      findings: [...findings, 'the binary\'s contents changed between --begin and --end'],
      next_action:
        'Re-run without rebuilding. A run spanning a rebuild measures two different programs and neither result is attributable.',
    };
  }

  // 1. Exactly ONE relay may be able to send a commit signal, or the note cannot be
  //    attributed to any of them. Named, never removed — rule 1.
  const senders = commitSignalRelays(evidence.relays);
  findings.push(
    `relay census: ${senders.length} possible commit-signal relay(s) among ${evidence.relays.length} hook entr(ies)`,
  );
  if (senders.length > 1) {
    return {
      verdict: 'INCONCLUSIVE',
      because: `${senders.length} relays could have sent the commit signal, so the note cannot be attributed to any one of them`,
      findings: [
        ...findings,
        ...senders.map((r) => `  possible relay: ${r.source} — ${r.command}`),
      ],
      next_action:
        "Decide which relays to disable — that is your call, not this tool's, and it will never edit your agent config. Then RESTART the agent (a config file is not the running configuration) and re-run --begin.",
    };
  }
  if (senders.length === 0) {
    return {
      verdict: 'INCONCLUSIVE',
      because:
        'no relay capable of sending a commit signal was found, so there is nothing under test',
      findings,
      next_action:
        'Install the hook (`harness hooks install`), restart the agent, and re-run --begin.',
    };
  }

  // 2. THE PRECONDITION MUST BE MEASURED FOR *THIS* RUN. Not inferred from an
  //    earlier one — that inference is exactly how a provisional PASS gets stated as
  //    a result, and it is why this gate exists at all.
  const sandbox = evidence.sandbox;
  if (sandbox === undefined) {
    return {
      verdict: 'INCONCLUSIVE',
      because:
        'the shell-side sandbox probe was not supplied for this run, so the precondition is unmeasured',
      findings: [...findings, 'sandbox probe (SHELL context): ABSENT'],
      next_action:
        'Run the probe --begin emitted INSIDE the agent session and leave its output where --begin said. A precondition measured on an earlier run does not carry forward.',
    };
  }
  findings.push(
    `sandbox probe (SHELL context): control=${sandbox.control} trace2=${sandbox.trace2}${sandbox.sandboxEnv === undefined ? '' : ` sandbox=${sandbox.sandboxEnv}`}`,
  );
  if (sandbox.control !== 'refused' || sandbox.trace2 !== 'refused') {
    return {
      verdict: 'INCONCLUSIVE',
      because: `the agent's shell could reach the daemon (control=${sandbox.control}, trace2=${sandbox.trace2}), so git-ai's own channel was open and the relay was not required`,
      findings,
      next_action:
        'Engage the agent sandbox and re-run. This tool never changes your sandbox configuration. NOTE: a HOOK-side probe reporting OK is expected and is NOT this measurement.',
    };
  }

  // ── PASS / FAIL. Only reachable once the run is a valid experiment. ─────────

  if (evidence.journal.length === 0) {
    return {
      verdict: 'FAIL',
      because: 'our hook never ran — the journal has no entry in this run window',
      findings,
      next_action:
        'Check `harness hooks status --json` for `commandState` and `binaryState`, then confirm the agent invoked the hook at all.',
    };
  }

  const emitted = emittedEntry(evidence.journal);
  findings.push(
    emitted === undefined
      ? `our relay did NOT emit (${evidence.journal.length} journal entries in window)`
      : `our relay emitted for head ${emitted.head ?? '<unknown>'}`,
  );

  const note = evidence.note;
  const notePresent = note?.present === true;
  findings.push(
    notePresent
      ? `note present on ${note?.ref} for ${note?.sha}`
      : `NO note on ${note?.ref ?? 'refs/notes/ai'} — the total-loss signature`,
  );

  if (emitted === undefined) {
    return {
      verdict: 'FAIL',
      because: notePresent
        ? 'a note exists but our relay never emitted, so something else produced it'
        : 'our relay did not emit and no note appeared',
      findings,
      next_action:
        'Read the reason on the post journal entry — it is the diagnosis. `silent`/`head-unchanged` means the guard saw no new commit.',
    };
  }

  if (!notePresent) {
    return {
      verdict: 'FAIL',
      because: 'we emitted and the daemon wrote nothing — the most informative failure',
      findings,
      next_action:
        'Run `git-ai await` and re-read before concluding; if still absent, keep everything exactly as it is. This state is what distinguishes a relay problem from a daemon problem.',
    };
  }

  if (note !== undefined && evidence.groundTruth !== undefined) {
    const identity = identityMatches(note, evidence.groundTruth);
    findings.push(
      identity.ok
        ? 'note identity matches ground truth on every agent-authored path and range'
        : `note identity MISMATCH: ${identity.missing.join('; ')}`,
    );
    if (!identity.ok) {
      return {
        verdict: 'FAIL',
        because: 'a note appeared but it does not attribute the lines the agent reported writing',
        findings,
        next_action:
          "Compare the note body against the ground truth you wrote down BEFORE reading it. Deciding afterwards which lines were \"really the agent's\" is how a wrong result reads as a right one.",
      };
    }
  } else {
    findings.push(
      'no ground truth supplied — the note was scored on PRESENCE only, which is a weaker claim than identity',
    );
  }

  return {
    verdict: 'PASS',
    because:
      'the shell was sandboxed, exactly one relay could signal the commit, that relay emitted, and the note landed with the expected identity',
    findings,
    next_action:
      "Record the run. Note the limit: this proves capture survived for THIS agent on THIS machine — it does not generalise to another agent's sandbox without re-running.",
  };
}

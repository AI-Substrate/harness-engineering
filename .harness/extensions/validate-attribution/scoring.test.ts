import { describe, expect, it } from 'vitest';
import { RUN_09, RUN_10, RUN_10_WITHOUT_PROBE } from './fixtures.js';
import { type Evidence, expandRanges, scoreRun } from './scoring.js';

/**
 * THE CONTROLS FIRST. Everything else in this file is secondary to the two rows
 * below: a verb that cannot tell run 9 from run 10 is worthless, because they
 * differ in exactly one material way and agree on everything else.
 */
describe('the two real control runs, scored from their recorded evidence', () => {
  it('RUN 9 is INCONCLUSIVE — two relays could have sent the commit signal', () => {
    /*
    Test Doc:
    - Why: run 9 produced a real, correct note, and a scorer that asks "did a good
      note appear?" calls that a PASS. It was confounded: the POC's channel-2 relay
      fired for the same commit one second before ours. Either could have caused it.
    - Contract: INCONCLUSIVE, and the reason NAMES the competing relays rather than
      reporting a count — the operator has to know WHICH ones to decide about.
    - Quality Contribution: this is the negative control. It is the more important
      of the two, because the failure it guards against is silent.
    */
    const score = scoreRun(RUN_09);

    expect(score.verdict).toBe('INCONCLUSIVE');
    expect(score.because).toContain('2 relays');
    // Named, not counted — and specifically the POC relay, by its command.
    expect(score.findings.join('\n')).toContain('harness-commit-hook.mjs');
    expect(score.findings.join('\n')).toContain('hooks fire cursor');
    // And it must never suggest editing the user's config for them.
    expect(score.next_action).toContain('your call');
    expect(score.next_action).toContain('never edit');
  });

  it('RUN 10 is a PASS — four legs, all measured, none inferred', () => {
    /*
    Test Doc:
    - Why: the positive control. Run 10 differs from run 9 in exactly one material
      variable — the number of channel-2 relays — which is what makes the pair a
      control pair rather than two runs that happened to disagree.
    - Contract: PASS, on the strength of all four legs: sandbox engaged in the shell
      where the commit ran, one commit-signal relay, our emission, and a note whose
      identity matches the ground truth.
    */
    const score = scoreRun(RUN_10);

    expect(score.verdict).toBe('PASS');
    expect(score.because).toContain('exactly one relay');
    expect(score.findings.join('\n')).toContain('note identity matches ground truth');
    expect(score.findings.join('\n')).toContain('control=refused trace2=refused');
    // The PASS must state its own limit rather than reading as a general result.
    expect(score.next_action).toContain('does not generalise');
  });

  it('strip run 10 of its shell-side probe and the PASS falls to INCONCLUSIVE', () => {
    /*
    Test Doc:
    - Why: THE INCIDENT BEHIND THE GATE. Run 10's PASS was provisional for twenty
      minutes because the sandbox condition was measured once, in run 9, and carried
      forward — not a wrong measurement, an un-repeated one. This row is that
      twenty minutes, pinned: with everything else identical and only the
      precondition missing, the verdict is not available.
    - Contract: INCONCLUSIVE, and the message must say the precondition does not
      carry forward from an earlier run.
    - Quality Contribution: proves the sandbox gate is load-bearing rather than
      decorative — it is the only difference between these two evidence sets.
    */
    const score = scoreRun(RUN_10_WITHOUT_PROBE);

    expect(score.verdict).toBe('INCONCLUSIVE');
    expect(score.because).toContain('unmeasured');
    expect(score.findings.join('\n')).toContain('sandbox probe (SHELL context): ABSENT');
    expect(score.next_action).toContain('does not carry forward');

    // Identical evidence apart from that one leg.
    const { sandbox: _only, ...rest } = RUN_10;
    expect(rest).toEqual(RUN_10_WITHOUT_PROBE);
  });

  it('the discriminator is the RELAY CENSUS: give run 9 one relay and it passes too', () => {
    /*
    Test Doc:
    - Why: proves the two controls are separated by the census and NOT by some
      incidental difference in their notes, journals or shas. Without this row, the
      pair could be passing for a reason nobody has identified.
    - Contract: run 9's own evidence, with the POC relay dropped, scores PASS.
    - Quality Contribution: turns "these two runs differ in one way" from a claim in
      a doc comment into a measurement.
    */
    const withoutPoc: Evidence = {
      ...RUN_09,
      relays: RUN_09.relays.filter((r) => !r.command.includes('harness-commit-hook.mjs')),
    };

    expect(scoreRun(withoutPoc).verdict).toBe('PASS');
    // And the converse: give run 10 a second relay and it stops being a result.
    const withPoc: Evidence = {
      ...RUN_10,
      relays: [...RUN_10.relays, RUN_09.relays[1]],
    };
    expect(scoreRun(withPoc).verdict).toBe('INCONCLUSIVE');
  });
});

describe('the channel distinction — the conflation that nearly voided both controls', () => {
  it('a `git-ai checkpoint` entry does NOT confound a run, however many there are', () => {
    /*
    Test Doc:
    - Why: channel 1 records what the agent wrote and cannot produce a note on its
      own; channel 2 tells the daemon a commit happened. Treating a checkpoint entry
      as a competing relay would score every correctly configured machine
      INCONCLUSIVE — attribution NEEDS channel 1.
    - Contract: extra checkpoint entries change nothing.
    */
    const manyCheckpoints: Evidence = {
      ...RUN_10,
      relays: [
        ...RUN_10.relays,
        {
          source: '~/.claude/settings.json PreToolUse[0]',
          command: 'git-ai checkpoint claude --hook-input stdin',
          channel: 'checkpoint',
          ours: false,
          acknowledged: true,
        },
      ],
    };
    expect(scoreRun(manyCheckpoints).verdict).toBe('PASS');
  });

  it('an UNKNOWN command is treated as a possible commit signal until acknowledged', () => {
    /*
    Test Doc:
    - Why: we cannot know what a stranger's script does by reading its command line.
      Guessing "probably harmless" is the guess that certifies a bad run, so the
      safe assumption is that it might be a relay.
    - Contract: an unacknowledged unknown confounds; acknowledging it — an explicit
      operator declaration, recorded in the evidence — clears it.
    - Quality Contribution: pins that the acknowledgement is the ONLY thing that
      changes the answer, so the human's declaration cannot be inferred by the tool.
    */
    const stranger = {
      source: '~/.cursor/hooks.json preToolUse[9]',
      command: 'node /opt/somebody-elses/tool.js --pre',
      channel: 'unknown' as const,
      ours: false,
    };

    const unacknowledged: Evidence = {
      ...RUN_10,
      relays: [...RUN_10.relays, stranger],
    };
    const score = scoreRun(unacknowledged);
    expect(score.verdict).toBe('INCONCLUSIVE');
    expect(score.findings.join('\n')).toContain('somebody-elses/tool.js');

    const acknowledged: Evidence = {
      ...RUN_10,
      relays: [...RUN_10.relays, { ...stranger, acknowledged: true }],
    };
    expect(scoreRun(acknowledged).verdict).toBe('PASS');
  });
});

describe('the INCONCLUSIVE gates run BEFORE any PASS/FAIL check', () => {
  it('a confounded run is INCONCLUSIVE even when the note is perfect', () => {
    // RUN_09 already has a perfect note and correct identity. Order is the design:
    // asking "did the note appear?" of a confounded run yields a meaningless answer.
    expect(scoreRun(RUN_09).verdict).toBe('INCONCLUSIVE');
    expect(RUN_09.note?.present).toBe(true);
  });

  it('a shell that CONNECTED is INCONCLUSIVE, not a PASS — git-ai needed no relay', () => {
    const open: Evidence = {
      ...RUN_10,
      sandbox: { context: 'shell', control: 'connected', trace2: 'connected', sandboxEnv: 'unset' },
    };
    const score = scoreRun(open);
    expect(score.verdict).toBe('INCONCLUSIVE');
    expect(score.because).toContain('could reach the daemon');
    // And it must warn about the inversion that has actually been made by a reader.
    expect(score.next_action).toContain('HOOK-side probe reporting OK');
  });

  it('a binary whose CONTENTS changed mid-run is INCONCLUSIVE — two programs were measured', () => {
    /*
    Test Doc:
    - Why: measured on this machine. A hook config naming a development tree does not
      name a fixed artifact; a `just build` during a run silently changes the program
      the agent executes. It happened, and it moved an install from broken to working
      with nobody aware.
    - Contract: mtime moving between --begin and --end voids the run BEFORE anything
      else is considered.
    */
    const rebuilt: Evidence = {
      ...RUN_10,
      binary: {
        path: '…/harness/cli/dist/index.js',
        stampBefore: '1200:1a2b3c4d',
        stampAfter: '1310:9f8e7d6c',
      },
    };
    const score = scoreRun(rebuilt);
    expect(score.verdict).toBe('INCONCLUSIVE');
    expect(score.because).toContain('changed during the run');
  });

  it('an unchanged binary does not disturb the verdict', () => {
    const stable: Evidence = {
      ...RUN_10,
      binary: {
        path: '…/harness/cli/dist/index.js',
        stampBefore: '1200:1a2b3c4d',
        stampAfter: '1200:1a2b3c4d',
      },
    };
    expect(scoreRun(stable).verdict).toBe('PASS');
  });

  it('no relay at all is INCONCLUSIVE — there is nothing under test', () => {
    const none: Evidence = { ...RUN_10, relays: [] };
    expect(scoreRun(none).verdict).toBe('INCONCLUSIVE');
    expect(scoreRun(none).because).toContain('nothing under test');
  });
});

describe('PASS and FAIL, once the run is a valid experiment', () => {
  it('emitted + no note is a FAIL, and is named the most informative failure', () => {
    const lost: Evidence = {
      ...RUN_10,
      note: { ref: 'refs/notes/ai', sha: RUN_10.note?.sha ?? '', present: false, claims: [] },
    };
    const score = scoreRun(lost);
    expect(score.verdict).toBe('FAIL');
    expect(score.because).toContain('the daemon wrote nothing');
    // `git-ai await` first: a race with the daemon reads as a total loss.
    expect(score.next_action).toContain('git-ai await');
  });

  it('an empty journal is a FAIL that says our hook never ran', () => {
    const never: Evidence = { ...RUN_10, journal: [] };
    const score = scoreRun(never);
    expect(score.verdict).toBe('FAIL');
    expect(score.because).toContain('never ran');
    expect(score.next_action).toContain('commandState');
  });

  it('silent-only + no note is a FAIL pointing at the journal reason', () => {
    const silent: Evidence = {
      ...RUN_10,
      journal: [
        { at: '…', phase: 'pre', kind: 'recorded' },
        { at: '…', phase: 'post', kind: 'silent', reason: 'head-unchanged' },
      ],
      note: { ref: 'refs/notes/ai', sha: 'x', present: false, claims: [] },
    };
    const score = scoreRun(silent);
    expect(score.verdict).toBe('FAIL');
    expect(score.next_action).toContain('head-unchanged');
  });

  it('a note present WITHOUT our emission is a FAIL — something else produced it', () => {
    const notOurs: Evidence = {
      ...RUN_10,
      journal: [{ at: '…', phase: 'post', kind: 'silent', reason: 'head-unchanged' }],
    };
    const score = scoreRun(notOurs);
    expect(score.verdict).toBe('FAIL');
    expect(score.because).toContain('something else produced it');
  });

  it('SCORES ON IDENTITY, NOT COUNT: a note that claims the wrong lines FAILS', () => {
    /*
    Test Doc:
    - Why: rule 3. A note count moves for unrelated reasons, and a run scored on
      "a note exists" would certify on somebody else's note or on a note that
      attributed the human's lines to the agent.
    - Contract: the note is present and well-formed, but omits a line the agent
      reported writing. That is a FAIL, and the message says which line.
    */
    const wrongLines: Evidence = {
      ...RUN_10,
      note: {
        ref: 'refs/notes/ai',
        sha: '5ac3eaaacf78142dd05bdbec66338d32253e0805',
        present: true,
        claims: [
          { path: 'AI7.md', actor: 'session', lines: '1-2' },
          { path: 'seed.mjs', actor: 'session', lines: '8' },
        ],
      },
    };
    const score = scoreRun(wrongLines);
    expect(score.verdict).toBe('FAIL');
    expect(score.findings.join('\n')).toContain('AI7.md: agent lines 3 not claimed');
  });

  it("a line claimed for the HUMAN does not satisfy the agent's ground truth", () => {
    /*
    Test Doc:
    - Why: the actor kind is the whole point of the note. If `h_` claims satisfied an
      agent expectation, a run in which attribution got the direction exactly
      backwards would score PASS.
    */
    const wrongActor: Evidence = {
      ...RUN_10,
      note: {
        ref: 'refs/notes/ai',
        sha: '5ac3eaaacf78142dd05bdbec66338d32253e0805',
        present: true,
        claims: [
          { path: 'AI7.md', actor: 'human', lines: '1-3' },
          { path: 'seed.mjs', actor: 'session', lines: '8' },
        ],
      },
    };
    const score = scoreRun(wrongActor);
    expect(score.verdict).toBe('FAIL');
    expect(score.findings.join('\n')).toContain('AI7.md: no agent claim');
  });

  it('without ground truth the PASS is explicitly weaker, and says so', () => {
    const { groundTruth: _dropped, ...noTruth } = RUN_10;
    const score = scoreRun(noTruth);
    expect(score.verdict).toBe('PASS');
    expect(score.findings.join('\n')).toContain('PRESENCE only');
  });
});

describe('range comparison is about line numbers, not formatting', () => {
  it.each([
    ['1-3', [1, 2, 3]],
    ['2-3,5-7', [2, 3, 5, 6, 7]],
    ['7', [7]],
    ['4,9-10', [4, 9, 10]],
    ['3-1', [1, 2, 3]],
  ])('expands %s', (text, expected) => {
    expect([...expandRanges(text)].sort((a, b) => a - b)).toEqual(expected);
  });

  it('ignores junk rather than throwing — a note we cannot parse must not crash scoring', () => {
    expect([...expandRanges('1-2,,garbage,5')].sort((a, b) => a - b)).toEqual([1, 2, 5]);
  });
});

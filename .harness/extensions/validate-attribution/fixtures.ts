import type { Evidence } from './scoring.js';

/**
 * THE TWO CONTROL RUNS, AS RECORDED EVIDENCE (plan 082 phase 4).
 *
 * These are not invented fixtures. Every field was read off the machine that ran
 * them on 2026-08-10, and the provenance of each is named beside it, because a
 * control whose origin nobody can check is just an assertion with extra steps.
 *
 * WHY THESE TWO. They differ in EXACTLY ONE material way — the number of relays
 * that could have sent the commit signal — and they are otherwise as similar as two
 * runs get: same repo, same agent, same session id, same shape of note, three
 * minutes apart. That makes them the sharpest available test of the one thing the
 * verb must do: **tell a confounded run from a clean one.** A scorer that cannot
 * separate these is worthless no matter what it prints.
 *
 * A NOTE ON HOW THIS PAIR WAS ALMOST GOT WRONG, because it is the reason the
 * `channel` field exists at all. On first reading, the author of this file
 * concluded that BOTH runs were confounded, on the evidence that `git-ai checkpoint`
 * demonstrably ran during both. It did — and it is CHANNEL 1. It records what the
 * agent wrote; it cannot produce a note on its own. The relay that was removed
 * between the runs was `harness-commit-hook.mjs`, which sends synthetic commit
 * events — channel 2. Proving "a relay ran" is not proving "a commit signal was
 * sent", and the two are one grep apart.
 */

/**
 * RUN 9 — commit `1cbdf0de`, 2026-08-10 07:37:56–07:38:11 local.
 *
 * CONFOUNDED. The POC's own relay fired for the same commit ONE SECOND before ours:
 *
 *   07:38:10  ~/.harness/commit-hook-state.json -> {"…/attrib-probe": "1cbdf0de…"}
 *   07:38:11  ~/.harness/hooks/fires.jsonl      -> {"kind":"emitted","head":"1cbdf0de…"}
 *
 * The note is real and correct. Either relay could have caused it, and nothing in
 * the note distinguishes them. That is the definition of INCONCLUSIVE, and it is
 * the verdict a tool that scores on "did a good note appear?" would have missed.
 */
export const RUN_09: Evidence = {
  agent: 'cursor',
  repo: '/Users/jordanknight/temp/attrib-probe',
  relays: [
    {
      // ~/.cursor/hooks.json, still present today at preToolUse[0].
      source: '~/.cursor/hooks.json preToolUse[0]',
      // A verbatim command recorded off a macOS machine: EVIDENCE, not a path this
      // code ever opens. Preserved byte-for-byte because a control run whose inputs
      // were tidied is not the run that happened.
      command:
        'python3 …/attrib-probe/hook-probe.py PRE >/dev/null 2>&1; tee -a /tmp/cursor-hook-pre.jsonl | …/git-ai checkpoint cursor --hook-input stdin', // win-ok: recorded evidence, never opened
      channel: 'checkpoint',
      ours: false,
      // The operator kept this deliberately: attribution NEEDS channel 1.
      acknowledged: true,
    },
    {
      // REMOVED from the config at 07:40:48, between the two runs. Its state file
      // ~/.harness/commit-hook-state.json is frozen at 07:38:10 carrying run 9's
      // head — written on PRE, so had it run in run 10 the stamp would have moved.
      source: '~/.cursor/hooks.json preToolUse[1] (run 9 only)',
      command: 'node …/attrib-probe/harness-commit-hook.mjs pre',
      channel: 'commit-signal',
      ours: false,
    },
    {
      source: '~/.cursor/hooks.json preToolUse[2]',
      command:
        '"…/s077-suite-portability/harness/cli/bin/harness.js" hooks fire cursor --phase pre --hook-input stdin --hook-owner ai-substrate-harness-hook-v1',
      channel: 'commit-signal',
      ours: true,
    },
  ],
  // Jordan pasted this for run 9. `seatbelt`, both sockets refused — the sandbox
  // WAS engaged in the context that matters, the one the commit runs in.
  sandbox: { context: 'shell', control: 'refused', trace2: 'refused', sandboxEnv: 'seatbelt' },
  // ~/.harness/hooks/fires.jsonl, entries between 21:37:56Z and 21:38:11Z.
  journal: [
    { at: '2026-08-09T21:37:56.517Z', phase: 'pre', kind: 'recorded' },
    { at: '2026-08-09T21:37:57.808Z', phase: 'post', kind: 'silent', reason: 'head-unchanged' },
    { at: '2026-08-09T21:38:08.946Z', phase: 'pre', kind: 'recorded' },
    {
      at: '2026-08-09T21:38:11.051Z',
      phase: 'post',
      kind: 'emitted',
      head: '1cbdf0de871e06f3f297faf0fc82e6f25a11af24',
    },
  ],
  // `git notes --ref=ai show 1cbdf0de…` in the probe repo.
  note: {
    ref: 'refs/notes/ai',
    sha: '1cbdf0de871e06f3f297faf0fc82e6f25a11af24',
    present: true,
    claims: [
      { path: 'AI6.md', actor: 'session', lines: '1-3' },
      { path: 'seed.mjs', actor: 'session', lines: '7' },
      { path: 'jordan6.md', actor: 'human', lines: '1-9' },
      { path: 'AI3.md', actor: 'human', lines: '4-10' },
    ],
  },
  groundTruth: [
    { path: 'AI6.md', lines: '1-3' },
    { path: 'seed.mjs', lines: '7' },
  ],
};

/**
 * RUN 10 — commit `5ac3eaa`, 2026-08-10 07:41:43–07:41:55 local. **PASS.**
 *
 * FOUR LEGS, ALL MEASURED, NONE INFERRED:
 *
 * 1. the sandbox was engaged in the shell where the commit ran — `CURSOR_SANDBOX
 *    seatbelt`, `connect()` REFUSED (`PermissionError` errno 1) on BOTH sockets,
 *    pasted from `DURING-COMMIT-RUN-E` **for this run**;
 * 2. exactly one channel-2 relay was installed — the POC was removed beforehand and
 *    its state file is still frozen at 07:38:10; it writes on PRE, so it cannot have
 *    run;
 * 3. our hook emitted for head `5ac3eaa`;
 * 4. the note anchors `AI7.md` 1-3 and `seed.mjs`:8 to the agent session, and
 *    `jordan7.md` to the human.
 *
 * A sandboxed commit could not reach the daemon, nothing else could send the commit
 * signal, we sent it, and the note exists.
 *
 * WHY THIS VERDICT WAS PROVISIONAL FOR TWENTY MINUTES, and it is the incident behind
 * the precondition gate rather than a principle: the sandbox condition was measured
 * ONCE, in run 9, and carried forward. Not a wrong measurement — an UN-REPEATED one.
 * That is why `--begin` obtains the shell-side probe for THIS run and refuses to
 * certify without it. The gate has a real incident behind it, and it is not a
 * hypothetical one.
 */
export const RUN_10: Evidence = {
  agent: 'cursor',
  repo: '/Users/jordanknight/temp/attrib-probe',
  relays: [
    {
      source: '~/.cursor/hooks.json preToolUse[0]',
      // A verbatim command recorded off a macOS machine: EVIDENCE, not a path this
      // code ever opens. Preserved byte-for-byte because a control run whose inputs
      // were tidied is not the run that happened.
      command:
        'python3 …/attrib-probe/hook-probe.py PRE >/dev/null 2>&1; tee -a /tmp/cursor-hook-pre.jsonl | …/git-ai checkpoint cursor --hook-input stdin', // win-ok: recorded evidence, never opened
      channel: 'checkpoint',
      ours: false,
      acknowledged: true,
    },
    {
      source: '~/.cursor/hooks.json preToolUse[1]',
      command:
        '"…/s077-suite-portability/harness/cli/bin/harness.js" hooks fire cursor --phase pre --hook-input stdin --hook-owner ai-substrate-harness-hook-v1',
      channel: 'commit-signal',
      ours: true,
    },
  ],
  // DURING-COMMIT-RUN-E, pasted for RUN 10 — measured, not carried across from run 9.
  sandbox: { context: 'shell', control: 'refused', trace2: 'refused', sandboxEnv: 'seatbelt' },
  journal: [
    { at: '2026-08-09T21:41:43.527Z', phase: 'pre', kind: 'recorded' },
    { at: '2026-08-09T21:41:44.002Z', phase: 'post', kind: 'silent', reason: 'head-unchanged' },
    { at: '2026-08-09T21:41:54.568Z', phase: 'pre', kind: 'recorded' },
    {
      at: '2026-08-09T21:41:55.233Z',
      phase: 'post',
      kind: 'emitted',
      head: '5ac3eaaacf78142dd05bdbec66338d32253e0805',
    },
  ],
  note: {
    ref: 'refs/notes/ai',
    sha: '5ac3eaaacf78142dd05bdbec66338d32253e0805',
    present: true,
    claims: [
      { path: 'AI7.md', actor: 'session', lines: '1-3' },
      { path: 'seed.mjs', actor: 'session', lines: '8' },
      { path: 'jordan7.md', actor: 'human', lines: '1-8' },
      { path: 'AI2.md', actor: 'human', lines: '4-11' },
    ],
  },
  groundTruth: [
    { path: 'AI7.md', lines: '1-3' },
    { path: 'seed.mjs', lines: '8' },
  ],
};

/**
 * RUN 10 WITH THE PRECONDITION REMOVED — a DERIVED fixture, not a record.
 *
 * It exists to pin the gate that the real run 10 satisfies: strip the shell-side
 * probe and the verdict must fall to INCONCLUSIVE, however clean everything else is.
 *
 * NAMED FOR WHAT IT IS. For twenty minutes this was the honest record of run 10 and
 * `RUN_10` carried no sandbox leg. The probe has since landed, so keeping a constant
 * that implied otherwise would be a fixture asserting something the machine no
 * longer says.
 */
export const RUN_10_WITHOUT_PROBE: Evidence = (() => {
  const { sandbox: _unmeasured, ...rest } = RUN_10;
  return rest;
})();

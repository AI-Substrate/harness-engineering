---
record_kind: "retro"
harness_version: "0.13.0"
branch: "s065/deterministic-documents"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-08-04T03:38:50.743Z"
agent: agent
plan_id: 065-deterministic-documents
schema_version: "1.2"
retro_id: "2026-08-04T03:40:00Z-agent-p7dd065"
started_at: "2026-08-03T20:30:00Z"
ended_at: "2026-08-04T03:40:00Z"
summary: "Post-ship stream on an already-shipped PR: Jordan's taste call returned WITH CHANGES, which grew into 10 further commits — render fixes (checkbox marks, three-tier section titles with the address pinned to an explicit anchor, array-of-link cells), a self-contained custom-adapter corpus, docs/how/dd (README + 10 chapters + promoted exemplar + runnable justfile), and Phase 7's dd graph map through four review rounds. PR #87 merged to main at d537ad33. The through-line of the whole stream is one failure class in six disguises: proof that shares a blind spot with the thing it proves — escape bytes as columns, characters as columns, a shared oracle, an unrepresentative anchor, a cumulative file list, and a rule the author had written down and still did not follow."
entries:
  - id: DL-010
    kind: difficulty
    description: "FENCE COST, not a scope decision — an instance of the EXPIRY-OWNERSHIP GAP class, whose specific defect was the PRIME'S and whose specific cost was borne by s065. FU-4 (repoRoot from process.cwd) shipped documented-rather-than-fixed because a stand-off gated me off acts/dd/build.ts and shared.ts — files on my own branch, in my own worktree, carrying a defect I had already diagnosed with a repro and a fix shape. The stand-off was RIGHT WHEN ISSUED (araminta was live and about to take FU-4; two writers in one path is the worse failure). The defect is that nothing expired it when its cause died: araminta was closed, FU-4 went unowned, and the fence stayed up by inertia because lifting it required an action nobody was prompted to take. Class in the header for comparability, owner in the body for accountability — a finding filed only under a general class stops being anyone's specific debt."
    target: infra
    severity: degrading
    workaround: "held the fence and shipped the defect documented rather than freelancing across it"
    suggested_encoding: "every durable constraint states its cause AND its expiry condition in the same breath; mechanism: closing a seat retires the fences that named it"
    fp: "6163e0b34e8d"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T03:25:11.572Z"
  - id: DL-012
    kind: difficulty
    description: "KNOWING THE RULE IS NOT A CONTROL — the load-bearing evidence for the whole expiry-ownership finding, because it is the only instance that rules out 'they did not know'. The seat that NAMED the class was carrying an instance of it while naming it: my parked badge contradicted my card for 300 minutes and its cause was already half dead. Worse, I had AUTHORED a personal memory note on this exact defect after being caught by it once before, and it did not fire. Diligence was tested against its own best case and lost. Only two shapes work: the state expires itself, or it is cleared by the same operation that resolves its cause. Anything else is a reminder wearing a control's clothes."
    target: tooling
    severity: degrading
    workaround: "pij report clear, prompted by the prime's PA after three sweeps"
    suggested_encoding: "pij report now should clear or refuse to contradict a parked badge; a badge must not be able to outlive its cause silently"
    fp: "dccbb2804713"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T03:31:42.287Z"
  - id: DL-008
    kind: difficulty
    description: "THE SELF-DEFEATING PROBE, sixth through eleventh occurrence in this plan, now unified as one class: PROOF THAT SHARES A BLIND SPOT WITH THE THING IT PROVES. Six distinct disguises in one stream — (1) a coverage claim from a suite that did not move under a real behaviour change; (2) a declared-shape test that address INFERENCE was silently satisfying, so deleting the shape left it green; (3) a width oracle measuring the STYLED string, counting escape bytes as columns; (4) a shared cell-width helper used by BOTH renderer and oracle, so reverting it left all 57 assertions green — a shared oracle proves two things AGREE, never that either is RIGHT; (5) an anchor sampling one Unicode block to validate a table spanning ten; (6) a cumulative PR file list answering 'ever changed on this branch' when the question was 'touched during the window'. The fix is identical every time: make the evidence come from somewhere the thing being proved cannot reach."
    target: skill
    severity: degrading
    workaround: "mutation sweeps every round; 16/16 red by the final renderer round"
    suggested_encoding: "review doctrine + lint heuristic; merge into probe-must-see-the-opposite; add 'does this evidence share a source with its claim?' to the reviewer checklist"
    fp: "b4c6516e978f"
    disposition: plan
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-08-03T23:08:56.266Z"
  - id: DL-009
    kind: difficulty
    description: "exec-remote-telemetry-git.int.test.ts ROOT-CAUSED, and it is not what the P6 retro said. Two independent non-hermetic patterns, both in that one file: (1) it snapshots the LIVE repo — rev-parse HEAD, write-tree, status --porcelain at process.cwd() — and asserts they are unchanged at the end (lines 1212-1214/1315-1317 and 1839-1840/1868-1869), so ANY concurrent git activity in the tree fails it, which is exactly what a PM committing and two peers working produce; (2) readdirSync(tmpdir()) enumerating the shared OS temp dir by prefix, the original DL-002 hazard. Pattern (1) explains variance in supposedly ISOLATED runs (1/4/0 failures across three identical zero-change runs) that concurrency alone cannot. It cost four false-alarm detours in this stream. DO NOT let the fix delete the assertion — proving the CLI does not corrupt the caller's repo is a good guarantee; the defect is the SUBJECT, and it must assert against a fixture repo it created, not the developer's live tree. NOT diagnosed: publication-boundary and git-read have neither pattern and failed once alongside it — observed co-occurrence, not established shared cause."
    target: tooling
    severity: degrading
    workaround: "re-run and re-verify in isolation, four times"
    suggested_encoding: "snapshot a fixture repo, not process.cwd(); scope tmpdir enumeration to a per-run root"
    fp: "8d741743b82c"
    disposition: plan
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-08-03T23:23:07.706Z"
  - id: DL-002
    kind: difficulty
    description: "FU-4, the cwd-anchoring class in its FOURTH home (after P2 fixtures, P3/P4 CLI tests, P6 flow-gate resolution): dd build and createLinkContext take repoRoot from process.cwd(), so the documented <gitroot>/.dd precedence root silently means cwd/.dd. The sharpest repro is that the SAME UNMODIFIED DOCUMENT returns three verdicts by working directory alone — ok from the repo root, degraded with 5 path-escape warnings from its own folder, E401 from its parent. That exercises both halves: the resolution root AND the containment boundary (isWithin/isPathWithinRepo/path-escape/doctor scope), which is why it is a security-relevant change and not a one-line fix. The three-row table is its acceptance test; exemplar/custom-render is deliberately left REPRODUCING it, because a fixture that has been quietened cannot prove a fix."
    target: project
    severity: degrading
    workaround: "run every dd command from the repository root; the docs/how/dd justfile bakes the cd in"
    suggested_encoding: "reuse P6's docRepoRoot(.git-walking, handles a worktree .git FILE); share one derivation between build.ts and createLinkContext"
    fp: "dd24391fe346"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-03T21:22:13.371Z"
  - id: DL-003
    kind: difficulty
    description: "A GREEN SUITE THAT DOES NOT MOVE UNDER A BEHAVIOUR CHANGE IS A COVERAGE FINDING, not a clean bill of health. Fixing array-of-link cells to render as links changed real output and left the dd suite at 265/265 — because no fixture exercised an array-of-links at all. The silence was the signal, and it is only readable if you notice the suite SHOULD have moved."
    target: skill
    severity: degrading
    workaround: "added the regression test the fix should have broken"
    suggested_encoding: "after any behaviour change, ask what test SHOULD have failed; if none did, that is the finding"
    fp: "24f76efab4bd"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-03T21:22:15.338Z"
  - id: DL-006
    kind: difficulty
    description: "just lint-md silently omits UNTRACKED authored docs — twelve new markdown files landed and the gate reported the same baseline, having never examined them. A lint gate that cannot see new files reports green loudest exactly when the content is newest. NOTE, and this is the more useful half: my first report of this claimed the docs were 'never examined', which was FALSE once they were tracked (examined went 109 -> 121, count unchanged because they were clean). The real defect is subtler — an unchanged COUNT cannot distinguish 'new content is clean' from 'new content was not looked at', and the discriminator is the DENOMINATOR, which sits in the JSON and is absent from the number everyone quotes."
    target: tooling
    severity: annoying
    workaround: "direct path-aware markdownlint/remark runs over the new files"
    suggested_encoding: "quote lint fully qualified — '197 markdownlint over 121 files examined; 199 total across three checks' — never the bare number; make the gate print its denominator"
    fp: "1ce388af65d5"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-03T22:17:07.775Z"
  - id: CONF-004
    kind: confusion
    description: "STATE THE WINDOW when claiming a file is untouched. I wrote 'untouched by me throughout'; build.ts carries my own P1 and P3 commits, so the literal claim was false while the meaningful one — untouched across 64ea294c..599b241c — was true. The prime's first probe grepped the PR's CUMULATIVE file list, found the file, and was one step from reporting my fence claim FALSE: a cumulative list answers 'ever changed on this branch', not 'touched during the stand-off'. Two different questions that both return a file list, so one substitutes for the other silently. A range-scoped claim cannot drift into the wrong question by accident; an unscoped one invites it."
    target: project
    fp: "32546ac64bf3"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T03:25:14.643Z"
  - id: DL-007
    kind: difficulty
    description: "The P4 links layer explained its EDGES well but had no way to turn an address interior into the location an edge carries, or back. That single missing pairing is WHY dd links answers about a whole document when handed a row address — it accepted an address it could not honour. A graph library that cannot map its own address space onto its own edge locations cannot answer an item-level question, and the gap is invisible until someone asks one."
    target: project
    severity: degrading
    workaround: "built indexDocument — one walk pairing every addressable interior with its location, both directions from one source"
    suggested_encoding: "landed in P7 (services/dd/links/map.ts)"
    fp: "c5a9737579f3"
    disposition: fixed-now
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-08-03T23:08:36.703Z"
  - id: DL-005
    kind: difficulty
    description: "dd doctor sweeps gitignored directories, so a peer's throwaway probe under scratch/ flipped the repo-wide doctor gate from ok 0/0 to degraded 0/1 locally while CI stayed clean. A local-only gate discrepancy is worse than a shared one: it gets diagnosed twice, and the second person has no reason to suspect the tree."
    target: tooling
    severity: annoying
    workaround: "removed the probe directory"
    suggested_encoding: "honour .gitignore in the sweep, or extend SCAN_SKIP_DIRS the way node_modules/.git/dist/coverage already are"
    fp: "48c7bca0aa9d"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-03T22:06:23.280Z"
  - id: CONF-002
    kind: confusion
    description: "dd graph map: a seed address missing its '#' reports 'address target is missing: <path>' — literally true and completely unhelpful, because the cause is a forgotten file/interior boundary, and next_action sends the reader to dd links <target>, which fails identically. A path ending in '.dd.json/<something>' is almost always a missing '#'. I hit this myself during the exemplar move, an hour after the coder proposed fixing it."
    target: project
    fp: "bd8c2971c319"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-03T23:08:19.796Z"
  - id: MW-001
    kind: magic-wand
    description: "An ARCHITECTURE CONSTRAINT TURNED OUT TO BE A FEATURE. services/dd/links/** may not import output/ (arch-enforced), so the human renderer takes an INJECTED palette and the act composes the ANSI. That could have been a tax; instead it produced exactly one render path, so the plain golden and the coloured run are the same bytes modulo palette, and --json structurally CANNOT acquire an escape byte — 'not one escape byte' became a property of the shape rather than a rule someone polices. Worth stating as the pattern for the next dd surface that wants colour."
    target: project
    fp: "e4b1081d1752"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-03T23:08:42.517Z"
  - id: WIN-001
    kind: win
    description: "THE CODER CAUGHT MY RULING, AND THE REVIEWER CAUGHT THE CODER'S ANCHOR. I ruled 'one cell-width helper shared by renderer and oracle, agreeing by construction'. The coder implemented it, reverted the helper to code-point length, found all 57 width assertions still GREEN, and reported that my ruling had traded a detectable disagreement for an undetectable common error. The reviewer then found the coder's replacement anchor sound in SHAPE but not REPRESENTATIVE — one Unicode block validating a table spanning ten. Neither correction came from the layer that made the mistake. A pair where the coder corrects the PM and the reviewer corrects the coder is the loop working as designed, not friction in it."
    target: project
    fp: "aa11bb22cc33"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T00:30:00Z"
  - id: WIN-002
    kind: win
    description: "AMBIGUOUS = 1 WAS LOAD-BEARING, not cosmetic. Ruling East Asian Ambiguous as one cell looked like a formality until the table landed: U+2502, U+2514, U+2500, U+2026 and U+2014 — the tree's own guides, corners, ellipsis and the em dash in its TRUNCATED banner — are ALL EAW=Ambiguous. At two cells every line of the render would have counted double against its own budget. A decision taken for tidiness turned out to hold the feature up, which is an argument for deciding undecidable cases EXPLICITLY rather than leaving them to a default nobody has read."
    target: project
    fp: "dd44ee55ff66"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T01:15:00Z"
  - id: WIN-003
    kind: win
    description: "THE BASIS LEDGER EARNED ITS KEEP UNPROMPTED. Moving the exemplar changed one 'probe' command string inside a corpus file, and validate immediately reported 13 basis-stale warnings — content drift nobody would have noticed by eye. Re-verification REQUIRES the sha you believe is recorded (--sha <recorded> --update <doc>), so it cannot be done blind, and a real ordering constraint surfaced: updating a parent before its child leaves the parent stale, so the ledger must be walked leaf-first. The references themselves are relative and survived the move untouched — dd's own design working for the move that relocated it."
    target: project
    fp: "77aa88bb99cc"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T03:10:00Z"
  - id: CONF-003
    kind: confusion
    description: "A reviewer handoff named .harness/temp/pair-p7/coder-report.md and the path did not exist — I had described the report's contents in the dispatch without ever writing the file. The reviewer reconstructed the mutation list from the task ledger rather than asking. Pointer delivery only works if the pointer is written BEFORE it is sent; a path in a message is a promise."
    target: skill
    fp: "e01e7b66f07f"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-03T23:26:52.136Z"
  - id: DL-004
    kind: difficulty
    description: "The documented boot command (just test) took 40s and failed on two 5s telemetry timeouts plus a leaked credential-temp assertion, obscuring whether a docs-only change was safe. A boot check that cannot be trusted to answer 'is the tree healthy' teaches the next agent to skip it."
    target: tooling
    severity: annoying
    workaround: "re-ran; used the focused slice suites instead"
    suggested_encoding: "same root cause as DL-009 — fix the live-repo snapshot and the tmpdir enumeration"
    fp: "a96477e13b3e"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-03T21:53:14.329Z"
---

# Retro — 065 dd, Phase 7 and the post-ship stream

This stream began after the plan had already shipped. Jordan's exemplar taste
call (`bp-0902`) came back **with changes**, and those changes grew into ten
further commits and a merged PR at `d537ad33`.

## What shipped

Render fixes he asked for directly — checkbox state marks prefixing the state
word, three-tier section titles with the address pinned to an explicit anchor so
retitling cannot move a link, and arrays of declared links rendering as links.
A self-contained custom-adapter corpus. `docs/how/dd/` — a README, ten ordinal
chapters, the promoted exemplar and a runnable justfile. And Phase 7's
`dd graph map`, through four review rounds.

Three of those were **defects, not preferences**, and two were in documentation
that ships compiled into the CLI: the adapter guide typed its context with a
property that does not exist, and the overview claimed "nothing is
self-reported" when an explicit state is never reconciled against its evidence.

## The one lesson this stream actually taught

Every significant finding was the same failure wearing a different coat:
**proof that shares a blind spot with the thing it proves.**

Escape bytes counted as columns. Characters counted as columns. A shared oracle
that could only prove two things agreed, never that either was right. An anchor
sampling one block to validate a table spanning ten. A cumulative file list
answering a question about a window. And — the sharpest — a rule its own author
had written down, been caught by once, and still did not follow.

The fix is identical every time: **make the evidence come from somewhere the
thing being proved cannot reach.** Independent derivation, stored expected
values, hand-written facts read from a source the implementation never touches.

That last instance (DL-012) is the load-bearing one, because it is the only
case that rules out the comfortable explanation. Every other example can be
dismissed as "they did not know". Mine cannot. **Knowing the rule is not a
control** — and the corollary, that only self-expiring state or expiry
discharged by the operation that kills the cause will do, is the finding that
outlived this stream and landed as doctrine in another repo.

## What shipped broken, on purpose

FU-4 merged **documented rather than fixed**, and `exemplar/custom-render/` is
deliberately left reproducing it. A fixture that has been quietened cannot prove
a fix, and the three-verdict table is the acceptance test for whoever takes it.
DL-010 records why it was not fixed — a fence that was right when issued and
that nothing retired when its cause died. That cost is the prime's and is
recorded as such.

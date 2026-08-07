# Execution log — Phase 1: Converge the managed block on the mode union

**Plan**: `docs/plans/076-commit-guidance-convergence`
**Branch**: `s076/commit-guidance-block` (cut at `5dae6e9c`)
**Coder**: `pij-immediate-pennyroyal` · **PM**: `pij-respectable-clam`

---

## tk-0001 — the `CommitMode`-keyed guidance table (TDD-first)

**RED first.** The new assertions were written and run before any source change:
`6 failed | 24 passed`. The most important RED was `readAgentsBlock` returning
`current` for the verbatim pre-075 bytes — i.e. the fixture proved the block had
not yet moved, so the migration test could not have been tautological.

**What landed** in `harness/cli/src/services/instructions/commit-guidance.ts`:

- `CommitOutcome` — one reader-facing outcome: `label`, `promise`, `remedy`, and
  `nudge: 'drains-this' | 'not-the-remedy'`. The nudge disposition is DATA because
  getting it wrong *is* the defect: the pre-075 block sent every reader to
  `telemetry-nudge`, which refuses on a Windows named pipe.
- `COMMIT_OUTCOMES` — the three outcomes (`verified`, `buffered`, `unverified`).
- `CommitOutcomeGuidance` — `{ outcome: CommitOutcomeId; when: string }`.
- `COMMIT_OUTCOME_GUIDANCE` — `as const satisfies Record<CommitMode, CommitOutcomeGuidance>`,
  importing `CommitMode` type-only from `commit-service.ts`.

**Design note — why two levels, not one flat table.** The task text reads "each entry
declares the label, the promise, and the remedy". A flat `Record<CommitMode, …>` would
have meant the two buffered modes each carrying their OWN copy of the same promise and
remedy prose — two hand-maintained copies, which is the exact defect one level down.
Entries instead name a shared outcome *object*, so a collapsed outcome is literally the
same strings, and a mode whose promise genuinely differs cannot be folded in. The
`satisfies Record<CommitMode, …>` totality — the thing ac-0002 asks for — is unchanged
by the indirection, as the Dim-0 transcript below shows.

**No behaviour changed.** `commit-service.ts` has a zero-line diff; the only coupling is
a type-only import in the other direction.

## tk-0002 / tk-0003 — both surfaces render from the table

`commitOutcomeLines()` renders the list ONCE and both surfaces embed it verbatim. Modes
are walked in table order and grouped by declared outcome, so a collapsed outcome names
every condition that reaches it rather than describing one mode and implying the other.

- `commitGuidanceBlock()` — the hand-written two-outcome sentence is gone, replaced by
  "tells you WHICH outcome you got. The outcomes are:" + the rendered list.
- `COMMIT_INSTRUCTIONS` — the three hand-written bullets under "The two safe shapes" are
  replaced by the same rendered list.
- **One edit beyond tk-0003's letter**: the "What is and is not guaranteed" section
  carried a THIRD hand-maintained enumeration ("verifies the note landed, or names the
  buffer…, or states that attribution could not be verified"). ac-0003 says neither
  surface may carry an independently-maintained enumeration, so it now reads "reports
  which of the outcomes above it took". Every string the existing tests pin
  (`never SILENT about attribution`, `**NOT guaranteed**: delivery`) is preserved. All
  other prose — why the verb exists, the shapes to avoid, the Windows not-supported
  note — is untouched.

The two fence markers are byte-identical; a test now pins both literal strings and
asserts the pre-075 fixture still starts and ends with them, so a block already in the
wild is still found and refreshed rather than orphaned.

## tk-0004 — tests

New fixture `harness/cli/test/support/pre-075-block.ts` holds the pre-075 block captured
from `git show 5dae6e9c` — real historical bytes, never regenerated from
`commitGuidanceBlock()` (that would make the migration test tautological — F011).

| # | claim | where |
| --- | --- | --- |
| a | the block names the unverified outcome and does NOT offer the nudge as its remedy | `commit-guidance.test.ts` |
| a′ | the block no longer carries the two-outcome sentence | `commit-guidance.test.ts` |
| b | every table entry's label/promise/remedy — and every mode's `when` — appears in BOTH surfaces, iterating the TABLE | `commit-guidance.test.ts` |
| c | the mode→outcome mapping is pinned, so a future mode cannot be quietly folded in | `commit-guidance.test.ts` |
| d | the verbatim pre-075 block reads `stale`; doctor's row is not-ok, says STALE, names `--inject`, and mutates nothing | `attribution-surface.test.ts` |
| e | a refresh inside a file with user content on BOTH sides leaves both byte-identical; a second run is `unchanged` | `commit-guidance.test.ts` |

Result: `30 passed (30)` across the two files; full suite green under `just checks`.

## tk-0005 — this repo's own block

`node harness/cli/bin/harness.js instructions commit --inject` → `refreshed`.
`git diff --numstat 5dae6e9c -- AGENTS.md` → **`6	3	AGENTS.md`: 6 lines added, 3 removed**,
all between the two markers (verified by eye in the diff). Three prose lines were replaced
by two prose lines, a blank, and the three rendered outcome bullets. Nothing outside the
fences moved.

*(Round 1 of this log said "11 lines" — review F004. That number was wrong: it counted the
diff hunk's context lines. The change is 6 added / 3 removed. In a plan about not
overclaiming, a wrong evidence number is not a rounding error.)*

## tk-0006 — evidence

### ac-0002 · Dim-0 mutation — the compile error is the deliverable

A fake fifth member was added to `CommitMode` in `commit-service.ts`:

```diff
   | 'ingress-unverified'
+  | 'dim0-fifth-mode';
```

`npx tsc --noEmit -p harness/cli/tsconfig.json` → **exit 2**:

```text
src/services/instructions/commit-guidance.ts:124:12 - error TS1360: Type '{ readonly 'direct-verified': …; readonly 'file-buffered': …; readonly 'harness-buffered': { ...; }; readonly 'ingress-unverifie...' does not satisfy the expected type 'Record<CommitMode, CommitOutcomeGuidance>'.
  Property '"dim0-fifth-mode"' is missing in type '…' but required in type 'Record<CommitMode, CommitOutcomeGuidance>'.

124 } as const satisfies Record<CommitMode, CommitOutcomeGuidance>;
               ~~~~~~~~~

src/services/instructions/commit-guidance.ts:139:31 - error TS7053: Element implicitly has an 'any' type because expression of type 'CommitMode' can't be used to index type '…'.
  Property 'dim0-fifth-mode' does not exist on type '…'.

139     const { outcome, when } = COMMIT_OUTCOME_GUIDANCE[mode];
                                  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Found 2 errors in the same file, starting at: src/services/instructions/commit-guidance.ts:124
```

**The claim this proves, precisely**: both errors are in `commit-guidance.ts`, at the
guidance table (line 124) and its renderer (line 139). `commit-service.ts` compiled
CLEANLY with the fifth mode — so tsc's *only* objection to a new commit mode is that the
guidance has not described it. That is the guarantee ac-0002 asks for, and it is the
opposite of what a test asserting today's text would have given.

The mutation was reverted (`git diff harness/cli/src/services/commit/commit-service.ts`
→ empty) and `tsc --noEmit` re-run → **exit 0**.

### `just checks`

`tests:ok biome:ok typecheck:ok check:docs:ok check:flows:ok check:telemetry-fixtures:ok
check:doctrine-parity:ok check:dd-docs:ok root-invocation-smoke:ok arch-check:degraded
dd doctor:ok skills-check:ok markdown-lint:degraded windows-check:degraded`

Every hard gate green. The three warn-launch degradeds were confirmed **pre-existing and
untouched by this change**:

- `arch-check` (2× `services-ports-type-only`) — `telemetry/ref-source.ts` and
  `telemetry/sync-service.ts`. Neither is in this diff.
- `markdown-lint` (210 findings) — **zero** are in `AGENTS.md` (checked by filtering the
  findings for the path).
- `windows-check` (6 hazards) — all in `.harness/extensions/html-snap/`. Zero mention
  `commit-guidance`.

### doctor

`node harness/cli/bin/harness.js doctor` →
`{'name': 'commit-guidance', 'ok': True, 'detail': 'AGENTS.md carries the managed harness:commit-guidance block'}`

---

## Discoveries & Learnings

| # | tag | what |
| --- | --- | --- |
| D1 | Noteworthy | The task schema has no `in_progress` state — `harness dd set …/state in_progress` is refused by the schema (`E451`; allowed: `unchecked`, `checked`, `blocked`, `human-skipped`, `na`). The per-task "flip to `[~]` on start" ritual in the implement sub-skill has no representation in a dd-native plan. Not a blocker; states were flipped on completion with receipts. |
| D2 | Noteworthy | The "What is and is not guaranteed" section held a third copy of the outcome enumeration that no task named. Left alone it would have been the next thing to drift, so it was derived away (see tk-0003). Flagging it as a deliberate call a human might have made differently. |
| D3 | Noteworthy | The rendered outcome bullets are long single lines (not hard-wrapped to ~78 like the surrounding prose). Wrapping was considered and rejected: it would break the `toContain(promise)` assertions that prove both surfaces carry the same strings, and `markdown-lint` reports zero findings for `AGENTS.md` as-is. Legibility cost is a diff that shows one long line per changed outcome. |

## Deferred & Noteworthy (this phase)

No deferred work, no skipped or blocked tasks, no unmet acceptance criteria, no new
`TODO`/`FIXME`/`HACK` markers. Three `Noteworthy` rows above (D1–D3) — D2 is the only one
that changed a file beyond the letter of a task.

## Suggested commit message

```text
fix(instructions): converge commit guidance on the CommitMode union (plan 076)

The managed AGENTS.md block promised exactly two outcomes while CommitMode has
four, so a Windows agent was told to expect an outcome it cannot get and was
sent to a recovery command that refuses on that platform.

The words were wrong because the outcome contract existed twice, in two
hand-maintained prose copies with nothing forcing them to agree. Both surfaces
now render from one exported Record<CommitMode, CommitOutcomeGuidance> table in
src, so adding a fifth mode is a compile error at the guidance table — the third
application of the TRACE2_TARGET_POLICY / RETAINED_FIELD_RENDERING pattern.

No commit behaviour changes: commit-service.ts has a zero-line diff.
```

---

# Round 2 — review CHANGES on `8a856921`

Review: `assets/reviews/phase-1-review.md` · Fix tasks: `assets/reviews/phase-1-fix-tasks.md`.
All four findings accepted; none disputed.

## F001 (HIGH) — buffered recovery was false on Windows

**Verified in source before fixing.** `runNudge()` (`nudge.ts`) checks
`if (isWin32(deps))` *before every replay path* and returns `unsupported-platform`:
"git on Windows has no af_unix trace2 target, so there is no ingress this verb can replay
into… Buffered events on this host stay on disk, untouched." Both `file-buffered` and
`harness-buffered` are reachable on Windows and both collapse onto the shared `buffered`
outcome — which told the reader to run that command. We fixed the named-pipe branch's
honesty in round 1 and left the buffered branch lying on the same platform.

**Fix — state the prerequisite, never detect the platform.** `NUDGE_PREREQUISITE` is
emitted by the renderer for *every* `drains-this` outcome, unconditionally:

> Recovery is POSIX-ONLY: the drain replays into an af_unix socket, so on a Windows host
> `harness doctor telemetry-nudge` refuses on platform grounds and drains nothing — the
> buffered events stay on disk, untouched, until they are drained from a host whose
> collector ingress is an af_unix socket.

`process.platform` appears nowhere in the renderer, by design and not by omission: this
text is committed into an `AGENTS.md` that any OS may check out, so **the machine that
renders it is not the machine that reads it**. A platform branch would bake one host's
answer into a file read on another. An unconditional prerequisite is true on every host.

## F002 (MEDIUM) — `nudge` was dead data

Round 1 declared the disposition and never rendered it: a guard-shaped datum free to
disagree with the prose beside it. Took the reviewer's **preferred** option — the datum is
now load-bearing.

- `CommitOutcome.remedy` (free text) is **gone**. It is replaced by
  `CommitOutcome.recovery: CommitRecovery`, a discriminated union.
- `renderRecovery()` derives the instruction from the disposition and is the **only writer
  of the string `harness doctor telemetry-nudge`** anywhere in the guidance.
- A test asserts **no authored string in the table may contain `telemetry-nudge`**. An
  author who hand-writes "run the nudge" into a promise fails the suite, so the disposition
  and the rendered instruction structurally cannot drift apart.

### The third arm — a contradiction this fix would otherwise have created

Making the datum load-bearing naively renders "Do NOT run the nudge" for every
non-drainable outcome. That would have been **wrong for `direct-verified`**: its
verify-MISS branch in `commit-service.ts` names that very command in its own
`next_action`. Guidance contradicting the shipped command is the same overclaim in a new
place — caught by reading the branch rather than trusting the shape.

So `CommitRecovery` has three arms, and the distinction is real:

| arm | outcome | renders |
| --- | --- | --- |
| `drains-this` | buffered | the drain instruction + the POSIX prerequisite |
| `not-the-remedy` | unverified | "Do NOT run …" + why it refuses |
| `not-applicable` | verified | what to do, and **silence about the verb** |

A test pins `verified.recovery.nudge === 'not-applicable'` and that its rendered text never
names the verb, so a later tidy-up cannot collapse three dispositions into two and
reintroduce the contradiction.

## F003 (LOW) — the third enumeration

`docs/how/gitai-collector.md` § "The two safe commit shapes" carried a stale two-outcome
list (`ingress reachable` / `anything else`) — written before plan 075's fourth mode.
**Converged by pointing, not by restating**: the section now says the outcome list is
deliberately not restated there, names `COMMIT_OUTCOME_GUIDANCE` as the source, tells the
reader to run `harness instructions commit` for the live list, and records that this very
section had already gone stale once. Restating it in prose would have made a *fourth*
hand-maintained copy. The code fence's comment was also corrected to `POSIX-only`.

## F004 (LOW) — the wrong evidence count

"11 lines" → the real numbers, `6	3	AGENTS.md` (6 added, 3 removed), from
`git diff --numstat 5dae6e9c -- AGENTS.md`. Corrected in the tk-0005 section above and in
the ac-0006 receipt.

## Round-2 evidence

**ac-0002 Dim-0, re-run against the restructured table** — `dim0-fifth-mode` added to
`CommitMode`, `npx tsc --noEmit` → exit 2, **exactly 2 errors, both in
`commit-guidance.ts`**:

```text
src/services/instructions/commit-guidance.ts:192:12 - error TS1360: … does not satisfy the expected type 'Record<CommitMode, CommitOutcomeGuidance>'.
  Property '"dim0-fifth-mode"' is missing in type '…' but required in type 'Record<CommitMode, CommitOutcomeGuidance>'.
192 } as const satisfies Record<CommitMode, CommitOutcomeGuidance>;

src/services/instructions/commit-guidance.ts:207:31 - error TS7053: … expression of type 'CommitMode' can't be used to index type '…'.
207     const { outcome, when } = COMMIT_OUTCOME_GUIDANCE[mode];

Found 2 errors in the same file, starting at: src/services/instructions/commit-guidance.ts:192
```

Reverted; `git diff --quiet 5dae6e9c -- harness/cli/src/services/commit/commit-service.ts`
passes (**zero-line diff against base**, still true after round 2).

**What that compile error does and does not prove** (the reviewer is right, and the receipt
now says so): it proves **declaration totality** — a new mode cannot exist without an entry.
It does **not** prove the entry is semantically right; pointing a fifth mode at `buffered`
still compiles. Semantic correctness is carried by the renderer owning every nudge mention,
by the shared-outcome-object design, and by the tests — not by the type system, and the
receipts no longer imply otherwise.

**Tests**: 33 passed (33) across the two files; `just checks` green on every hard gate.
The three warn-launch degradeds are unchanged and pre-existing — re-verified after the doc
edit: **0** markdown findings for `AGENTS.md`, **0** for `docs/how/gitai-collector.md`.

**doctor**: `commit-guidance: ok`.

## Round-2 discoveries

| # | tag | what |
| --- | --- | --- |
| D4 | Noteworthy | The naive form of the F002 fix would have introduced a fresh contradiction with `commit-service.ts`'s verify-miss `next_action`. Found by reading the branch, not by any check. There is no guard that compares guidance prose against the `next_action` strings the commands actually emit — that is a real gap and a candidate for a future plan, not something this one should widen to cover. |

---

# Round 3 — review CHANGES on `8d54ede2` (two MEDIUMs, no HIGH)

The three-arm recovery union and the Windows prerequisite were both **confirmed correct**;
no fourth arm is needed. Two findings remained.

## R2-F001 — the standalone RECOVERY block was worse than "missing a caveat"

The page's generic recovery paragraph did not merely omit the prerequisite: it **asserted
behaviour that is false on win32**, saying the verb "rotates the buffer to a segment" and
"replays that segment into the collector". On a Windows host `runNudge()` returns before
either happens. And because that paragraph named the verb **by hand**, it falsified the
source comment round 2 had just added — that `renderRecovery()` / `NUDGE_VERB` were the
sole writer of the verb's instruction. A sole-writer claim with one hand-written exception
is aspirational, which is the same shape of overclaim this plan exists to remove.

**Fix — derive it.** `RECOVERY_SECTION` is a module constant interpolating `NUDGE_VERB`
and ending with `NUDGE_PREREQUISITE`, and the page embeds it:

```text
    harness doctor telemetry-nudge

RECOVERY, on a POSIX host. Run it from an UNSANDBOXED shell: it rotates the
buffer to a segment, replays that segment into the collector, …

Recovery is POSIX-ONLY: … on a Windows host `harness doctor telemetry-nudge`
refuses on platform grounds and drains nothing …
```

The replay assertion is now scoped ("RECOVERY, **on a POSIX host**") *and* the
prerequisite travels with it. The general rule the reviewer named — **the prerequisite
travels with every standalone recovery instruction, not just the outcome list** — is
pinned by a test that counts prerequisite occurrences in the page (≥ 2) and asserts the
text following the rotate/replay sentence still carries it.

The source comments were corrected to say what is true rather than what was aspirational:
`NUDGE_VERB` is the single **source of the verb's name**, interpolated everywhere; and
`renderRecovery()` owns the **outcome list's** recovery text, with `RECOVERY_SECTION`
named as the other, deliberately-qualified site.

## R2-F002 — the plan's own claim was the overclaim (PM-owned, fixed here)

`COMMIT_OUTCOME_GUIDANCE` is total over `CommitMode` but stores only `outcome` + `when`;
`label`, `promise` and `recovery` live in the companion `COMMIT_OUTCOMES`. So ac-0002's
"a single exported table … is the ONLY declaration of what each commit outcome promises"
was false as written. The round-2 receipt already said so; the claim did not.

**Raised the claim to the receipt's honesty, rather than lowering the receipt.** ac-0002
now reads: one table is the EXHAUSTIVE declaration of *which outcome each mode yields*,
over a companion map declaring each outcome's promise and recovery *exactly once* — with
the scope stated in the claim itself: compilation guarantees **declaration totality**, not
that a mode was pointed at the *right* outcome. Goal 2 was narrowed the same way (and now
also records that the how-doc points rather than restates); goal 3 gained the same explicit
bound.

### On collapsing the two maps instead — argued, and declined

The PM offered the alternative: collapse into one `Record<CommitMode, …>` carrying
label/promise/recovery per mode, making the original claim literally true. **Recommend
against, and did not do it.** `file-buffered` and `harness-buffered` would then each carry
their own copy of the same promise and the same recovery prose — two hand-maintained
copies of one contract, *inside the very table whose purpose is to prevent hand-maintained
copies*. Worse, nothing would keep them equal: an editor could change one and not the
other and silently split a collapsed outcome, with every test still green. The only way to
keep them provably identical is to have both reference one shared object — which is the
two-level design, with the outer level inlined and the named outcome ids (which the tests
pin) thrown away. So collapsing buys a truer sentence by reintroducing the defect. Fixing
the sentence is strictly better than fixing the design to match a sentence.

## Round-3 evidence

- Tests: **34 passed (34)** across the two files.
- `just checks`: green on every hard gate; the three warn-launch degradeds unchanged and
  pre-existing.
- `commit-service.ts`: `git diff --quiet 5dae6e9c` still passes — **zero-line diff**.
- `AGENTS.md`: unchanged by round 3 (the managed block never contained the standalone
  recovery section), still `6	3` against base, still fence-confined; doctor reports
  `commit-guidance: ok`.

## Round-3 discoveries

| # | tag | what |
| --- | --- | --- |
| D5 | Noteworthy | Both round-3 findings are the same failure at different layers: a *claim of single ownership* that one hand-written exception quietly falsified — once in a source comment (R2-F001), once in an acceptance criterion (R2-F002). Worth naming, because the defect this plan set out to fix is itself "a surface claiming more than the code delivers", and it kept reappearing one layer up each round. The lesson generalises: when you assert "X is the only writer of Y", grep for Y before writing the sentence. |

---

# Round 4 — review CHANGES on `c84b126a` (one MEDIUM, one LOW)

The three recovery arms were confirmed correct a second time.

## R3-F001 — the fourth instance, and then two more the sweep found

The reviewer was told to assume a fourth instance existed and hunt it. It did:
`commit-guidance.ts:172`, the doc comment directly above `COMMIT_OUTCOME_GUIDANCE`, still
called that table "the ONLY declaration of what each commit outcome promises" — which
`COMMIT_OUTCOMES` plainly contradicts. Same defect as F002, R2-F001 and R2-F002, sitting
one line above the table the plan's honesty rests on.

**The instructed sweep of every `only`/`sole`/`single` assertion found two more that the
reviewer had not named:**

- The `CommitRecovery` doc comment claimed "the renderer OWNS **every** mention of the
  verb". False — `RECOVERY_SECTION` mentions it too.
- Worse: the replacement *I wrote for that comment* said the verb "appears in exactly two
  places, both interpolating `NUDGE_VERB`". Also false, immediately — the page's
  "**NOT supported on Windows**" bullet named `telemetry-nudge` by hand, in rendered
  output. **Six instances of the same overclaim across four rounds, the sixth in a comment
  written minutes earlier.**

**So this one is ENCODED, not reworded.** Rewording a seventh time fixes today's sentence
and leaves tomorrow's exception free — the exact failure mode this plan exists to kill, and
exactly what D5 warned about.

- The Windows bullet now interpolates `${NUDGE_VERB}` like every other site.
- A test **reads this source file** and asserts the literal
  `harness doctor telemetry-nudge` appears **exactly once**, at the `NUDGE_VERB`
  declaration — plus that both rendered surfaces really do contain the verb, so "named
  once" can never be satisfied by simply not mentioning it.
- **Mutation-proven**: hand-typing the verb into the page body fails the suite
  (`AssertionError: expected 2 to be 1`). Reverted.

That is the same move as ac-0002's compile error, one layer over: a claim about future
edits enforced by a mechanism rather than by reviewer attention. The doc comments now
state only what the mechanism delivers.

Also corrected: the plan `summary` said the plan "converges both surfaces on a single
table" — narrowed to "one `CommitMode`-keyed table over a companion outcome map", and the
recurrence itself is now recorded in the summary so the next reader inherits the lesson.

## R3-F002 — a test that could pass for the wrong reason

The round-3 standalone-recovery test sliced from the rotate/replay sentence to **page
end**, so a later, unrelated prerequisite mention could satisfy it even after the recovery
section regressed. In a plan about not claiming more than you can prove, that is the same
bug in the test layer.

**Bounded to the section**: the slice now runs from `RECOVERY, on a POSIX host.` to the
next `\n## ` heading, and asserts both the replay sentence and the prerequisite live
*inside that slice*.

**Mutation-proven, against the exact regression the reviewer described**: removing
`NUDGE_PREREQUISITE` from `RECOVERY_SECTION` while adding an unrelated mention later in the
page makes the bounded test FAIL (`expected 'RECOVERY, on a POSIX host. Run it fro…' to
contain 'Recovery is POSIX-ONLY…'`) — the page-end version would have passed. Reverted.

## Round-4 evidence

- Tests: **35 passed (35)**; two independent mutation proofs above.
- `just checks`: green on every hard gate; the three warn-launch degradeds unchanged.
- `commit-service.ts`: still a **zero-line diff** against `5dae6e9c`.
- `AGENTS.md`: `instructions commit --inject` reports **`unchanged`** — round 4 touched no
  rendered block text — still `6	3` against base and fence-confined.

## Round-4 discoveries

| # | tag | what |
| --- | --- | --- |
| D6 | Noteworthy | D5 was recorded as a lesson and then violated twice in the same file within the hour, once by the very comment written to fix it. A lesson in prose does not survive its own author; the fix that held was the source-reading test. **Encode, don't remind** — the general form of DL-007, and the reason this plan's own doc comments are now narrower than they were. |

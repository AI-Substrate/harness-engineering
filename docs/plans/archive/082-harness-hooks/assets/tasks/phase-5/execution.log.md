# F005 — the entry shape is not uniform, and a wrong one DISABLES THE HOST CONFIG

**Found in the wild by the product owner**, in a Claude Code instance that refused to start cleanly.
Not by a test, not by the gate, not by review.

```text
Settings Error
/Users/<user>/.claude/settings.json
  hooks.PostToolUse.1.hooks: Expected array, but received undefined
  hooks.PreToolUse.1.hooks:  Expected array, but received undefined
Files with errors are SKIPPED ENTIRELY, not just the invalid settings.
```

Index `[1]` was ours.

## What was actually broken

Read that last line again, because it is the whole severity of this finding: **it did not break our
hook — it disabled every setting in the file.** Permissions, notifications, all of it, from the live
install until a human removed the entries by hand.

We wrote Cursor's **flat** entry shape `{command}` into configs that require the **nested** shape
`{matcher, hooks:[{type, command}]}`. git-ai's own correctly-shaped entry was sitting **one line
above ours** in the same file.

## The blast radius was three agents, not one

The first report named claude-code. A read-only census of every Strategy A config on the machine
(`json.load`, no writes — and deliberately **not** `hooks status`, which calls `journal.compact()`)
found our flat entry in two more nested-shape files:

| config | our entry | consequence |
| --- | --- | --- |
| `~/.claude/settings.json` | flat, at `[1]` | file skipped entirely — **reported by the app** |
| `~/.gemini/settings.json` | flat, at `[1]` | same shape defect, unreported |
| `~/.factory/settings.json` | flat, at `[1]` | same shape defect, unreported |

Only claude-code told anybody. Gemini and droid may have been inert since the install and said
nothing — **the same defect, twice, silent.** A defect that announces itself is the lucky case.

Had the fix been scoped to the agent that complained, two thirds of it would have shipped broken.

## Why nothing caught it — and this is the reusable part

Every install fixture we had asserts:

- our entry is present, and
- the pre-existing sibling entries survived.

Both are properties of the **parts**. Not one asserted that the **file is still valid to its own
consumer**.

> **Preservation is not correctness.** Every entry survived. The document stopped working anyway,
> because validity is a property of the whole document and we only ever asserted properties of its
> parts.

That sentence is the finding. The shape table is just this week's instance of it.

## Fourth time this plan assumed uniformity across agents and was wrong

| # | assumed uniform | actually | cost when wrong |
| --- | --- | --- | --- |
| 1 | event-name casing | `PreToolUse` / `preToolUse` / `BeforeTool` | hook never fires |
| 2 | config paths | seven different layouts | nothing installed |
| 3 | one file per agent | windsurf writes **two** | half installed |
| 4 | copilot's config file | it is git-ai's, deleted by their uninstall | hook vanishes silently |
| **5** | **the entry shape** | **3 nested / 4 flat** | **host config disabled** |

The first four fail to install. **The fifth damages the host application.** That difference is why
`supported: false` now exists as a matrix field rather than a comment.

## The method changed, and the method is the lesson

The first census read the **configs on this machine**. The product owner's correction:

> git-ai ships **sixteen per-agent installers** — `src/mdm/agents/*.rs`. Every correct shape is in
> that source. We raided it for the four defects we were fixing and never lifted the SHAPES, then
> wrote one shape for everybody.

The brief was to bring in **their** hooks system. We built a parallel one that re-derived — wrongly —
what they already had right.

Deriving from the source rather than from the artifacts is strictly better for two measurable
reasons, not one:

1. **It covers agents this machine has no file for.** firebender has no config here. Reading
   configs, its shape was *unmeasurable*; reading `firebender.rs`, it is `flat` — and **stronger
   than flat**: a matcher-bearing entry is treated as *not installed* (`firebender.rs:66`, `:81`)
   and actively **stripped** (`firebender.rs:179`, test at `:516`). Nested is as wrong there as flat
   is in claude-code. "Unmeasurable" became "read it".
2. **An installed file is an artifact of a writer; source is a statement of the requirement.** The
   configs could only ever tell us what git-ai *did*, never what the agent *requires*.

## The seven shapes, each cited

All from `git-ai/src/mdm/agents/`, now carried in the matrix row itself so the next reader does not
re-derive them:

| agent | shape | citation | root field |
| --- | --- | --- | --- |
| claude-code | **nested** | `claude_code.rs:151-154`, `:206-209` | — |
| gemini | **nested** | `gemini.rs:162-165`, `:194-197` | `tools.enableHooks` `gemini.rs:99-106` |
| droid | **nested** | `droid.rs:183-186`, `:237-240` | — |
| cursor | flat | `cursor.rs:150-164` | `version: 1` `cursor.rs:172-174` |
| firebender | flat | `firebender.rs:126-141` | `version: 1` `firebender.rs:143-148` |
| github-copilot | flat + `powershell` | `github_copilot.rs:59-69` | — |
| windsurf | flat + `show_output` | `windsurf.rs:114-117` | — |

## Two more "installed and dead" surfaces the source raid found

Neither was being looked for. Both are the F004 class — *registered nowhere, fires never* — arriving
through a different table.

- **windsurf's event keys.** It dispatches on five **cascade** events (`windsurf.rs:17-23`), none of
  them `PreToolUse`. We wrote `PreToolUse`/`PostToolUse` into `~/.codeium/hooks.json`: structurally
  valid, so the file parses and a shape assertion passes — and **dead**. Shipping a "fixed" installer
  that still writes well-formed dead hooks is worse than the bug being fixed, because it now *looks*
  installed.
- **gemini's `tools.enableHooks`.** Its own installer sets it on every install and asserts it
  (`gemini.rs:478-480`). We never wrote it. A perfectly-shaped gemini entry could be inert
  independently of the shape defect.

## What shipped

1. **`entryShape` is a matrix field** — `'flat' | 'nested'`, **required, no default**. A default is
   what produced F005: one shape assumed for everybody. Making it required means a new row cannot
   inherit a silent wrong answer.
2. **`rootExtras`, merged key-by-key and never overwritten.** An existing `tools` object keeps the
   user's own settings and gains only what is missing.
3. **`supported: false` for firebender**, wired into `listAgents` — which had `supported: true`
   **hard-coded**, so the matrix field would have been decorative. Found by an off-by-two in a count
   assertion, not by reading the code.
4. **Ownership reads both shapes** (`entryCommands`). A nested entry has no top-level `command`.
5. **windsurf's five cascade events**, which forced `events` from `{pre, post}` to `{pre[], post[]}`.

## The guard that outlives this bug

Per-agent schema validation catches *this* defect. The **shape-vs-sibling** guard catches the class:
for every agent, seed the fixture with **that agent's own real git-ai entry**, install, and assert our
entry has the same structural signature as the one already there.

**It immediately found two things the schema validator structurally could not** — both files were
perfectly valid:

- we omit copilot's `powershell` variant (`github_copilot.rs:59-69`);
- we omit windsurf's `show_output: false` (`windsurf.rs:114-117`).

That is the reusable lesson, not a copilot detail: **a sibling entry is a worked example of the
required shape, sitting in the file we are about to edit.** We had it and did not read it. The guard
needs no per-agent expectation written down, so it cannot go stale the way a hard-coded table can —
an eighth agent is covered by seeding its own entry.

**MATCHED-NOT-VERIFIED.** For `powershell`, `show_output`, `tools.enableHooks` and `version`, the
claim we can support is *git-ai writes this, so we now write it too* — **not** *this is required*.
Copilot parses hook files in native code, so requiredness is not readable from its bundle. That label
is in the matrix comments, where the next reader is, not only here.

## The RED evidence

The fixture reproduces the reported error **byte-for-byte, at the same index**:

```text
FAIL test/services/hooks/entry-shape.test.ts > THE FILE IS STILL VALID TO ITS OWN CONSUMER
     — the assertion nobody had > claude-code: the config still satisfies that agent's own
     schema after install
AssertionError: expected [ { …(2) }, { …(2) } ] to deeply equal []

- []
+ [
+   { "at": "hooks.PreToolUse.1.hooks",  "problem": "Expected array, but received undefined" },
+   { "at": "hooks.PostToolUse.1.hooks", "problem": "Expected array, but received undefined" },
+ ]
```

**9 of 24 rows RED with 15 green in the same run.** An honest RED: the structural scaffolding
(events-as-lists, `supported`, entry-level ownership) landed *first*, with the entry shape left
alone, so every failure is the defect refusing rather than a missing symbol. A RED from a compile
error is not a refusal. The 15 green rows prove the fixture can say yes — an assertion that always
fires detects nothing.

Two of the nine were **my expectation, not the code's behaviour**, and are recorded as corrections
rather than as defects fixed:

- windsurf uninstall counted `5` removals where the correct figure is `5 × 2 files = 10`;
- the uninstall byte-equality rows failed because root fields survive — see below.

## Uninstall deliberately leaves root fields behind

The symmetry rows failed on `tools.enableHooks`, and the failure was the **right question**. Install
adds it, so symmetry argues uninstall should remove it. **It must not**: that flag is a
document-level enablement switch shared by *every* hook consumer in the file — git-ai sets it for its
own gemini hooks. Removing it on our way out would silently disable somebody else's working hooks,
which is exactly the posture the marker exists to enforce.

> **Symmetry is not the principle — reversibility of OUR OWN WRITES is.**

Those are different claims, and this is where they come apart. A perfectly symmetric uninstall
removes everything install added, including a shared switch we merely *ensured* rather than *owned*.
Reversibility asks the narrower and correct question: *is the config back to a state where every
other tool works as it did?* Clearing a document-level switch fails that test while passing the
symmetry one.

The cost is a leftover root key. **Recoverable cruft; disabling another tool's attribution is not** —
the same trade F003 settled for event-array keys, applied one level up from entries to root fields.

## The detection-asymmetry pass (asked for, answered, not fixed)

*Can any agent's own "is it installed?" check be defeated by an entry shape, the way firebender's is?*
**Yes — all of them, and in both directions:**

| agent | its own predicate | defeated by |
| --- | --- | --- |
| claude-code / gemini / droid | requires `block.hooks[].command` | a **flat** entry is invisible |
| firebender | requires `matcher.is_none()` (`:66`, `:81`) | a **nested** entry is invisible |
| github-copilot | exact match on `type`+`command`+`powershell` | a **missing `powershell`** is invisible |
| cursor / windsurf | reads `item.command` | a nested entry is invisible |

### The general lesson: two readers of one file, disagreeing about what is in it

This explains the thing that otherwise makes no sense about F005 — **the file was disabled and
nothing anywhere reported an installed hook.** Our flat entry was simultaneously:

- **invisible** to claude-code's *git-ai detection*, which keys on `block.hooks[].command`; and
- **fatal** to claude-code's *schema validation*, which keys on `block.hooks` being an array.

Both readers read the same bytes. One concluded *nothing is installed*; the other concluded *this
file is broken*. Neither is wrong, and neither could report the other's finding.

> **A validator and a detector keyed on different fields will always be able to disagree.** Every
> consumer of a shared config file has this shape — the detector answers *is my thing here?* and the
> validator answers *is this document well-formed?*, and an entry can satisfy exactly one of them.

That is not a claude-code detail. It is the general property, and it is why "our entry is present"
and "the file still works" have to be **two separate assertions**: no amount of strengthening the
first will ever produce the second. Our fixtures had a detector's assertions and no validator's.

**A corollary worth naming:** a tool cannot rely on a host application to report the damage it does.
claude-code happened to surface a settings error; gemini and droid did not. Silence from the host is
not evidence of correctness — it is the absence of one particular reader.

Our predicate is now deliberately wider than any single agent's: `entryCommands` reads both shapes,
so detection does not depend on the matrix being right. That yields the property whose absence forced
a human repair:

> **We can always remove what we wrote, even when the shape was wrong.**

### Method lesson: a claim tested in one direction is half a claim

The recoverability row was written first for **flat-into-nested** — the mistake we actually made. It
passed. Then, under mutation (the nested branch of `entryCommands` deleted), **it stayed green**.

The row was not testing what its name said. Installing the *flat* shape and reading it back needs
only flat-shape ownership, so it exercised none of the machinery it claimed to prove. Adding the
**nested-into-flat** direction took the same mutation from 4 RED to **5 RED**.

The generalisation is not about entry shapes: **a bidirectional property asserted in one direction
is satisfied by a one-directional implementation**, and the passing test is what conceals it. The
guard against this is the mutation, not the review — reading the row does not reveal it, because the
row is *true*, merely weaker than its own name.

## Verification

| check | result |
| --- | --- |
| `entry-shape.test.ts` | **32 passed** |
| hooks suite | **425 passed** (was 395) |
| `HARNESS_TEST_SCOPE=all just checks` | **tests:ok biome:ok typecheck:ok** |
| arch-check · markdown-lint · windows-check | **2 · 211 · 7** — standing baseline, unmoved |

Mutation evidence: deleting the nested branch of `entryCommands` → **5 RED**; collapsing the matrix
to one flat shape → **9 RED** including the verbatim host error.

## What is MEASURED vs EXPECTED-UNVERIFIED

**Measured:** the three nested shapes and four flat ones, each against git-ai's installer source; the
host error reproduced verbatim; three configs on this machine carrying the defect; every gate above.

**Expected-unverified:** that gemini and droid were *actually* inert (only claude-code reported); that
`powershell`, `show_output`, `enableHooks` and `version` are *required* rather than merely written by
git-ai; **firebender end to end** — its shape is known from source, but no firebender config has ever
been observed, which is precisely why it is held out rather than guessed at.

## Softest claim

**Our entries now match the worked example already in each file, on every agent, and we can remove
what we wrote even when the shape is wrong.** That is a claim about *structural agreement with
git-ai*, not about what each agent's runtime requires — and for four fields we are explicit that we
matched rather than verified.

And the honest one about how this was found: **the product owner found it on his own machine, in
another tool's error message.** The suite was green. The gate was green. The evidence was one line
above ours in the file we were writing to — **the third time tonight the answer was already on the
machine.** What changed is that the shape is now read from git-ai's source and asserted against a
sibling, so the next reader inherits the answer instead of re-deriving it wrongly.

---

# F005 review delta — three findings from the gpt-5.6-sol reviewer on `62b86e96`

All three accepted. Each is narrower than it first looks, and two of them are the *same shape as the
defect they follow* — which is the point worth carrying forward.

## F1 (P1) — our WRITER learned both shapes and our READER did not

`ourCommands` (`hooks-verbs.ts`) parsed `entry.command` and nothing else. A nested entry has no
top-level `command`, so `list` and `status` reported `installed:false, binaryState:absent,
commandState:absent` **immediately after a successful install** into claude-code, gemini or droid.

This is **the detection asymmetry again, and this time we owned both readers.** F005's general
lesson was *a validator and a detector keyed on different fields will always be able to disagree*.

> I wrote the lesson into the log in the same commit that shipped a third reader keyed on the old
> field. **Knowing a defect's shape is not the same as having searched for its other instances.**

That is the keeper, not the `ourCommands` line. The general form: **writing down a defect's shape
is an act of understanding, not an act of search.** The two feel identical while you are doing the
first one, which is why the log entry felt like closure and the third reader shipped underneath it.
A defect class earns a *sweep* — every call site that answers the same question — and the sweep is
a separate piece of work from the explanation.

**Why it stayed green:** every `list`/`status` row in the suite used **cursor** — the one agent whose
shape is flat. A per-agent surface tested on one agent proves one agent. The new rows are driven from
`AGENT_MATRIX`, so the eighth agent is covered by adding a row rather than by remembering to add a
test.

**RED first, on the unmodified source:** exactly three failures — `claude-code`, `gemini`, `droid` —
and four passes. The fix routes `ourCommands` through the same `entryCommands()` uninstall already
matches ownership with: **one reader, not a second one that agrees today.**

**The negative control is what makes the fix provable rather than plausible.** A git-ai-only nested
config must still read `installed:false` / `binaryState:absent`. Without that row, a reader that
returned every command it FOUND — rather than every command of OURS — passes all seven positive
rows. The positive rows prove we can see our entry; only the negative row proves we can still tell
it apart from somebody else's.

## F2 (P1) — a principle held; its implementation was too broad

The PM's endorsement of unconditional retention was reversed, correctly. `Reversibility of our own
writes` never justified retaining a field on a file with **no peer to protect**. Install + uninstall
on a config with no foreign hooks left `{"tools":{"enableHooks":true},"hooks":{}}` behind: our write,
rationalised as shared.

Worse, and this is the part that generalises: **the fixture that "proved" retention protects git-ai
seeded a sibling with no `enableHooks` at all.** It asserted a safety property on a document where
the flag was doing nothing. *A fixture can assert the right thing about the wrong world and stay
green forever* — preservation-is-not-correctness, one level up from where F005 found it.

Retention is now conditional on **both**: (a) provenance says we created it, and (b) zero foreign
hook entries remain anywhere in that file's hook sections after our removal. **Any doubt retains** —
unparseable document, non-array section, an entry we cannot classify. The path shape carries the
second half of the answer for free: an absent `tools` records `['tools']` (we made the object, we may
remove the object), while a `tools` that merely lacked the flag records `['tools','enableHooks']` (we
made one key, we may remove one key). `foreignHooksRemain` counts an **`ours-with-foreign`** entry as
foreign — one we refused to remove *because* it chains a peer's work is not evidence of an empty file.

**Three mutations, because one condition proven is not two:**

| mutation | rows RED |
| --- | --- |
| A — removal is a no-op (`62b86e96`'s unconditional retention) | **3** — created+no-foreign, created-over-user's-object, cursor's `version` |
| B — condition (b) forced false | **3** — created+foreign, the protect-git-ai row, the unparseable row |
| C2 — condition (a) discarded | **4** — including pre-existing and no-provenance |

Mutation C (a *weaker* version of C2, falling back only when the map lacked the path) caught **one**
row, not two: the pre-existing case passes an **empty list**, not an absent one.

**METHOD NOTE, and it generalises past this row: an insufficiently sharp mutation UNDERSTATES the
coverage it is measuring — in the direction nobody notices.** An over-sharp mutation fails loudly
and gets fixed. An under-sharp one returns a smaller RED count that reads as a *finding* ("only one
row covers condition (a)") rather than as a *broken instrument*. The tell was arithmetic: two rows
claim to exercise (a), one went red, and the gap was in the mutation rather than in the suite. A
mutation is an instrument, and an instrument that has not itself been checked is a claim.

## F3 (P2) — structural parity was being written up as runtime requirement

Accepted in full. For every agent **except claude-code**, the evidence is *git-ai writes and asserts
this*, which is parity with the upstream writer — **not** a consumer schema and **not** observed
runtime behaviour. The prose had upgraded it: "dispatch gate", "mandatory", "never dispatched",
"never fires".

- `test/support/agent-config-schema.ts` → **`test/support/writer-shape-parity.ts`**;
  `CONFIG_VALIDATORS` → `WRITER_SHAPE_CHECKS`, `ConfigValidator` → `WriterShapeCheck`,
  `SchemaViolation` → `ShapeDivergence`. The reviewer's argument for renaming the *file*, not just
  the comments, is the one that convinced: **under the false name the tests would also reject a
  runtime-correct divergence as if it were a defect.** A test's name is part of its contract.
- Each row in `WRITER_SHAPE_CHECKS` now carries its evidence grade inline.
- **claude-code keeps its runtime language, and it is now stated as the contrast**: *a wrong shape
  disables the whole config* is MEASURED — Jordan's machine, the error verbatim in the fixture. That
  is the one row where "invalid" means invalid-to-the-runtime.

## Verification (delta)

| check | result |
| --- | --- |
| `entry-shape.test.ts` | **39 passed** (was 32) |
| `hooks-verbs.test.ts` | **29 passed** (was 22) |
| hooks suite (23 files) | **407 passed**, every run |
| whole suite, `HARNESS_TEST_SCOPE=all` | **5853 passed / 388 files — GREEN** |
| `just checks` non-test gates | biome ok · typecheck ok · check:docs ok · check:flows ok · check:telemetry-fixtures ok · check:doctrine-parity ok · check:dd-docs ok · root-invocation-smoke ok · dd doctor ok · skills-check ok |
| arch-check · markdown-lint · windows-check | **2 · 211 · 7** — standing baseline, unmoved |

### The gate's `tests` row could NOT be driven green on this machine, and that is a MEASUREMENT

Five full `HARNESS_TEST_SCOPE=all just checks` runs, and the `tests` gate failed every time — on a
**different set of files each time**, never on anything this change touches:

| run | tree | failing file(s) |
| --- | --- | --- |
| 1 | mine | `live-daemon-note.int.test.ts` |
| 2 | mine | `live-daemon-note.int.test.ts` |
| 3 | **`62b86e96`, isolated `--ref` worktree** | `exec-git-write.int.test.ts`, `pty-input.test.ts` |
| 4 | mine | `pty-input.test.ts` |
| 5 | mine | `live-daemon-note.int.test.ts`, `pty-input.test.ts` |

**Run 3 is the control and it is why this is not being waved through.** The parent commit fails the
same gate, on this machine, in a worktree that never saw my diff. The failure set varies run to run,
which a code defect does not do.

The cause is measured, not guessed: **load average 230–280** on a box running thirteen concurrent
seats. All three files are wallclock-bound against shared resources — a live git-ai daemon socket
polled for a bounded 10s (it answers in **1.2s** unloaded), a real PTY, a 64 MiB blob round trip.

**The decisive run:** the whole suite executed directly with self-contention reduced —
`HARNESS_TEST_SCOPE=all npx vitest run --maxWorkers=4` — is **5853 passed / 5853, 388 files, 57s,
zero failures.** The same three files pass together in isolation.

`VITEST_MAX_THREADS=4` does **not** reach the gate: `harness checks` spawns its own vitest and the
variable is not honoured, so there is no supported way to bound the gate's worker count from outside.
Captured as **DL-001** (`harness observe --kind difficulty`) rather than worked around.

**The honest statement of what is proven:** every gate except `tests` is green or at its standing
baseline, the full test suite at CI scope is green when it is not starved of CPU, and the `tests`
gate's redness reproduces on the parent commit. **CI is the authoritative gate and it runs on an
unloaded box** — this needs to be read there, not here.

## Credit

The reviewer re-ran the `entryCommands` mutation itself (5 RED, the same five rows), confirmed the
`docs-content.ts` disclosure via `check:docs`, and left the tree byte-identical. Two of its three
findings were defects our own green suite was actively certifying.

## Softest claim, restated after the delta

**Our reader and our writer now agree about both entry shapes, and a root field we created is
reversible unless something else in the file still depends on it.** Still a claim about structural
agreement with git-ai and about our own provenance — **no agent runtime has been exercised**, on any
of the seven, at any point in this phase.

---

# Re-verdict micro-round — two narrow residuals on `0d95960b`

`pij-ugliest-constrictor` (gpt-5.6-sol) re-verdicted the delta **FIX_REQUIRED** on two residuals.
Everything else it verified clean: the F1 mutations exact (3 RED on the nested reader, 1 RED on the
negative control), F2's removal-no-op 3 RED, the provenance-depth behaviour, a true R066 rename, and
a byte-identical tree.

## R1 — a DIM-0 GAP ON THE EXACT SAFETY CASE THE LOG CLAIMED

The reviewer mutated `entryMayRemove` → `entryIsOwnedByUs` in `foreignHooksRemain`
(`uninstall-strategy-a.ts:259-264`) — the line whose own comment says *"NOT `entryIsOwnedByUs`"* —
and **`entry-shape` + `uninstall` stayed 53/53 GREEN.**

That line encodes the third state of our ownership model: an `ours-with-foreign` entry, one we
refused to delete *because* it chains a peer's work, must count as a peer still in the file. The F2
truth table exercised **wholly-foreign** and **unreadable**. It never exercised **ours-with-foreign**.
So the model has three states, the code branches on all three, and the fixture tested two.

**The shape of this miss is worth naming, because it is not the same as forgetting a case.** The
comment on that line argues for the distinction in three sentences. Writing the argument down is what
made the case feel covered — the same substitution the F1 confession names one section above, inside
the same commit, one file away. *An argument in a comment is a claim; only a row that goes red is
evidence.*

**The row added:** install into a clean gemini config (so we create `tools.enableHooks`), a third
party then chains our `BeforeTool` invocation into its own — the observed normal from dw-0041, not an
exotic case — then the user uninstalls. **Both must survive**: the chained entry because we never
delete work we did not write, and the flag because a field a peer also writes is not ours to clear on
the way out. Our unchained `AfterTool` entry still goes, which is what keeps the row from passing for
the trivial reason.

RED under the reviewer's exact mutation, verbatim:

```
 × CREATED + AN OURS-WITH-FOREIGN ENTRY REMAINS → RETAINED, both of them 4ms

 FAIL  test/services/hooks/entry-shape.test.ts > A ROOT FIELD IS REMOVED ONLY IF WE CREATED IT
       AND NOBODY ELSE NEEDS IT > CREATED + AN OURS-WITH-FOREIGN ENTRY REMAINS → RETAINED, both of them
AssertionError: expected undefined to be true // Object.is equality
- Expected: true
+ Received: undefined
 ❯ test/services/hooks/entry-shape.test.ts:557:33
 Tests  1 failed | 53 passed (54)
```

**One RED, and only that row** — 53/53 green before it existed, 1/54 red after, so the row is
carrying the mutation on its own rather than riding a neighbour. Mutation reverted; source
byte-identical (`git diff --stat` empty).

## R2 — F3 RESIDUE OUTSIDE CLAUDE-CODE

Three sites the reviewer named still upgraded structural parity to a runtime requirement, each
contradicting the disclaimer sitting ~10 lines above it in the same file:

| site | was | now |
| --- | --- | --- |
| `entry-shape.test.ts:297` | `ROOT FIELDS THE AGENT REQUIRES — well-formed and DEAD without them` | `ROOT FIELDS THE UPSTREAM WRITER EMITS — git-ai sets them, so we match` |
| `entry-shape.test.ts:384` | `…removing them breaks git-ai` | `…WHEN A PEER REMAINS` |
| `config-writer.ts:119` | `root fields an agent requires` | `root fields the upstream writer emits`, + the parity disclaimer inline |

**Three more of the same class, found by sweeping rather than by being told** — the lesson from the
F1 confession applied for once at the right moment: `entry-shape.test.ts:376` (*"an agent with NO
root requirement"*), `:484-492` (*"the peer is genuinely live"*, *"a peer that is dispatching"*), and
`uninstall-strategy-a.ts:222` (*"silently switches off somebody else's attribution"*). All restated.
Every one of them was mine, written in the commit that shipped the F3 sweep.

**The retention argument survives the restatement, and is arguably stronger for it.** It never
needed the flag to gate dispatch — *no runtime has been exercised either way* is itself the reason to
retain, because clearing a field a peer also writes can only ever risk that peer and never help it.
The runtime language was decoration on an argument that stands without it.

**claude-code keeps its runtime language deliberately**, as the contrast: *"a wrong shape disables the
whole config"* is MEASURED — Jordan's machine, the error verbatim in the fixture. It is the one row
in this phase where "invalid" means invalid-to-the-runtime, and the surrounding rows now read as the
weaker claims they are.

## Verification

| | |
| --- | --- |
| hooks suite, fast scope | **408 / 408**, 23 files |
| hooks suite, `HARNESS_TEST_SCOPE=all` | **442 / 442**, 25 files (was 441 — the one new row) |
| biome, touched files | clean, 17 files |
| typecheck | exit 0 |

Full-suite figures and the gate's load story are in the run below; the box is still carrying
thirteen seats at load ~180-210, so the same bounded-worker method as the previous round applies and
is quoted rather than restated as a green.

### The gate, this round — same story, same file, and I am not calling it green

| | |
| --- | --- |
| full suite, `HARNESS_TEST_SCOPE=all --maxWorkers=4` | **5854 / 5854, 388 files, 52.6s, zero failures** |
| `HARNESS_TEST_SCOPE=all just checks` | **RED on `tests`: 5853 / 5854, 387 / 388 files** |
| the one failure | `live-daemon-note.int.test.ts:214` — `expected null not to be null` |
| that file, rerun alone at full scope | **2 / 2 passed, 3.9s** |
| every other gate | `biome:ok typecheck:ok check:docs:ok check:flows:ok check:telemetry-fixtures:ok check:doctrine-parity:ok check:dd-docs:ok root-invocation-smoke:ok dd doctor:ok skills-check:ok`, and `arch-check 2 · markdown-lint 211 · windows-check 7` — **baseline unmoved** |
| load average during the gate | **214 / 232 / 215**, thirteen seats |

**`live-daemon-note` is the same file that failed runs 1, 2 and 5 of the previous round**, and the
control for it is already on the record: run 3 was `harness checks --ref 62b86e96` in an isolated
worktree that never saw any of this work, and it failed the same gate on a *different* file set. That
control was not re-run tonight because nothing in this micro-round touches the daemon path — the
diff is one test row and six comment restatements, in three files, none of them
`live-daemon-note.int.test.ts` or anything it imports.

**So the claim is the scoped one, not the general one:** the full suite is green at bounded workers,
the touched surface is 442/442, the failure is a wallclock-bound daemon probe (1.2s unloaded, 10s
budget) losing a race on a box at load 214, and it passes alone in 3.9s. **I am not writing "just
checks green" and nobody should read this as a general green.** CI is the authoritative gate and it
runs unloaded.

**DL-001 stands and this is its second consecutive night** — *the gate cannot distinguish "this diff
is broken" from "this machine is busy"*. Every round that ends with a paragraph like this one is
evidence for fixing the instrument rather than for getting better at explaining it.

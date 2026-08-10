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

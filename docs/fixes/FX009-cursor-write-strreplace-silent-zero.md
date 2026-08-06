# FX009 — Cursor `Write`/`StrReplace` edits produce a silent 0% agent share

**Status**: allocated, NOT started. **Owner**: unassigned — worktree + stream
requested from o-prime 2026-08-06.
**Cuts from**: `origin/main` @ **`e756d091`** (see § Base, below — this is
load-bearing).
**Severity**: Critical — silent data loss producing a *plausible but wrong*
number, not an error.
**Component**: `harness/cli/src/services/telemetry/adapters/cursor-adapter.ts`
**Regression from**: plan 066 / PR #88 (`895644a5`) — a specimen-coverage gap,
not a coding error.

## Scope — Jordan's ruling, 2026-08-06

**`Telemetry.Cursor.working` is the objective. Cursor is the priority.**

The deliverable is: a Cursor session's file writes are captured and yield a
correct agent-contribution share. Everything in this brief is judged against that
one outcome.

**Claude-side findings are LOGGED, NOT WORKED.** They are recorded here for
traceability and must not consume stream time or widen the diff. See
§ Logged-not-worked.

In-scope work that happens to touch shared code is still in scope — the V4A
parser and the segment path helpers sit on Cursor's own path, so fixing them is
Cursor work. Copilot benefiting is a side effect, not scope creep.

## Source documents

| Doc | What it is |
|---|---|
| `scratch/paste/20260806T015432.md` | The original issue report from the other machine — detailed, mostly correct, **five errors** |
| `scratch/paste/20260806T015432-REVIEW.md` | My validation of it against the code. **Read this second and treat it as the corrections layer.** |

Do not implement from the issue report alone. Three of its instructions are
wrong and one names a function that does not exist.

## The defect

`cursor-adapter.ts:366` gates file-event extraction on
`name === 'ApplyPatch' && typeof b.input === 'string'`. A Cursor build that edits
via `Write` / `StrReplace` (object inputs) falls through **both** gates, so the
adapter emits zero `file` events while the tool histogram still counts the calls.

Downstream the pipeline does not error, does not degrade, and does not mark the
surface unavailable — it publishes a well-formed report attributing 100% of the
agent's lines to a human. Reported case: **410 committed lines → 0.0% agent**.

This violates plan 068's contract directly — *"a zero is a measurement, a null is
a gap"* — and it **inverts** the bias direction `measuring-ai-contribution.md`
promises (*"always … inflates the agent's share, never the human's"*), so a
consumer applying the documented reasoning reasons the wrong way.

## Corrections that change the fix (from the review — full detail there)

1. **`accumulateFileEvent` does not exist.** `file-delta.ts` exports exactly
   `computeFileDelta` and `writtenDelta`. Drop every reference to it.
2. **Do not copy the Claude adapter for same-path handling.** It uses
   `Map.set()` (`claude-adapter.ts:420,564,577`) — last write wins, earlier
   deltas discarded. Follow the **cursor** adapter's existing array-push; the
   join sums per path already.
3. **The IDE-vs-headless explanation is refuted.** All three Cursor transcripts
   on Jordan's machine — including two IDE sessions — use `ApplyPatch`. The real
   discriminator is a **Cursor version/vocabulary migration**: the whole toolset
   is renamed (`ReadFile`→`Read`, `AwaitShell`→`Await`, `+Grep`), not just the
   edit tool. Therefore: **support both vocabularies simultaneously, never
   deprecate `ApplyPatch`, and expect the names to move again.**
4. **The reported 0% does not evidence this defect.** Every segment in that run
   was `win=0..0` (capture stall), which explains the zero on its own. The tool
   gap stands on **code reading**, which is sound. Keep the two separate, and fix
   tool coverage first as the report advises.
5. **Line-number corrections**: `segment.ts:1448-1449` (not 1264-1265),
   `copilot-adapter.ts:128` (not 127).

## Primary deliverable — reordered

Because of (3), the issue report's §7.4 is promoted from "strongly recommended"
to **the primary deliverable**:

> When a `tool_use` block carries a `path`/`file_path` key but matches no known
> extraction strategy, count it (`unhandled_write_tools`) and surface it in
> `harness doctor` / `degraded[]`.

It is the only part of this fix that survives the next Cursor rename. Ship it
first; the two new extraction branches are the cheap part. Then the table-driven
tool→strategy mapping (issue report §7.3.1), populated with **both** vocabularies.

## Non-negotiables carried from the review

- **Windows path shape is a hard requirement, not a nice-to-have.** Observed
  paths are `c:\src\…`; the existing fixture is POSIX-only, so nothing covers it,
  and a confinement miss leaks absolute machine paths.
- **Privacy re-verification is the highest-risk item.** `contents` /
  `old_string` / `new_string` are full file text and must be consumed only inside
  the delta helpers, never retained. Extend the existing planted-secret assertion
  to the new branches (AC-04).
- **Fixture gap**: the corpus has no IDE-agent Cursor session, so
  `check:telemetry-fixtures` cannot catch a regression on this path. Minting one
  needs the reporter's specimen — see § Blocked-on.

## Also in scope — on Cursor's own path (verified real)

These are Cursor work despite living in shared files: Cursor's paths flow through
all three.

- `segment.ts:1448-1449` — `files.written`/`files.edited` go through
  `relativizePath`, which falls back to **basename** out-of-repo, while `file`
  events correctly collapse to `<external>`. The code already knows: the comment
  at `segment.ts:522` says *"Deliberately NOT relativizePath, which drops [to]
  basename."* **This fix increases exposure**, since Cursor populates both
  surfaces. In scope as a privacy consequence of the primary change.
- `copilot-adapter.ts:128` — `raw.trim()` lets an indented patch **context** line
  parse as a header, publishing body text as a path; and `(.+)` makes the
  empty-path reset branch unreachable. This is the **V4A parser Cursor's
  `ApplyPatch` branch calls**, so it is on Cursor's path. Copilot benefits as a
  side effect.
- V4A `*** Move to:` renames unhandled — same shared parser, same reasoning. The
  delta stays on the old path, breaking the path-keyed join.

If any of these threaten to widen the diff beyond what
`Telemetry.Cursor.working` needs, drop them to a follow-up rather than growing
the stream. The primary outcome outranks them.

## Logged-not-worked (Jordan's scoping, 2026-08-06)

Recorded for traceability. **Do not work these in this stream. Do not let them
into the diff.**

- **`claude-adapter.ts` `Map.set()` overwrite** (`:420,564,577`) — last write per
  path wins, so churn on any file Claude touches more than once in a window is
  silently dropped, which is most files. Verified by code reading. Claude-side,
  therefore out of scope here; raise as its own defect when Cursor is working.
- The reported session's **`win=0..0` capture stall** is a plan-070-class issue,
  not this fix. Judge it only *after* tool coverage lands and a re-run can
  separate the two causes.

## Base — why `e756d091` specifically

Jordan's instruction: this is telemetry work, so it must carry the recent
telemetry PRs. `origin/main` @ `e756d091` contains all of:

| Commit | What |
|---|---|
| `e756d091` | **#101** — FX007, the published reader could not read its own repo's telemetry |
| `66516836` | **#100** — stop scanning the whole Copilot log dir on every command |
| `f50a0e88` | FX002 + FX003 + FX004 + the read pin at the floor |
| `f78957e3` | plan 070 — capture liveness + orphan-lane reconciliation (schema 2.7) |
| `895644a5` | plan 066 — the cursor ApplyPatch path this extends |

Local `main` and `origin/main` are identical at `e756d091` (verified
2026-08-06). Cutting from `origin/main` gets everything; do not branch from an
older base.

**FX007 is fixed and verified**: `harness telemetry pull` now returns
`status: ok`, 6 blobs, `completeness: "complete"` against the real remote. Any
guidance saying to avoid `telemetry pull` because of E222 is stale.

## Blocked-on (non-blocking for the code, blocking for the fixture)

Session `71282df5-d151-4dce-82cc-17a1a3d31f93` is **not on origin**, so the
issue report's tool histogram (§5.1), payload shapes (§5.2) and projected numbers
(§9) are INHERITED — UNVERIFIED. Ask the reporter to push the ref or attach the
scrubbed transcript. It is also the natural specimen for the missing IDE-agent
fixture.

The code fix does not need it. The regression guard does.

## Standing constraints

- **Never** mutate `refs/harness-telemetry/*`; `2026/06/23/15eaa924` is untouchable.
- `government/` content must never be committed as-is (requires fixture-scrub).
- Prefix your own commits with `HARNESS_NO_TELEMETRY=1`.
- A segment wire-version bump is a Jordan decision, not a stream decision.
- `docs/how/measuring-ai-contribution.md`'s blind-spot list must be updated as
  part of this — its own warning (*"Adding a new agent tool that writes files
  requires updating this list, or the share will drift downward silently"*) is
  precisely what went wrong.

## The defect class, in the stream lead's words

> The silent zero is not that the adapter is silent; it is that the LOUD surface is the
> honest one and the QUIET surface is the one everybody reads.

The supporting fact: for the very same segment, `caps.files` returns `null` — an honest
gap — while the event stream yields **0** file events, which becomes a confident `0.0%`
downstream. Two surfaces of one missing measurement disagree about it, and the one that
lies is the one consumers use. That asymmetry, not the missing branch, is what made a
critical data-loss defect look like a normal report for as long as it did.

## Follow-up — RECORDED ONLY, must not enter this diff

**A registry-independent detector already exists in that disagreement.** `files == null`
while file events `== 0` is the same condition the FX009 counter tests, with **no tool
table needed**: it compares two surfaces of one segment against each other rather than
against a list of names we maintain. It is the natural fallback if the closed registry in
`cursor-tools.ts` ever drifts — and it is harness-agnostic, so it would also cover the
Claude/Copilot rename that the Cursor-scoped counter deliberately does not.

It is recorded here and **not built**. The registry-based counter is the one shipped,
because it names the offending tool (telling a reader what to add) where the surface
disagreement can only say that something is missing.

## Decisions taken in the fix, with their costs

Each of these is a choice, written down so a later reader finds a decision rather than an
oversight — "nobody noticed" is the failure mode this whole stream exists to stop.

### The counter is scoped to Cursor

The registry is Cursor's vocabulary. Applied unscoped, Claude's `TodoWrite`/`Task` would
classify as unknown and fire on nearly every window; a marker that fires everywhere is
ignored, and an ignored marker is the silent zero again.

**Cost, stated**: a future Claude or Copilot write-tool rename is **not** covered by this
counter. That cost is also recorded in `docs/how/measuring-ai-contribution.md`'s Known
blind spots, because a cost disclosed only in a stream conversation dies with the stream —
and that list going un-updated is what caused FX009 in the first place.

**Guard**: the scope predicate is itself a claim, and a scope gate that silently matches
nothing would make the counter quiet — this defect one level up, inside the mechanism built
to detect it. So the predicate is pinned to the corpus by a test that asserts the harness id
it matches is the one both real cursor fixtures actually carry (in `expected-segment.json`
**and** `meta.json`). If Cursor's harness id changes, that test fails loudly.

### The marker rides the existing `event_skipped:` prefix

`acts/telemetry.ts` filters `degraded[]` for `metric_skipped:`/`event_skipped:` and declines
to report `ok` when either matches. Naming the marker
`event_skipped:unhandled_write_tools:<tool>` therefore **downgrades the envelope by
construction** — no gate change, no schema change, and no edit to `acts/telemetry.ts`.

The rejected alternative was a bare `unhandled_write_tools:` prefix, which would have sat in
an array that nothing reacts to: a signal that never reaches the surface consumers read,
which is FX009 a third level up, installed inside the fix for FX009.

### The counter fires on EMPTY EXTRACTION, never on an unknown name

The original issue report asked for a counter on a `tool_use` whose **name** matches no
known strategy. That trigger would have reinstalled the defect: add a `Write` branch, guess
its payload keys wrong, and the tool is now *known* — the branch runs, yields nothing, and a
name-triggered counter never fires. The condition shipped is per segment: **write-capable
calls > 0 AND `file` events == 0**, so it guards our own guess as well as the next rename,
and it needs no payload access at all.

### `files.written`/`files.edited` are confined, not relativized

Those lists went through a basename fallback for out-of-repo paths (publishing `keys.env`)
while `file` events for the same write already collapsed to the `<external>` sentinel. Cursor
populates both surfaces, so extending its extraction *increases* what the leaky one carries —
the swap is a consequence of this change, not unrelated cleanup.

**Cost, stated**: repeated `<external>` entries now collapse to one, so **the count of
distinct out-of-repo files is no longer recoverable** from that surface. In-repo duplicates
are preserved deliberately, because that multiplicity is real churn evidence. A privacy
improvement that silently changes a number is still a silently changed number.

## Specimen — the blocked-on item cleared

The reporter's session was scrubbed and committed as the corpus instance
`fixtures/real/cursor/2026-08-06-write-strreplace`, so the payload shapes are no longer
inherited: `Write` carries `{contents, path}` and `StrReplace` carries
`{old_string, new_string, path}`, measured against the real transcript. The tolerant
alternates (`file_path`, `content`) are kept anyway — they are slack for the next rename, not
evidence of a producer.

**What the fixture cannot carry**: the scrub rebased the machine paths, so the committed
transcript keeps the Windows **backslash separators** but loses the lowercase **drive
letter**. Drive-letter confinement is therefore covered by synthetic unit tests instead,
which need no real machine data. Stated rather than left to be discovered.

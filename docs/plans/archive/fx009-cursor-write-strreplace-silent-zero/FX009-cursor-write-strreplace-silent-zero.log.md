# FX009 — execution log (coder: pij-desperate-turkey)

**Branch**: `fix/fx009-cursor-write-strreplace` (from `e756d091`) ·
**Dossier**: `FX009-cursor-write-strreplace-silent-zero.md`
**PMs**: `pij-prickly-owl` → `pij-respectable-clam` (handover mid-stream; owl's rulings
carried forward intact, and its own §4 was retracted by the stream lead — see *Marker
naming* below).

## Baseline (before any change)

The failing-first proof was already written and was reproduced unmodified before a line was
touched:

```
npx vitest run harness/cli/test/services/telemetry/cursor-object-write.test.ts
→ 3 failed | 2 passed (5)
```

The two passes are the deliberate controls — the `tools` histogram (`{Write:1, StrReplace:1}`,
proving the adapter *sees* the calls, so the extraction gate is the sole cause) and an
`ApplyPatch` regression control. No assertion in that file was edited, relaxed, or deleted.

## Order of work — the counter first, and why that was not ceremony

The counter was built **before** the extraction branches, and building it in that order
changed what it is. Written afterwards it would have been a check on code known to work
against inputs known to be right, and the obvious trigger — *a tool name matching no known
strategy* — would have looked sufficient.

It is not sufficient, and that is the whole deliverable. At the time the branches were
written the `Write`/`StrReplace` payload keys were **inherited, unverified**: no specimen
existed on this machine, so nothing could refuse a wrong guess. Under a name-triggered
counter, a wrong guess is invisible — the tool is *known*, the branch runs, it extracts
nothing, and the counter stays silent. The silent zero moves one level deeper and gets
harder to find, installed by the fix for a silent zero.

So the trigger is **empty extraction**, evaluated per segment, read-side:

> write-capable tool calls > 0 **AND** `file` events for that segment == 0 → fire.

It guards our own guess and the next rename with one condition, and it touches no payload,
so the privacy question does not arise inside it at all.

The specimen arrived later and confirmed the keys (`Write` → `{contents, path}`,
`StrReplace` → `{old_string, new_string, path}`). **The counter was not weakened afterwards
and the tolerant key matching was not narrowed.** Green tests over a confirmed shape prove
self-consistency today; they say nothing about the next build, and this toolset has already
been renamed twice on this machine.

## What was built

| Piece | Where | Note |
|---|---|---|
| Closed tool registry | `adapters/cursor-tools.ts` (new) | one table, read by BOTH capture-side dispatch and read-side classification, so the two cannot drift into two lists |
| Read-side counter | `session-export.ts` | marker into the EXISTING `degraded: string[]` — no segment field, no schema bump |
| Object-input extraction | `adapters/cursor-adapter.ts` | `Write` → `writtenDelta`, `StrReplace` → `computeFileDelta`, `ApplyPatch` string unchanged |
| V4A header hardening | `adapters/copilot-adapter.ts` | `parseApplyPatchDeltas` — Cursor's own parser |
| Path confinement | `segment.ts` | `files.written`/`files.edited` now use `confineFilePath`, not the basename fallback |
| Real corpus instance | `fixtures/real/cursor/2026-08-06-write-strreplace` | the reporter's scrubbed session — the only evidence of this vocabulary in the corpus |

### No schema change, by construction

A new top-level segment key was impossible in this stream: `segment.schema.json` is
`additionalProperties: false`, `segment-schema.test.ts` asserts the schema's property set
equals `SEGMENT_FIELD_KEYS` exactly, and that set is pinned to a frozen v2.7 snapshot. A new
key means 2.7 → 2.8, which is not a stream-level decision.

Read-side is also strictly better than capture-side: it classifies segments **already on the
wire**, retroactively, including the session that triggered the report. A capture-side
counter could only ever have helped sessions captured after it shipped.

### Marker naming — the correction that matters

The first ruling was a bare `unhandled_write_tools:<tool>` prefix, with a note to document
that it would not change the envelope status. The stream lead retracted that: `acts/telemetry.ts`
downgrades the envelope for `metric_skipped:`/`event_skipped:` entries only, so a bare prefix
would have parked the marker in an array nothing reacts to — **a signal that never reaches
the surface consumers read, which is FX009 one level up**.

Shipped as `event_skipped:unhandled_write_tools:<tool>`: the downgrade happens by
construction, with no gate change and no edit to `acts/telemetry.ts` (which is outside the
fence either way). Semantically exact, too — a `file` event that should have existed did not.

## Evidence

| Control | What it proves |
|---|---|
| `cursor-object-write.test.ts` (unmodified) | 3 fail → 5 pass. The failing-before/passing-after transition |
| `fx009-unhandled-write-tools.test.ts` (new, 13 tests) | the counter fires on a KNOWN write tool with empty extraction **and** on an UNKNOWN name; stays silent when file events exist, on a write-free toolset, and on another harness |
| `2026-06-25-checks-walkthrough` (real fixture) | must-NOT-fire, and a **table-completeness** guard: were `Read`/`Glob` missing from the registry they would classify as unknown and fire on a write-free session |
| `2026-08-03-applypatch-textstat` (real fixture) | must-NOT-fire from the other direction — write calls present *and* file events present |
| harness-id corpus pin | the scope predicate matches the id both real fixtures actually carry, in `expected-segment.json` and `meta.json`. A gate that matched nothing would make the counter quiet — indistinguishable from finding nothing |
| `2026-08-06-write-strreplace` (new real fixture) | 14 file events (6 written + 8 edited) from the vocabulary that previously produced zero |
| planted-secret controls | `contents`/`content`/`old_string`/`new_string` never reach the capabilities *or* the serialized segment; the fixture test re-derives every payload string from the raw transcript and asserts none of it survives |
| Windows controls | drive-letter in-repo → relative, out-of-repo → `<external>`, different drive → `<external>`, case-insensitive drive; the fixture covers separators end to end |
| `copilot-adapter.test.ts` (3 new) | an indented header-shaped line is not a header; CRLF; empty-path header resets |

Full telemetry suite: **1666 passed**. `harness checks`: green.

### Blank is content, not absence (review fix)

Review caught the body-key presence check: `firstString` skipped any candidate whose value
trimmed to empty, so `contents: ''` was treated as *absent* and the write was dropped. It is
broader than the empty-file case — `'\n\n\n'` (3 added lines) and `'   \n  '` (2 lines, 5
bytes) are real content and were discarded too. Both directions corrupt the honesty
mechanism: **alone** in a segment the dropped write leaves zero file events, so the counter
fires and downgrades the envelope on a **false positive**; **in company** with another write
the counter stays quiet and the write is silently lost — FX009's own failure mode installed
inside FX009's fix. Body keys now use `firstPresentString` (`typeof === 'string'`); the
blank guard **stays** on `path`, where a blank value is genuinely invalid. Four controls,
each proven non-vacuous by restoring the trim guard (4 red): empty, blank-lines-only,
whitespace-only, and a counter test driving the adapter end to end so a `+0` write still
counts as extraction.

### Same-path churn is an array push, and the golden bakes that in

The specimen edits `lib.test.mjs` six times, `cli.mjs` three times and `README.md` twice.
The claude adapter's `Map.set` (last-write-wins) would have collapsed those into one delta
per path and permanently encoded under-counted churn in `expected-segment.json`. The cursor
adapter's existing array push is kept; the downstream join sums per path. The golden proves
it: 14 events over 6 distinct paths.

## What I could NOT verify — stated plainly

- **The reported 410 lines → 0.0% number is still not reproduced end to end.** The fix is
  proven at extraction and at the read surface; the reported run also had every segment at
  `win=0..0` (a capture stall, a plan-070-class issue explicitly out of scope here), which
  explains a zero on its own. The two causes stay separate until a re-run can distinguish
  them. This fix removes one of them.
- **The line totals I measured do not match the 438 quoted in the stream.** From the
  scrubbed specimen the array-push extraction yields **432 lines added + 22 removed** (454
  total churn). A naive line count of each payload — `contents` and `new_string` counted
  whole — gives 467 added + 57 removed. Neither is 438. The likely cause is the
  multiset-difference convention `computeFileDelta` uses (shared anchor lines present on
  both sides of a `StrReplace` cancel and are not counted as churn), which the brief
  mandates. Flagged rather than reconciled by adjusting anything: the number in the golden is
  what the repo's own delta helpers measure.
- **No IDE-agent Cursor session** is in the corpus still; the new instance is headless with
  respect to this machine (its `cursorDiskKV` bubbles live on the reporter's box), so every
  event is interval-grade. The anchored-timing path for this vocabulary is covered only by
  synthetic tests.

## Dropped / not done

- **V4A `*** Move to:` rename handling** — dropped to follow-up by the stream lead; not in
  this diff.
- **`parseApplyPatchPaths`** (the sibling of the hardened parser, same file) has the same
  `raw.trim()` header weakness. It is **copilot-only** — Cursor's branch never calls it — so
  it was left alone rather than widening the diff. Noted here so it is not lost.
- **The registry-independent detector** (`files == null` while file events `== 0`) is
  recorded in the dossier as a follow-up and deliberately not built.
- **Envelope-status semantics beyond the prefix** — raised upstream by the PM, not resolved
  here.
- **Claude `Map.set` churn loss** and the `win=0..0` capture stall — logged-not-worked, kept
  out of the diff.

## Notes for the next reader

The fixture privacy scanner earned its keep during this work: it flagged an illustrative
Windows path I had written into the new `meta.json` prose. Nothing real leaked, but the
liveness of that guard is not theoretical — it caught its author.

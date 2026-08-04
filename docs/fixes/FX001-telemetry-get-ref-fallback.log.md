# FX001 execution log

(started 2026-08-05 — entries appended by the fix coder)

## Orchestrator ruling note (2026-08-05, pij-related-koala)

D2 consequence, stated plainly for every future reader: A10 (gate-refused)
was not answered badly by the eval runs — it was STRUCTURALLY UNANSWERABLE
for any flushed session, ever, because the OTLP roll dropped
command_exit.code (0 coded exits across all 112 telemetry refs). An
unanswerable assertion reporting `unknown` looks identical to a subject
that simply never hit a gate; runs 20260804-160553Z-rictor and
20260804-210515Z-dkoala are the former, and their telemetry lanes are
evidence of NOTHING about subject behaviour. D2's fix is prospective;
historic refusal bytes were never encoded and cannot be recovered.

## Coder seat

`pij-blonde-pig` (Claude, model `claude-opus-5`, effort `high`), worktree
`s065-deterministic-documents`, branch `s065/deterministic-documents`.
Dispatch sha: `57d9cda5` (dossier) → `d2af7866` (Ruling #1 amendment).

## Baseline — `just checks` at `57d9cda5`, before any code change

`just checks` → exit 0, envelope `status: degraded`, `durationMs: 48114`.
14 gates, 11 `ok`; the WARN TRIO (warn-launch, non-blocking) is the no-regression target:

| gate | status | note |
|---|---|---|
| `arch-check` | degraded | 2 warn-severity architecture violations (rules: `services-ports-type-only`) |
| `markdown-lint` | degraded | 196 findings (194 markdown lint, 1 in-repo links/anchors, 1 mermaid syntax) |
| `windows-check` | degraded | 6 cross-platform hazards in 2 rule classes [WIN004x1, WIN007x5] |

Attribution note: `d2af7866` (the Ruling #1 amendment) is docs-only and lands between the
baseline sha and my first commit, so a small markdown-lint count move is attributable to
that doc, not to this fix.

## Live repro of the headline defect (pre-fix, at `57d9cda5`)

```text
$ node harness/cli/bin/harness.js telemetry get pij-related-koala --json
exit 1
{"command":"telemetry","status":"error","error":{"code":"E100",
 "message":"no telemetry found for pij session 'pij-related-koala'"}, ...}
```

## Recon — three defects, only one of them the dossier's

Read-only probes over this clone's 112 local `refs/harness-telemetry/*` refs (18,319
decoded segments), driven through the built `ExecGitRead` + `readRefSegments`.

**D1 — the dossier's defect; its pre-fix failure has TWO shapes.**
A partial fallback already existed (`session-evidence.ts:555-566`, joining `readRefLanes`
on `pij_session_id`). It filled only `harness_session_id` / `segments` / `token_evidence`,
leaving `skills`, `tools`, `flow_seams` and `refusals` EMPTY. So a flushed session that
DOES carry the pij join key returned hollow evidence (not `E100`), while one with no join
key on the ref returned `null` → `E100` (the live case above). Either way every derived
view the conformance scorer asserts on came back empty.

**D2 — the OTLP roll DESTROYED `command_exit.code`** (new; ruled IN SCOPE).
`otlp/logs.ts` encoded only `CMD_VERB`/`CMD_EXIT`/`CMD_STATUS` and the decoder never read a
code. `segment.ts` decode DOES preserve it, so the loss was specific to the rolled
`session.logs.jsonl` every ref stores. Counts, pre-fix: koala's ref `71679da4-...` holds
**357** `command_exit` events, **0** carrying a code; across all 112 refs, **0** coded
exits; the string `E440` appears in **0** refs and **0** local buffers (worktree + main
checkout). Historic refusal bytes are unrecoverable — never encoded. The fix is prospective.

**D3 — `pij-related-koala` has no PIJ join key on the ref** (spun out to prime).
Its harness session `71679da4-5249-4e02-9117-68a3abf3ed0e` holds 487 ref segments, ALL with
`captured_env: {}`; 398 segments elsewhere carry `PIJ_PARENT_ID=pij-related-koala` (its
children). Zero segments anywhere carry `PIJ_SESSION_ID=pij-related-koala`. Known
adopted-root-seat capture gap — capture-side, not read-side.

## T3 — controls, planted-bad both ways

New file `harness/cli/test/services/telemetry/fx001-ref-fallback.test.ts` (10 tests).
Fixtures come from the REAL pipeline — `serializeSegment` → `syncTelemetry` (which writes
the rolled ref AND prunes the buffer) → the ref read back through the READ port — so the
shape under test is the production rollup, not a bespoke one.

**Pre-fix run (src reverted to `d2af7866`, same test file): 6 of 10 FAIL.**

| control | pre-fix result |
|---|---|
| (a) flushed buffer + present ref → whole session from the ref | FAIL — `expected {} to deeply equal { 'the-flow': 1 }` (hollow evidence) |
| (b) both surfaces empty → `null` / E100 | pass (guard — must not fire) |
| (c) populated buffer → unchanged, `source: buffer` | FAIL — `expected undefined to be 'buffer'` |
| (d) wrong-session control: another session's ref must NOT satisfy the join | pass (guard — must not fire) |
| flushed half + unflushed delta → `source: buffer+ref` | FAIL — `expected undefined to be 'buffer+ref'` |
| ref namespace absent locally → honest, never fatal | pass (guard) |
| D2: `command_exit.code` round-trips through the rolled record | FAIL — decoded event carries no `code` |
| D2: a non-E-code value is REFUSED by the wire contract | FAIL — `expected undefined to be defined` (no attribute existed at all) |
| act: `telemetry get` on a flushed session exits 0, `source: ref` | FAIL — `expected undefined to be 'ref'` |
| act: `telemetry get` still errors E100 when BOTH surfaces empty | pass (guard) |

The four passing controls are the ones that MUST NOT fire — they prove the suite can still
say no. **Post-fix: 10 of 10 pass.**

## The fix

- `otlp/semconv.ts` — new `A.CMD_CODE = 'harness.command.code'`.
- `otlp/logs.ts` — `command_exit` gains `optionalString(A.CMD_CODE, 'e-code')`; new
  `e-code` string role validated by `/^E\d{3}$/`; encode writes the code, decode reads and
  RE-validates it. A record carrying anything else is refused by the strict reader, exactly
  as for every other contract attribute.
- `services/telemetry/ref-source.ts` — new `telemetryRefsPresent(gitRead)`: is there a ref
  namespace to check at all (fail-safe `false`).
- `services/telemetry/session-evidence.ts` — `SessionEvidence` gains `source`
  (`buffer` | `ref` | `buffer+ref`) and `ref_checked`; `fold()` takes an `origin`
  (`live` | `ref`) that stamps the token evidence and marks a rolled ref whole-session; the
  partial `readRefLanes` branch is REPLACED by `foldFromRefs()` — a full fold of the ref's
  segments joined on the same `PIJ_SESSION_ID` key. `null` (→ `E100`) now means both
  surfaces were empty.
- `acts/telemetry.ts` — `--help` states the fallback and the provenance fields; the human
  line prints `[source: ...]`; the `E100` `next_action` says BOTH surfaces were checked.

## Drift gates — the deliberate steps (Ruling #2)

Two closed schemas had to move. Neither was a fixture regeneration.

**`otlp/harness-otlp.schema.json`** — the frozen `harness.*` attribute contract the
eng-thrive scraper binds to. Added `harness.command.code` in place; `scope_version` and
`$id` STAY at `2.6`. The reasoning, so the next reader does not re-litigate it from the
bare `additionalAttributes: false`:

1. `additionalAttributes: false` is enforced nowhere at runtime — one test line asserts it
   (`harness-otlp-schema.test.ts:100`, "closed set (no smuggled attrs)"). It is a
   PRODUCER-side claim (we emit nothing outside this list), not a consumer promise that the
   list never grows.
2. `docs/how/telemetry-otlp.md:75` prescribes exactly this procedure: "To swap a semconv
   name when it stabilises, edit `semconv.ts` and the frozen contract, nothing else."
3. `scope_version` MIRRORS the segment schema version (documented "kept in lockstep with
   Segment 2.5"; `schemaIdentityForSegmentVersion` implements it). It is not a vocabulary
   version — a `2.7` scope with no Segment 2.7 would break a stated invariant.

Finding, NOT fixed here (already stale before FX001; fixing it is scope creep):
`docs/how/telemetry-otlp.md:67-68` still says schema_url `v0.2.0` / scope `2.5` while the
code is at `v0.3.0` / `2.6`.

Spun to prime, not this fix: vocabulary ADDITIONS have no version handle at all, because
`scope_version` is bound to the segment ladder. That is a wire-policy decision.

**`fleet-export.schema.json`** — the closed per-session evidence object. `source` and
`ref_checked` leaked into the fleet payload and tripped AC-07 plus the 051 golden (2 and 8
violations). Both added as REQUIRED properties with descriptions. Verified per Ruling #2:
every `SessionEvidence` in `harness/cli/src` is constructed by `fold()`, which always sets
both fields — call sites are `session-evidence.ts:573`, `session-evidence.ts:601`,
`fleet-evidence.ts:859`, `fleet-evidence.ts:958`; no other construction site exists (the
only cast is the extension's `env.data as SessionEvidence` over the CLI's own JSON).
`fleet-evidence.ts:859` additionally now states the lane's own provenance instead of taking
the `buffer` default, so a lane folded from the durable union does not claim the ref
contributed nothing to a number it produced.

**Regeneration clause, and its consequence.** `check:telemetry-fixtures` stayed `ok`
throughout and `gen:telemetry-fixtures` was NOT run and was NOT needed: no committed golden
holds a coded `command_exit`, because none has ever existed. The consequence, stated rather
than left for a reader to assume: **no golden exercises the new encode path**, so the D2
round trip is pinned ONLY by the two new controls in
`fx001-ref-fallback.test.ts` ("command_exit.code round-trips through the rolled logs record"
and "a non-E-code value is REFUSED by the wire contract"). That is acceptable coverage —
they are direct, both-ways, and one of them is a planted-bad — but it is not redundant
coverage.

## T4a — live fallback proof against `pij-key-constrictor` (PROVEN)

```text
$ node harness/cli/bin/harness.js telemetry get pij-key-constrictor --json
exit 0   status: degraded (token coverage partial — unrelated to the fallback)
  pij_session_id:     "pij-key-constrictor"
  harness_session_id: "a7bda1ce-3994-45fb-8c0e-5148113c93f1"
  segments:           28
  source:             "ref"
  ref_checked:        true
  skills:             {"builder": 1, "eng-harness-flow": 4, "validate-v2": 1}
  tools:              6 distinct    flow_seams: 3
  duration_s:         2450
  refusals:           {}
  token_evidence:     coverage partial, source "ref"
```

28 segments — the same 28 the dossier found sitting on
`refs/harness-telemetry/2026/08/04/a7bda1ce-*`. Pre-fix, that same session returned an
empty-derived-view lane: replaying the OLD path against the real `ExecGitRead` shows
`readRefLanes` DID find the lane (`segments: 28`, `measured: false`) but the branch folded
ZERO segments, so `skills`/`tools`/`flow_seams`/`refusals` were all empty. The `E100` shape
of the same bug is the koala case (D3 — no join key at all).

`refusals: {}` here is CORRECT and expected: those bytes predate D2, so their codes were
stripped at flush time and cannot be recovered. The fix is prospective.

## T4b — fresh end-to-end E440 (BLOCKED by a fourth defect, D4)

A genuine fresh E440 was produced live in a throwaway sandbox repo (real dd schema, real
`docs/tasks.dd.json` with one unchecked item, real `flow nav set`):

```text
$ harness flow nav set --path .harness/flows/journey.json --now backpressure --json
exit 1
{"command":"flow","status":"error","error":{"code":"E440","message":"node \"boot\" gates on
 \"docs/tasks.dd.json#tasks\": 1 of 2 items are not complete (dw-0002 (unchecked))."}, ...}
```

Nothing was written — the cursor stayed on `boot`, the pinned invariant holding.

It never reached telemetry. Three subsequent captures produced no `command_exit` for that
invocation at all.

**D4 — the refusal capture never fires under Claude Code.** `outcome-events.ts`
`parseEnvelope()` requires the trimmed tool-result text to START with `{` — a deliberate
strict guard so free-form output is never mis-read as an envelope. Claude Code wraps a
FAILING Bash tool result as `Exit code 1\n{…envelope…}` with `is_error: true` (verified by
reading this session's transcript JSONL directly). Trimmed, that starts with `E`, so
`parseEnvelope` returns `null`, `outcomeEvents` returns `[]`, and NO `command_exit` event is
emitted.

Every refusal exits non-zero. So the `code` field plan 071 · tk-7169 added has never once
been captured from a real refusal in this harness. D4 is INDEPENDENT of D2 and UPSTREAM of
it: D2 fixed the wire; D4 means nothing was ever put on the wire. It also fully explains the
0-coded-exits-in-112-refs count on its own — the D2 loss was masked by a second bug rather
than being the sole cause. Consequence for plan 071's `lg-0009`: the refusal was real and
human-observed, but it was never in telemetry either, so A10 was doubly unanswerable.

Raised as fence question #3; awaiting a ruling. T4b cannot be proven until D4 is fixed.

## D4 — the fix (Ruling #3), and what it means for the two earlier findings

Fixed at the `claude-adapter.ts` call site, not in `outcome-events.ts`: the
`Exit code N` prefix is a Claude Code tool-result convention, not a harness envelope
convention. `outcomeEvents` has exactly one caller today, which is precisely why the strip
belongs in the adapter — the next adapter must not inherit a Claude-specific strip it never
needed. New `unwrapFailedBashResult(text, isError)`: strips only under `isError`, only
anchored at `^`, only ONE line, `\r?\n` so a CRLF transcript cannot silently re-break the
lane.

Controls (4 more in `fx001-ref-fallback.test.ts`, 14 tests total): the real Claude Code
failure shape yields `command_exit{verb:'flow', exit:1, code:'E440'}`; the CRLF variant does
too; the REGRESSION GUARD — `isError` true with a bare JSON body (no prefix) must still
parse, so the strip can never eat real content; and the planted bad — prose behind the
wrapper line is still not an envelope, plus a successful result is never stripped.

Pre-fix behaviour, replayed against the built module (the old call site passed the raw text):

```text
outcomeEvents('Exit code 1\n{"command":"flow","status":"error","error":{"code":"E440",…}}', t, true)
  -> []                                          # pre-fix: no event at all
outcomeEvents('{"command":"flow",…}', t, true)
  -> [{kind:'command_exit', verb:'flow', exit:1, status:'error', code:'E440'}]
```

**Finding 1 — D2's loss was MASKED by D4.** The 0-coded-exits-in-112-refs count is fully
explained by D4 alone: nothing was ever put on the wire, so nothing could be dropped from
it. Neither fix repairs the lane by itself — D4 puts the event on the wire, D2 keeps its
code through the roll. Both were always required, and a reader who finds only one of them
will conclude the other was unnecessary.

**Finding 2 — plan 071's `lg-0009` was DOUBLY unrecorded.** The orchestrator note at the top
of this log says A10 was structurally unanswerable for FLUSHED sessions (D2). D4 STRENGTHENS
that, and does not replace it: the refusal was unanswerable for UNFLUSHED sessions too,
because the event never reached a segment in the first place. Both `unknown`s are artefacts
of the instrument. **No future reader may read either one as "the subject never hit a gate."**

**A second, independent reason my first T4b attempt captured nothing** (recorded so nobody
re-derives it): outcome events fire only for a Bash call whose command signature IS a harness
sub-command. `node <path>/harness/cli/bin/harness.js flow nav set` signs as `node`, not
`harness flow nav`, so it is not correlated. That is correct behaviour, not a defect — the
proof below therefore uses the linked `harness` binary.

## T4b — the fresh E440, end to end (PROVEN)

```text
1. REFUSE   $ harness flow nav set --path .harness/flows/journey.json --now backpressure --json
            exit 1  {"error":{"code":"E440","message":"node \"boot\" gates on
                     \"docs/tasks.dd.json#tasks\": 1 of 2 items are not complete (dw-0002 …)"}}
            cursor still `boot` — nothing written, the invariant holding.

2. CAPTURE  $ harness dd doctor            (any harness command; capture is tail-shaped)
            seq 15.json → 14 events, 1 command_exit, code E440
            ← the first coded refusal ever captured in this repo (D4)

3. FLUSH    $ harness telemetry sync --json
            {"synced":4,"sessions":1,"pushed":true}
            $ git grep -c E440 refs/harness-telemetry/2026/08/04/4312e257-…
            session.logs.jsonl:1     ← the code SURVIVED the OTLP roll (D2)

4. READ     $ harness telemetry get pij-blonde-pig --json
            exit 0, status ok
              segments:    18
              source:      "buffer+ref"      ref_checked: true
              refusals:    {"E440": 1}
```

The control that makes step 4 mean something: at that moment the live buffer held ONE
segment and **zero** `E440` bytes (`grep -l E440 …/*.json` → 0 files, coded exits → 0). The
`{"E440": 1}` can only have come from the REF half of the union. `source: buffer+ref` rather
than `ref` is honest, not a miss — a capture landed after the sync, and the envelope says so.

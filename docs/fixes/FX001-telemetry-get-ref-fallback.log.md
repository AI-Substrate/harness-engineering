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

## Blast radius of D4 — what else was silent (enumeration only, no code changed)

Prime's question: D4 is not a bigger D2, it is a DIFFERENT failure that produced the SAME
silence and masked the other — so does a capture that never fired invalidate assertions
beyond A10? Enumerated below. This is the capture-side list, meant to be INTERSECTED with the
orchestrator's independent assertion-side sweep; where the two disagree, the disagreement is
the finding.

### 1. The complete set that call site emits

`claude-adapter.ts:558` → `outcomeEvents` pushes exactly two event kinds and nothing else:

| event | fields | evidence field it feeds |
|---|---|---|
| `command_exit` | `verb`, `exit`, `status?`, `code?` | `SessionEvidence.refusals` (from `code`); verb/status also surface on the report + metric lenses |
| `checks` (only when `verb === 'checks'`) | `status`, `gates?` | `SessionEvidence.checks[]` — **status only**; `gates` is captured and has NO consumer today |

**Precision on "absent".** The drop is conditioned on `is_error === true` — the shell exit
PROPAGATED to the tool result. A harness command whose failure was MASKED (piped, `|| true`,
redirected, or last-in-a-compound that succeeded) had `is_error: false`, no wrapper line, and
was captured normally. Measured over this clone's 112 local refs:

```text
command_exit events: 360 total — exit:0 = 210, exit:1 = 150, carrying a code = 1
  …and all 150 exit:1 derive from the ENVELOPE's `status: error`, not from isError
checks events: 8 total — degraded 4, error 4, ok 0
```

So the failures that survived are exactly the ones whose exit was masked; what D4 destroyed
is the HONEST, propagated failure. (The single coded exit is the T4b proof from this session —
the first one that has ever existed.)

### 2. Assertions that consume them

Swept all five `live-testing/scenarios/*/assertions.json`:

| assertion | scenario(s) | consumes | affected |
|---|---|---|---|
| `gate-refused` A10 (required) | dd-native-builder | `refusals` ← `command_exit.code` | YES — directly, and it is the assertion the scenario exists for |
| `checks-ran {status:"ok"}` | md-to-pdf A9, md-to-pdf-flow A10, md-to-pdf-ponytail A9, md-to-pdf-ponytail-harness A9 | `checks[]` ← `checks` events | YES, but only for a FAILING checks run: `ok` exits 0, so an `ok` event was never at risk |

**Nothing else.** Every other telemetry-source assertion — `skill-called`, `skill-sequence`,
`flow-seam-fired`, `compaction-occurred`, `harness-verb-ran`, `tool-used`, and the telemetry
half of `retro-drained` (which keys on `harness_verbs.record`) — derives from the TOOL_USE
side of the transcript (`commandSignatures` / the `Skill` tool / `event-builder`), never from
`outcomeEvents`. D4 could not touch them.

### 3. Is there a GREEN that never consulted its evidence?

**Among D4-affected assertions: NO.** In both real `dd-native-builder` runs every
telemetry-lane assertion read `unknown` — A1, A7, A8, A10 — and the judged A12
(`explanation-matches-telemetry`) also read `unknown`, naming its own reason: "0 segments
joined for session pij-key-constrictor (telemetry.available=false), so the telemetry half of
the criterion is unmeasurable." The instrument failed LOUDLY. No green was ever taken off a
leg D4 silenced.

**But the shape is worse than it looks going forward, which is why both fixes had to land
together.** `gateRefused` returns `bool(...)`, not `unknown`, whenever evidence is PRESENT and
`refusals` is empty. Both real runs escaped a false verdict only because the evidence was
`null` (E100). With FX001's fallback in place the evidence now RESOLVES — so a D4-style
silence from here on would score A10 a false **RED**: "the subject dodged the gate", about a
subject that was correctly stopped. That is the inverse of prime's worry and it is closed by
D4, not by the fallback.

**One green worth naming anyway, arrived at independently of D4.** `dd-native-builder` A9
(`command-succeeds`, required, `node harness/cli/bin/harness.js dd doctor`) read **pass** in
the `20260804-210515Z-dkoala` run — the run in which A2, A4, A5 and A6 ALL failed, i.e. the
subject authored no dd documents at all. A doctor sweep over a corpus with nothing new in it
is clean by vacuity. A9's own `describe` claims it proves "never hand-edited the generated
markdown"; with zero authored documents it cannot distinguish correct work from NO work. That
is a green that consulted an empty evidence set. It is not a D4 consequence — reported because
it is precisely the class prime asked to have named.

### 4. The THIRD independent reason this lane reads empty

Outcome events fire only for a Bash call whose command SIGNATURE is a harness sub-command
(`claude-adapter.ts:520`). Measured with the real `commandSignatures()`:

```text
"harness flow nav set --now y --json"                        -> ["harness flow nav"]   correlated
"node harness/cli/bin/harness.js flow nav set --json"        -> ["node"]               NOT correlated
"cd /sb && node /path/harness/cli/bin/harness.js flow nav …" -> ["cd","node"]          NOT correlated
```

Correct behaviour, not a defect — but it means any subject or prover that invokes the CLI BY
PATH rather than through the linked `harness` binary produces zero outcome events no matter
what D2 and D4 do. It cost me one failed T4b attempt. Anyone re-deriving these counts will hit
it, so it belongs in the same enumeration as the other two causes: **three independent reasons
this lane can read empty, and finding any one of them explains the whole observation.**

## FX001-R1 — the E100 path owed the same provenance the success path did

The review's MAJOR, and it is fair: `getSessionEvidence` computed `refChecked` up front,
applied it to every success path, and then THREW IT AWAY on `return null` — while the act
hardcoded "BOTH surfaces were empty" for every miss. FX001's own thesis is that provenance
must be STATED rather than inferred, and the error path did precisely what the fix condemns,
one branch away from the code that fixes it.

The orchestrator's extension is the sharper half: the reviewer found two states, there are
**three**, because `catch { return null }` produced the same envelope as a real miss.

| state | pre-R1 envelope said | true? |
|---|---|---|
| buffer empty · ref namespace present · no match | "both empty" | yes |
| buffer empty · ref namespace ABSENT locally | "both empty" | **no** — the ref was never reachable to BE empty |
| an exception occurred, nothing established | "both empty" | **no** — no surface was proven anything |

**The fix.** `resolveSessionEvidence()` is the real read now and returns
`{ evidence, ref_checked, resolution }` with `resolution` one of `resolved` · `both_empty` ·
`ref_unavailable` · `resolution_failed`. `getSessionEvidence()` stays exactly as it was — a
thin wrapper returning `.evidence` — so no existing caller or the extension facade changes.
The act reads the resolution form and emits `error.details = { ref_checked, resolution }` with
a `next_action` that matches the state. The fail-safe contract is untouched: the read still
never throws. Failing safe is simply no longer licence to report a conclusion never reached.

**Before / after on real bytes** — same command, same throwaway git repo with no
`refs/harness-telemetry/*` namespace, the only difference being the build:

```text
PRE-R1   {"error":{"code":"E100","message":"no telemetry found for pij session 'pij-nobody'"},
          "next_action":"BOTH surfaces were empty — the live buffer and the committed
                         refs/harness-telemetry/* rollup. …"}
          ^ false: there was no ref namespace to check.

POST-R1  {"error":{"code":"E100","message":"no telemetry found for pij session 'pij-nobody'",
                   "details":{"ref_checked":false,"resolution":"ref_unavailable"}},
          "next_action":"The live buffer held nothing and there was NO local
                         refs/harness-telemetry/* namespace to check (ref_checked: false) —
                         this is NOT proof the ref surface is empty. Fetch the namespace
                         (`git fetch <remote> \"refs/harness-telemetry/*:refs/…/*\"`) …"}
```

**Controls** (18 tests in the file now, up from 14). The review's other real catch is fixed
too: the old "ref namespace absent locally" control asserted only `null` while its COMMENT
claimed "the act still says ref_checked" — a field the act did not have. The comment
overstated what the control tested, which is the same defect class as the envelope itself.

- service: `ref_unavailable` — absent namespace, `ref_checked: false`
- service: `both_empty` — a BYSTANDER's ref really is present and consulted, `ref_checked: true`
  (the distinguishing pair: same `null`, opposite provenance)
- service: `resolution_failed` — a throwing fs claims nothing about either surface
- act: E100 with a present namespace → `details {ref_checked:true, resolution:'both_empty'}`
- act: E100 with no namespace → `details {ref_checked:false, resolution:'ref_unavailable'}`,
  and asserts the envelope does NOT contain "BOTH surfaces were checked"
- act: E100 after a thrown read → `details {ref_checked:false, resolution:'resolution_failed'}`
  so state 3 cannot silently re-collapse into state 1

## FX001-R2 — enumerate the surface, then fix it

Three passes over one error path, each finding new members of the same class (pass 1: two
states collapsed into one envelope; pass 2: a third on the `catch` branch; pass 3: two more
*inside the fix for the first three*). A fourth round patching exactly what pass 3 named
would be followed by pass 4. So this round enumerates the whole surface first.

### The rule the enumeration applies

Two kinds of empty arrive at the same `catch` today, and they mean opposite things:

- a **malformed RECORD** inside a readable surface → **skip it and keep reading.** The
  documented fail-safe (AC-03), and correct: one corrupt line must not blind a session.
- a **PORT READ FAILURE** — the git command itself failed → **`resolution_failed`.** Nothing
  about that surface was established, so no miss over it may be reported as established.

Skipping is still skipping. What changes is that the skip is now COUNTED, and a failure is no
longer indistinguishable from an absence.

### Every path to `evidence: null` or an empty fold

`resolveSessionEvidence` and everything it calls. "must map to" is the resolution the path is
required to produce; `→` marks what it produced before this round.

| # | path | swallows | class | must map to | before |
|---|---|---|---|---|---|
| 1 | `pijFolder` → `env.home()` / `fs.readText` throws (facade ports; `session-evidence.ts:182`) | exception | port failure | `resolution_failed` (outer catch) | ✓ already |
| 2 | `pijFolder` → state file absent / unparseable JSON (`:190`) | corrupt record | malformed | next candidate root; a miss stays a miss **over the roots it could resolve** | ✓ already, see BOUNDARY-3 |
| 3 | `candidateRoots` → `proc.cwd()` throws | exception | port failure | `resolution_failed` (outer catch) | ✓ already |
| 4 | `readBufferedSegments` → `fs.readdir` throws (facade) | exception | port failure | `resolution_failed` (outer catch) | ✓ already — the ONE throw source R1's state-3 control exercised |
| 5 | `readBufferedSegments` → `fs.readText` returns `null` (`:295`) | unreadable file | malformed record | skip + **count** | ✗ count destroyed |
| 6 | `readBufferedSegments` → `JSON.parse` throws (`:299`) | corrupt file | malformed record | skip + **count** | ✗ count destroyed |
| 7 | `readFlushedWatermark` → absent / NaN watermark | absent marker | benign | `0` (nothing flushed) | ✓ already |
| 8 | `telemetryRefsPresent` → `listTelemetryRefs` throws (`ref-source.ts:182`, pre-R2) | exception | **port failure** | `resolution_failed` | ✗ **reported `ref_unavailable` — "there was NO local namespace", a claim about a surface never read** |
| 9 | `readRefSegments` → `listTelemetryRefs` throws (`:201`, pre-R2) | exception | **port failure** | `resolution_failed` | ✗ **empty map → `both_empty`** |
| 10 | `readRefSegments` → `readShardTree(ref)` throws (`:211`, pre-R2) | exception | **port failure** | `resolution_failed` | ✗ **`continue` → `both_empty`; the reviewer executed this one** |
| 11 | `segmentsFromBlobs` → `JSON.parse(line)` throws | corrupt rolled record | malformed | skip + **count** | ✗ count destroyed |
| 12 | `segmentsFromBlobs` → `reconstructSegmentFromOtlpLogs` not ok | rejected by wire contract | malformed | skip + **count** | ✗ count destroyed |
| 13 | `segmentsFromBlobs` → `decodeLooseSegment` returns `null` | corrupt loose segment | malformed | skip + **count** | ✗ count destroyed |
| 14 | `readRefSegments` → a ref decoding to zero segments (`:216`) | whole tree rejected | malformed | `continue` + count | ✗ count destroyed |
| 15 | `sessionIdOfRef` returns `null` | unnameable ref | benign | `continue` (unreachable in practice — `split('/').pop()`) | ✓ already |
| 16 | ref tier join filter finds no matching `PIJ_SESSION_ID` | genuine empty join | **real miss** | `both_empty` | ✓ already — this is the ONLY honest `both_empty` |
| 17 | `foldDurable` → union folds to ZERO segments after the watermark drop + join filter | supersession | **hollow answer** | a miss, never `resolved` | ✗ **returned `resolved` with `segments: 0`** |
| 18 | `durableSegments` → ref unreachable while the BUFFER matched (`:579`) | ref half missing | degraded, stated | keep the buffer answer; `token_evidence.reason = flushed_segments_unreadable` | ✓ already correct |
| 19 | `deps.gitRead === undefined` (the extension facade's shape) | no port | absence | `ref_unavailable` | ✓ already, see BOUNDARY-4 |
| 20 | `resolveSessionEvidence` outer `catch` | anything unforeseen | port failure | `resolution_failed`, `ref_checked: false` | ✓ already (R1) |

Rows 5–6, 8–14 and 17 are fixed this round; rows 1–4, 7, 15–16, 18–20 were already correct and
are now pinned by controls rather than by reading.

### What the fix does

- **`GitReadPort` gains two OPTIONAL strict reads** — `listTelemetryRefsStrict` /
  `readShardTreeStrict` — which THROW on a failed git command and still return `[]` for a
  genuinely empty or absent tree. `ExecGitRead` already had the bit: `readFlatTree` returns
  `ok | absent | failed` and `readTreeAt` flattened all three to `[]`. The fail-safe forms are
  unchanged, so every other reader (sync, `session save`, the migration walk) keeps its
  current behaviour; a port without the strict form degrades to the old read.
- **`telemetryRefsPresent` → `telemetryRefNamespace`**, returning `present | absent |
  unreadable`. The boolean could not hold the third answer, which is exactly how a failure
  came to be reported as an absence.
- **`readRefSegmentsOutcome`** returns `{ status: 'ok' | 'port_failed', segments, skipped }`.
  A malformed record increments `skipped` and the read continues; a failed port read sets
  `port_failed` and the read continues too — partial data is still returned, it simply may no
  longer be reported as an established miss.
- **`resolveSessionEvidence`** maps them: a `port_failed` ref read or an `unreadable`
  namespace resolves `resolution_failed`; a zero-segment durable fold is no longer returned as
  an answer; `records_skipped` rides on the outcome and reaches the E100 envelope
  (`details.records_skipped`, plus a `next_action` sentence) whenever it is non-zero.
- **Ordering matters and is pinned by a control**: the namespace probe runs FIRST, so letting
  it throw would have sunk a perfectly good buffer read with it. A ref failure costs the ref
  surface and nothing else.

### Honest boundaries — where the enumeration stops

1. **`ExecGitRead` was, until this round, the last word.** `listTelemetryRefs` returns `[]` on
   any non-zero status and `readShardTree` returns `[]` on a failed tree walk, so in
   PRODUCTION a git failure had already become an empty read one layer below the service —
   the service could only ever have detected a *throwing* port (which is what the reviewer's
   fakes did). The strict variants close this for the two calls the evidence path makes. They
   do NOT close it for `readRefLanes` (the fleet path), which still uses the fail-safe reads.
   That path reports lanes, not an established miss, so it is out of R2's scope — recorded
   here rather than silently widened.
2. **`FsPort` is fail-safe BY CONTRACT**: `readText` returns `null` and `readdir` returns `[]`
   for missing *or unreadable* paths, and never throws. So a permission-denied buffer
   directory is indistinguishable from an empty one at the port, and `both_empty`'s buffer
   half can never be stronger than "the port reported nothing". Changing that contract
   touches every fs consumer in the CLI; it is a finding for prime, not a fix I may make
   inside this fence.
3. **The locator can silently degrade** (row 2): a corrupt `~/.pij/<id>.json` drops the
   worktree candidate, so the read may look only at `cwd`. `both_empty` therefore means "over
   the roots I could resolve", not "over every root that exists". Bounded, stated, unfixed —
   fixing it means reporting which roots were scanned, which is envelope surface I did not
   widen without a ruling.
4. **`getSessionEvidenceFromContext` builds deps with NO `gitRead`**, so any extension calling
   the facade directly always gets `ref_unavailable` — the FX001 fallback is unreachable
   through it. The flow-eval scorer is unaffected because it consumes the CLI act's envelope
   (which has a real port), but a `VerbContext` carries no git port, so this cannot be fixed
   from inside the facade. Finding for prime.

### Controls — one per path, and each proved able to fail

10 new controls (28 in the file, up from 18). Every one was run against a re-simulated pre-R2
build (`port_failed` → `ok`, hollow-fold guard removed, `unreadable` mapping removed,
`records_skipped` forced to 0): **8 of the 10 failed**, quoted below. The other two are
regression guards that were already true and must stay true.

```text
× a FAILED ref enumeration is resolution_failed, never "no namespace"
    AssertionError: expected 'ref_unavailable' to be 'resolution_failed'
× a FAILED tree read is resolution_failed, never both_empty
    AssertionError: expected 'both_empty' to be 'resolution_failed'
× a durable union that folds to NOTHING is a miss, never a hollow answer
    AssertionError: expected { Object (pij_session_id, harness_session_id, …) } to be null
× a MALFORMED record inside a readable ref is skipped, not fatal        (records_skipped)
× a MALFORMED buffer record is skipped; its readable sibling still answers
× a miss over records it could not READ says how many it rejected
× the act envelope reports a FAILED tree read as such (E100, resolution_failed)
× the act envelope reports records it could not read
✓ a failing git port must NOT destroy a good buffer answer          (regression guard)
✓ a port WITHOUT the strict reads still works — degraded, never broken (regression guard)
```

The malformed-record controls are the ones that keep the fail-safe *alive*: a corrupt rolled
record inside an otherwise readable tree is skipped and the good record still answers
(`resolved`, `segments: 1`, `records_skipped: 1`). Making a malformed record fatal would have
"fixed" rows 11–14 by breaking the behaviour they exist to protect.

Full suite: 303 files / 4279 tests green.

## FX001-R3 — the two boundaries that were asserting, not merely missing

Ruled in from the R2 boundary list under a stopping rule I am recording verbatim,
because it is the rule that ends this chain: **a finding gets FIXED only if it makes an
envelope ASSERT SOMETHING IT DID NOT ESTABLISH. Anything else — capability gaps,
contracts outside the fence, design questions — gets ROUTED, not fixed.** Boundaries 1
(fleet lane reader) and 2 (`FsPort` fail-safe by contract) fail that test and stay
routed; 3 and 4 meet it.

### #4 — the type was STILL one value short

I reported this as a capability gap (an extension calling the facade can never reach the
ref fallback). The orchestrator verified it is also a TRUTH gap, and the sharper reading:

```ts
deps.gitRead === undefined ? 'absent' : telemetryRefNamespace(deps.gitRead)
```

A caller with **no git port** was assigned `absent` — an assertion nobody established.
This is the same defect I had just diagnosed one layer out: R2 replaced a boolean that
could not express `unreadable`, and the three-valued replacement still could not express
**"I had nothing to look WITH"**. So the branch reached for the nearest wrong word again.
A type too small to hold the truth does not produce one bug; it produces a bug at every
site that must speak it.

`RefNamespaceState` gains `not_checked`, produced only by a CALLER (the probe always has
a port by construction). The resolution stays `ref_unavailable` — the ref genuinely could
not contribute either way — but the REASON now reaches the envelope as
`details.ref_namespace`, and the `next_action` differs because the fixes differ: a
`git fetch` cannot repair a missing port.

```text
PRE-R3   details {"ref_checked":false,"resolution":"ref_unavailable"}
         next_action "…there was NO local refs/harness-telemetry/* namespace to check…"
         ^ false: nothing looked at the namespace at all.

POST-R3  details {"ref_checked":false,"resolution":"ref_unavailable",
                  "ref_namespace":"not_checked"}
         next_action "…the committed refs/harness-telemetry/* surface was NEVER
                      CONSULTED — this read had no git read port (ref_namespace:
                      not_checked). That is not a statement about the ref surface at
                      all. Run it through the CLI (`harness telemetry get <id>`)…"
```

The facade's capability gap itself is unchanged and stays a finding for prime: a
`VerbContext` carries no git port, so it cannot be closed from inside
`getSessionEvidenceFromContext`. What it may no longer do is MISLABEL the reason.

### #3 — a miss over fewer roots than it sounds like

`pijFolder` returning `null` for a corrupt `~/.pij/<id>.json` silently drops the worktree
candidate, so a later "the buffer held nothing" covers the roots that were reachable
rather than every root that exists. Disclosed in the smallest form, the way
`records_skipped` was: `details.locator_degraded: true` plus one `next_action` sentence.
No redesign — the read still degrades to the next candidate exactly as before.

Flagged for the two cases the locator CAN establish: no HOME to build the path from, and
a state file that was read but is corrupt / carries no usable `folder`. **Not** flagged
for an absent file, because `FsPort.readText` returns `null` for missing AND unreadable
alike — flagging that would fire on every session without a pij state file, and that
conflation is boundary 2, routed rather than papered over with a flag that means nothing.

### Controls (35 in the file, up from 28)

All seven new controls were run against a re-simulated pre-R3 build (`not_checked` →
`absent`, the locator note never set): **6 of 7 failed**, one is the both-directions
negative control that must hold either way.

```text
× NO git read port resolves ref_namespace: not_checked, never absent
    AssertionError: expected 'absent' to be 'not_checked'
× the act envelope tells a portless read from an absent namespace
× a CORRUPT ~/.pij/<id>.json is disclosed, not silently dropped
× a state file with no usable folder degrades too; a good one does NOT
× the act envelope discloses a dropped root
× a locator degradation NEVER stops the read from answering
✓ an EMPTY namespace still says absent — the two must not collapse the other way
```

The last one is deliberate: a real, readable, EMPTY namespace must stay an established
`absent` and must not drift into `not_checked` just because both produce the same
resolution. A fix that makes everything "unknown" is not more honest, it is less useful.
And `a locator degradation NEVER stops the read from answering` keeps disclosure from
turning into refusal — the corrupt state file is reported AND the cwd candidate still
resolves the session.

Full suite: 4286 tests. One integration test (`post-commit-hook`, "a value other than 1
does NOT opt out") hit its 5s timeout on a loaded run and passes in 1.03s on its own and
under `just checks`; it spawns a real git commit and is unrelated to this change.

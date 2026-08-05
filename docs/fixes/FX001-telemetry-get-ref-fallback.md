# FX001 — `telemetry get` reads the ref when the buffer is flushed

**Mode**: standalone fix (docs/fixes/) · **CS**: 3 · **Domains**: telemetry (adapters/git, services/telemetry), flow-eval scorer (consumer, unchanged)
**Origin**: found live during plan 071's flow-eval runs (2026-08-05), proven twice.

## Problem

`harness telemetry get <pij-session-id>` — the flow-eval scorer's entire
telemetry lane — reads ONLY the local buffer (`.harness/temp/telemetry/`).
`telemetry sync` (flush) moves segment payloads to `refs/harness-telemetry/*`
and leaves marker files, so a flushed session returns
`E100 "no telemetry found"` even though every segment — with its
`captured_env` PIJ join keys — is durably on the ref.

This is not fixable by runbook ordering: the **post-commit hook auto-flushes
on every commit**, so any subject that commits blinds its own telemetry lane
before an orchestrator can score it. Proven twice tonight:

- eval run `20260804-160553Z-rictor` (blind subject): buffer synced pre-score
  → telemetry lane 0 segments → A1/A7/A8/A10 all `unknown`, with A10
  (`gate-refused`) being the assertion the scenario exists for. The segments
  sat on `refs/harness-telemetry/2026/08/04/a7bda1ce-*` with
  `PIJ_SESSION_ID=pij-key-constrictor` in all 28.
- self-score `20260804-210515Z-dkoala`: session `pij-related-koala` E100'd
  while its E440 gate-refusal evidence was verifiably on the ref.

## Fix

When the local buffer yields no segments for the session (absent OR
flushed-markers-only), `telemetry get` falls back to reading
`refs/harness-telemetry/*`: locate the session's ref(s) by the same join keys
it already uses locally (captured_env `PIJ_SESSION_ID`, harness session id),
read the rolled segment files from the ref tree, and normalize into the same
counts-only evidence object. The envelope must SAY where evidence came from
(`source: buffer | ref | buffer+ref`) — a silent merge is how the next
debugging session gets lied to. E100 remains the answer only when BOTH
surfaces are empty. Read-only: no fetch over the network is implied — local
refs only; if the ref namespace is absent locally, say so in the envelope
(`ref_checked: false`) rather than failing.

## Tasks

| # | Task | Domain | Files (expected) | Success | CS | Notes |
|---|------|--------|------------------|---------|----|----|
| T1 | Ref-read path: enumerate `refs/harness-telemetry/*`, filter to the session by join key, read+parse rolled segment files | telemetry/adapters | `harness/cli/src/adapters/git/*telemetry*`, `services/telemetry/**` | A flushed session returns its real segments from the ref | 3 | Reuse the existing rollup format (`manifest.json` + `session.logs.jsonl` + `session.metrics.jsonl`); never shell to `git` outside the existing adapter idiom |
| T2 | Fallback wiring + provenance in the envelope (`source`, `ref_checked`) | telemetry/services | `telemetry get` act + service | Envelope names its evidence source; buffer-only behavior byte-identical when buffer has data | 2 | Buffer wins when non-empty (freshest); no silent merge |
| T3 | Controls, planted-bad BOTH ways | tests | `harness/cli/test/**` | (a) flushed-buffer + ref-present → segments returned, `source: ref` — **see the correction below**; (b) both-empty → E100 still; (c) buffer-present → identical to today, `source: buffer`; (d) a ref present for a DIFFERENT session must NOT satisfy the join (wrong-session control) | 3 | Fixture: real git repo with a `refs/harness-telemetry/...` commit built by the existing sync code, then buffer wiped — the control must see the opposite |

> **CORRECTION to T3a (2026-08-05, pij-related-koala — coder-supplied, evidence-backed).**
> This row originally said T3a "FIRES pre-fix as E100". **That was wrong**, and a
> reviewer holding the original wording would report a false finding when the
> control does something else. The pre-fix failure has **two distinct shapes**:
> a flushed session that DOES carry the pij join key returns **hollow evidence**,
> not E100 — the assertion that fires is `expected {} to deeply equal
> { 'the-flow': 1 }`, because the old partial branch filled token totals while
> leaving `skills`/`tools`/`flow_seams`/`refusals` empty. The **E100** shape is
> the no-join-key case (the D3 class, reproduced live against
> `pij-related-koala`). Both are real pre-fix failures; only the second is E100.
> The authored spec was the imprecise artifact here, not the implementation.
| T4 | Live proof against tonight's evidence | validation | none (run-only) | `telemetry get pij-related-koala` returns segments incl. the E440 `command_exit`; re-score `dd-native-builder --session pij-related-koala` shows `telemetry.available: true` (verdict may still FAIL on fs-lane domain — that is expected and out of scope) | 1 | Quote both envelopes in the execution log; do NOT commit a new ledger row as proof of exit-anything |

## Constraints (fence for the fix pair)

- Allowed: `harness/cli/src/**`, `harness/cli/test/**`. Nothing else without
  a fence question — early, by pij send.
- Forbidden: `docs/plans/**` (071 is archived + shipped; its corpus is
  closed), `live-testing/scenarios/**` (scorer bundle unchanged — this fix is
  in the CLI under it), any the-flow files, any push (orchestrator pushes),
  `.harness/live-testing/**` ledgers.
- Surface discipline: no new E-code expected (E100 semantics narrow); if one
  becomes genuinely necessary, fence-question it. `--help` text updated for
  the new fallback + provenance field.
- Every refusal/behavior class gets a planted-bad control that FIRES pre-fix
  (T3a is the headline: it must reproduce E100 against current source).
- Branch: `s065/deterministic-documents` — NOTE: commits here move PR #95's
  head; the 2026-08-05 exit green stays bound to `e4e08d42` historically and
  a fresh green is required before merge. This is deliberate (Jordan's
  direction, 2026-08-05).

## Review

Cross-model review required (same pair discipline as plan 071): Dim-0
mutation gate on T3's controls first, then fix verification, then
no-regression (`just test` full suite + `harness checks` warn trio
byte-identical to the current baseline at dispatch sha).

## Ruling #1 (2026-08-05, pij-related-koala — T4 scope + D2/D3)

Coder recon (357 coded-exit events on koala's ref, 0 carrying a code; 0 E440
bytes anywhere on 112 refs; koala ref segments all captured_env {}) proved
T4 unmeetable as written. Ruling = the coder's recommendation, adopted:

- **D2 IS IN SCOPE** (option b): preserve `command_exit.code` through the
  OTLP round trip (otlp/logs.ts encode + decode). It is the difference
  between the fix working and looking like it works — without it, every
  flushed session's refusal lane reads empty forever. The
  `check:telemetry-fixtures` drift-gate regeneration must be a DELIBERATE,
  quoted step in the report (never a scope-dodge). Historic refusal bytes
  are accepted as unrecoverable — they were never encoded; the fix is
  prospective and the report must say so.
- **T4 RE-SCOPED** (option a): live proof runs against
  `pij-key-constrictor` (real, joinable, flushed — 28 segments with the
  PIJ key on its ref) for the fallback, plus a FRESH post-fix E440
  manufactured and round-tripped to prove the refusal lane end to end
  (capture → roll → ref → get → refusals non-empty with the code).
- **D3 SPUN OUT**: the adopted-root-seat identity gap (no PIJ_SESSION_ID
  captured for adopted seats — koala's own lane unjoinable by PIJ key) is
  capture-side, already a known class, and goes to prime as a finding; if
  prime wants it as a fix, prime allocates the FX ordinal (FX ordinals are
  prime-allocated as of tonight).
- **D1 noted**: the partial fallback at session-evidence.ts:555-566 is
  replaced by the full fold with provenance — one implementation, not two.

## Ruling #2 (2026-08-05, pij-related-koala — OTLP contract version, fence question #2)

Coder asked whether adding one optional attribute (`harness.command.code`) to
the CLOSED frozen vocabulary at `scope_version: 2.6` requires a version bump.
**Option (i) stands — add in place, no bump.** Not as the cheap compromise the
coder framed it as, but as the *documented procedure*. Three findings from the
source, any one of which is sufficient:

1. **`additionalAttributes: false` is enforced nowhere at runtime.** It is
   asserted by exactly one line — `harness-otlp-schema.test.ts:100`, commented
   "closed set (no smuggled attrs)". That is a **producer-side** closure claim
   (the harness emits nothing outside this list), not a consumer-facing promise
   that the list never grows. Reading it as the latter is what made the question
   look hard.
2. **The repo prescribes exactly what the coder did.** The telemetry doc
   (`services/docs/docs-content.ts`): "To swap a semconv name when it
   stabilises, edit `semconv.ts` and the frozen contract, **nothing else**."
   Edit both, bump neither.
3. **Option (ii) would break a stated invariant.** `scope_version` is documented
   as "kept in lockstep with Segment 2.5" and `schemaIdentityForSegmentVersion`
   implements that mapping — scope version mirrors the SEGMENT schema version,
   it is not a vocabulary version. A 2.7 scope with no Segment 2.7 would be
   semantically wrong, not merely expensive; and minting Segment 2.7 for one
   optional attribute is disproportionate by any measure.

Riders (all cheap, none scope growth):

- **Record the reasoning in the log**, citing the docs line, so the next reader
  does not re-litigate this from the bare `additionalAttributes: false`.
- **The residual risk is real but bounded and first-party**: a consumer that
  vendored a copy of the 2.6 file and validates the closed set strictly would
  reject new records. The only known consumer is the eng-thrive scraper, whose
  documented read contract is *this file* (not a vendored pin), so it picks the
  vocabulary up by reading. It goes to prime as a **notification**, not a fix.
- **Genuine gap, spun out — vocabulary additions have no version handle at
  all.** Because `scope_version` is bound to the segment ladder, there is
  nothing that can honestly signal "same segment shape, larger vocabulary". That
  is a telemetry-wire policy decision with a downstream consumer; it belongs to
  prime, who allocates any FX ordinal. NOT FX001 work.
- **`fleet-export.schema.json`**: agreed, no judgment call. One thing the
  reviewer must check that the coder did not raise — the two new provenance
  fields were added as **required**, so every producer of a `SessionEvidence`
  must now emit them. A path that constructs one without them is a break.
- **Doc drift noted, NOT fixed here**: the telemetry doc still says scope
  version 2.5 / schema_url v0.2.0 while the code is at 2.6 / v0.3.0. It was
  already a version stale before FX001 touched anything; fixing it is scope
  creep on a fix task. Finding to prime, not a task.

## Ruling #3 (2026-08-05, pij-related-koala — D4, the refusal capture never fires)

Coder found a FOURTH defect, upstream of D2 and independent of it:
`outcome-events.ts` `parseEnvelope()` requires the trimmed tool-result text to
start with `{`, but Claude Code wraps a FAILING Bash result as
`Exit code 1\n{…}`. Trimmed, that starts with `E` → `parseEnvelope` returns
null → `outcomeEvents` returns `[]` → **no `command_exit` event is emitted at
all**. Every refusal exits non-zero, so the `code` field plan 071 tk-7169 added
has never once been captured from a real refusal in this harness.

Verified independently before ruling: the guard is `trimmed[0] !== '{'` at
`outcome-events.ts:55`, and `outcomeEvents` already receives the `isError` flag
it uses at line 97 — so the information the fix needs is present at both
candidate layers.

**D4 IS IN SCOPE.** This is the same test I applied to D2 — "the difference
between the fix working and looking like it works" — and it applies harder
here: D2 fixed the wire, D4 means nothing was ever put on the wire. Option (c)
(spin it out, close FX001 with T4b unproven) would ship a fix whose headline
claim — the refusal lane works end to end — stays undemonstrated, which is the
one assertion the whole scenario exists for.

**Why D4 is in scope when D3 was spun out**, so the line is principled and not
convenience: D3 (adopted-seat identity capture) is orthogonal to the refusal
lane, unbounded in scope, and changes *who can be joined*, not *whether
refusals exist at all*. D4 sits directly on FX001's claimed path, is ~3 lines,
and has a crisp control. Path-relevance and boundedness, not appetite.

**Layer: option (b) — fix at the `claude-adapter.ts` call site.** The coder's
reasoning is right and one fact I checked makes it decisive: `outcomeEvents`
has **exactly one caller**, `claude-adapter.ts:537`. Today (a) and (b) are
behaviourally identical — which is precisely why (b) wins: it is the only one
still correct when a second adapter starts calling `outcomeEvents` and must NOT
inherit a Claude-specific strip. `Exit code N` is a Claude Code tool-result
convention, not a harness envelope convention. The strict guard stays
harness-agnostic and untouched.

Requirements on the fix:

- Strip only under `isError`, anchored (`^`), a single leading line, and accept
  `\r?\n` — this repo already carries cross-platform hazards in its warn trio
  and a CRLF transcript would silently re-break the lane.
- Controls: the exact transcript-shaped string yields
  `command_exit{verb:'flow', exit:1, code:'E440'}` · planted-bad
  `Exit code 1\nsome prose` still yields `[]` · **and a regression guard** —
  `isError` true with a bare JSON body (no prefix) still parses, so the strip
  can never eat real content.

**Two findings to record in the log, not just the fix:**

1. **D2's loss was MASKED by D4.** The 0-coded-exits count across 112 refs is
   fully explained by D4 alone — D2 was never needed to explain it. The first
   sufficient-looking explanation was incomplete, and only looking again past a
   confirmed cause found the second. Neither fix alone repairs the lane: D4
   puts the event on the wire, D2 keeps its code through the roll. This does
   not weaken Ruling #1; it means both were always required.
2. **Plan 071's lg-0009 was doubly unrecorded.** That gate refusal was real and
   human-observed, but it reached telemetry through neither defect. My
   orchestrator note in the log says A10 was structurally unanswerable for
   flushed sessions; D4 means it was unanswerable for *unflushed* ones too.
   Strengthen that note rather than replacing it — a future reader must not
   read either `unknown` as "the subject never hit a gate".

On the regeneration clause of Ruling #1: the coder's report that
`check:telemetry-fixtures` needed NO regeneration — because no committed golden
holds a coded `command_exit` (there have never been any, per its 112-ref recon)
— satisfies the clause's intent. The clause existed to bar a silent scope-dodge;
an explicit "no drift, and here is why" is the honest form of it. But note the
consequence for the reviewer: **no golden exercises the new encode path**, so
the D2 round trip is pinned only by the new FX001 controls. That is acceptable
coverage, not redundant coverage.

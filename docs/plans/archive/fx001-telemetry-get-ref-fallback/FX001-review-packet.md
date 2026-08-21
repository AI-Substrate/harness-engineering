# FX001 — review packet (cross-model reviewer)

**Reviewer**: `pij-medieval-yak` (copilot, `gpt-5.6-terra`, effort high).
**Orchestrator**: `pij-related-koala` — report by `pij send pij-related-koala`, pointer only (persist the review body to a file, send the path).
**Under review**: the FX001 fix on branch `s065/deterministic-documents`.
**Read first**: `docs/fixes/FX001-telemetry-get-ref-fallback.md` (dossier + **Ruling #1**), then `docs/fixes/FX001-telemetry-get-ref-fallback.log.md` (the coder's execution log).

## Dispatch facts

| | |
|---|---|
| Dispatch sha (dossier) | `57d9cda5` |
| Ruling #1 amendment | `d2af7866` |
| Orchestrator log note | `961d8bd6` |
| Fix commits under review | `1c01c255` (fallback + D2) · `3c47f58f` (fleet provenance) · `ca5ad283` (D4) |
| **FROZEN CODE HEAD** | **`ca5ad283`** — the code under review, and only this. Nothing is pushed. My own **docs-only** commits (this packet, rulings) may land on top and do NOT rebind your verdict; if any **code** commit lands before you finish, I will tell you and the verdict re-binds to the new head. |
| Baseline warn trio at `57d9cda5` | arch-check **2** · markdown-lint **196** · windows-check **6**; `just checks` exit 0, `degraded`, 48.1s |

The baseline's markdown-lint count may move by a small amount purely from the two
docs-only commits (`d2af7866`, `961d8bd6`) that land between the baseline sha and
the first fix commit. Attribute that, don't launder it — and don't accept it as
cover for a code-caused move either.

## Dim-0 — mutation gate (FIRST, BLOCKING)

**Do this before reading the fix.** A control suite that cannot fail is not evidence,
and the coder's own table is a claim, not a result. Reproduce it yourself:

1. Revert **only** `harness/cli/src/**` to `d2af7866`, keeping the new test file
   `harness/cli/test/services/telemetry/fx001-ref-fallback.test.ts` at its fix-time content.
2. Run that test file. Confirm **exactly 6 of 10 fail** and that the failures are the
   six the log names — not six others, not five, not seven.
3. Confirm the **four guards pass pre-fix** — (b) both-surfaces-empty → `E100`,
   (d) wrong-session join refused, ref-namespace-absent honest, and act-level E100
   when both empty. A guard that fires pre-fix is a broken control, not a strong one.
4. Restore the fix; confirm **10/10 pass**.

**If Dim-0 does not reproduce, stop and report — the rest of the review is void.**

**Do not report the dossier's original T3a wording as a defect** — it said the control
"FIRES pre-fix as E100" and that was *my* error in the authored spec, corrected in the
dossier on 2026-08-05. The pre-fix failure has two shapes: **hollow evidence** when the
flushed session carries the pij join key (`expected {} to deeply equal { 'the-flow': 1 }`),
and **E100** only when there is no join key at all. Both are genuine; only the second is
E100. The implementation was right and the spec was imprecise.

One control deserves adversarial attention: **(c) populated buffer → `source: buffer`**
fails pre-fix only because the `source` field did not exist. That makes it a weak
witness for the actual requirement — *buffer-only behaviour is byte-identical to today*.
Judge whether anything in the suite genuinely pins that, and say so if nothing does.

## Dim-1 — the fallback itself

- The partial fallback at the old `session-evidence.ts:555-566` must be **replaced**, not
  supplemented — Ruling #1 D1 is one implementation, not two. Grep for a surviving second path.
- The join must be the **same key** the local path uses (`captured_env.PIJ_SESSION_ID`).
  Dim-0 control (d) covers the wrong-session case; check the code agrees with the test.
- **No silent merge.** `source` must be honest in all three states (`buffer` / `ref` /
  `buffer+ref`), and `ref_checked` must distinguish "checked, nothing there" from
  "no ref namespace locally". A wrong provenance value is worse than a missing one —
  it lies to the next debugging session.
- **Read-only, local refs only** — no network fetch may be implied or reachable.
- `E100` must remain the answer when, and only when, **both** surfaces are empty.
- **Two read paths now answer "what telemetry does this session have" — check they agree.**
  I verified `readRefLanes` is gone from `session-evidence.ts` (comment reference only), so
  D1 holds there. But it survives at `fleet-evidence.ts:1331`, feeding the fleet export's
  durable union, while the session path now uses the full `foldFromRefs`. Establish whether
  those two produce consistent answers for the same session, or whether the fleet surface
  still returns the partial shape the session surface just stopped returning. If they
  legitimately differ (fleet needs only token evidence), that is fine — but it should be
  true by design and stated, not by accident.

## Dim-2 — D2, the OTLP round trip (in scope by Ruling #1)

- `command_exit.code` must survive encode → rolled `session.logs.jsonl` → decode.
  Without it the refusal lane reads empty forever and the fix only *looks* like it works.
- Encode/decode must be symmetric and the reader **strict**: a non-`E###` value is refused,
  same as every other contract attribute.
- **The `check:telemetry-fixtures` / schema-freeze regeneration must be deliberate and
  quoted in the log** — what drifted, why, and the command run. A frozen-snapshot test
  outside the touched path can still pin bytes inside it; regenerating it silently is the
  scope-dodge this clause exists to catch. The coder reports that clause resolved as
  **no regeneration needed** (no committed golden holds a coded `command_exit` — there
  have never been any). Verify that claim; it is checkable.
- **Consequence of the above, and the sharper review question**: if no golden exercises
  the new encode path, the D2 round trip is pinned **only** by the new FX001 controls.
  That is acceptable coverage, not redundant coverage — judge whether those controls are
  strong enough to be the sole witness, since nothing else will catch a regression here.
- **Version policy is RULED, do not re-open it** — see **Ruling #2** in the dossier.
  `harness.command.code` is added to the closed vocabulary at `scope_version: 2.6` with
  no bump, because (a) `additionalAttributes: false` is enforced nowhere at runtime and is
  a producer-side claim, (b) the repo's telemetry doc prescribes exactly "edit `semconv.ts`
  and the frozen contract, nothing else", and (c) `scope_version` mirrors the **Segment**
  schema version, so a 2.7 scope with no Segment 2.7 would break a stated invariant.
  A finding arguing for a bump is out of scope; a finding showing one of those three
  premises is **factually wrong** is very much in scope and I want it.
- **`fleet-export.schema.json` — check this, the coder did not raise it.** The two new
  provenance fields were added as **required** properties on a closed per-session evidence
  object. Every producer of a `SessionEvidence` must therefore emit them. Find any path
  that constructs one without them.
- The log must state plainly that historic refusal bytes are **unrecoverable** (never
  encoded) and the fix is **prospective**. Overclaiming here is a finding.

## Dim-2b — D4, the refusal capture that never fired (Ruling #3)

Found by the coder *upstream* of the defect it was sent to fix, and it is the most
consequential thing in this branch. `parseEnvelope` demanded a leading `{`, but Claude
Code wraps a failing Bash result as `Exit code 1\n{…}` — so **no outcome event was
emitted at all** for any non-zero harness command, and every refusal is non-zero.

- Fix must be at the **`claude-adapter.ts` call site**, not in `outcome-events.ts`.
  `outcomeEvents` has exactly one caller today, so both placements behave identically —
  which is exactly why the harness-agnostic module must stay clean for the second caller.
  A fix that leaked Claude's wrapper convention into `outcome-events.ts` is a finding.
- Strip must be **`isError`-only, anchored, single line, `\r?\n`-tolerant**. Verify the
  **regression guard**: `isError` true with a bare JSON body still parses, so the strip
  can never eat real content. Verify a **success** result is never stripped.
- **The masking claim is the interesting one — test it.** The coder states D2's loss was
  masked by D4: the zero-coded-exits count across 112 refs is explained by D4 *alone*, so
  D2 was never needed to explain it, and neither fix repairs the lane by itself. Judge
  whether that is actually true, because if it is, it means the first sufficient-looking
  explanation on this path was wrong twice.

**Known, recorded, NOT a defect — do not report it:** outcome events fire only when a Bash
call's signature *is* a harness sub-command. `node <path>/harness.js flow nav set` signs as
`node`, so it is never correlated. That is correct behaviour and a **third** independent
reason this lane reads empty. If you re-run the T4b steps with `node …/harness.js` you will
see zero captures and it will look like the fix failed — use the linked `harness` binary.

## Dim-3 — no regression

- Full `just test` suite green.
- `just checks` warn trio against the baseline above — byte-identical modulo the
  documented docs-only delta. A new warn class is a finding regardless of severity.

## Dim-4 — fence conformance

Allowed: `harness/cli/src/**`, `harness/cli/test/**`, plus the coder's own
`docs/fixes/FX001-*.log.md`. Forbidden: `docs/plans/**`, `live-testing/scenarios/**`,
any the-flow file, any push, `.harness/live-testing/**` ledgers.

**Known non-violation — do not report it:** `.harness/live-testing/dd-native-builder/ledger.jsonl`
(+1 row) and the untracked run dir `20260804-210515Z-dkoala/` are the **orchestrator's**,
written at 21:05Z during the pre-dispatch self-score — they pre-date the coder's first
edit. Check mtimes before believing me.

## Dim-5 — T4 live proof (Ruling #1 re-scoped)

T4 as originally written was unmeetable; the ruling re-scoped it to two legs:

1. **Fallback leg** — `pij-key-constrictor` (real, flushed, 28 ref segments carrying the
   PIJ key) returns real segments with `source: ref`.
2. **Refusal leg** — a **fresh, post-fix** `E440` manufactured and round-tripped end to end
   (capture → roll → ref → `get` → refusals non-empty **with the code**).

T4b is now reported proven in four steps (real E440 with the cursor unmoved → capture with
the code → sync → `get` returning `refusals {"E440": 1}`). **The load-bearing control is
step 4's negative**: at that moment the live buffer held zero `E440` bytes, so the count
could only have come from the ref half. Verify that negative — without it, step 4 proves
nothing, because a buffer hit would produce the same output. Note the envelope honestly
says `buffer+ref` rather than `ref` (a capture landed after the sync); that is the
provenance field doing its job, not a defect.

Both envelopes quoted verbatim in the log. Judge whether the quoted output actually
demonstrates the claim, and re-run at least one leg yourself. Do **not** accept
`pij-related-koala`'s own lane as proof of anything — it has no PIJ join key on the ref
(that is D3, below).

## Explicitly out of scope — do not report as findings

- **D3**, the adopted-root-seat identity gap (no `PIJ_SESSION_ID` captured for adopted
  seats). Capture-side, spun out to prime, prime allocates any FX ordinal.
- Historic telemetry refs lacking coded exits — unrecoverable by construction.
- The flow-eval scorer bundle and the `dd-native-builder` scenario — unchanged by design.
- PR #95's merge state and the historical `e4e08d42` CI green.
- The CLI↔extension `SessionEvidence` lock-step test that **cannot fail to compile** (only
  `src` is in tsconfig, and its SAMPLE literal already omits fields). The coder found and
  reported it; it is pre-existing and batched to prime. Worth knowing while you review,
  because it means the two new provenance fields have **no drift guard on the extension
  side** — but do not raise it as a finding against this branch.
- The stale `docs/how/telemetry/otlp.md:67-68` (v0.2.0 / scope 2.5 vs code v0.3.0 / 2.6).

## Report shape

Findings as rows: **id · severity (BLOCKER/MAJOR/MINOR/NIT) · dimension · claim · the
evidence you ran · what would fix it**. A verdict of **APPROVE** requires Dim-0 to have
reproduced. Say plainly which dimensions you executed and which you only read — a
dimension you did not run is `unknown`, never a silent pass.

# Survey: requirement→proof→receipt carriage in recent SDD plans

> Produced 2026-08-03 by an Opus 5 subagent, commissioned as design input for plan 065 ("we are going to be making more changes to how the flow spine carries requirements deterministically"). Preserved verbatim below (minor formatting only). Scope: 7 recent plans, excluding 063 which was reviewed separately in-session.

Sources: `docs/plans/<ordinal>-<slug>/{<slug>-plan.md, backpressure-coverage.md, the-flow.json, tasks/**}`; also `harness/cli/src/services/flow/schemas/flow.schema.json` and `skills/builder/references/flight-plan.schema.json`.

### The structural headline (true for all 7 + 063)

`flow.schema.json` node fields are: required `id, type, label, status, next`; optional `branch_of, created_at, modified_at, ran_at, user_input, comments, authority, agents, output, error, command, chore, note, artifacts, phase, reconstructed, zone`. **There is no requirement, acceptance-criterion, or proof field anywhere in the contract** — core or flight-plan overlay. `instructions[]` isn't even in the schema (the validator is strict on required, tolerant of extras). Comment kinds actually used across all spines: `validation` 74, `note` 59, `decision` 39, none 31, `warning` 7 — no proof/receipt kind. Root optional `plan_dir` is **unset in all 9 spines inspected**.

---

## 059-typed-extensions-sensors (degraded: no backpressure artifact)

**a. ACs** — 14, strongly sensor-shaped; failure modes inline. AC-04: "an extension declaring `api` above the core's support → per-extension `failed` record `E147` with `next_action` naming `harness update`; an unknown top-level section → `E148`". AC-09 even encodes the anti-mode: "daemon down → **`degraded`** … never `unconfigured`, which exits 2 by the core status contract". Coverage Map exists (`typed-extensions-sensors-plan.md:241`) binding AC → task numbers (`AC-10 | 2.5 | scheduler tests (watcher+clock fakes)`) — **"Verified in" is prose, never a named file or command**.

**b. Backpressure** — none. `backpressure` node `skipped` with an honest receipt: *"Declined by Jordan (went straight to Phase 1 tasks); plan already self-designs its primary sensors (conformance corpus + guard)"*. This is the correct degraded shape (real status change + reason), but it means the plan's 14 ACs never got a proof-selection pass.

**c. Spine** — 23 nodes, `nav.now=phase-3 / next=review-3`; phase-3 `in_progress`, review-3 `in_progress`, ship `assumed`. Richest receipt corpus in the repo (5–11 comments on phase nodes, full 6-round review cascade). `boot-3` uses the 063 grammar: `decision:ran verdict:HEALTHY time:… — boot(just test) green 5.5s warm …`; boot-1/boot-2 use prose. **Unsatisfied-done**: `observe-1`, `retro-1`, `observe-2` are `done` with zero comments. All 3 plan phases exist as spine nodes; `artifacts[]` populated on research/plan/phase-1/phase-2/workshops (one of only 3 plans that do this).

**d. Carriage** — nowhere. Grep for AC ids in the spine returns `AC-09`, `AC-13` only, both buried in free-text comments. `phase-2.instructions[]` is verbatim template boilerplate ending *"Done when the phase's acceptance criteria are met"* — identical to 052's and 063's. Resume-from-spine knowledge: label ("P2: Sensors engine (headless)"), `command: /builder 6 implement`, and `artifacts[]` → the tasks dossier. Which of the 14 ACs phase-2 owes: unknowable without reading the .md.

## 058-harness-retro-insights (full artifact set)

**a. ACs** — 12, the most sensor-shaped of the set; several enumerate the refusal path: AC-01 "*every insight row carries `n` and a non-empty `caveat` — rows that can't be caveated are structurally refused*"; AC-05 names the exact ordering and a field name `proof_gap_signal: "target" | "keyword"`. Coverage Map at `:214`, AC → task numbers + prose verification.

**b. Backpressure** (`058-harness-retro-insights/backpressure-coverage.md`, 62 lines) — Certainty **Partial**; taxonomy is the **older EXISTS/BUILDABLE/ABSENT**, not RUN/EXTEND/BUILD: **12 BUILDABLE · 2 EXISTS · 1 ABSENT**. **No Basis SHA** (only 063 has one). The ABSENT row does carry a probe trail: *"globbed `live-testing/scenarios/*` for an existing retro-insights scenario: no match"*. Proof Plan lines are prose, not paved commands (*"done when a flow-eval scenario scores a harvest run and the judged lane confirms every narrated number appears in the verb's JSON"*).
- **Folding trace 1 (stranded)**: the survey invents **AC-09b** ("narration restates, never computes" at runtime). `grep "09b\|flow-eval"` over the plan doc → **zero hits**. It has no AC entry, no coverage-map row, no task. A requirement created by the proof layer that the plan never adopted.
- **Folding trace 2 (folded)**: AC-11's `grep -r "compound-value" skills/` appears verbatim as task 2.2's Success Criteria.
- **Folding trace 3 (folded, weakened)**: AC-04's "tolerant parsing, skip counters … live-corpus run (1.2, 1.8)" → task 1.8/dossier T009, whose Done When was *strengthened* during validation ("status counts sum to entries, never a frozen ratio").

**c. Spine** — 15 nodes, `nav.now=ship`, ship `done` (PR #66). Backpressure node is `done`, but its receipt sits in **`note`**, not `comments[]`: *"backpressure-coverage.md: Partial — 12/14 rows BUILDABLE … 2 EXISTS, 1 ABSENT"*, and `artifacts[]` is **empty** — the survey file is linked to the node only by living in the same folder. **Unsatisfied-done**: `backpressure`, `boot-1`, `observe-1`, `retro-ship`, `observe-2` all `done` with zero comments. `retro-1` and `retro-2` `skipped` with no reason comment. Note the mode/basis counts in the note (12/14) disagree with the artifact's own row count (14 rows + 1 ABSENT = 15 lines) — nothing checks it.

**d. Carriage** — nowhere structured. Best-in-set is the dossier: `tasks/phase-1-deterministic-engine/tasks.md` has a per-task `Done When` column with real assertions and `[x]` checkboxes that were actually maintained — but the spine points at it via *no* `artifacts[]` entry.

## 057-flow-token-efficiency (degraded: backpressure never run)

**a. ACs** — 11, sensor-shaped and unusually self-aware about epistemics: AC-09 splits proof classes explicitly ("(a) **capture-health proof** — deterministic … (b) **directional outcome** … explicitly labeled *non-normalized*") and pre-declares "delegation impact is marked unmeasured/low-confidence". Coverage Map at `:224`.

**b. Backpressure** — **absent both ways**: no `backpressure-coverage.md`, and the `backpressure` node is `assumed` (never ran, never declined). This is the silent-skip shape — unlike 059's honest `skipped`+reason, `assumed` records nothing at all.

**c. Spine** — 17 nodes, `nav.now=ship`, ship `assumed` despite PR #65 being open (receipt in a comment). Includes two excursion nodes: `fix-1` (FX001 friction batch, `done`) and `tripwire-review` (`assumed`, a deliberate T+3wk re-entry thread). All four chore nodes (`boot-1/observe-1/retro-1/retro-ship`) `done` with zero comments; only `retro-2` carries a drain receipt.

**d. Carriage** — nowhere. Ironically AC-06 of this very plan *adds prose to `instructions[]`* ("one token-discipline line and one delegation/tier line … on the nodes agents re-read"), confirming `instructions[]` is treated as a place for **posture**, never for **obligations**.

## 056-dont-apologise-fix (full artifact set; best node↔artifact linkage of the old cohort)

**a. ACs** — 11, mixed: several sensor-shaped (AC-07 letter-code purge = a grep), one explicitly inferential (AC-08 "drain reads as recommendation-led conversation"). Task table has BOTH a `Done When` column and a `Notes` column carrying AC ids — the closest thing in the repo to a bidirectional binding, entirely in markdown. Coverage Map at `:208`.

**b. Backpressure** (`backpressure-coverage.md`, 53 lines) — Certainty **Partial**; **9 BUILDABLE · 2 EXISTS · 1 ABSENT**; no Basis SHA. ABSENT row has a real probe trail: *"not sensor-provable by design … matches repo's declared gap: 'skill prose has no deterministic sensor'"*. Proof Plan: 1 line, prose.
- **Folding trace**: the survey's row-level task refs (T017 greps, T014 scenario, T001–T005 tests) all exist in the plan's task table, and T014's Done When was hardened to "declined/deferred entries present in the produced record". Good folding — but notice the direction: the survey was written *against* an existing task list, so folding here is really *confirmation*, not *insertion*.

**c. Spine** — 12 nodes, ship `done`, but `nav` is internally inconsistent: `{"now": "ship", "next": "plan", "status": "complete"}`. Backpressure node is the **only one in the whole cohort** carrying both a summary `note` ("Certainty: Partial — all behaviour/arch criteria computationally provable; sensors BUILDABLE as in-plan tasks…") **and** `artifacts: ["docs/plans/056-dont-apologise-fix/backpressure-coverage.md"]`. Everything else — boot-1, observe-1, retro-1, ship — is `done` with no receipt.

**d. Carriage** — nowhere. All 17 plan-doc task checkboxes remain `[ ]` although the spine says phase-1 done and shipped.

## 056-file-write-telemetry (degraded: no backpressure, all chores `assumed`)

**a. ACs** — 8, tightly sensor-shaped and the most "contract-like" set surveyed: AC-06 pre-refutes its own weak proof — *"(The regenerated `check:telemetry-fixtures` guard alone does not prove this — it passes by construction after regen — so the exclusion is asserted directly.)"* Coverage Map at `:170` names test intents ("serializer out-of-repo→`<external>` test").

**b. Backpressure** — none, node `assumed`.

**c. Spine** — 10 nodes; **every chore node (`backpressure`, `boot-1`, `observe-1`, `retro-1`, `retro-ship`) is `assumed`** — the maximally degraded case. Phase-1 `done` with zero comments; ship `done` with zero comments. All proof discussion lives in two review comments.
- **Unproven-AC smell**: the review receipt reads *"AC-01/02/04/05/06/07/08 verified PASS w/ mutation evidence"* — **AC-03 is the one AC never claimed**, and AC-03 is exactly the `<external>` sentinel behaviour whose implementation the same fix loop reverted (*"HIGH regression — coder modified legacy `relativizePath()` to return `<external>`, breaking segment.test.ts:139/:160 … Fix dispatched: revert relativizePa[th]"*). The node went `done` → ship anyway. Nothing enumerates the AC set, so nothing noticed the hole.

**d. Carriage** — nowhere; not even `artifacts[]`.

## 055-vendor-builder-baked-skills (degraded: no backpressure, no tasks dossier)

**a. ACs** — 10, mostly sensor-shaped and command-named (AC-01 "`npm pack --dry-run` lists `skills/builder/**` …"; AC-10 "CI fails the build if any baked skill … is absent from `npm pack` output"). Notably **out of order in the doc** (AC-01..04, AC-09, AC-10, AC-05..08) — late-added ACs appended mid-list, a small but telling markdown-drift artifact. Coverage Map at `:178`; AC-05 "Verified in" is *"manual `/the-flow`,`/builder` (T017)"* — a human step, recorded nowhere else.

**b. Backpressure** — none; node `assumed`. This plan invented a **regression sensor as an AC** (AC-10 CI guard) with no survey prompting it.

**c. Spine** — 10 nodes; `research` `skipped` (no reason), all 5 chores `assumed`. **`review-1` is `done` with zero comments and no `note`** — the review verdict for the entire plan exists only in `review-p1.md` / `*-plan.md.pij-review.md` on disk, invisible from the spine. 21 task checkboxes all `[ ]` post-ship.

**d. Carriage** — nowhere; `artifacts[]` empty on every node.

## 052-fleet-telemetry-lane-sources (full artifact set; zero receipts)

**a. ACs** — 8, terse format (66-line plan). Sensor-shaped where it matters, with literal expected numbers: AC-01 "returns **4/4 lanes measured** with billing units matching the debrief's recovered numbers exactly". **No Acceptance Coverage Map.** Instead the task table has a **`proves` column carrying AC ids** (`T007 … | AC-01..03, AC-06`) — the single most machine-parseable AC↔task binding found in the survey, and nothing in the repo parses it.

**b. Backpressure** (`backpressure-coverage.md`, 44 lines) — Certainty **Partial**; **6 BUILDABLE · 1 EXISTS(pattern) · 2 ABSENT · 1 mixed**; no Basis SHA. ABSENT rows carry probe trails (*"globbed `docs/how/telemetry.md` — exists, extended by T008"*). Proof Plan lines are the closest to paved in the old cohort:
- **Folding trace 1 (folded)**: *"AC-01 | done when the T007 golden test pins 1,742.9 AIC / 298.5 AIC / 1,368,083 / live and `harness checks` is green"* → T007 reads "**golden test: the real 051 run resolves 4/4 lanes (coder 1,742.9 AIC · reviewer 298.5 AIC · validator 1,368,083 · orchestrator live)**". Numbers survived; the `harness checks` half did not.
- **Folding trace 2 (folded)**: *"AC-04 | done when packet fixtures assert non-review AND the real review fixture still yields FIX_REQUIRED `{critical:1}`"* → T002 verbatim-equivalent.
- Only 2 of 8 ACs got a "done when" line at all; the other 6 have no proof line anywhere.

**c. Spine** — 15 nodes, all `done`, `nav.now=ship`. **The entire spine contains zero comments and zero notes.** The `backpressure` node is `done` with no receipt, no `note`, no `artifacts[]` — yet `backpressure-coverage.md` sits in the folder. From the spine alone the survey does not exist. Also carries a vestigial `fields: {"label": …}` key on phase-1/review-1 (mutation echo, not in the schema). 12 task checkboxes all `[ ]` after ship.

**d. Carriage** — nowhere. Grep for `AC-` in this spine returns **nothing at all**.

*(Also noted: `docs/plans/060-telemetry-ls-pull/` contains only `tasks/phase-1-implementation/execution.log.md` — no plan doc, no spine, no survey. The fully-degraded case.)*

---

## Cross-plan synthesis

### 1. Deterministic today = the chore lane. The requirement lane is 100% markdown inference.
Everything the spine carries deterministically is *journey mechanics*: node id/type/status/next/branch_of, chore `{kind, importance}`, `command`. Requirements appear in the spine only as incidental substrings inside free-text comments (2–3 AC ids per plan, zero in 052 and 063). `instructions[]` is template boilerplate — byte-identical `"Done when the phase's acceptance criteria are met, the tests pass…"` across 052 (harness 0.7.0), 059 (0.12.0) and 063. **An agent resuming from `the-flow.json` alone knows: the phase label, the verb to run, sometimes an artifact path (populated in only 3 of 9 spines: 059, 056-dont-apologise, 063), and a one-sentence `nav.intent`. It knows nothing about which ACs the phase owes, which are already proven, or what command would prove them.** It must open the .md and re-derive.

### 2. The 063 receipt grammar already solves this problem — for chores only.
063's chore `instructions[]` encode a full protocol ("**receipt first, status second**", exact `harness flow comment --kind validation --text "decision:… verdict:… basis_sha256:…"`, then `status --to done`; declines require the human's verbatim words), producing structured receipts like `modes:2-RUN,8-EXTEND,1-BUILD,0-ABSENT` and a **deterministic re-open rule keyed to a hash** (`backpressure-<first 12 hex>` if the plan SHA drifts). None of the 7 surveyed plans has this; 059's `boot-3` is the only pre-063 node using the `decision:… verdict:…` shape. The machinery is proven and pointed at the wrong lane.

### 3. Concrete drift/failure corpus found

| Failure | Evidence |
|---|---|
| No basis binding anywhere but 063 | `grep -rn "Basis\|sha256" docs/plans/*/backpressure-coverage.md` → **one hit**, 063. The other 8 surveys float free of the plan version they surveyed. |
| Survey invents an unadopted requirement | 058 "AC-09b" exists only in `backpressure-coverage.md:37`; zero hits in the plan doc, no task, no coverage row. |
| Proof plan half-folded | 052 AC-01: the golden numbers landed in T007, the `harness checks` clause did not. 051 AC-07's "RED-able by mutation (un-close the schema → test fails)" degraded to T003's "negative-key payload fails validation". |
| Only 2 of N ACs get proof lines | 052: 2/8; 058: 1/14 rows; 056-dont-apologise: 1/12. The Proof Plan section is treated as a footnote for the ABSENT rows, not a per-AC contract. |
| Unsatisfied-done | 052: whole spine, 15/15 nodes `done`, zero receipts, backpressure artifact on disk unreferenced. 058: `backpressure`/`boot-1`/`observe-1`/`retro-ship` done, no comment. 055: `review-1` done with no verdict at all. |
| Silent skip vs honest skip | 059 backpressure `skipped` + reason ✅ vs 057/055/056-fw backpressure `assumed` (never ran, no record) ❌. `assumed` is doing double duty as "not yet" and "never will". |
| Unproven AC marked done | 056-file-write: review receipt enumerates AC-01/02/04/05/06/07/08 — AC-03 (the `<external>` sentinel) is missing, and it is precisely the behaviour the fix loop reverted. Shipped. |
| Plan-side progress rots | 055 (21), 056-dont-apologise (17), 056-file-write (10), 052 (12), 051 (6) — **all task checkboxes still `[ ]` after ship**. Dossier `tasks.md` checkboxes (058, 059, 063) *are* maintained. Two ledgers, one maintained, nothing reconciles them. |
| Receipt location is per-plan convention | `comments[]` (059, 063), `note` (058, 051, 056-dont), `artifacts[]` (056-dont, 059, 063), nothing (052, 055, 056-fw). |
| Taxonomy drift | 050/051/052/056/058 use **EXISTS / BUILDABLE / ABSENT**; 063 uses **RUN / EXTEND / BUILD / ABSENT**. Cross-plan mode counting is not comparable today. |
| Spine can't name its own plan | `provenance.plan_id` is `null` in all 8 pre-063 spines (063 = `"063"`); root `plan_dir` unset in all 9. |

### 4. Where linkage *is* deterministic-ish, and what it costs
Three markdown mechanisms carry AC→task binding, all unparsed by any tool: (i) `### Acceptance Coverage Map` (7/8 plans, AC → task numbers + **prose** "Verified in"); (ii) a `Done When` column in inline task tables (055, 056×2, 051) and in every dossier `tasks.md`; (iii) 052's `proves` column (AC ids per task row) — the only column that is already a clean foreign key. The Coverage Map's "Verified in" is the weakest link: `"engine + act suites"`, `"grep assertions in review"`, `"manual /the-flow,/builder (T017)"` — never a runnable command, so "is AC-07 proven?" is always an inference.

### 5. Highest-leverage design observations

1. **Carry requirements as a root-level `requirements[]` collection, not as nodes.** 059 is already 23 nodes; per-AC nodes would double the graph and pollute `next`/`branch_of` navigation. A root array of `{id: "AC-04", sha256: <hash of the AC's markdown text>, owned_by: ["phase-1"], proof: [...]}` keeps the prose in the .md while making existence, ownership, and drift machine-visible. `plan_dir` + `provenance.plan_id` should be populated at create as the cheap precondition.
2. **Make the backpressure Proof Plan the *source* of `requirements[].proof`, not advisory text.** Model it on 063's mode taxonomy: `{mode: RUN|EXTEND|BUILD|ABSENT, command: "<paved command>", artifact: "<test file>", probe: "<trail for ABSENT>"}`. This turns "did the proof plan get folded into the tasks?" from archaeology into a diff — the exact question that stranded 058's AC-09b and half-folded 052's AC-01.
3. **Extend the 063 receipt protocol from chores to requirements, reusing `comments[].refs[]`.** `refs[]` already exists in flow-core and is already used (14 occurrences) to carry commit SHAs and file paths. A `--kind proof` receipt of the form `decision:proven ac:AC-04 command:"vitest run api-gate" verdict:PASS mutation:RED->GREEN` with `refs: ["<test path>", "<commit sha>"]` gives per-AC provenance with zero schema invention beyond a new comment kind. This is what 056-file-write's missing AC-03 would have caught.
4. **Basis hashing generalizes from the plan file to the AC section.** 063's `basis_sha256` + deterministic re-open chore id (`backpressure-<12hex>`) is the right primitive: hash the `### Acceptance Criteria` block, and a mismatch re-opens exactly the requirements whose text changed rather than the whole survey. Without this, every plan re-version silently orphans its survey — which is the state of all 8 pre-063 surveys today.
5. **The first deterministic gate should be a completeness check, not a correctness check.** "No `phase`/`review`/`ship` node may go `done` while a requirement it owns has no proof receipt" is computable with no judgement, and the surveyed plans provide a ready-made failure corpus (052's zero-receipt spine, 055's silent review-1, 056-file-write's AC-03, 058's receipt-in-`note`). Keep it advisory-honest in the harness tradition — surface as a finding, not a block — but *record* the finding as a receipt so it can't evaporate.
6. **Retire `assumed` as the default for un-run chores, or split it.** Three of seven plans have `assumed` chore nodes that never ran and left no record; 059's `skipped`+reason is the shape that actually informs a resuming agent. Whatever the requirement layer does, it should never inherit a status whose meaning is "we don't know whether this happened".

> Note (parent-session context): observation 1's `requirements[]`-in-the-spine shape was **superseded** by the brief/workshop direction — requirements live in DDs and the spine links by stable address (D5). Observations 2–6 fed directly into the DD design (proof links, receipt discipline, basis hashing → content-SHA + pins, completeness gates → doctor, `assumed` retirement → state vocabulary W2).

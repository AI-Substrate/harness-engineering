# the-flow state determinism — finish dropping `.the-flow-state.json` onto nav/bag

**Ordinal**: 030 · **Branch**: `026-flow-nav-rail-zone` (no new branch — staying put until PR time)
**Date**: 2026-06-19 · **Mode**: Simple · **Status**: READY (validated 2026-06-19) · **CS**: 3 (sum 7 — top of band; D=2 from the migration, but the no-clobber §6 redesign needs no new CLI affordance, so it stays CS-3)
**Posture**: best-effort — no gates, no scores, no thresholds. The flow must still degrade gracefully.
**Edit target**: the the-flow **skill source** in the tools repo (`~/github/tools/skills/SDD/the-flow/`); verification + eval harness live **here** (harness-engineering), reusing plan 027's harness. Same cross-repo split 027 used.

> 📚 This plan **executes an already-validated design** — it does not redesign. The authoritative ledger is plan 026's [workshop 001 `001-cursor-meta-migration.md`](../026-the-flow-cursor-meta-migration/workshops/001-cursor-meta-migration.md) (Contract 2 = edit map, Contract 3 = vibe change, Contract 4 = field map). This plan re-baselines that ledger against the **post-027** source and proves it. **§6 (migration) is deliberately revised away from workshop 001's D6** — see §6 for why (D6 predates nav; the live flows are already nav-canonical).

## Business Specification

*(This `## Business Specification` + the `## Implementation Plan` heading below are the-flow's unified-plan contract — present so the engine's disk-fallback recognises this doc. HIGH-2 fix.)*

### 1. TL;DR — the gap and the fix

`the-flow` guided mode still **hand-writes `.the-flow-state.json`** with raw Create/Edit file tools every turn (the "Create → *Path already exists* → fall back to Edit" dance, with the malformed-JSON risk that rides along). That file **duplicates `nav`** — the deterministic position/state object the `harness flow` CLI already owns (`now` / `next` / `intent` / free-form `bag`). The fix is workshop 001's **Option A**: drop the file, fold session-only state into `nav.intent` + `nav.bag` (`mode`/`status` are *stored* bag keys — still one CLI writer, still no second file), **derive** the rest (`pending_command`, milestones) at read time, and repoint resume/discovery to read the flight plan via the CLI.

After this, **`/the-flow <slug>` on a cold session (and after `/compact`) must land on the correct next step with no `.the-flow-state.json` present** — that is the acceptance test.

### 2. How it was missed (the crack between 026 and 027)

The user's question — *"I thought this would have been captured… not sure how it was missed."* Here is the exact seam:

| Plan | What it did | What it left |
|---|---|---|
| **026** (cursor-meta-migration) | Built the **CLI substrate** — `nav` (`now/next/intent/bag`), `harness flow rail`, per-node `zone`, `create --agent` — *and* designed the **complete** skill migration in **workshop 001** (drop `.the-flow-state.json`, field map, resume one-shot). | **Explicitly scoped the skill edits OUT** as *"tools-repo work the user owns"* and *"No migration command in the CLI"* (026 plan Non-Goals, lines 27, 29). The CLI shipped; the skill edits were deferred. |
| **027** (the-flow-skill-migration) | Did "the skill migration" — but consumed workshops **004 + 005** (the `cursor`→`nav` flight-plan ledger + the minih eval harness). Ported the flight-plan **position** to `nav`, added `--agent the-flow`, fixed `.minih.json`, proved it with the eval harness. | **Never pulled in workshops 001/002** — so `.the-flow-state.json` was never dropped. 027 even listed the coach rail-source change (hand-rolled counters → `harness flow rail`) as *"phase-2/optional"* (027 Non-Goals). |

So the **session-state file fell in the gap between "CLI substrate" (026, built) and "flight-plan position migration" (027, built)** — nobody owned "drop the state file," because 026 said *skill = your job* and 027 implemented a different (narrower) workshop. Workshop 001 — the doc that *did* own it — was never executed. This plan closes that loop.

**Sharpest evidence the seam is real:** the live source is now self-contradictory — `SKILL.md:99` already says *"the CLI is the only writer … Do not fall back to hand-cranking the JSON"* while `SKILL.md:19` still instructs the hand-write. The plan resolves a genuine pre-existing inconsistency, not an invented one.

> Process note: 028's `eng-harness-flow` flight-map port is a **separate standalone effort** (confirmed by the user) — explicitly **not** in this plan. Calling it out here so it is tracked and does not slip the same way. (It is also a *downstream consumer* of this fix — see §9 blast radius.)

### 3. What already exists (so we don't rebuild)

- **The CLI surface is live and verified** (`harness` 0.4.0, this working tree) — dogfood-confirmed during validation:
  - `harness flow nav set --now/--next/--clear-next/--intent` ✓
  - `harness flow nav meta set <k> <v>` / `nav meta get [k]` (the free-form `bag`, shallow-merge, any key) ✓
  - `harness flow nav show` (emits JSON by default — there is **no** `--json` flag) → `{nav:{now,next,intent,bag}, predecessors[], successors[]}` ✓
  - `harness flow rail` → the one-line rail from **live node status + zones** (no stored counters) ✓
  - **`nav.bag.status` round-trips and persists** (`nav meta set status active` → on-disk `.nav.bag.status` → `nav show` returns it; absent → `null`, clean idempotency signal) ✓
- **The design** — workshop 001 (Contracts 1–4, validated 2026-06-18) + workshop 002.
- **The eval harness** — plan 027's `agents/flow-skill-eval/` + `scripts/score-flow-eval.sh` + a fixed `.minih.json` (sources → `~/.agents/skills`).

**Net new build = skill-prose edits + eval-harness gates.** No CLI change. No schema change (`nav.bag` is schema-free).

### 4. The field map (`.the-flow-state.json` → flight plan)

Translated from workshop 001 Contract 4 into the **shipped** vocabulary (`cursor`→`nav`, `meta`→`nav.bag`):

| Old `.the-flow-state.json` field | New home | How |
|---|---|---|
| `slug`, `plan_dir`, `schema_version` | flight-plan **root** | already there — set by `create` |
| `intent` | **`nav.intent`** | `harness flow nav set --intent "<text>"` |
| `current_stage` (`awaiting-<id>`) | **`nav.now`** (+ node statuses) | `harness flow nav set --now <node>`; the "awaiting" is just position. **`nav.now` is authoritative — never reconstructed from `current_stage`** (see §6) |
| `pending_command` | **derived — not stored** | `nav.next` (node id) → Graph → Registry + Command grammar → command string, rendered at read time. `--plan`/`--phase` flags derive from `plan_dir`/`slug` + the next-incomplete phase node |
| `mode` | **`nav.bag.mode`** (stored) | `harness flow nav meta set mode <Simple\|Full\|unknown>` |
| `status` (`active`/`complete`) | **`nav.bag.status`** (stored) | `harness flow nav meta set status active`; flips to `complete` at merge. **Stored**, not derived — it is the active/complete flag AND the resume idempotency signal (§6); terminal-node status is only a read-time *fallback* when `bag.status` is absent |
| `milestones_total` / `milestones_done` | **derived from the rail** | `harness flow rail` computes pips from live node status + zones |
| `last_checkpoint_at` | **CLI node stamps** | the CLI already stamps `ran_at`/`modified_at` on nodes |
| `compacted_seams` | **`nav.bag.compacted_seams`** if still needed | `nav meta set` (free-form) |

Everything genuinely session-scoped is *stored* in `nav.intent` + `nav.bag` (one CLI writer); everything else is in the flight-plan root or *derived* at read time. **No second file.**

## Implementation Plan

### 5. Edit sites (re-baselined against the current post-027 source)

The handover under-counted; this is the full set, verified by `grep -rn "the-flow-state" ~/github/tools/skills/SDD/the-flow/` (validation confirmed: **13 grep hits across 4 files, all mapped, zero missed, zero line drift**). Workshop 001 Contract 2 is the before→after authority.

#### `SKILL.md`
- **~L19** (Two load paths, Guided step 3): *"it writes `.the-flow-state.json` directly, and drives the flight plan … only through `harness flow` calls"* → "drives **all** state — position + session bag — through `harness flow nav`; the flight plan is the single substrate; nothing hand-written."
- **~L54** (old-slug translation): the `pending_command in .the-flow-state.json` example → reframe as a **legacy artifact read during the one-shot backfill**; the live source of a pending command is now `nav.next` + grammar (rendered at read time).
- **~L93** (§ State): *"Durable state lives at … `.the-flow-state.json`, plus the flight plan"* → "Durable state **is** the flight plan — `nav` (position + `bag`) + node statuses. No separate state file."
- **Invariant (state-write)**: add/extend to "the CLI is the only state writer; **no hand-authored state file**" — and resolve the L99-vs-L19 contradiction (§2).

#### `references/00-routing.md`
- **~L13** (Entry paths step 1): *"Glob `docs/plans/*/.the-flow-state.json` where `status == active`"* → "Glob `docs/plans/*/the-flow.json`; read `nav.bag.status == "active"` (via `harness flow nav show`). A flow with only a legacy `.the-flow-state.json` → backfill on resume (§ Resume)."
- **~L30** (Fresh start step 5): *"Write `.the-flow-state.json` (temp file + atomic rename)"* → **delete**; fold into the CLI seeding (step 6): after `create` + seed nodes + `nav set --now research`, add `nav set --intent "<ask>"` and `nav meta set mode <…>` + `nav meta set status active`.
- **~L45–55** (§ Resume): *"Read the state"* → "Read position via `harness flow nav show` + node statuses" + the §6 backfill. Keep the idempotency rule (artifact-discovery-by-existence) — unchanged; it is what makes `/compact` a no-op.
- **~L59–89** (§ State contract — `.the-flow-state.json`): **replace wholesale** with the nav/bag contract (workshop 001 Contract 1). Drop the JSON block and the temp-file/atomic-rename method.
- **~L93–97** (§ State-write ownership): *"ONLY writer of `.the-flow-state.json`, `the-flow.json`, and `the-flow.md`"* → "drives **one** substrate (`the-flow.json`) via `harness flow` (the CLI is the only writer); `the-flow.md` is rendered; **no hand-authored state file**."
- **~L120** (Routing markers): *"keys on durable state first (`.the-flow-state.json` …)"* → "keys on `nav` (`now`/`next`) read via `harness flow nav show`; the exact-string disk fallback is unchanged."

#### `references/coach.md`
- **~L32–56** (host rail) **+ ~L58–71 (Stage→rail map table) + ~L312–319 (adoption `milestones_done` column)**: all three are `milestones_*`-from-file today. **Re-derive the pip fill** from `harness flow rail` / live node status, **keeping** the coach's `now/next` block and phase-grouping (`[build 2/3]`) as a presentation layer over it. *(This is the 027-deferred rail-source change, now on the critical path — and it is bigger than "swap the source": the coach rail is a richer artifact than the CLI's single line.)*
- **~L292** (`/compact` resume handshake): *"glob …`.the-flow-state.json` (status:active)"* → "`harness flow nav show` → re-derive from `nav` + artifacts."
- **~L310** (Adoption: artifact→stage inference): *"written into `.the-flow-state.json` as `pending_command`, render it at write time"* → "render the command at **read time** from `nav.next` + Registry; set position/bag via `nav set`/`nav meta set`."

#### `references/getting-started.md`
- **~L197**: drop `.the-flow-state.json` from the guided-mode **outputs** column → outputs become `the-flow.{json,md}` + `original-ask.md`.

#### Templates / schema
- **No change.** `flight-plan.template.json` already carries a `nav` block (027); `nav.bag` is schema-free.

### 6. Resume & backfill (revised after validation — nav is authoritative, never clobber it)

**Key correction from validation.** The in-flight flows are **not** "state file + empty nav." Plan 027 already migrated their **position** to `nav`, so today every live flow (026/027 here; 035 in tools) carries a **populated, canonical `nav`** *and* a **stale, disagreeing `.the-flow-state.json`** (e.g. 026: `nav.now=p1` but file `current_stage=awaiting-6`; `nav.intent` fresh but `state.intent` = the original ask). Workshop 001's D6 pseudo-code (written *before* nav existed) would set `nav.now` from `current_stage` — but `awaiting-<id>` are Graph **position markers, not node ids** (ids are per-flow: `p1`, `ws-nav`), so there is no reliable resolver, and lifting from the file would **overwrite good nav with stale data**. So: **nav wins; never clobber a populated nav; backfill only what's absent.**

On the **first guided resume** of a flow (§ Resume of 00-routing.md):

```
read nav via `harness flow nav show` (+ node statuses) and the-flow.json
# nav is the source of truth for POSITION — never overwritten below.
if nav.now is set to a real (non-seed) node:        # post-027 flows: the normal case
      # position already canonical → backfill ONLY absent session bag:
      if nav.bag.status absent: nav meta set status active   # (`complete` if the terminal node is done)
      if nav.bag.mode   absent: nav meta set mode <from plan **Mode**>
      if nav.intent     absent: nav set --intent "<from original-ask.md>"
      delete .the-flow-state.json  — it is now superseded
elif nav.now is empty / at the seed node:            # genuinely pre-nav flow (may not exist anymore)
      # do NOT read current_stage→node from the file (no reliable resolver).
      derive position from ARTIFACTS via the existing Adoption path (coach.md § Adoption),
      then set nav.now from THAT.
else:                                                → fresh / adopt per 00-routing.md
```

- **Idempotency signal** = `nav.now` being a real non-seed node (true for every live flow today), **not** `nav.bag.status` (the real flows don't carry it: 026 `bag={build_commit}`, 027/035 no bag). Optionally write `nav.bag.migrated=true` as the first backfill step for an explicit marker.
- **The `current_stage`→node lift is dropped** (CRITICAL-1/2/3) — no sound resolver, and unnecessary because position already lives in `nav`.
- **Deletion is the default** (not "optional"): a left-behind `.the-flow-state.json status:active` is a resurrection hazard for any un-repointed reader (see §9 — `eng-harness-flow`).
- **In practice this is a no-op-ish backfill** — since 027 already made flows nav-canonical, the "migration" just adds absent `bag` fields. That makes **clean break** (ignore the file; re-derive from nav+artifacts) equally safe; the no-clobber backfill above subsumes both. **Recommended: the no-clobber backfill.**

### 7. Acceptance criteria (deterministic — best-effort, none gate)

1. **AC-01** — `grep -rnE "Write .the-flow-state|Create .the-flow-state|atomic rename|ONLY writer.*the-flow-state" ~/github/tools/skills/SDD/the-flow/` returns nothing (the `ONLY writer` sub-pattern omits `of` to survive the `**`-bold in the source — validated against the real line); the only surviving `.the-flow-state.json` references are the **read-time backfill** + back-compat.
2. **AC-02** — `00-routing.md` § State contract is the **nav/bag** contract (no JSON block, no temp-file/atomic-rename); § State-write ownership says "CLI is the only state writer, no hand-authored file."
3. **AC-03** — Entry-path discovery globs `the-flow.json` (reads `nav.bag.status`); § Resume reads `harness flow nav show`.
4. **AC-04** — `coach.md` host rail (and the Stage→rail map + adoption `milestones_done` column) source the pip fill from live node status / `harness flow rail`; the `/compact` handshake re-derives via `nav show`; adoption renders `pending_command` at read time.
5. **AC-05** — `getting-started.md` guided-mode outputs no longer list `.the-flow-state.json`.
6. **AC-06a (static — the thesis proof that does NOT need an agent run)** — `grep -rnE "Write .the-flow-state|Create .the-flow-state" <migrated source>` returns nothing: the file is never authored. (Explicit overlap with AC-01.)
7. **AC-06b (behavioural)** — `minih run flow-skill-eval` (pass `--no-skills` if `.minih.json` still trips E211 — known seam) against the migrated source yields a run dir (`.harness/temp/flow-eval/$RUN_ID`) with **no `.the-flow-state.json`**, and after a simulated cold resume the **scorer** runs `harness flow nav show` (JSON by default) and confirms `nav.now` + the derived next command == the expected step (deterministic, not the agent's self-grade). The un-migrated baseline still writes the file → discrimination holds.
8. **AC-08 (idempotent backfill)** — a flow whose `nav.now` is already a real node (the post-027 norm) is **not** repositioned on resume; only absent `nav.bag` fields are backfilled; a second resume is a no-op. Tested against a fixture flow with the post-backfill shape.

### 8. Tasks

**Group A — prompt edits (tools-repo source `~/github/tools/skills/SDD/the-flow/`):**

| ID | Task | File(s) | Done when |
|----|------|---------|-----------|
| T-A1 | Rewrite SKILL.md state prose (load-paths step 3, §State, invariant, old-slug note); resolve the L99-vs-L19 contradiction | `SKILL.md` ~L19/54/93/99 + invariant | nav/bag is the substrate; "no hand-authored state file"; L19/L99 consistent |
| T-A2 | Entry-path + fresh-start + resume read switch | `00-routing.md` ~L13/30/45–55 | glob `the-flow.json`; fresh start sets intent/bag via nav; resume reads `nav show` |
| T-A3 | Replace § State contract + § State-write ownership + routing markers | `00-routing.md` ~L59–97/120 | nav/bag contract; CLI-only writer; keys on nav |
| T-A4 | Add the §6 no-clobber backfill block (nav authoritative; backfill absent bag; delete file) | `00-routing.md` § Resume | backfill present + idempotency on `nav.now`-is-real-node |
| T-A5 | Coach: **re-derive the host-rail pip fill** from `harness flow rail`/live node status (not stored `milestones_*`), **keeping** the `now/next` block + phase-grouping as a presentation layer; `/compact` handshake → `nav show`; adoption `pending_command` derived at read time | `coach.md` ~L32–56 **+ L58–71 (Stage→rail map) + L312–319 (adoption `milestones_done` col)** /292/310 | pip fill from live status; coach overlays preserved |
| T-A6 | Drop `.the-flow-state.json` from getting-started outputs | `getting-started.md` ~L197 | outputs = `the-flow.{json,md}` + `original-ask.md` |
| T-A7 | Grep gate | migrated source tree | AC-01..AC-05 hold |
| T-A8 | Grep **both** `the-flow` AND `eng-harness-flow` sources for any remaining control-flow read of `.the-flow-state.json` / `milestones_*` | both skill sources | no un-repointed reader remains (or each is listed + dispositioned — see §9) |

**Group B — verification (here, extending plan 027's harness):**

| ID | Task | File(s) | Done when |
|----|------|---------|-----------|
| T-B1 | Scorer gate: the **run dir** (`.harness/temp/flow-eval/$RUN_ID`, where the eval writes — **not** `docs/plans/`) has **no** `.the-flow-state.json`, AND a post-resume `harness flow nav show` shows `nav.now` at a real node | `scripts/score-flow-eval.sh` | deterministic (artifact-read, not self-grade); non-zero if the file appears or position is unset |
| T-B2 | Teach the eval agent a **cold-resume** beat + add output-schema fields (`stateFileAbsent`, `resumeDerivedPosition`; schema is `additionalProperties:true` → additive) | `agents/flow-skill-eval/{prompt,instructions,output-schema}` | agent simulates a fresh session, re-globs, reports nav-derived position; the scorer (T-B1) verifies it, not the agent |
| T-B3 | Run the loop — migrated PASSES (no file, resume works); un-migrated FAILS (writes file) | (run) | discrimination proven (AC-06b) |

**Deploy (separate, gated — not plan execution):** CLI is already shipped (0.4.0). Promote the migrated source → deployed via `just install-skills-from-source` from the tools repo, **CLI-first-then-skill** order. Live flows (026/027 here; 035 in tools) are **already nav-canonical**, so resume just backfills absent `bag` fields (§6) — no data loss. **Blast radius beyond the-flow:** the deployed `eng-harness-flow` unified-rail probe reads the dying file (§9) — it degrades to its solo rail until repointed in the 028 effort.

### 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Resume can't re-derive position without the file | Med | High | AC-06b cold-resume test; idempotency rule (artifact-by-existence) kept; `nav.bag.status` verified queryable/persisted |
| `pending_command` derivation misses a flag (e.g. `--phase`) | Med | Med | Derive `--phase` from the next-incomplete phase node; cover in the eval run |
| **Migration clobbers a populated `nav`** — every live flow has a canonical `nav` AND a stale, disagreeing state file | Med | High | §6 redesigned: nav is authoritative, never overwritten; backfill absent bag only; the `current_stage→node` lift is dropped |
| **`eng-harness-flow` (deployed) reads the dying file** — `~/.agents/skills/eng-harness-flow/references/coach.md:48/66` globs `.the-flow-state.json` + reads `milestones_*` for the unified the-flow rail | High (it will hit it) | Med (UX only) | Graceful: `coach.md:66` falls back to the solo rail. Repoint it to `harness flow nav show`/`rail` in the **028** standalone effort; T-A8 confirms no other reader; until then accept the solo-rail fallback |
| **030's own doc lacks the unified-plan headers** → disk-fallback grep won't recognise it | Low (030's nav is populated → resume keys on nav) | Med (hand-authored plans generally) | Headers now added (§ Business Specification / § Implementation Plan); post-fix `the-flow.json`+`nav.bag.status` is the primary discovery anchor, the doc-grep only the no-nav fallback |
| Coach rail change (027-deferred) drifts vs the old counters / under-scoped | Med | Med | T-A5 re-derives pip fill from live status, preserves coach overlays, and includes the 2 extra sub-sites (L58–71, L312–319); pin the rail in the eval scorer (027 GATE 1) |
| Overlap with the tools-repo chore-lifecycle schema WIP (`todo`/`skipped`, uncommitted) | Low | Low | Different file (`flight-plan.schema.json`) — no edit collision; coordinate deploy timing |
| Editing the deployed skill breaks live use mid-iteration | Med | Med | Iterate on the **source** via `--skill-source`; deployed copy stays baseline (027 pattern) |

### 10. Open questions

- **Q2 (from workshop 001)** — rail fill: derive from node statuses vs store `nav.bag.milestones_*`? **Resolved: derive** (via `harness flow rail`) — substrate-honest, matches 00-routing's "no derived rollup state." (`status`/`mode` remain *stored* bag keys; milestones are derived.)
- **Migration default** — the §6 **no-clobber backfill** (recommended) subsumes both D6 and clean-break; since flows are already nav-canonical, clean-break is equally safe. Confirm the no-clobber backfill is acceptable.

---

## Validation Record (2026-06-19)

### Validation Thesis

**Raison d'être**: the-flow guided mode still hand-writes `.the-flow-state.json`, duplicating the CLI's deterministic `nav`; workshop 001 designed the elimination but 026 scoped the skill edits out and 027 implemented a different workshop. This plan finishes the deferred migration.

**Value claim**: one CLI-owned, validated state substrate — no hand-write, no two-source drift, resume from one read; "navigator not bookkeeper."

**Artifact promise**: an implementer can execute with minimal clarification — exact edit sites (file:line + before→after), a complete field map, concrete resume/backfill logic, deterministic ACs, and an eval-harness proof.

**Intended beneficiaries**: the Phase-1 implementer; future the-flow resume; the user; the standalone eng-harness-flow effort (reuses nav/bag).

**Proof target**: Implementation (leaning Integration).

**Evidence standard**: edit sites match real source; field map complete; CLI capability verified; ACs testable via eval harness + grep; resume-correctness defined; migration loses no in-flight flows.

**Thesis source**: handover `handover-flow-state-determinism.md` + workshop 001 + plan 026 Non-Goals + the user's request.

**Thesis verdict**: **Advanced** (Option A committed; file eliminated; folded into nav/bag).

**Main thesis risk**: the single behavioural proof (no file + cold resume) rides one `minih` run with a known `.minih.json`/`--no-skills` seam — split into AC-06a (static grep, deterministic) + AC-06b (dynamic) to harden it.

| Agent | Lenses | Issues | Verdict |
|-------|--------|--------|---------|
| Source-Fidelity & Coherence | Evidence Sufficiency, Proof-Level Fit, Technical Constraints, Concept Docs, Integration, Hidden Assumptions | 1 MED (nav show `--json`) — fixed; sites 14/14 OK, 0 missed | ✅ |
| Risk + Completeness + Migration-Safety | Edge Cases, Deployment/Ops, Migration Safety, Test boundary, Evidence | 3 CRITICAL + 2 HIGH + 3 MED + 1 LOW — fixed | ⚠️→✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit | 2 LOW (AC-06 split; status stored) — fixed; 2 INFO confirmations | ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Deployment/Ops | 1 HIGH (eng-harness-flow reader) + 3 MED + 1 LOW — fixed | ⚠️→✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Phase-1 implementer | Exact sites + field map + resume logic, actionable | encapsulation lockout / shape mismatch | ✅ (after fix) | §5 sites verified 14/14; T-A5 coach scope widened to L58–71 + L312–319 |
| `score-flow-eval.sh` + `flow-skill-eval` | Concrete "no-file" + "cold-resume" gate; harness extensible | test boundary | ✅ (after fix) | `output-schema.json` `additionalProperties:true`; T-B1 run-dir = `.harness/temp/flow-eval/$RUN_ID`; scorer asserts `nav.now` |
| Future guided resume (post-/compact) | Position re-derivable from `the-flow.json` + `nav.bag.status` | contract drift (make-or-break) | ✅ | `nav meta set status active` → `nav show` returns `bag.status`; persisted on-disk; absent→`null` |
| In-flight flows (026/027/035) | Gentle lift, no data loss; clear owner/timing | lifecycle ownership | ✅ (after fix) | §6 no-clobber backfill: nav authoritative, backfill absent bag only, file deleted |
| Standalone eng-harness-flow (028 + deployed) | nav/bag pattern reusable; no conflict | shape mismatch / contract drift | ⚠️ tracked | 028 is nav-native (safe); **deployed** `eng-harness-flow/coach.md:48` reads the dying file → solo-rail fallback, repoint in 028 (§9) |

**Thesis alignment**: value claim **advanced** at proof target Implementation; the file is genuinely eliminated (Option A), with the main residual risk being the behavioural proof's reliance on one `minih` run (mitigated by the AC-06a static split).

**Outcome alignment**: The plan advances the VPO Outcome — *"the skill stops hand-authoring a state file and becomes a navigator… one source of truth, survives /compact from one source"* — on its load-bearing axis (the make-or-break `nav.bag.status` interface is real and verified, so the file can be eliminated and position re-derived from one substrate); the remaining cross-skill reader (`eng-harness-flow/coach.md:48`) and the cold-resume gate are now captured in-plan (§9, AC-06b) and fixable without redesign.

**Standalone?**: No — downstream consumers exist (implementer, eval harness, resume, in-flight flows, eng-harness-flow).

Overall: ⚠️ **VALIDATED WITH FIXES** — 3 CRITICAL + 3 HIGH found and fixed (the §6 migration redesign + the eng-harness-flow blast radius were the material catches); core thesis, edit sites, field map, and resume mechanism verified against live source/CLI.

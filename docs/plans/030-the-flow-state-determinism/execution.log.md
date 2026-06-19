# Execution Log — 030 the-flow state determinism · Phase 1

**Plan**: [the-flow-state-determinism-plan.md](./the-flow-state-determinism-plan.md) · **Phase**: Phase 1 — Drop the state file onto nav/bag
**Mode**: Simple · **Date**: 2026-06-19 · **Branch**: `026-flow-nav-rail-zone` (harness-engineering) / `main` (tools)
**Edit target**: the-flow skill **source** `~/github/tools/skills/SDD/the-flow/` (Group A); verification harness here in harness-engineering (Group B).

> Faithful to the validated plan (no redesign). Source is **post-035** (`ship`/`reconcile` vocabulary) — preserved, not regressed.

---

## Group A — prompt edits (the actual fix)

### T-A1 — `SKILL.md` state prose + invariant ✅
4 edits:
- **L19** (load-paths step 3): "writes `.the-flow-state.json` directly" → "drives **all** of it — position *and* session bag — through `harness flow nav`; the flight plan is the single state substrate; nothing is hand-written."
- **L57** (old-slug note): reframed the `.the-flow-state.json` `pending_command` as a *legacy artifact read only during the one-shot resume backfill*; live pending command = `nav.next` + Command grammar, rendered at read time.
- **L97** (§ State): "Durable state lives at … `.the-flow-state.json`" → "Durable state **is** the flight plan — `nav` + `bag` + node statuses; no separate state file; the CLI is the only writer."
- **Invariant 6**: extended to "**never hand-author a state file** … there is no `.the-flow-state.json`." → **resolves the L19-vs-L103 contradiction** (§2 of the plan): L103 ("the CLI is the only writer") and L19 now agree.

### T-A2/A3/A4 — `00-routing.md` nav/bag rewrite ✅
- **Entry paths (L13)**: glob `docs/plans/*/the-flow.json`; read `nav.bag.status == "active"` via `harness flow nav show`; a flow with only a legacy state file → backfill on resume. `>1 active` lists `nav.now` (was `current_stage`).
- **Fresh start (L29–31)**: deleted the `Write .the-flow-state.json (temp file + atomic rename)` step; folded session seeding into the CLI — `nav set --intent`, `nav meta set mode`, `nav meta set status active`.
- **Resume (L47–51)**: reads position via `nav show`; idempotency keyed on `nav.now` + node mtime stamps; pending command derived from `nav.next` + Registry.
- **§6 one-shot backfill (new subsection)**: **nav authoritative, never clobber** — backfill only absent `bag`; the `current_stage`→node lift is **dropped** (awaiting-`<id>` are position markers, not node ids); deletion of the legacy file is the default. Idempotency signal = `nav.now` is a real non-seed node.
- **§ State contract (L59–89)**: replaced wholesale — nav/bag contract, no JSON block, no temp-file/atomic-rename. Rail fill **derived** (`harness flow rail`), `ran_at`/`modified_at` replace `last_checkpoint_at`.
- **§ State-write ownership (L93–97)**: "the `harness flow` CLI is the ONLY state writer … no hand-authored state file."
- **Graph `complete` row + routing markers (L116/L120)**: `nav.bag.status:"complete"`; routing keys on `nav` first. Plus 2 cleanups — the `plan`-pass cadence no longer "recompute `milestones_total`" (rail re-derives), and the alias-table note no longer says "on the next state write."

### T-A5 — `coach.md` rail-source + handshake + adoption ✅
- **Host rail (L47, L71)**: pip fill **derived** from `harness flow rail` / live node status (`◆`/`◐`/`◇` follow each node's `done`/`in_progress`/`known`); **no `milestones_*` counter**. The coach overlays (same-line legend, phase-grouping, `now`/`next`) explicitly kept as the presentation layer — the bigger-than-a-swap point validation flagged.
- **`/compact` handshake (L292)**: glob `the-flow.json` → `harness flow nav show (bag.status:active)` → `nav.now`.
- **Adoption (L310/L312/L322/L324)**: pending command **derived at read time** from `nav.next`; column renamed to "done milestones (rail fill)"; back-fill now also sets `nav.now` + `nav meta set status active`/`mode`.

### T-A6 — `getting-started.md` outputs ✅
- Quick-reference guided-mode outputs: dropped `.the-flow-state.json` → `the-flow.{json,md}` + `original-ask.md`.

### T-A7 — grep gate (AC-01..05, AC-06a) ✅
- `grep -rnE "Write .the-flow-state|Create .the-flow-state|atomic rename|ONLY writer.*the-flow-state"` → **empty** (AC-01, AC-06a PASS).
- All 10 surviving `.the-flow-state` refs audited: every one is a **contract statement** ("there is no …") or **back-compat** (read-during-backfill / delete). The single `milestones_*` ref is the "no counters" contract line. Zero writers. AC-02..AC-05 satisfied.

### T-A8 — cross-skill reader grep + disposition ✅
- the-flow source: clean (T-A7).
- **eng-harness-flow source** `skills/eng-harness-flow/references/coach.md:48` reads the dying file for its unified-rail probe. It carries its **own graceful fallback** (~L62: *"State unreadable or stale → fall back to the solo rail"*) → degrades to its solo rail (UX-only). **Disposition: defer the repoint to the 028 standalone effort** (user-scoped, plan §9). **Not edited here.**

---

## Group B — verification harness (extends plan 027)

### T-B1 — scorer gate (no-file + nav.now) ✅
`scripts/score-flow-eval.sh`: added **GATE 6** (no `.the-flow-state.json` under the eval scratch dir — the discriminator) and **GATE 7** (`nav.now` resolves to a real node — cold resume needs no file). `bash -n` clean.

### T-B2 — eval agent cold-resume + schema ✅
- `agents/flow-skill-eval/prompt.md`: added a **Cold-resume beat** (simulate a fresh session; faithful `$OUT/` redirect for any state file the skill authors; re-derive position via `nav show`) + two report fields.
- `output-schema.json`: added `stateFileAbsent` (bool) + `resumeDerivedPosition` (string) to properties **and** required (additive; `additionalProperties:true`). Valid JSON confirmed.

### T-B3 — scorer discrimination proven (deterministic) ✅
Built a fixture flight plan with the migrated CLI and ran the scorer twice:

| Run | Shape | Result |
|---|---|---|
| 1 | migrated (no state file, `nav.now=phase-1`) | **ALL 7 GATES PASS**, exit 0 |
| 2 | + planted `.the-flow-state.json` | **GATE 6 FAIL**, exit 1 |

→ the gate **discriminates**. (Fixture removed after.)

### T-B3b — full minih end-to-end run **DEFERRED** ⏳
The agent-driven `minih run flow-skill-eval` against the *source* (behavioural AC-06b/AC-08) was **not** executed. Blocked on, by design: the **deploy gate** (the eval drives `~/.agents/skills/the-flow` per `.minih.json`; the migrated bits live in source until `just install-skills-from-source`, CLI-first), **invariant #7** (the flow agent doesn't run `minih`), and the known `--no-skills`/E211 seam. The scorer-discrimination proof above + AC-06a (static) establish the thesis; this is the remaining behavioural confirmation for the user/CI to trigger post-deploy.

---

## Final status vs acceptance criteria

| AC | Verdict |
|---|---|
| AC-01 — no writer patterns | ✅ grep empty |
| AC-02 — §State is nav/bag (no JSON block / temp-file) | ✅ |
| AC-03 — entry globs `the-flow.json`; resume reads `nav show` | ✅ |
| AC-04 — coach rail derived; `/compact` → `nav show`; adoption read-time | ✅ |
| AC-05 — getting-started outputs drop `.the-flow-state.json` | ✅ |
| AC-06a — static (file never authored) | ✅ grep empty |
| AC-06b — behavioural (no file + cold resume) | ⏳ scorer discrimination proven (deterministic); full minih run deferred (T-B3b) |
| AC-08 — idempotent no-clobber backfill | ✅ contract written (§6: nav authoritative, backfill-absent-only, idempotent on `nav.now`); behavioural confirm rides T-B3b |

## Discoveries & Learnings

| Kind | Note |
|---|---|
| insight | Source is **post-035** (`ship`/`reconcile`, not `merge`) — ahead of the deployed copy I read for routing. Edited source verbatim; preserved the newer vocabulary. |
| insight | `eng-harness-flow` source lives in **this** repo's top-level `skills/` (not the tools repo), confirming the eng-harness family split. |
| decision | `nav meta set` syntax is `nav meta set --path <f> <key> <value>` — verified before baking into the skill prose. |
| gotcha | The eval drives the **deployed** skill (`.minih.json` sources → `~/.agents/skills`); proving "migrated PASSES" end-to-end requires deploy-or-`--skill-source` first — hence T-B3b's deploy dependency. |

## Deploy (separate, gated — NOT done here)
CLI already at 0.4.0. Promote source → deployed via `just install-skills-from-source` (CLI-first-then-skill). Live flows (026/027 here; 035 in tools) are already nav-canonical → resume just backfills absent `bag` (§6). `eng-harness-flow` degrades to solo rail until repointed in 028.

## Suggested commit message
```
feat(030): drop the-flow's hand-written state file onto nav/bag

the-flow guided mode no longer authors .the-flow-state.json — all state
(position + session bag) lives in the flight plan's nav object, written
only by the harness flow CLI; pending_command, milestones and status are
derived at read time. Adds a one-shot no-clobber resume backfill (nav
authoritative). Extends the flow-skill-eval harness with a no-file +
cold-resume gate.

Source edits land in the tools repo (~/github/tools/skills/SDD/the-flow);
eval harness here. Deploy + full minih e2e run are gated follow-ups.
```

---

## Post-review fixes — review verdict **APPROVE WITH NOTES** (2026-06-19)

The `7 review` verb returned **APPROVE WITH NOTES** (no CRITICAL; `--strict` off → no fix-tasks file). Three findings; two were already self-flagged (F002 commit boundary, F003 deferred minih). The new actionable one was **F001 (HIGH)** — a real defect in my work — now fixed.

### F001 (HIGH) — discovery predicate vs §6 active-signal ✅ FIXED
**Defect**: the cold-discovery entry path and the `/compact` handshake keyed on `nav.bag.status == "active"`, but §6 (written later) says the active signal is **`nav.now` being a real non-seed node** *because some live flows lack a bag*. Verified empirically: live flows **026** (`nav.now=p1`, no `bag.status`) and **027** (`nav.now=review`, `bag=null`) would be **MISSED** by a bare `/the-flow` — the exact in-flight flows the migration must carry forward. AC-03 and §6 could not both be right.

**Fix** (aligns the predicate with §6 — the review's recommendation verbatim): a flow is **active** when `bag.status == "active"` **OR** (`bag.status` absent **AND** `nav.now` is a real non-seed node **AND** terminal not done). Two sites:
- `00-routing.md:13` — entry glob predicate. (grep-verified: now names `nav.now`.)
- `coach.md` `/compact` handshake — same fallback. (grep-verified.)

F005 (LOW — stale `status:active` files linger) **resolves automatically**: bare `/the-flow` now finds 026/027 → §6 backfill runs → legacy file deleted.

### F003 (MEDIUM) — eval masked the legacy population ✅ STRENGTHENED
The fresh-flow fixture always seeds `bag.status`, so it never exercised the bag-less shape that exposed F001. Added:
- **`scripts/score-flow-eval.sh` GATE 8** — derives the legacy shape from the real flow (`jq 'del(.nav.bag.status)'`) and asserts position still resolves via `nav.now`. Validated under bash: **positive** (030 flow → strip → `nav.now=phase-1`, PASS) and **negative** (also strip `nav.now` → correctly FAILS, discriminates). `bash -n` clean.
- **`agents/flow-skill-eval/prompt.md`** cold-resume beat — new step 3 legacy-shape sub-case: copy with `bag.status` stripped, confirm a bare `/the-flow` still treats it as active (rides the deferred behavioural run, but now covers F001's population).

### F002 (MEDIUM) — commit boundary — UNCHANGED, user's call
The 4 Group A files still commingle 030 with uncommitted 035 (`merge`→`ship`). Not resolvable to a clean 030-only diff from this tree non-interactively. Awaiting the user's commit-sequencing decision.

### F004 (LOW) — plan §3 omits the `.data` envelope on `nav show` — noted; Group B code already uses `.data.nav.now` correctly. Left as a doc nit.

> Group A (tools) changes are prose-only; Group B (harness-engineering) changes are a bash script + a markdown prompt — **no TypeScript / CLI source touched**, so neither can affect the CLI build or vitest suite.

**Next the-flow step**: re-run `7 review` to confirm F001/F003 clear, then resolve F002 and proceed to `8 ship`.

---

## Behavioural reps — T-B3b DONE (2026-06-19)

Ran `minih run flow-skill-eval` **4×** against the **migrated source** (`--skill-source path:~/github/tools/skills/SDD --skill the-flow` — sidesteps the deploy gate; no deploy needed). Varied intents: foo-widget, status-badge, doctor-`--json`, fetch-retry.

**Result: 4/4 reps, all 8 gates green.** Every rep: rail `[the-flow]`, clean spine `research·plan·phase·ship`, workshop as `branch_of` excursion, `navUsed` / no `cursor`, **GATE 6 no `.the-flow-state.json` authored**, **GATE 7** `nav.now` resolves, **GATE 8** bag-less legacy copy still resolves via `nav.now`. Run dirs under `agents/flow-skill-eval/runs/2026-06-19T0[34]-*` (gitignored); retros harvested to `docs/retros/flow-skill-eval.md`. This is the behavioural confirmation AC-06b/AC-08 were waiting on.

**Honest scope of the proof** (rep 2 surfaced this precisely): the eval writes to `.harness/temp/flow-eval/$RUN_ID`, so it exercises the CLI **substrate** (`nav show` resolves the bag-less copy) and the **clean-drive + no-file** authoring — but **not** the bare-`/the-flow` discovery *glob* itself (which globs `docs/plans/*/the-flow.json`, not scratch). The F001 discovery-predicate prose is verified by static review + this substrate proof; the real-world end-to-end is the live bag-less flows 026/027, which the fixed predicate now matches.

**Retro findings — the-flow prompt-tune (NOT 030 defects), batched for decision:**
1. Fresh-start prose lacks a copyable *ordered* (last-to-first) create-command block and hard-codes `docs/plans/` paths (reps 1, 2, 4). magicWand: print one eval-safe `PLAN_DIR`/`FLOW_PATH` block.
2. `harness flow nav show` renders human output in a TTY; the eval prompt should use `--json` to expose `.data.nav.now` (rep 3 — `agents/flow-skill-eval/prompt.md`).
3. workshop arg-shape differs between Registry (topic only) and the workshop sub-skill (plan+topic) (rep 4).

**F002 update**: resolved externally — plan 035 was committed (`6594035`/`213f87b`), so the the-flow source files are no longer commingled; the only remaining 030 source change is the F001 fix in `00-routing.md`/`coach.md`.

**Retro findings — all three FIXED (2026-06-19):**
1. `00-routing.md` fresh-start — added a single copyable, **ordered** create+seed block (`PLAN_DIR`/`FLOW_PATH` defined once; spine built last-to-first per `flight-plan-ops.md §6`). [tools]
2. `agents/flow-skill-eval/prompt.md` — cold-resume beat + report fields now use the global `--json` before `flow` (TTY-robust `.data` envelope), and step 3 states honestly that it verifies the substrate, not the `docs/plans` discovery glob. [harness-engineering]
3. `SKILL.md` Registry — workshop flags now `<plan> "<topic>" [--from-spec] [--list]`, matching the `25-workshop.md` sub-skill. [tools]

No re-run of the eval needed (per user): the fixes are prompt/doc ergonomics; the behavioural thesis is already proven by the 4/4 green reps above.

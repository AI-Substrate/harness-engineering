# Workshop: Migrate the-flow skill to the nav / harness-flow mechanics

**Type**: Skill Migration / Documentation Architecture
**Plan**: 026-the-flow-cursor-meta-migration
**Spec**: [the-flow-cursor-meta-migration-plan.md](../the-flow-cursor-meta-migration-plan.md)
**Created**: 2026-06-18
**Status**: Draft

**Value Thesis**: Plan 026 shipped the CLI side (nav object, `rail`, `zone`, `create --agent`) as a **clean break** — the `cursor` verb is gone. The the-flow **skill** was a 026 Non-Goal and still calls the removed verb, knows nothing of `nav`/`rail`/`zone`, and bloats its always-loaded engine with CLI mechanics. This workshop decides **where** the nav/CLI knowledge should live (a new, load-on-demand reference file — *not* the engine) and specifies **exactly which files change and what goes in them**, so the migration is a mechanical edit rather than a redesign, and the skill cannot break against the new CLI.
**Target Proof Level**: Implementation Ready
**Current Proof Level**: Implementation Ready

**Selected Value Axes**:
- **Migration Safety**: the cursor→nav clean break means the un-migrated skill breaks the moment 026's CLI publishes; the migration must land *with* that publish, additively and reversibly.
- **Onboarding / Accessibility**: progressive disclosure is the skill's contract — the mechanics belong in a file pulled in *only when mutating the flight plan*, not in the engine loaded every guided turn.
- **Agent Readiness**: a migrated skill must let an agent author a flight plan that renders a clean rail (spine-only) with minimal clarification — the thing 026's own flight plan got wrong.
- **Knowability**: the nav model and the spine-vs-excursion rule were implicit; making them explicit is what prevents the "workshops in the spine" defect recurring.
- **Learning Compounding**: capture the recipe + gotchas once so future flows don't rediscover them.

**Related Documents**:
- [002-nav-first-class-position-db.md](./002-nav-first-class-position-db.md) — designed the `nav` object this migration consumes.
- [003-building-flows-on-the-system.md](./003-building-flows-on-the-system.md) — the spine/excursion authoring model.
- [docs/how/harness-flow.md](../../../how/harness-flow.md) — the **authoritative** full CLI verb + render reference (updated in 026).
- [docs/how/examples/canonical-flight-plan.json](../../../how/examples/canonical-flight-plan.json) — the worked clean-rail sample produced while dogfooding 026.

---

## Purpose

Decide the documentation architecture for teaching the-flow the new CLI mechanics, and produce an Implementation-Ready edit ledger (file → change → content). The migration must (a) stop the skill calling the removed `cursor` verb, (b) teach it `nav` / `rail` / `zone` / `create --agent`, and (c) do so **without** swelling `00-routing.md`.

## Fresh Entrant Outcome

A fresh agent should be able to use this workshop to **execute the skill migration** with no additional context. They should be able to:

- Create the new reference file with the right content.
- Apply each listed edit to each named existing file.
- Verify the migrated skill produces a clean spine-only rail and never calls `cursor`.

## Key Questions Addressed

1. Where do the nav/CLI mechanics live — a **new** file or an **existing** one? → **New** (`references/flight-plan-ops.md`).
2. What exactly goes in that file?
3. Which existing files must change, and to what?
4. What about the coach's hand-rolled rail now that `harness flow rail` exists?
5. How does this stay safe across the CLI publish (deploy order)?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Implementation Ready | The user asked for "which file to edit and what goes in it" — the migration must be executable, not just oriented. |
| Primary Value Axis | Migration Safety | A clean-break verb removal makes the un-migrated skill a runtime hazard once the CLI ships. |
| Supporting Value Axes | Onboarding/Accessibility, Agent Readiness, Knowability | Progressive disclosure + a clean rail + an explicit nav model. |
| Downstream Loop Improved | Skill maintenance + every future guided run | The engine stays lean; mechanics load on demand; flows render clean rails by default. |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Removed-verb call survives in the skill | `00-routing.md:175` (`harness flow cursor --to / --recommend`) | "the skill breaks on the new CLI" | Validated (grep) |
| Zero new-surface awareness | grep `flow nav` / `flow rail` / `--zone` / `--agent` across skill → empty | "skill knows none of nav/rail/zone/create --agent" | Validated (grep) |
| Workshop-as-excursion already known | `00-routing.md:178` (`insert-node … --branch-of`) | "the spine bug was construction, not knowledge" | Validated (grep) |
| Stale template | `flight-plan.template.json:8` (`recommended_next`) | "template still uses the old top-level shape" | Validated (grep) |
| Stale schema prose | `flight-plan.schema.json:5` ("mutate via `cursor/…`") | "description references the dead verb" | Validated (grep) |
| Two rails now exist | `coach.md:32–56` (hand-rolled) vs CLI `flow rail` | "rail-source decision needed" | Validated (read) |
| Engine already heavy | `00-routing.md` = 224 lines; mechanics in 170–186 | "don't add more to the always-loaded engine" | Validated (wc) |
| Clean rail is achievable | `docs/how/examples/canonical-flight-plan.json` + rail line | "spine/excursion model yields the target rail" | Validated (dogfood) |

---

## Decision Space — where do the mechanics live?

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| A. Inline in `00-routing.md` | Fix + expand the existing 170–186 mutation block | One file; no new load path | Bloats the **always-loaded** engine; violates progressive disclosure; the user explicitly said "don't jam the flow full of this" | **Rejected** |
| B. Reuse `docs/how/harness-flow.md` | Point the skill at the CLI's own reference | Already exists + updated in 026; single source for *what the commands are* | Different **repo** (harness-engineering), referenced by **URL** — not bundled, not loadable at runtime; it's the CLI's reference, not the flow's *usage* choreography | **Rejected as the home** (kept as the authoritative pointer) |
| C. Reuse `harness-seams.md` | Fold mechanics into the harness-loop seam doc | Existing references file | Wrong scope — that file is the eng-harness **loop** overlay (boot/backpressure/retro), not the core flight-plan CLI | **Rejected** |
| D. **New `references/flight-plan-ops.md`** | A skill-local, **load-on-demand** operations manual | Keeps the engine lean; matches the progressive-disclosure contract; bundled so it's loadable; the natural home for flow-specific CLI usage | One new file + one load rule to add | **✅ Selected** |

**Why D**: the skill's own contract is "load exactly what the current step needs." The CLI mechanics are needed **only** when guided mode mutates the flight plan — a textbook on-demand reference. `00-routing.md` keeps the routing-level *when*; the new file holds the *how*.

> **Answer to the user's question:** a **NEW** file — `references/flight-plan-ops.md`. No existing file is the right home (the engine is the wrong place per progressive disclosure; the CLI doc is in another repo and URL-only; harness-seams is the wrong scope).

---

## The new file — `references/flight-plan-ops.md`

**Load rule (must be wired into the engine's load contract — see ledger row 9 / FC-01):** in **guided** mode, load this file **before the first flight-plan mutation** of a session. The directive must be registered in `SKILL.md` "Two load paths" **and** `00-routing.md` § Flight plan Prerequisite — a reference file with no loader is dead. Sub-skills (direct-jump) never load it — they don't touch the flight plan.

### File map (sections + what each contains)

| § | Section | Contents |
|---|---------|----------|
| 1 | Principle | "The CLI persists; the flow dispatches." The CLI validates node-refs + structure only — it never routes. The flow owns the Graph. |
| 2 | The nav object | The model + the position verbs (replaces `cursor`). See block below. |
| 3 | Verb cheat-sheet | `create` / `add-node` / `insert-node` / `status` / `set-node` / `comment` / `nav` / `rail` / `render` with exact flags. |
| 4 | Spine vs excursion | THE rule that keeps the rail clean. See block below. |
| 5 | Zone bands | Defaults-by-type table; when (rarely) to pass explicit `--zone`. |
| 6 | Gotchas | Build-order (no forward `--next` refs); `set-node` can't re-parent. |
| 7 | Pointer | "Authoritative full reference: `docs/how/harness-flow.md`." |

### § 2 — The nav object (lift verbatim)

```md
`nav = { now, next, intent?, bag? }` — replaces the old top-level `cursor`/`recommended_next` (clean break, no alias).
- `now`   — the validated current node (the truth). Move it: `harness flow nav set --now <id>` (fires cursor-moved).
- `next`  — an advisory node-id or null (no event). Set: `--next <id>`; clear: `--clear-next`.
- `intent`— free-text leg intent: `--intent "<text>"`.
- `bag`   — free-form shallow-merge qualifiers (no schema): `nav meta set <key> <value>` / `nav meta get [key]`.
- Inspect: `harness flow nav show` → nav + the now-node's predecessors/successors.

⚠️ The `cursor` verb is GONE. Every place you would have run
   `harness flow cursor --to <id>`     → `harness flow nav set --now <id>`
   `harness flow cursor --recommend <id>` → `harness flow nav set --next <id>`
```

### § 4 — Spine vs excursion (lift verbatim — the anti-bug rule)

```md
The rail walks the MAIN SPINE only and excludes any node with `branch_of`.
- SPINE = the SDD journey: research → plan → phase(s) → review → merge.
  - wire with `--next`; reveal phases at the plan pass via `insert-node --after <prev>`.
- EXCURSIONS = workshops, ADRs, backpressure, fix-loops, harness seams.
  - attach with `insert-node --branch-of <node> [--rejoin <node>]` — the branch point's `next` is UNCHANGED.
  - excursions are EXCLUDED from the rail and render as dotted side-branches.
❗Workshops ALWAYS `--branch-of plan` — NEVER `--next`/`--after`. Chaining a workshop onto the spine
  is exactly the "workshops in the spine" defect (cluttered rail). Phases on the spine; everything else hangs off it.
```

### § 3 — Verb cheat-sheet (key rows)

```bash
# create — ALWAYS pass --agent the-flow (→ rail title [the-flow]; without it the rail shows the slug)
harness flow create flight-plan --slug <slug> --path <flow.json> \
  --schema "<skill base>/references/flight-plan.schema.json" --bare --agent the-flow [--title "<t>"] [--plan-id <id>]

harness flow add-node    --path <f> --id <id> --type <t> --label "<l>" --status <s> [--next <a,b>] [--zone <band>]
harness flow insert-node --path <f> --id <id> --type <t> --label "<l>" --status <s> (--after <n> | --before <n> | --branch-of <n> [--rejoin <n>]) [--zone <band>]
harness flow status      --path <f> --node <id> --to <status>
harness flow set-node    --path <f> --node <id> [--label|--note|--user-input|--artifacts]   # NOTE: cannot set --next/--branch-of
harness flow nav set     --path <f> [--now <id>] [--next <id>|--clear-next] [--intent "<t>"]
harness flow render      --path <f> --output <flow.md>
harness flow rail        --path <f>            # the one-line spine rail
```

### § 5 — Zone defaults (so the flow rarely needs `--zone`)

| zone | default node types |
|------|--------------------|
| preflight | research, plan, workshop, adr (the shared renderer also maps `tasks`→preflight, but `tasks` isn't in the-flow's vocabulary) |
| flight | phase (and any unknown type) |
| postflight | review, merge, retro |

Pass explicit `--zone` only to override a default. For the flight-plan vocabulary the defaults are already correct, so the migration does **not** need to add `--zone` to existing calls.

### § 6 — Gotchas (lift verbatim)

```md
- Build order: the validator rejects forward `--next` refs. Add the spine last-to-first (merge first), or add nodes then wire.
- `set-node` can't set `--next`/`--branch-of` — you cannot re-parent an existing spine node into an excursion via the CLI.
  If a spine node should have been an excursion, re-create it with insert-node --branch-of (or rebuild the flow).
```

---

## Edit ledger — existing files

> Order: create the new file first, then apply edits. All edits are additive/mechanical **except row 3** (the SLIM — see before/after below). Apply to the **source** tree (`~/github/tools/skills/SDD/the-flow/`), not the deployed copy.

| # | File | Where | Change |
|---|------|-------|--------|
| 1 | **NEW** `references/flight-plan-ops.md` | — | Create with the seven sections above. |
| 2 | `references/00-routing.md` | line **175** (inside the § Flight plan cadence block, step-1 "advance" bullet) | **Fix the break.** `harness flow cursor --to <id>` (move) / `--recommend <id>` → `harness flow nav set --now <id>` (move; fires cursor-moved) / `--next <id>` (advisory) / `--clear-next`. |
| 3 | `references/00-routing.md` | the § Flight plan **CLI-driven cadence** block (currently ~170–186), steps 1–4 | **Slim** — see "The SLIM (row 3): before/after" below for the exact rewrite. Keep the routing-level *when*; replace inline flags with a pointer to `flight-plan-ops.md`. (The `docs/how/harness-flow.md` pointer already exists at line 185 — don't re-add it.) |
| 4 | `references/00-routing.md` | line **31** (initial create call) | Add `--agent the-flow`; then **after** the `add-node research` call, set position: `harness flow nav set --now research`. |
| 5 | `references/00-routing.md` | line **189** (legacy E308 re-create prose) | Add `--agent the-flow` to the `harness flow create` mention (same slug-title fix). |
| 6 | `references/coach.md` | line **324** (back-fill create) | Add `--agent the-flow` to the back-fill `create` call. |
| 7 | `SKILL.md` | line **101** (E308 re-create example) | Add `--agent the-flow` to the `harness flow create flight-plan …` example — the user-facing rebuild path; without it the rebuilt rail is slug-titled. |
| 8 | `SKILL.md` | line **99** (precheck probe list) | Add `nav`/`rail` to the capability-probe surface listed alongside `create`/`insert-node`/`render` (advertises the floor the skill now needs; correctly rejects a pre-026 CLI). |
| 9 | **Load wiring (FC-01)** — `SKILL.md` "Two load paths" (Guided, ~line 19) **and** `00-routing.md` § Flight plan Prerequisite (~line 163) | — | Register the new file in the **engine's** load contract: *"in guided mode, load `references/flight-plan-ops.md` before the first flight-plan mutation."* Without this the new file is an orphan nothing tells the engine to read. |
| 10 | `references/flight-plan.template.json` | lines **7–10** | Remove the top-level `"cursor"` (7), `"recommended_next"` (8), `"now"` (9), `"next"` (10); replace with one `"nav": { "now": "<id>", "next": "<id>" }` block. **Cosmetic** — `create --bare` never reads the template (`flow-service.ts` short-circuits to empty nodes); example-correctness only. |
| 11 | `references/flight-plan.template.md` | generated twin | Regenerate from the migrated `template.json` via `harness flow render` (it's the "regenerate, never hand-edit" rendered example — keep it in sync). |
| 12 | `references/flight-plan.schema.json` | line **5** (description) | Prose: "mutate via `harness flow cursor/status/…`" → "`…nav/status/…`" (cosmetic — the CLI ignores `description`). |
| 13 | `references/coach.md` | lines **32–56** (rail) | **Open question — see below.** Optional / phase-2: source the spine pips from `harness flow rail`, keep the coach's framing. |

**Already correct — no change:** `00-routing.md:178` (workshops as `--branch-of`), `harness-seams.md` (seams already `branch_of`), the shipped `flight-plan.schema.json` vocabulary. `getting-started.md` exists (a rendered view of the pipeline) and carries no `cursor`/`nav` mechanics, so it needs no migration edit.

### The SLIM (row 3): before/after

The cadence block interleaves *when* (the trigger) and *how* (the exact flags) in the same bullets — so the SLIM is a re-author, not a delete. Pattern:

**Before** (line 175):
> `- advance → harness flow cursor --to <id> (move) or --recommend <id> (advisory, no event).`

**After**:
> `- advance → nav set --now <id> (move) / --next <id> (advisory). Exact flags + full verb cheat-sheet: flight-plan-ops.md § 2–3.`

Apply the same shape to the other cadence bullets (status / set-node / comment / insert-node): keep the one-line *when*, append `(see flight-plan-ops.md § N)`, drop the inline flag spelling. Net: the block shrinks from a flag reference to a routing index; the flags live once, in the new file — which *demonstrates* (not just asserts) the "lean engine" claim.

---

## Open Question — the rail (coach hand-rolled vs `harness flow rail`)

### Q1: Should the coach keep hand-rolling its rail, or use `harness flow rail`?

**Context**: `coach.md:32–56` builds the host rail from `.the-flow-state.json` milestone counters. The CLI now emits `harness flow rail` from **live node status + zones** (no separate counter, no drift).

| Option | Pros | Cons |
|--------|------|------|
| A. Keep hand-rolled | Coach owns the voice; macro-milestone framing (`[build 2/3]`); zero new CLI call per turn | Two rails can disagree; duplicated logic; less accurate than live status |
| B. Replace with `flow rail` | Single source of truth; live status; zones; no drift | Loses coach-specific framing (the `[current]` bracket, companion line, now/next groups) |
| C. **Hybrid** | Coach calls `flow rail` for the **spine/pips** (live-accurate), then wraps it in the coach's framing | One CLI call per narration turn; small coupling |

**RECOMMENDED: C (hybrid)** — but **phase-2 / optional**. The rail works today; this is a quality improvement, not a break. Keeping it separate lets the core migration (edits 1–5, 7–9) ship first, de-risked.

---

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Skill migration | "update the prompts" — scope unknown, redesign risk | A 13-row edit ledger; each change is mechanical (row 3 carries a before/after) |
| Every guided run | Mechanics wedged in the always-loaded engine | Engine slimmed (row 3); mechanics load on demand (row 9 wires the loader) |
| Authoring a flight plan | Implicit spine/excursion model → workshops landed on the spine (026) | Explicit rule: phases on spine, everything else `--branch-of` |
| CLI publish | Un-migrated skill **already** breaks on the local nav-CLI (removed `cursor` verb) | Deploy-order + the exact broken line (`00-routing.md:175`) named |

## Migration Safety / deploy order

- **The break is already live (not pending).** The flow `cursor` verb was removed in the 026 CLI (HEAD; `--version` still reads `0.4.0`, unreleased to npm). The `harness` installed on this machine already reflects HEAD — `harness flow --help` shows `nav`/`rail` and **no** `cursor` (verified: `which harness` → `~/.npm-global/bin/harness`) — so `00-routing.md:175` is **already broken** against the local CLI. (The npm-registry `0.4.0` predates 026 and still has `cursor`, which is why an un-migrated skill *appears* to work wherever that older published CLI is installed.)
- **Deploy order**: land the migrated skill **with** the 026 CLI publish — *CLI first, then skill* (SKILL.md § Prerequisite). Rows 1–4, 7, 9 are load-bearing; the rest is correctness/cosmetic.
- **Reversible**: revert the skill + pin the prior CLI. The new file + edits are additive.
- **Source of truth**: edit the tools-repo source (`~/github/tools/skills/SDD/the-flow/`); the deployed copy at `~/.claude/skills/the-flow/` is overwritten on the next deploy.

## Validation / Acceptance

This workshop reaches Implementation Ready when:

- A reader can create `references/flight-plan-ops.md` from § "The new file" alone.
- Every existing-file edit names a file + location + concrete change (✅ the edit ledger).
- The `cursor`→`nav` break is identified with its exact line (✅ `00-routing.md:175`).
- Post-migration check (run against the **source** tree you edited): `grep -rnE '"cursor"|flow cursor|recommended_next|--recommend' ~/github/tools/skills/SDD/the-flow` returns **nothing**, AND `flight-plan.template.json` contains a `nav` block. Keep `flow cursor` with the space — a bare `cursor` trips the legitimate "move the cursor" prose in `coach.md`. Then a fresh guided run renders a spine-only rail titled `[the-flow]`.

## Open Questions

### Q1: Rail source — hand-rolled vs `flow rail`?
**OPEN** — recommend hybrid (C), phase-2. Does not block the core migration.

### Q2: New file name — `flight-plan-ops.md`?
**RESOLVED**: `flight-plan-ops.md` (the-flow's operational manual for its flight plan). Alternatives considered: `harness-flow-ops.md`, `flight-plan-cli.md` — rejected as less tied to the "flight plan" artifact the flow already names.

### Q3: Should the new file duplicate the full CLI reference?
**RESOLVED**: No. It carries the **the-flow-specific usage** (nav model, spine/excursion rule, gotchas) and **points** to `docs/how/harness-flow.md` for the exhaustive verb reference (DRY; one authoritative CLI doc).

---

## Validation Record

Validated 2026-06-18 via `validate-v2` — 4 parallel agents (source-truth, completeness, thesis/proof, forward-compatibility), each grounded in the real skill files + the 026 CLI source.

**Verdict**: Accuracy **STRONG** (0 HIGH); the core decision (new file `flight-plan-ops.md`) and every technical block (nav model, verb cheat-sheet, zone defaults, `--agent` rail-title, gotchas) verified line-for-line against `flow.ts` / `flow-renderer.ts` / `docs/how/harness-flow.md`. Two HIGH structural findings + several MED/LOW were **fixed in this revision**:

| Finding | Severity | Fix applied |
|---------|----------|-------------|
| FC-01 — new file orphaned (no loader in the engine's contract) | HIGH | Added ledger **row 9** (wire the loader into `SKILL.md` "Two load paths" + `00-routing.md` § Flight plan Prerequisite); strengthened the Load rule. |
| FC-02 — "not broken today" premise false (installed CLI already has nav/rail, no `cursor`) | HIGH | Rewrote Migration Safety: the break is **already live** against the local nav-CLI; npm-registry `0.4.0` predates 026. |
| CP-02 / CP-03 — create call-sites at `SKILL.md:101` + `00-routing.md:189` missed `--agent` | MED | Added ledger **rows 5 + 7**. |
| TH-01 — the SLIM (row 3) was the only non-mechanical edit, lacked before/after | MED | Added "The SLIM (row 3): before/after". |
| CP-04 / TH-03 — template row imprecise (`cursor` + top-level `now`/`next` also stale) | MED | Reworded **row 10** (remove lines 7–10 → one `nav` block). |
| CP-01 — `flight-plan.template.md` (rendered twin) not in ledger | MED | Added ledger **row 11** (regenerate). |
| CP-05 / TH-04 / FC-03 — acceptance grep under-covered + scoped to deployed copy | MED | Broadened the grep pattern + pointed it at the source tree. |
| ST-01 — zone table omitted `tasks` | MED | Footnoted in § 5. |
| TH-02 / FC-04 — line-anchor + precheck-citation drift | LOW | Row 3 uses a content anchor; precheck fixed to `SKILL.md:99`. |

**Residual**: the rail source (Q1) stays an explicit phase-2 open question (not a defect). `getting-started.md` exists and needs no nav/rail edit (it carries no CLI mechanics). Proof level after fixes: **Implementation Ready** (all 13 rows mechanical or carry a before/after).

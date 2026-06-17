# Research Dossier — eng-harness-flow "hooks" interface

**Generated**: 2026-06-16
**Research query**: "Re-map eng-harness-flow to expose its loop as four neutral lifecycle hooks (pre-flight / pre-coding / coding / post-coding) with `--hooks` discovery, `--hook` invocation (aliasing `--event`), `--emit-injection <idiom>`, and a concise `--help` — neutral from the-flow, lean."
**Mode**: Pre-Plan
**Location**: docs/plans/021-harness-flow-hooks/research-dossier.md
**FlowSpace**: Not available (standard tools)
**Roster**: 4 targeted parallel agents (structure · consumer blast-radius · prior-art · prior-learnings) — adapted from the 8-agent default because the design space was already deeply scoped in conversation; the unknowns were *current-state facts*, not concepts.
**Harness**: router installed (`~/.claude/skills/eng-harness-flow/SKILL.md`) → loop live; session-start = detection only, no node.

---

## Executive Summary

### What this changes
`eng-harness-flow` is the stateless front-door **router** to the harness loop. Today host flows call it via `--event <seam>` (5 seams). This work re-skins the public surface as **four neutral lifecycle "hooks"** on a single time-relative-to-coding axis, adds a **self-describing discovery** call so hosts can wire themselves in, and gives the skill a program-style **`--help`** — all while keeping the skill **lean** and **neutral from any specific host flow**.

### The four hooks (the public surface)
| Hook | Intent | Today's loop stage | the-flow.json node | `--event` seam(s) it subsumes |
|---|---|---|---|---|
| **pre-flight** | can we fly? — *system* ready | Boot (+ adoption redirect) | `harness-boot` | `session-start`, **`pre-implement`** |
| **pre-coding** | what's provable before we build? | Backpressure | `backpressure` | `post-spec` |
| **coding** | capture friction as we work (SILENT) | Observe | *(none)* | — (the `harness observe` CLI verb) |
| **post-coding** | reflect + encode | Retro + Improve | `harness-retro` | `phase-end`, `plan-complete` |

### Key insights
1. **This is a vocabulary projection, not a re-architecture** — the-flow.json already carries only *three* active harness node types (`harness-boot`, `backpressure`, `harness-retro`) + silent observe. The four hooks are those node types projected onto one axis (DC-01, IC-node-map).
2. **One genuine fork needs a decision: does the hooks interface execute as agent-interpreted *skill* instructions, or as a deterministic `harness` CLI verb the skill invokes?** The prior-art for `--help`/`--json` is all CLI code (`help-service.ts`, `envelope.ts`). → **Workshop WS-1.**
3. **`--event` must stay a back-compat alias** — 33 byte-identical call sites across the-flow stage modules + this skill's own docs. Rename-without-alias = cascade break (DC blast-radius).

### Quick stats
- **Primary target file**: `skills/eng-harness-loop/eng-harness-flow/SKILL.md` — **348 lines** (lean budget is the binding constraint).
- **Blast radius**: 33 `--event` invocation/doc sites (most in the **separate** `the-flow` skill repo).
- **Prior learnings**: 12 (PL-01…PL-12) — statelessness, frozen `--json` envelope, one-door, leanness.
- **Workshop opportunities**: 3 (see § Workshop Opportunities).

---

## How eng-harness-flow currently works (the thing we're changing)

### The router, in one line
A pure dispatcher: `(repo signals A–J, conversation, optional hint) → one next harness action`. **Stateless** — writes no state file, owns no artifacts, re-derives every call (PL-01). Never gates/scores/blocks; never invents a health verdict (that's `harness doctor`).

### SKILL.md section map (348 lines) — where things live
| Section | Lines | Relevance to this work |
|---|---|---|
| The stateless contract | 16–27 | **trim candidate** — a tight `--help` synopsis can absorb ~half |
| The two zones (adoption gate S0–S4 + engineering dispatch) | 31–77 | the hooks map onto these stages |
| Detection signals A–J + decision order | 80–108 | `--hook` is a new hint axis (PL-04) |
| **Parameter contract** (flags + slug table + conflict matrix) | 111–172 | **primary edit site**; verbose prose → `--help` can replace part |
| The `--json` routing envelope | 173–200 | **frozen contract** — hooks output must be additive (PL-03) |
| Per-turn UX (host rail, narration, why-table, flag beat, tone) | 204–319 | large human-mode block — *do not bloat further* |
| Called repeatedly along an externally-managed flow | 322–333 | the **seam/injection** vocabulary — where `--hooks`/`--emit-injection` belong |
| Relationship to existing skills | 337–342 | one-door / anti-reinvention guard (PL-07) |
| References | 343–348 | getting-started (266), governance-doc (71), maturity-assessment (45) |

### Current flag/`at=` surface (lines 115–137)
`at=` stages: `auto, adopt|setup, boot, backpressure, observe, retro-drain, retro-harvest, improve`. Flags: `--event <seam>`, `--plan-dir`, `--spec`, `--phase`, `--prompt-optional`, `--repo` (v2-reserved), `--json`.

### The `--json` envelope (lines 173–200) — the frozen, MCP-stable contract
Fields: `requested_stage, actual_stage, decision (route|redirect|noop|ambiguous), command, why, produces, preconditions_met, missing_rung, next_suggested, bypass_recommended, bypass_cause, rail{zone,adopt_pips,loop_pips,cursor}, now, next, flags[], insight`.

### The conflict matrix (lines 160–172)
6 rows reconciling a hint against signals (`route`/`redirect`/`noop`/`ambiguous`). **A `--hook <name>` is just another hint** that flows through this same matrix (PL-04).

---

## Consumer blast-radius — why `--event` stays an alias

**33 `--event` sites** were found. Critical context (00-routing.md:227): *"Stage modules keep their concrete seam invocations inline and byte-identical."* So the strings are hard-coded in many files, with **no version-gating in any caller**.

| Location | Sites | Notes |
|---|---|---|
| `the-flow/references/00-routing.md` | 8 | Graph table + Harness-seams section + flight-plan render rules |
| `the-flow/references/stages/*.md` (10,20,50,60,70,80) | ~18 | byte-identical inline invocations the verbs fire |
| `eng-harness-flow/SKILL.md` | 5 | signature + parameter contract + "called by parent flow" table |
| `eng-harness-flow/references/getting-started.md` | 4 | quick-reference table |

**Decision (carried into the plan):** add `--hook` as the **primary** name; keep **`--event` a transparent alias** in the router's parse step. In-tree docs/examples migrate to `--hook` incrementally; **no caller breaks**. ~~A soft-deprecation of `--event` can come 2–3 releases later.~~ **[SUPERSEDED by plan v1.2.0 / Phase 1 T003 — `--event` is a *permanent*, never-deprecated transparent alias; companion finding F001/F002.]** ⚠️ Most call sites live in the **separate `the-flow` skill repo** — see CD-04 / WS scope note.

### the-flow.json node-type → hook mapping (for render-rule alignment)
`harness-boot → pre-flight` · `backpressure → pre-coding` · `harness-retro → post-coding` · (silent observe → coding). This is the data side of the projection; the flight-plan render rules (00-routing.md:193–203) reference these node types.

---

## Prior-art to reuse (don't reinvent)

### A) Program-style `--help` + JSON envelope (CLI house style)
- **`harness/cli/src/services/help/help-service.ts:16–25,109–151`** — a pure `HelpContent` struct + `renderHelpText()` rendering function; **content-building separated from rendering**; "AGENTS START HERE" banner; core vs extension sections.
- **`harness/cli/src/output/envelope.ts:30–45`** — the `Envelope`: `{command, status (ok|error|degraded|unconfigured), timestamp, data, error, evidence, next_action, update_available}`; `next_action` required for non-ok.
- **`harness/cli/src/services/doctor/doctor-service.ts`** — `doctor` always exits 0, carries a full report struct in `data`; the model a `--hooks --json` manifest should mirror.

### B) Manifest precedent
- **`harness/cli/src/services/docs/docs-manifest.json` + `scripts/gen-docs.mjs`** — a static manifest (`id, title, summary, audience, sourcePath`) is THE curation point; a build-time generator inlines content into a committed `docs-content.ts` (JSON.stringify escaping, biome-canonical, logs to stderr). Precedent for a hooks manifest shape if it goes CLI-backed.

### C) Leanness rules (the binding constraint — PL-06/11/12)
1. **Carry each fact once; render, don't duplicate** (HelpContent/DoctorReport structs rendered to both text + JSON).
2. **Progressive disclosure** — layered sections, skip-safe; high-level first.
3. **One command-grammar definition** — like the-flow's single Registry table + render slots.

---

## Prior Learnings (institutional knowledge)

| ID | Learning | Source | Implication |
|---|---|---|---|
| **PL-01** | Statelessness is load-bearing — no state files, re-derive every call | 011-spec:10–13 | a manifest must be **derived**, never a stored registry |
| **PL-02** | session-start→boot (graceful degrade); plan-complete→retro | 011 T001, 015 T009 | confirms pre-flight=boot, post-coding=retro |
| **PL-03** | `--json` envelope is an MCP-stable **frozen contract** | 011 AC-8, 019 KF-01/09 | hooks output is **additive** (`data.*`), never reshaping fields |
| **PL-04** | conflict matrix encodes hint-vs-signal reconciliation | 011 AC-6, ws-001 | `--hook` is another hint through the same matrix |
| **PL-05** | boot-last; S3 inject is "owed, not provisioned" | 011 KF-08, T001 | `--hooks` may *advertise*, must stay honest about owed rungs |
| **PL-06** | skill carries no flag bloat; `--help` replaces longhand | 021 ask, 002 | binding leanness rule |
| **PL-07** | one-door — never name child skills in prose/envelope | 020 phase-4 | hook names stage-neutral; `command` names the invocation |
| **PL-08** | plan-complete→retro; router never declares "improve" | 011 T003, 015 T009 | **no post-harvest hook**; retro owns the Improve beat |
| **PL-09** | manifest computes availability every call (no capabilities registry) | 011 AC-3, spec:18 | hooks list derived; *but* the 4-hook spine is fixed — see CD-03 |
| **PL-10** | `--emit-injection` idiom-not-product; self-adapts | 021 ask | no `the-flow` profile; idioms only |
| **PL-11** | `--help` is the zero-context entry point; print-and-stop | 019 KF-09, 011 AC-9 | concise, no links to prose |
| **PL-12** | skill-size discipline — guard line count | 015 T009 (`wc -l` gate) | **add a line-count check to the plan** |

---

## Critical Discoveries

### 🚨 CD-01 — SKILL-interpreted vs CLI-backed: the execution substrate is undecided
`eng-harness-flow` is a **markdown skill** (an agent reads SKILL.md and acts). But every `--help`/`--json` prior-art is **CLI code**. So "`eng-harness-flow --hooks`" is ambiguous: is it (a) agent-interpreted skill behavior (the agent prints the manifest per instructions), or (b) a deterministic `harness` CLI verb (e.g. `harness flow --hooks --json`) the skill calls? The user's "as if it was a program" leans toward determinism; statelessness + leanness lean toward skill-only. **This decision governs determinism, machine-callability, testability, and skill size.** → **WS-1 (blocking for the plan's phase shape).**

### 🚨 CD-02 — pre-implement maps to pre-flight (boot), NOT pre-coding
A naming trap: `--event pre-implement` *sounds* like "pre-coding", but it fires the **`harness-boot`** node (00-routing.md:168 — "a harness-boot node before each phase"). So **pre-implement → pre-flight**. The research agent initially mis-binned it; the node-type evidence is decisive. The plan's mapping table must state this explicitly to prevent the same error downstream.

### 🚨 CD-03 — Fixed 4-hook spine vs signal-varying availability
PL-09 (statelessness) could be read as "advertise different hooks at different maturity levels." Our design says the **4 hooks are a closed, fixed set** (the lifecycle spine); what varies is **what each hook resolves to** (the one-to-n), decided by signals + the conflict matrix. The manifest always lists 4; per-hook entries may note preconditions. Pin this in the plan (and confirm in WS-2) so the manifest doesn't drift into a variable registry.

### 🚨 CD-04 — Cross-repo blast radius (`the-flow` is a separate skill)
~18 of the 33 sites live in the **`the-flow` skill** (`~/.claude/skills/the-flow/…`), not this repo. The user's constraint — *"keep it neutral from the-flow; the flow will read our work when done and adjust"* — means **this plan changes only `eng-harness-flow` (this repo)**; `the-flow` migrates itself later. The `--event` alias is what makes that safe and decoupled. The plan must scope to this repo and NOT edit the-flow.

### 🚨 CD-05 — `--json` is frozen; hooks ride additively
Per PL-03 + 019/020 precedent: additive envelope fields are snapshot-safe, reshaping is not. A `--hooks` manifest and any per-call hook echo must appear as **new additive data** (e.g. `data.hooks`, or a sibling `hook`/`hooks` block), never by changing existing field meanings.

### 🚨 CD-06 — Leanness budget is the hard constraint
SKILL.md is **348 lines** with a large Per-turn UX block (204–319). The four additions (`--help`, `--hooks`, `--hook`, `--emit-injection`) must net **near-zero growth** by *replacing* verbose prose (the stateless-contract bullets 16–27, parts of the Parameter-contract prose 111–142) with one tight synopsis that doubles as `--help`. The plan must carry an explicit **line-count guard** (PL-12).

---

## Workshop Opportunities

> The user explicitly asked to "surface any workshops needed." These are the decisions the plan **cannot** settle by default without a judgment call.

### WS-1 (recommended — likely blocking) · Execution substrate: skill-interpreted vs CLI-backed
**Decision**: Do `--hooks` / `--hook` / `--help` / `--emit-injection` execute as agent-interpreted skill instructions, or as a deterministic `harness` CLI verb that the skill invokes (matching `doctor`/`help` prior-art)? Or a hybrid (skill prints `--help` + manifest; CLI owns nothing new)?
**Why it matters**: governs determinism, machine-callability (MCP), testability, and whether the plan touches `harness/cli` (code + tests) or stays skill-only (markdown). It reshapes the entire phase plan.
**Evidence to weigh**: CD-01, prior-art A/B, statelessness (PL-01/09), "as if it was a program" (021 ask).

### WS-2 · Manifest shape & the fixed-vs-derived question
**Decision**: Exact per-hook manifest fields (`hook, intent, run_at, kind: fire|silent, invoke, produces, needs[]`?), whether it matches the doctor envelope house style, and confirming the **fixed 4-hook spine** (CD-03). Does `coding` appear in the manifest as `kind: silent` (advertised but not a fire-point)?
**Why it matters**: the manifest is the new contract hosts consume; shape churn later is expensive (PL-03 frozen-contract discipline).

### WS-3 · `--emit-injection` scope & idiom boundary
**Decision**: Is `--emit-injection` in v1 or deferred? Which idioms ship first (`make` / `ci` / `shell` / `sdd-skill`)? How is **"idiom not product"** enforced (the rule that forbids a `the-flow` profile and unknown-idiom fallback to the neutral manifest)?
**Why it matters**: it's the largest net-new surface and the one most at risk of eroding neutrality (PL-07/PL-10). Cutting it from v1 keeps the plan lean.

*(Not a workshop: the `--event`→`--hook` migration choreography across the-flow is a cross-repo phasing decision handled by the alias + a follow-up, not a design debate — see CD-04.)*

---

## Recommendations for the Plan

1. **Scope to this repo only** — edit `eng-harness-flow` (SKILL.md + references); do **not** touch `the-flow`. The `--event` alias decouples them (CD-04).
2. **Resolve WS-1 first** — its outcome decides whether there's a CLI phase at all. Default lean bias: skill-first, CLI only if determinism/MCP demands it.
3. **Add `--hook` as primary, `--event` as a transparent alias** — zero-break (blast-radius).
4. **Manifest + per-call output are additive to the frozen `--json` envelope** (CD-05/PL-03).
5. **Fixed 4-hook spine**; `coding` = `kind: silent`, never a fire-point (CD-02/CD-03).
6. **`--help` replaces longhand prose**; include a **line-count guard** so net growth ≈ 0 (CD-06/PL-12).
7. **One-door**: hook names stay stage-neutral; never name child skills (PL-07).
8. **`--emit-injection`**: idiom-not-product, unknown→neutral-manifest fallback; consider deferring to a v2 (WS-3).

---

## External Research Opportunities
None — this is an internal interface-design task fully answerable from the codebase + the prior design conversation. No external/library knowledge gaps surfaced.

---

**Research complete** — feeds the `plan` stage (one atomic doc: business spec + implementation plan). Three workshop opportunities flagged above; WS-1 likely wants resolving before or during planning.

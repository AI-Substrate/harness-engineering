# Research Dossier — eng-harness-flow flight plans (two first-class CLI-driven flows)

**Generated**: 2026-06-19 · **Mode**: Pre-Plan · **FlowSpace**: Not available (standard tools)
**Query**: Make `eng-harness-flow` a first-class CLI-driven `harness flow` system with two mutually-exclusive flows (adopt + loop), inject loop steps as chores into an active the-flow, plus three validation agents.

---

## Executive Summary

### Headline: the design is already written — plan 028 specifies it end-to-end
`docs/plans/028-eng-harness-flow-flight-map/eng-harness-flow-flight-map.md` is a complete, validated flight-map design for **exactly this feature**: two disjoint flows (🧰 adopt, ⚙️ loop) as separate flight-plan overlays, every node/type/zone/hook mapped to the real CLI vocabulary, the cycle modeled as nav-reset (not stored edges), and the bridge as a `decision` node. **This plan executes 028's design** (re-baselined against the live CLI) rather than re-deriving it. Its §9 leaves three build-phase questions open (resolved below).

### The three key insights
1. **The CLI substrate is ~80% there.** `harness flow` already has the full verb surface, the **chore data model** (`chore:{kind,importance}` + free `command` field + `--chore-kind`/`--importance`/`--command` on add/insert-node + `flow chores` listing), and a bundled `harness-loop` **schema**. What's missing: a `harness-adopt` overlay, a modernized `harness-loop` template, and loop/adopt zone defaults.
2. **"Chores" and the-flow's existing "seam nodes" reconcile cleanly.** the-flow TODAY emits the 4 hooks as first-class **seam nodes** (`harness-boot`/`backpressure`/`harness-retro`), not chores. But workshop 004 (PL-01) established `chore` as an **orthogonal flag** — a seam node *becomes* a chore by adding `chore:{kind,importance}`, keeping its type + violet render. So the co-existence integration is: chore-flagged nodes whose `command` is `run /eng-harness-flow --hook <X>`.
3. **This deliberately supersedes the stateless contract.** `eng-harness-flow`'s SKILL.md/00-routing.md assert statelessness *pervasively* ("writes no artifacts", "re-derives every call", "if it needs memory that's a smell"). Driving real flight plans with persisted nav is the opposite. The supersession is intentional (dogfood + exemplar) and must be written consciously into the skill, scoped to *flow position only* (verb modules stay harness-blind; the five hooks stay fixed).

### Quick stats
- **CLI**: `harness flow` verb family complete (`harness/cli/src/acts/flow.ts` + `services/flow/*`), v0.4.0. Chore model live.
- **Existing overlays**: `harness-loop.schema.json` (bundled, schema-only) + legacy template. **No** `harness-adopt`.
- **Skill**: `skills/eng-harness-flow/` mirrors the-flow's structure but lacks a `flight-plan-ops.md` analogue + a shipped schema.
- **Eval pattern**: two proven styles (dogfood-probe `validate-harness-flow`; faithful-drive + 8-gate scorer `flow-skill-eval` / `scripts/score-flow-eval.sh`).
- **Cross-repo split**: skill source in tools repo, eval+scorer here (plans 027/030).

---

## The two flows (from plan 028, confirmed against the skill engine)

### Flow A — 🧰 Adopt (finite, once per repo; terminal = bridge)
Spine `install → governance → build-boot → bridge`; `scout` + `inject` are skippable **excursions** (`branch_of`). New node types: `install · scout · governance · inject · build-boot` + `decision` (bridge).

| Rung | node id | type | zone | spine? | required? |
|---|---|---|---|---|---|
| S0 Install | `install` | install | preflight | spine | required |
| S1 Scout | `scout` | scout | preflight | excursion | skippable |
| S2 Governance | `governance` | governance | flight | spine | required |
| S3 Inject | `inject` | inject | flight | excursion | advisory |
| S4 Boot (LAST) | `build-boot` | build-boot | postflight | spine | required |
| Gate | `bridge` | decision | postflight | spine | — (router checks S0+S2+S4) |

### Flow B — ⚙️ Loop (cycle, every session; terminal = improve, re-enters via nav)
Existing `harness-loop` overlay, **refined**: split `retro` → `retro-drain` + `retro-harvest`, add `drain-gate` decision, set zones, modern nav block.

| Stage | node id | type | `--hook` | zone | kind |
|---|---|---|---|---|---|
| Boot | `boot` | boot | pre-flight | preflight | fire |
| Backpressure | `backpressure` | backpressure | pre-coding | preflight | fire |
| Observe | `observe` | observe | coding | flight | **silent** (no chore) |
| Drain gate | `drain-gate` | decision | — | flight | router decision |
| Retro drain | `retro-drain` | retro | post-coding | postflight | fire |
| Retro harvest | `retro-harvest` | retro | post-flight | postflight | fire |
| Improve | `improve` | improve | — | postflight | follows a retro (no chore) |

**The cycle = nav reset, DAG stays acyclic** (`improve.next=[]`; router resets `nav.now` back to `observe`/`boot`). Selection between A and B = the adoption gate: S0+S2+S4 hold → loop; else adopt (`skills/eng-harness-flow/references/00-routing.md` decision order).

---

## Chore-injection into an active the-flow (the co-existence feature)

**Locked scope**: chores-only in the-flow when active (no separate plan); standalone → own `.harness/loop.flow.json`. Chore set = the **4 fire hooks**.

- **Data model (verified, `flow-events.ts:74-79,101-102`)**: `chore:{kind,importance}` + a free `command` string. `kind ∈ {skill,command,builtin,manual}`; `importance ∈ {strongly-recommended,recommended,optional,informational}` (no `required` — never gates). `command` holds any string → `run /eng-harness-flow --hook pre-flight`.
- **Verbs (verified, `flow.ts`)**: `add-node`/`insert-node --chore-kind <k> --importance <i> --command "<cmd>"`; `flow chores` lists `status·importance·kind·anchor·ref(command)·runnable`; `status --to todo|done|skipped` drives the chore lifecycle; rail renders chores as squares (`□■▨▣`), `--chores show|collapse|hide`.
- **Reconciliation with the-flow's seam nodes**: the-flow's `harness-seams.md` already emits `harness-boot`/`backpressure`/`harness-retro` nodes carrying `/eng-harness-flow --hook …` commands **when the router is installed + provisioned**. The chore is the orthogonal flag layered on those. ⚠️ **Open design point for the plan**: does eng-harness-flow *inject* new chore nodes, or does the-flow's existing seam emission already place them and we only add the chore flag? (See Risk R-1.)

---

## Critical findings & risks (decision-relevant)

| ID | Finding | Action for the plan |
|---|---|---|
| **R-1 (HIGH)** | Overlap: the-flow already emits harness **seam nodes**; the user wants **chores**. Two emitters could double-place the 4 hooks. | Decide ownership of the in-the-flow chores: (a) eng-harness-flow injects + idempotency-guards, or (b) the-flow's seam machinery carries the chore flag. Must be idempotent either way (the coexist-eval asserts no-dupes). |
| **R-2 (HIGH)** | Stateless contract is pervasive in `eng-harness-flow` SKILL.md/00-routing.md/getting-started.md. Driving real flight plans contradicts it. | Consciously supersede, scoped to *flow position*: author a `flight-plan-ops.md` analogue, keep verb modules harness-blind, keep the 5 hooks fixed. Rewrite the stateless assertions, don't leave them contradicting the new design. |
| **R-3 (MED)** | `harness-loop` **template** is legacy (`cursor` not `nav`, no `provenance`/identity, 5 nodes, no retro split/drain-gate/zones). No `harness-adopt` overlay at all. | Build: author `harness-adopt.schema.json`; modernize `harness-loop.template.json`; both bundled via `gen:flows` (PL-03) OR shipped-by-skill via `--schema` (decide — see Q-2). |
| **R-4 (MED)** | Renderer `ZONE_BY_TYPE` lacks the loop/adopt node types → they'd default to `flight`. | Either extend `ZONE_BY_TYPE` (CLI change) or set explicit `--zone` on every node in the templates. Prefer template `--zone` (no CLI change) per the-flow's ship-banding caveat. |
| **R-5 (MED)** | `decision` nodes (bridge, drain-gate) with `next:[]` — confirm renderer's decision classDef renders (028 §9 open Q3). | Add a render fixture covering a `decision` node; `harness flow render --check`. |
| **R-6 (LOW)** | Gotchas: forward `--next` refs rejected (build last-to-first); `set-node` can't re-parent; `E308` legacy detection keys on `!provenance`; golden `.md` fixtures are CLI-generated, never hand-edited (`--check` in CI). | Encode in build-order + fixtures; never hand-edit flow JSON/MD (skill invariant #6). |

---

## The three validation agents (proven patterns)

Scaffold = `agent.json` + `prompt.md` (YAML frontmatter: model gpt-5.5, permissions, params) + `instructions.md` + `input-schema.json` + `output-schema.json`; optional deterministic scorer shell script. Dual-layer (`project|minih`) retro, `VF-NNN` difficulties. Cross-repo via `--skill-source path:<tools-source> --skill eng-harness-flow` (quote the path; `~` not expanded).

| Agent | Style | Proves | Scorer gates (key) |
|---|---|---|---|
| `validate-harness-flow` *(adapt)* | Dogfood onboarding probe (`agents/validate-harness-flow/`) | **Adopt flow** authored via real CLI: spine `install→governance→build-boot→bridge`, scout/inject as excursions, terminal=boot, nav drives it, no hand-crank | adopt spine shape; terminal=boot; bridge is decision; rail `[adopt]` |
| `loop-flow-eval` *(new)* | Faithful skill-drive + scorer (copy `flow-skill-eval` + `score-flow-eval.sh` gates 1–7) | **Standalone loop** authors `.harness/loop.flow.json`, nav drives boot→…→improve, rail `[harness-loop]`, cycle = nav reset, real verbs only | rail title; loop spine shape; nav.now resolves; render exits 0; chores carry the 4 refs |
| `flow-coexist-eval` *(new)* | Hybrid: drive the-flow to mid-plan, run eng-harness-flow alongside | **Chore injection** into active `the-flow.json`: 4 chores (`run /eng-harness-flow --hook …`), idempotent, lifecycle todo→done/skipped, **no `.harness/loop.flow.json` while the-flow active** | 4 chore refs present; injection idempotent (no dupes); nav.now still valid; loop.flow absent |

Scorer discipline (`scripts/score-flow-eval.sh`): `#!/usr/bin/env bash` (word-splitting for `hflow(){ $HARNESS_CMD flow "$@"; }`); `--json` BEFORE `flow`; `jq -e` gates fail-fast.

---

## Open questions resolved for the plan (from 028 §9)

- **Q-1 One overlay or two?** → **Two** (`harness-adopt` + refined `harness-loop`) — the flows are disjoint by construction.
- **Q-2 Does the router instantiate durable flight plans?** → **Yes, this time** (supersedes 028's "start as reference artifacts"). The user's mandate is real `harness flow nav` commands / full dice / dogfood. Standalone loop persists `.harness/loop.flow.json`; alongside the-flow it's chores in `the-flow.json`. Adopt persists its own plan during onboarding.
- **Q-3 decision-node render** → verify with a fixture (R-5).
- **Schema ownership (PL-03)** → decide bundled-in-CLI vs shipped-by-skill-via-`--schema`. Lean: bundle `harness-adopt`+`harness-loop` in the CLI (they're harness-owned, unlike the-flow's flight-plan schema which the skill ships).

---

## External research opportunities
None — this work is fully grounded in a local review of this repository and the related tools repository. No `/deepresearch` needed.

---

## Prior learnings surfaced (✓ 20 findings from plans 024/026/027/028/030)
Highest-impact: **PL-01** chores are orthogonal flags (seam nodes become chores); **PL-02** two disjoint flows, cycle=nav-reset; **PL-03** schema-ownership split; **PL-04** E308 keys on `!provenance`; **PL-05** insert-node edge algebra + E309; **PL-07** nav-first resume never-clobber; **PL-08/PL-20** CLI-generated golden fixtures + `--check`, never hand-edit. Full table lives in this dossier's source research (plans cross-referenced above).

**Research complete.** Routing is the flow's job.

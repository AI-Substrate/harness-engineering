# eng-harness-flow — stateless harness-loop router + no-new-CLI governance refactor

**Mode**: Simple

📚 Specification incorporates the authoritative workshop `workshops/001-harness-flow-entry-points.md` (stateless-router thesis, Diagrams 1–3, detection signals A–J, the 5-step setup gate, the conflict matrix, the per-turn UX, and the locked governance decisions G1–G5). Its decisions must not be contradicted.

ℹ️ No `research-dossier.md` and no `docs/domains/registry.md` exist; this is a skills/markdown-authoring repo, so domains are expressed informally as the harness **skill families**.

## Summary

**What**: Add a new skill — **`eng-harness-flow`** — that does for the **harness loop** what `the-flow` does for the **SDD pipeline**: on each invocation it *detects where the work sits on the loop* (from deterministic repo signals + conversation + an optional parent hint) and **routes** to the single correct harness skill. Unlike `the-flow`, it is **stateless** — it writes no state file and owns no artifacts; it re-derives position every call. Bundled with it is the **no-new-CLI** half of the governance refactor (**G1–G5**): move the governance doc into `.harness/`, ship two canonical reference docs, and tighten where/when governance and history are written.

**Why**: The harness loop is a *cycle* re-entered wherever work is — not a linear journey — so a per-flow state file (the-flow's model) is the wrong fit. A stateless router is enterable from anywhere, by any caller (a human, `the-flow`, a CI agent), any number of times, with zero bookkeeping. The governance refactor removes the current drift risks (a governance doc with a reader but a contested home, a maturity ladder duplicated inside a skill body, and per-session writes mixed into a contract doc).

## Goals

- A `eng-harness-flow` skill that, with **no arguments**, reports: does this repo have a harness; is it healthy; **where on the loop** the work sits; and the **single next harness command** — and is safe to call repeatedly.
- The skill is a **pure dispatcher**: it only **reads** (repo signals A–J + conversation + optional hint) and **routes** (prints/offers exactly one next harness command, optionally runs it on an explicit go-ahead). It **stores nothing**.
- Honour a light **parameter contract** (`at=` / `--event` / `--plan-dir` / `--spec` / `--phase` / `--prompt-optional` / `--json`) so a parent flow can pin position; validate preconditions via the **conflict matrix** (`route` / `redirect` / `noop` / `ambiguous`) rather than blindly running a contradicted stage.
- Enforce the **🧰 setup gate** before crossing into the **⚙️ engineering zone**: install (+scout) → establish governance → inject → **build + run boot last**; route the first missing required rung (install, governance, built boot) to the setup action that provisions it.
- Deliver the same **pleasant per-turn UX** as `the-flow` — host rail (pips), `now`/`next`, the Flag beat (lift-not-derive, silent-when-clean), one Insight, then print-and-offer — with the rail **recomputed from substrate each call**, and folded into a `--json` envelope for machine callers.
- **G1**: relocate the governance doc to `.harness/engineering-harness.md` with a **canonical-first** read order across all readers.
- **G2**: ship `references/governance-doc.md` and `references/maturity-assessment.md` as the **one canonical copy each**; move the L0–L4 ladder out of `eng-harness-1-boot/SKILL.md` into `maturity-assessment.md`; other skills **link**, never restate.
- **G3**: define `.harness/history.md` as a sparse harness **changelog** (one row per *encoded improvement*, not per session/boot).
- **G4**: make `eng-harness-1-boot` **read-only** with respect to governance/history (drop its per-validate `## History` append).
- **G5**: document the governance **write conditions** — written at inception (once), body + maturity snapshot change **only at the Improve beat**.

## Non-Goals

- **D9 / D9b — governance inception (the *writer*)**: provisioning the governance doc + working boot via a deterministic `harness init` CLI command, and the advisory **inject** step in `eng-harness-0-setup`. **Deferred to the next plan** (the workshop's "Deferred — next plan" block carries the worked design). Until `harness init` ships, the router/boot **degrade gracefully to `UNAVAILABLE`** when no governance doc exists (existing behaviour); setup keeps its current graceful-fallback `npx harness init` call.
- **No new CLI source** in this plan (no `harness init`, no new `acts/` or `services/`).
- **Refactoring `the-flow`** to call `eng-harness-flow` at its seams (D6 — a follow-up, not a dependency).
- **Multi-repo `--repo`** execution (D7 — deferred to v2; the parameter is reserved/documented only).
- **Reconciling the harnessability report path** (D8) — the router detects "any report present" and *notes* the inconsistency; the path unification is out of scope.
- Adding a `.disabled` opt-out sentinel for the loop — declining the harness is **conversational**, not a file.

## Target Domains

> This repo has no `docs/domains/registry.md`; "domains" below are the harness **skill families** / artifact areas this work touches, for traceability only — no formal domain registry is created.

| Domain (skill family / area) | Status | Relationship | Role in This Feature |
|---|---|---|---|
| `eng-harness-loop` (skills/eng-harness-loop) | existing | **create + modify** | Add the new `eng-harness-flow/` skill here; edit `eng-harness-1-boot` (G2 ladder move, G4 read-only) and reference the governance path (G1) in `eng-harness-2-backpressure`, `eng-harness-4-retro` |
| `eng-harness-setup` (skills/eng-harness-setup) | existing | **modify** | Update the governance-doc path (G1) in `eng-harness-0-harnessability-assessment` SKILL.md + template; the router **delegates** to `eng-harness-0-setup` for missing setup rungs (no behavioural change to setup itself in this plan) |
| `.harness/` (tracked harness artifacts) | existing | **modify** | New canonical home for `engineering-harness.md` (G1) and `history.md` changelog semantics (G3) |
| minih source config (`.minih.json`) | existing | **modify** | Add `eng-harness-flow` to the `include` array (the `skills/eng-harness-loop` source path already covers the folder) |

No NEW formal domain is established.

## Testing Strategy

- **Approach**: **Lightweight** (Simple mode default).
- **Rationale**: The deliverable is overwhelmingly **skill / reference markdown** (a new `SKILL.md`, two reference docs, and G1–G5 edits to four existing skill bodies + one template + one `.minih.json` include). There is no meaningful CLI **source** change in this plan (`harness init` is deferred), so there is little to unit-test.
- **Focus areas**:
  - **Structure validation**: the new skill is a well-formed `skills/eng-harness-loop/eng-harness-flow/SKILL.md` with the two `references/*.md`; `harness skills` / minih can discover it (`.minih.json` `include` updated).
  - **Read-order consistency (G1)**: every reader of the governance doc uses the canonical-first order (`.harness/engineering-harness.md` → legacy `docs/project-rules/engineering-harness.md` → `agent-harness.md` → `harness.md`) — verified by grep across the four edited skill bodies + template.
  - **No duplication (G2)**: the L0–L4 ladder appears in exactly one place (`references/maturity-assessment.md`); boot links to it.
  - **Regression**: the existing CLI vitest suite (`harness/cli`) stays green (the `docs-content.test.ts` path reference, if affected, is updated).
- **Excluded**: TDD for router logic (it's skill instructions, not code); any test for the deferred `harness init`.
- **Mock usage**: **Avoid** — not applicable to markdown authoring; real files / fixtures only.

## Documentation Strategy

- **Location**: **No new end-user documentation.** The new `SKILL.md` plus the two reference docs (`references/governance-doc.md`, `references/maturity-assessment.md`) are themselves the canonical, self-documenting surface for this feature.
- **Rationale**: This is internal skills tooling in a skills/markdown repo; a separate README/how-to would duplicate the skill body. (A future plan that ships `harness init` may add a user-facing quickstart.)

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=1, N=1, F=0, T=1 → P=6 → CS-3
- **Confidence**: 0.80
- **Assumptions**:
  - The four loop/setup skills behave correctly once their governance-doc path read-order is updated (no other logic change).
  - `skills/eng-harness-loop` being an existing minih source means only an `include` entry is needed — no new source path.
  - `harness init` (deferred) will later become the *writer*; until then `UNAVAILABLE` degradation is acceptable and already implemented.
- **Dependencies**:
  - The authoritative workshop `001-harness-flow-entry-points.md`.
  - The four existing loop skills + `eng-harness-0-setup` (delegation targets) and `the-flow`'s UX conventions (the model being adapted).
- **Risks**: see Risks & Assumptions.
- **Phases** (Simple → single implementation phase, sub-grouped):
  1. **eng-harness-flow skill** — author `SKILL.md` (stateless dispatcher: signals A–J, setup gate, Diagram-2 routing, conflict matrix, parameter contract + `--json` envelope, per-turn UX), place in `skills/eng-harness-loop/eng-harness-flow/`, add `.minih.json` `include` entry.
  2. **Reference docs (G2)** — `references/governance-doc.md` (contents + write conditions) and `references/maturity-assessment.md` (canonical L0–L4 ladder + how to assess); move the ladder out of `eng-harness-1-boot`.
  3. **Governance refactor (G1, G3, G4, G5)** — update the governance-doc path + canonical-first read order across the four readers; make boot read-only (drop Step 5 history append); document `.harness/history.md` changelog semantics and the inception/Improve-beat write conditions in `governance-doc.md`.
  4. **Validate** — grep consistency checks; keep the CLI vitest suite green.

## Acceptance Criteria

**Router skill — existence & shape**
1. A new skill exists at `skills/eng-harness-loop/eng-harness-flow/SKILL.md`, with `references/governance-doc.md` and `references/maturity-assessment.md` alongside it.
2. `.minih.json`'s `include` array contains `eng-harness-flow`; the skill is discoverable (e.g. `harness skills` lists it / minih resolves it) and no new source path was required.

**Router skill — stateless dispatcher behaviour (documented in SKILL.md)**
3. The SKILL.md states the **stateless contract** explicitly: writes no state file, no flight-plan `.json`/`.md`, owns no artifacts; re-derives position every call; safe to call any number of times; never gates/scores/blocks; never runs `minih` or `/compact`; never invents a health verdict (defers to `harness doctor`).
4. The SKILL.md documents **detection signals A–J** and applies them in decision order: parent hint first, then the **setup gate** (S0 install → S1 scout → S2 governance → S3 inject → **S4 build+run boot last**), then the **⚙️ engineering dispatch** (boot → backpressure → observe → retro-drain → retro-harvest → improve).
5. The setup gate **never crosses into the engineering zone** until the required rungs hold (S0 install, S2 governance, S4 built boot); the first missing required rung routes to the setup action that provisions it, with a one-line *why*. Skippable rungs (S1 scout, S3 inject) are *offered*, never blocking.
6. The SKILL.md documents the **parameter contract** (`at=` / `--event` / `--plan-dir` / `--spec` / `--phase` / `--prompt-optional` / `--repo` reserved-for-v2 / `--json`) and the **conflict matrix** resolving a hint that contradicts signals into `route` / `redirect` / `noop` / `ambiguous` (e.g. `at=boot` with no governance → `redirect` with `missing_rung`; `at=retro-harvest` with a non-empty buffer → `redirect` to drain first; `>1` plan with no `--plan-dir` → `ambiguous` + ask, never guess).
7. The SKILL.md defines a **slug-resolution** rule (friendly stage name → exact installed slug at call time; never append a guessed version suffix; fall back to the bare stage name).
8. The SKILL.md specifies the **`--json` routing envelope** with at least: `requested_stage`, `actual_stage`, `decision`, `command`, `why`, `produces`, `preconditions_met`, `missing_rung`, `next_suggested`, plus the UX fields `rail` / `now` / `next` / `flags` / `insight`.

**Router skill — per-turn UX**
9. The SKILL.md specifies the human-mode per-turn contract: **host rail** first (two zones — setup fill-bar `🧰 ●─●─◐─○─○` and engineering loop `⚙️ … ↺`, recomputed from substrate), then **Orient → Flag → Insight → Suggest → Invite**, print-then-offer, one step per turn, nothing irreversible without explicit go-ahead. The **Flag beat** lifts must-sees verbatim from the routed artifact, is silent when clean, and never blocks.

**G1 — path move + read order**
10. The canonical governance-doc path is `.harness/engineering-harness.md`, and every reader (`eng-harness-1-boot`, `eng-harness-2-backpressure`, `eng-harness-4-retro`, `eng-harness-0-harnessability-assessment` + its template) reads in canonical-first order: `.harness/engineering-harness.md` → `docs/project-rules/engineering-harness.md` → `agent-harness.md` → `harness.md`. A grep shows no reader pointing **only** at the legacy path.

**G2 — canonical reference docs, no duplication**
11. The L0–L4 maturity ladder lives in exactly one place — `references/maturity-assessment.md`; `eng-harness-1-boot/SKILL.md` no longer embeds the ladder inline and instead **links** to it. `references/governance-doc.md` describes the doc's contents and is linked (not restated) by boot/setup.

**G3 — history.md is a changelog**
12. `references/governance-doc.md` (and any skill that mentions history) define `.harness/history.md` as a **changelog**: one row **per encoded improvement** (the Improve beat), explicitly **not** per session/boot; most loop runs add zero rows.

**G4 — boot read-only**
13. `eng-harness-1-boot/SKILL.md` no longer writes governance or history — its prior Step 5 per-validate `## History` append is removed; boot only **reads** maturity. A grep confirms boot performs no governance/history write.

**G5 — write conditions**
14. `references/governance-doc.md` states the write conditions: the doc is written at **inception** (once — by setup; the *writer* itself is deferred to `harness init`), and its **body + current maturity snapshot** change **only at the Improve beat** on a capability change; the doc holds only the *current* maturity snapshot (trajectory lives in `history.md`).

**Graceful degradation (until `harness init`)**
15. With no governance doc present, the router routes to the 🧰 setup track (and boot reports `UNAVAILABLE`) rather than erroring — nothing breaks; this is verified by the documented behaviour and the existing fallback in `eng-harness-0-setup`.

**Regression**
16. The existing `harness/cli` vitest suite passes unchanged (any governance-path reference in tests, e.g. `docs-content.test.ts`, updated to the canonical-first expectation if touched).

## Risks & Assumptions

- **Risk — router/writer mismatch**: the router and boot *read* `.harness/engineering-harness.md`, but the *writer* (`harness init`) is deferred. **Mitigation**: explicit `UNAVAILABLE`/setup-track degradation (AC-15) — the gap is anticipated, not a regression; the workshop's Deferred block carries the writer design so the next plan doesn't re-derive it.
- **Risk — read-order drift**: four separate skill bodies must adopt the same canonical-first order. **Mitigation**: a grep consistency check (AC-10) in the Validate step; the order is stated once in `references/governance-doc.md` and linked.
- **Risk — duplication creeps back**: the L0–L4 ladder could be re-pasted into a skill. **Mitigation**: single-source rule (AC-11) + link-don't-restate convention documented in G2.
- **Risk — stateless re-offer friction**: a skipped optional (scout/backpressure) re-offers next call. **Accepted by design**: the parent owns skip-suppression (`--prompt-optional=false`); the child **artifact** is the only durable "done" signal.
- **Assumption**: placing the skill under the already-sourced `skills/eng-harness-loop` folder needs only an `include` entry (validated against `.minih.json`).

## Open Questions

- **D9 / D9b (governance inception via `harness init` + the inject step)** — **deferred to the next plan** by explicit decision; not resolved here. Carried in the workshop's "Deferred — next plan" block.
- **D8 (harnessability report path inconsistency)** — left unreconciled by decision; the router detects "any report present" and notes the inconsistency.
- None blocking this plan.

## Workshop Opportunities

> The design workshop is **already complete** — `workshops/001-harness-flow-entry-points.md` is authoritative and resolves the design space (D1–D13, with D9/D9b/D8 dispositioned above). No further workshop is required before architecture.

| Topic | Type | Why Workshop | Key Questions |
|---|---|---|---|
| _(none outstanding)_ | — | Covered by `001-harness-flow-entry-points.md` | — |

## Clarifications

### Session 2026-06-09

- **Q: Workflow Mode?** → **Simple** (single-phase, inline tasks). *(User chose Simple to keep it lean despite the two bundled concerns.)*
- **Q: Testing strategy?** → **Lightweight** — validate skill structure + keep existing CLI tests green; manual read-through. Deliverable is mostly skill/reference markdown.
- **Q: Mock usage?** → **Avoid** — N/A for markdown authoring; real files/fixtures only.
- **Q: Documentation strategy?** → **No new end-user docs** — the new `SKILL.md` + two reference docs are self-documenting.
- **Q: D2 — placement of the new skill?** → **`skills/eng-harness-loop/eng-harness-flow/`** (sibling to the numbered loop skills); add `eng-harness-flow` to `.minih.json` `include` (the `skills/eng-harness-loop` source path already covers it — no new source needed). *(User: "the flow skill will be in the loop skill folder.")*
- **Q: D8 — harnessability report path?** → **Detect "any report present" and note the inconsistency**; do not reconcile the `latest.json` vs `<ordinal>-<slug>/report.json` paths in this plan.
- **Scope confirmation**: this plan = the `eng-harness-flow` router + the **no-new-CLI** governance refactor (G1, G2, G3, G4, G5). **D9 (governance inception via `harness init`) and D9b (inject step) are deferred to the next plan.**

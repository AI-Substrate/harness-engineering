# Execution Log — Plan 025: Product-Documentation Hierarchy

**Plan**: `product-documentation-hierarchy-plan.md` (Simple mode)
**Started**: 2026-06-18
**Scope**: single implement phase, inline tasks T001–T017 → author `docs/guide/` (1 router + 15 chapters)
**Companion**: `code-review-companion` (minih), run `2026-06-18T01-50-01-936Z-ea51`, Power-On Mode

## Deviations & decisions
- **NO-COMMIT run.** User: *"do not touch the branch. just work here"* + *"we will be committing some work from other agent"*. All `docs/guide/` files are authored **in the working tree only** — no `git add`, no commit, no branch ops. The companion reviews via file path + `git diff --no-index /dev/null <path>`, not shas (deviation from the standard commit-per-task companion protocol).
- **Companion booted with `--no-skills`.** The repo `.minih.json` skills block references the pre-consolidation layout and aborts skill resolution (E211); the companion needs none of those skills. → Discovery D-01.

## Discoveries & Learnings
| # | Severity | Discovery | Action |
|---|----------|-----------|--------|
| D-01 | Medium | `.minih.json` skills block is **stale post-consolidation**: `sources` point at `skills/eng-harness-setup` / `skills/eng-harness-loop` (both gone — current layout is `skills/eng-harness-flow/` + `skills/eng-harness-0-harnessability-assessment/`), and `include` lists removed skills (`eng-harness-0-adopt`, `-1-boot`, `-2-backpressure`, `-4-retro`, …). `minih run <any-agent>` fails `E211 Could not resolve requested skills`. | Booted companion with `--no-skills`; surfaced to user. Plan 023/024 territory — **not** edited by this docs task. |

## Task log
<!-- per-task entries appended below as each doc lands -->

### T001 — `docs/guide/README.md` (Start Here router) ✓
4-intent router table (learn / install / weave-workflow / use-existing → one hop), full map grouped Get-going→Sustain, a "for agents" pointer, non-goals, nav footer. Links the in-repo deck (`../static-site/index.html`). Companion pinged.

### T002 — `docs/guide/01-quick-start.md` ✓
Brisk install→green-boot path (intent b). Commands verified this session against `app.ts` (registered acts) + `--help`: `npm i -g @ai-substrate/engineering-harness`, `harness doctor`, `harness init`, `harness skills install --target <cli> --global`, `/eng-harness-flow`, `harness boot` (framed as an authored **extension**, not core), `harness docs agents-readme`. Verified core set = help/doctor/init/new/docs/skills/update/record/observe/flow/instructions (note: `self-install` is NOT registered → not cited). Companion pinged.

### T003 — `docs/guide/02-what-is-an-engineering-harness.md` ✓
Concepts digest (intent a): eng-vs-agent-harness table, the missing layer, the deterministic layer. Embeds `../media/harness-layers.png`; links `static-site/layers.html` + foundations. Orient+link, no re-authored layer defs (AC-06). Companion pinged.

### T004 — `docs/guide/03-the-harness-loop.md` ✓
The loop (Boot→Backpressure→Observe→Retro/Magic Wand→Improve) as mermaid + text fallback; router-hooks table verified vs `eng-harness-flow/SKILL.md`; 3-flows distinction noted, deferred to §08. Companion pinged.

### T005 — `docs/guide/04-adopting-the-harness.md` ✓
Detailed onboarding walkthrough (intent b); mirrors the `installing-the-harness` deck shape corrected to local reality (5-rung gate, verified commands). 3 in-flux call-outs marked. Post-deck-read enhancements: easy-authoring note + post-boot workflow-choice link to §08. Companion pinged.

### T006 — `docs/guide/05-using-an-existing-harness.md` ✓
Intent d: drive an existing harness, no install/adopt (`harness instructions/help/doctor/docs/boot/observe`). AC-03. Companion pinged.

### Terminology resolution (from the deck, recorded here since memory store is unavailable this session)
`/the-flow` = built-in SDD workflow (research→plan→implement→validate). `/eng-harness-flow` = the **single** harness-loop router skill called at three lifecycle moments (before work / after plan / after work), works with the-flow OR a BYO flow. "The self-improving loop" is a concept name, not a command. The `harness flow` 024 CLI verb is the CLI surface; its exact relationship to `/eng-harness-flow` is orient+link (§08) and a 🚧 TODO(confirm). Source: `installing-the-harness.md` open Q1 (RESOLVED) + `eng-harness-flow/SKILL.md:4`.

### T007 — `docs/guide/06-repo-layouts.md` ✓
Core-vs-extensions table; the `.harness/` tree **verified against this repo** (`engineering-harness.md`, `extensions/<name>/{extension.ts,instructions.md}`, `records/{retro,harness-change}/`, `reports/harnessability/` on-demand, `temp/`); committed-vs-gitignored table verified vs `.gitignore:159`. Links `../how/record-and-record-types.md`.

### T008 — `docs/guide/07-multi-repo-and-org-rollout.md` ✓
Shipped model (one global core + per-repo `.harness/`, converge via `harness update`) + monorepo note; 2 🚧 Roadmap call-outs (shared cross-repo extension registry; org-wide metric rollups) — AC-08.

### T009 — `docs/guide/08-fitting-your-workflow.md` ✓
Intent c, non-coercive. Two paths: built-in `/the-flow`; BYO + the single `/eng-harness-flow` at 3 moments (pre-flight/pre-coding/post-flight). Orient+link, no internals re-teach (AC-05). `harness flow` CLI relationship marked 🚧 TODO(confirm).

### T010 — `docs/guide/09-operating-the-loop.md` ✓
Daily rhythm: `harness instructions`/`harness boot` at start, `harness observe` during, retro drain (`post-coding`)/harvest (`post-flight`) + `harness record retro`. All commands real.

### T011 — `docs/guide/10-encoding-and-learning-loops.md` ✓ (flagship)
Encode-the-fix-not-the-memory, friction→deterministic-sensor table, magic wand, compounding. Digest of simple-mode Rule 2 + compounding. KF-04.

### T012 — `docs/guide/11-backpressure-patterns.md` ✓
The proof ladder (compile/type/lint → unit → arch → build/boot/smoke → e2e → health). KF-02: rungs 3–6 are authored EXTENSIONS, not core.

### T013 — `docs/guide/12-extending-the-harness.md` ✓
`harness new <name> [--wrap] [--js]`; extensions in `.harness/extensions/<name>/`; guided `add-extension`. Orient+link to `docs/how/extend-the-harness.md` + `harness docs authoring-verbs`.

### T014 — `docs/guide/13-maintaining-the-harness.md` ✓
`harness update` (core) + `harness skills update --target` (skills) — both verified vs `--help` this session; `harness doctor` for staleness; links keeping-the-harness-up-to-date.md.

### T015 — `docs/guide/14-metrics-and-measures.md` ✓ (INTENTIONAL STUB)
Title + scope + 🚧 TODO(populate) + candidate-measures skeleton (change-failure rate, lead time, token/time, bypass rate, skills usage, encoded improvements) + how-to-gather placeholder. Links harness-value-measures.md. Deliberately not fully written (per user).

### T016 — `docs/guide/15-where-to-next.md` ✓
Closing index → foundations, docs/how, INSTALL, skills/README, cli/README, static-site decks, AGENTS, README, `harness docs`. All links verified.

### T017 — Drift guard + call-out surfacing + README-link supply ✓
**DRIFT GUARD (this session):**
- **Links:** every relative link across all 16 `docs/guide/*.md` resolves (0 broken).
- **Commands:** every cited `harness <verb>` is real — doctor, docs, observe, help, instructions, update, skills, new, init, flow, record (+ `boot` framed as an authored extension). `boot`/`smoke`/`arch-check` never implied as core. Slash-commands: `/eng-harness-flow` (+ hooks verified vs SKILL.md), `/the-flow`, `/skills reload`.
- **Nav (AC-07):** README→01→…→15 continuous + acyclic; every doc carries the prev/next footer.

**6 CALL-OUTS surfaced (AC-08):**
1. Terminology / `harness flow` CLI ↔ `/eng-harness-flow` skill relationship — `08-fitting-your-workflow.md:37`.
2. Agent drop-file (`harness docs agents-readme` / source `AGENTS_README.md`) — `04-adopting-the-harness.md:14`.
3. Onboarding resumability (plan 023 `adopt-flow.json`) — `04-adopting-the-harness.md:65`.
4. `harness flow` (024) orient-only confirmation — `08-fitting-your-workflow.md:37`.
5. Harnessability = LLM-assisted skill, not a deterministic command — `04-adopting-the-harness.md:43`.
6. Folder name → resolved to `docs/guide/` (no inline marker needed). Plus Roadmap call-outs in `07-multi-repo-and-org-rollout.md:24` and the metrics stub in `14-metrics-and-measures.md`.

**README link supplied to plan 023 (AC-10 — 025 supplies, 023 owns the `README.md` edit; NOT edited here):**
```markdown
- **[The adopter's guide](docs/guide/)** — a guided, read-in-order walkthrough: adopt the harness in your repo, operate the loop, and grow it. Start here if you're new.
```
Recommended placement: a new bullet under `## See the full intro`, and add "the [adopter's guide](docs/guide/)" to the `docs/` row in `## What's in this repo` (README.md:119).

### Companion debrief (`code-review-companion`, run `2026-06-18T01-50-01-936Z-ea51`)
Power-On companion reviewed T001–T016 + a final full-guide drain (23 peer updates, 0 unresolved). Verdict: **3 MEDIUM, 0 CRITICAL/HIGH**; the final sweep found no further command/link/nav/terminology/unmarked-aspirational issues.

Findings disposition:
- **F001** (`README.md` nav footer) — **ACCEPTED BY DESIGN.** README is the index/root: no Prev, cannot self-link "↑ Start Here". Footer kept as `Start Here · Next →`; the full `← Prev · ↑ Start Here · Next →` pattern holds for all 15 chapter docs.
- **F002** (`02` — unqualified `harness boot`) — **FIXED.** Qualified both mentions as a repo-authored `boot` extension; kept `harness doctor` as the core example. (Serves KF-02/CD-03.)
- **F003** (`04` — over-strong resumability claim) — **FIXED.** Reworded to the stateless reality (router re-derives the next rung from repo signals); the 🚧 TODO(confirm) on first-class persisted resumability (plan 023) remains.

magicWand (target: **coordination / minih-layer**): a coordination-provided run-context field/helper that prints the authoritative project root, active plan, output path, and task counters as JSON. → **Route upstream (minih)**, not a project-doc fix. Already a known recurring friction (MH-001: `$MINIH_PROJECT_ROOT` resolved to the run folder, not repo root — matches existing repo guidance to resolve root via `git rev-parse`). MH-002 (first holistic sweep output too large) — minor; companion self-resolved by narrowing.

### Discovery D-02
Medium: a minih run wedged at status `active` (known `code-review-companion@0.2.0` limitation) leaves `minih retros` empty — the farewell retrospective is only in `output/report.json`. Read via the documented fallback after `minih validate` confirmed the envelope schema-valid. Missing surface: no read-only CLI prints a single wedged run's farewell content.

# Research Report: dogfood-harness-flow

**Generated**: 2026-06-09T11:42Z
**Research Query**: "a new harness CLI extension (like validate-harnessability.ts) that fires parallel minih agents to run the FULL eng-harness-flow setup on freshly-cloned public repos (skip install; harnessability assessment → governance harness.md → detect+build a working boot extension), abandons low-harnessability repos for another candidate, then collects the harness retros; plus dogfooding the same flow on this repo and reporting all records back"
**Mode**: Pre-Plan
**Location**: docs/plans/013-dogfood-harness-flow/research-dossier.md
**FlowSpace**: Not used (direct read + 3 parallel explore agents + minih probing)

## Executive Summary

### What we're building
A **second dogfood extension** that mirrors `.harness/extensions/validate-harnessability.ts`, but whose per-repo minih worker runs the **entire harness setup flow** end-to-end — *harnessability assessment → hand-written governance doc → detect + author + validate a working `boot` extension* — on a freshly-cloned public repo, abandoning a repo that scores poorly and picking the next candidate. It fires **3 in parallel**, returns immediately, and a collection step aggregates each child's **records (retros) + reports** back into this plan folder. Separately, **we dogfood the same flow ourselves** on this repo while building it, recording our own retros via `harness record retro`, then harvest and report.

### Two near-perfect existing templates (this is mostly assembly, not invention)
1. **`.harness/extensions/validate-harnessability.ts`** (250 lines) — the *parallel-clone-and-fire* orchestrator: temp dir, `git clone --depth=1` loop, detached `nohup` fire-and-forget per repo, `minih last-run` run-id capture, immediate `ctx.ok/degraded/error` return with `next_action` polling prompt. **Copy its skeleton verbatim.**
2. **`agents/install-and-validate-test-extension/`** — the *worker that drives setup skills in a throwaway repo*: installs the harness, **invokes the `add-extension` skill** to author an extension, then independently validates (`doctor`/`help`/invoke) and emits a `verdict` + dual-layer `retrospective`. **Copy its agent shape (prompt/instructions/input-schema/output-schema) and extend the mission to the full flow.**

### Key insights
1. **Don't run `eng-harness-flow` conversationally inside the agent — drive its child setup skills directly.** `eng-harness-flow` is an *interactive print-then-offer router* (one step/turn, never irreversible without go-ahead — SKILL.md:222-234). The `install-and-validate` agent already shows the right pattern: a worker drives a *setup skill* (`add-extension`) directly and validates the result. Our worker drives the ordered setup skills (`assess` → governance → `add-extension` for boot → `boot --validate`) directly. (Workshop candidate.)
2. **`harness init` (the governance writer) is NOT shipped** — "owed, not provisioned." The worker must **hand-write `.harness/engineering-harness.md`** from the BIO contract template at `skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md`.
3. **Retros are surfaced, never auto-implemented — already guaranteed by the skills.** `eng-harness-4-retro` states "Nothing is auto-applied," "No auto-applying any encoded diff," "No proof gates." Our plan inherits this; the only thing we *fix* during our work is a broken **record-write path** (if `harness record` itself fails), never a retro-sourced improvement.
4. **minih 0.1.7 is installed and has everything we need**: `run --skill-source path:… --skill … -p k=v`, `last-run`, `status`, `tail`, `history`, `harvest`, `retros`. Skills are wired via `.minih.json` (already points at `skills/eng-harness-setup` + `skills/eng-harness-loop`, includes all 8 harness skills).

### Quick stats
- **Reuse**: ~80% (orchestrator skeleton + agent shape both exist)
- **New code**: 1 extension (`.harness/extensions/<name>.ts`) + 1 minih agent folder (`agents/<slug>/` with prompt/instructions/2 schemas)
- **External deps**: `minih` (present, 0.1.7), `git`, network (clone targets)
- **Complexity**: Medium — the *worker mission* (full autonomous setup) is the hard part, not the orchestrator

---

## How It Currently Works (the two templates)

### Template A — the parallel orchestrator (`validate-harnessability.ts`)

| Aspect | Detail (file:line) |
|---|---|
| Verb contract | `HarnessVerb { name, summary, description, options, run(ctx) }` (`harness/cli/src/services/extensions/contract.ts:28-104`) |
| Context surface | `ctx.cwd/args/options/exec/fs/env/git/clock` + `ctx.ok/degraded/unconfigured/error` (`contract.ts:28-104`) |
| Repo loop | clone `git clone --depth=1 <url> <dest>` into `/tmp/...-<iso>` (`validate-harnessability.ts:131-160`) |
| Fire pattern | detached, injection-safe: `bash -c 'log="$1"; shift; nohup "$@" > "$log" 2>&1 & echo $!' label <log> minih run <slug> -p targetRepo=<dest> [--model] --skill-source path:skills --skill <skill>` (`:169-184`) |
| Run-id capture | poll `minih last-run <slug>` until a new id appears (~3.6s cap) (`:51-84`) |
| Return | immediate `ctx.ok/degraded/error` with `next_action` = poll instructions (`minih status/tail/last-run/history`) + cleanup (`:204-246`) |
| Guardrails | no `node:*`; all I/O via `ctx.exec`; never throws; every non-ok carries `next_action` (`:12-14`) |

### Template B — the setup-driving worker (`agents/install-and-validate-test-extension/`)

| File | Role |
|---|---|
| `agent.json` | manifest (name, description, tags, `minihVersion`) |
| `prompt.md` | mission + **frontmatter**: `model`, `timeout: 1800`, `permissions.preset: read-only` + overrides `shell/write/network: allow`, `allowedRoots: ["/tmp","/private/tmp","/var/folders"]`. Documents how skills wire in (`.minih.json` or `--skill-source path:skills --skill <name>`). |
| `instructions.md` | rules: **drive the skill, don't bypass it**; **independent verification mandatory**; prefer `--json`; **throwaway writes only**; **capture friction at the moment of friction** (numbered `MH-NNN`, layer-tagged). |
| `input-schema.json` | params (e.g. `harnessSource`, `verbName`, `variant`, `keepTempRepo`). |
| `output-schema.json` | structured report: `verdict (PASS\|FAIL)`, `summary`, `retrospective {workedWell, confusing, magicWand, magicWandTarget(project\|minih), difficulties[]}`. |

---

## The Autonomous Setup Recipe (what the new worker must do)

Per a fresh, already-cloned repo at `targetRepo` (parent clones; worker does NOT install the harness globally — it's already on the machine; it installs the harness *into the target repo* so `npx harness` resolves there, OR uses the local file install like Template B):

1. `cd <targetRepo>`; install the harness core into it (`npm install <MINIH_PROJECT_ROOT>` local, or `npm install github:AI-Substrate/harness-engineering`). Sanity: `npx harness doctor --json` runs (empty `.harness/extensions/` is **not** an error).
2. **Assess (S1 scout):** invoke the `eng-harness-0-harnessability-assessment` skill. Output lands at `.harness/reports/harnessability/<ordinal>-<slug>/report.{md,json}` + root `latest.{md,json}` (`SKILL.md:88-108`). Read `verdict.final_grade` + the Operate-Today/Adaptability tuple.
3. **Abandonment gate:** if harnessability is poor (e.g. `final_grade` D/F, or Operate-Today in the lowest band), **record the finding** ("repo X not harnessable, here's why") and **signal the parent to try the next candidate** — a *poor* result is a valid, useful outcome, not a failure. (Threshold = workshop candidate.)
4. **Governance (S2):** hand-write `.harness/engineering-harness.md` from the BIO template (`references/governance-doc.md:27-40`): Boot command · Health check · Interact method · Observe method · Deterministic signal inventory · Evidence paths · Back-pressure gaps · Maturity snapshot. (`harness init` is not shipped — SG-01.)
5. **Boot (S4, built LAST):** detect the cheapest readiness proof for the repo shape (web/API → start + health/smoke; library/CLI → build then test; docker → `compose up -d` + poll). **Author it via the `eng-harness-0-add-extension` skill** → `harness new boot --wrap "<cmd>"` (`add-extension/SKILL.md:34-52`) → fill `run(ctx)`.
6. **Validate boot:** `npx harness doctor` (loaded), `npx harness help` (listed), `npx harness boot --help`, `npx harness boot` (runs, returns honest Envelope status) (`add-extension/SKILL.md:74-86`).
7. **Record retros (S? loop):** `npx harness record retro` → fill the scaffolded `.harness/records/retro/<date>-<slug>.md` with the dual-layer retrospective; emit the worker `output/report.json` (verdict + retrospective).

---

## Retro / Record Collection Design

- **Where children write records:** `.harness/records/retro/*.md` (committed-style records via `harness record retro`), plus the harnessability report under `.harness/reports/harnessability/`, plus the minih `output/report.json` in the run dir.
- **Parent collection step** (after the 3 runs complete): for each child `runDir`/`targetRepo`, read & copy back into `docs/plans/013-dogfood-harness-flow/runs/<repo-or-slug>/`:
  - the child's `.harness/records/retro/*.md`
  - the child's `.harness/reports/harnessability/latest.{md,json}`
  - the minih `output/report.json` + `run.json`
- **Aggregate** (read-only): a plan-local rollup that links the copied child records, groups by `agent`/`kind`/`target`, dedups by `retro_id`. **Never mutates child retros.**
- **No-auto-implement guarantee (cited):** `eng-harness-4-retro/SKILL.md:165-167` ("Nothing is auto-applied"), `:223-225` ("No auto-applying any encoded diff"), `:471-478` ("No proof gates… never blocks… never declares compliance"). Harvest **presents options**; the user may go deeper; it never implements.

---

## Candidate Repos (pool for the parallel run + abandonment)

Cross-language, popular, clone-friendly with obvious readiness proofs. Pick **3** (one per language); keep alternates for abandonment fallback.

| Lang | Primary | Boot shape | Alternates |
|---|---|---|---|
| Node | `expressjs/express` | `npm install && npm test` (mocha) | `tj/commander.js`, `chalk/chalk`, `sindresorhus/got` |
| Python | `pallets/click` | `pip install -e . && pytest` | `psf/requests`, `pallets/flask`, `tiangolo/typer` |
| Go | `spf13/cobra` | `go build ./... && go test ./...` | `urfave/cli`, `gin-gonic/gin`, `gorilla/mux` |

Selection criteria: small-ish, well-known, single obvious build/test command, no exotic toolchain, public (no auth). The library/CLI shape gives a deterministic boot (build+test) — the safest first dogfood. (Final pool = workshop/spec decision.)

---

## Critical Discoveries

### 🚨 CD-01: Interactive router vs autonomous worker (design fork)
`eng-harness-flow` is print-then-offer/interactive (SG-07). The worker must **NOT** "run the flow skill" conversationally — it drives the **child setup skills directly** in order (the `install-and-validate` pattern). **Action:** the worker prompt encodes the ordered recipe above; `eng-harness-flow` is reference/orientation only. *(Workshop candidate.)*

### 🚨 CD-02: Governance writer is unshipped
No `harness init` act exists (`app.ts:165-173` registers only docs/doctor/help/new/record/skills/verb). **Action:** worker hand-writes `.harness/engineering-harness.md` from `references/governance-doc.md`. *(This is itself a useful dogfood finding — the gap will likely surface in retros.)*

### 🚨 CD-03: "Fix broken record-writes, but never auto-implement retro improvements"
The user's one carve-out: if storing a record fails *as part of our work* (e.g. `harness record` path bug), we fix that. Everything a *retro recommends* is surfaced only. **Action:** plan separates "record-pipeline correctness (fixable)" from "retro-sourced improvements (presented, not applied)."

---

## Workshop Opportunities (flagged per skill instruction)

> Spec will be **Simple mode** per the user; these are logged for visibility, not as blockers. The user may pull any into a `/plan-2c` workshop later.

- **WS-A — Worker mission contract**: the exact ordered autonomous recipe, abandonment threshold (which `final_grade`/axis band triggers "try next repo"), and how the worker signals "abandoned, pick another" back to the parent.
- **WS-B — Boot detection heuristics**: how the worker chooses the cheapest readiness proof per repo shape (web/lib/CLI/docker), and what counts as "boot works."
- **WS-C — Collection & rollup shape**: parent aggregation paths, the plan-local rollup doc format, dedup, and the no-auto-implement framing in the final report.
- **WS-D — Dogfooding-ourselves loop**: how *we* run eng-harness-flow on this repo while building, where our own retros land (`harness record retro`), and the end-of-plan harvest+report.

---

## Open Questions (for spec / clarify)

1. **Extension name**: `validate-harness-flow` (parallels `validate-harnessability`) vs `dogfood-harness-flow` (slug) — recommend `validate-harness-flow` as the verb, plan slug stays `dogfood-harness-flow`.
2. **Harness install into target**: local file install (fast, deterministic — like Template B `local`) vs `github:` (proves npx path). Recommend `local` for the dogfood, `github` as an option.
3. **Abandonment automation**: does the *worker* pick the next candidate itself, or does it just report "poor" and the *parent/operator* re-fires the next candidate? Recommend worker reports; parent (or a `--repo` re-fire) handles substitution — keeps the worker single-shot.
4. **How many candidates does the parent clone?** Exactly 3 (fire all 3), or 3 + held-back alternates the parent swaps in on a "poor" result?

---

## Recommendations

- **Build by assembly**: fork `validate-harnessability.ts` → `validate-harness-flow.ts` (swap the fired skill/agent + post-run prompt); fork `agents/install-and-validate-test-extension/` → `agents/validate-harness-flow/` (extend the mission to the full recipe; reuse the `verdict`+`retrospective` output schema, add `governanceWritten`/`bootWorks`/`harnessabilityGrade` fields).
- **Keep the worker single-shot & honest**: independent validation (don't trust skill self-reports), throwaway writes only (the cloned target + `/tmp`), capture friction at the moment of friction.
- **Inherit the no-auto-implement guarantee** from `eng-harness-4-retro`; the plan only *fixes* a broken record-write path, never a retro-sourced change.
- **Dogfood in parallel**: while building, run `eng-harness-flow`/the loop on THIS repo and record our own retros — proving the loop on the very tool that drives it.

## Next Steps

→ Proceed to **`/plan-1b`** (Simple mode) to spec the `validate-harness-flow` extension + agent + the parallel-run/collection + our own dogfood loop. Then **`/validate-v2`**.

---
**Research Complete**: 2026-06-09T11:42Z
**Report Location**: docs/plans/013-dogfood-harness-flow/research-dossier.md

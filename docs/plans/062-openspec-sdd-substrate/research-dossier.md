# Research Dossier: OpenSpec as an SDD substrate for the builder flow

**Generated**: 2026-07-17T09:02:00Z
**Query**: "research if we can make a open spec based version of the builder flow - bring it back in line with community base but maintain all teh spine and other featuers of the flow etc. also the builde flow calls out to eng harness flow etc… is my idea to have openspec as a sdd option in harness (along side flow or even pluging in to it) a good idea? is it orthogonal?"
**Effort**: Deep
**Tools**: Mixed (live CLI experiment · repo reads · Perplexity deep research)
**Evidence**: 12 current sources · 1 historical cluster

## The Ask

Jordan wants to know whether the builder flow (the `/builder` SDD pipeline in this repo) can be rebuilt on — or made interoperable with — **OpenSpec** (Fission-AI's community spec-driven-development tool), so the flow aligns with community conventions while keeping everything hard-won here: the flight-plan spine (`harness flow nav`/`orient`/chores/receipts), the eng-harness-flow seams, validation gates, and the coach. Two sub-questions: is OpenSpec-as-an-SDD-option-in-harness a good idea, and is it orthogonal to what exists? This dossier is the decision packet for the 062 plan.

## Answer

1. **The engineering harness is orthogonal to OpenSpec — and to every SDD tool — by design.** eng-harness-flow exposes a frozen five-hook contract (`pre-flight`/`pre-coding`/`coding`/`post-coding`/`post-flight`) explicitly built for arbitrary host flows via the injection map; OpenSpec's OPSX lifecycle seams (propose → apply → archive) map onto those hooks 1:1 with no vocabulary change (F-01, F-03).
2. **Builder-the-pipeline vs OpenSpec-the-pipeline is partial substitution, not orthogonality.** Both own artifact layout, stage verbs, task tracking, and agent instructions — running both unbridged means two front doors and two truths (F-03, F-11, F-12).
3. **OpenSpec is a healthy, composable substrate**: ~61k stars, active weekly, schema-driven artifact DAG (fork/validate), JSON CLI envelopes (`status`/`instructions --json`), per-artifact config injection, a sanctioned community-schema distribution channel, and a living spec corpus with delta-merge semantics builder lacks (F-04–F-09).
4. **Builder's spine has no OpenSpec equivalent and is the part to keep**: positional, compaction-proof seam firing (`nav.now` + `due_chores` + receipted chores) versus OpenSpec's only injection mechanism — schema/config prose — which is exactly the "remembered prose" failure mode plans 033/039 engineered away (F-02, F-10, F-12).
5. **Feasible composition**: keep the flight-plan spine as the orchestration layer; let OpenSpec own artifact schema/layout; bridge them with a deterministic `openspec status --json → harness flow` mapping (both state models are filesystem-derived, so the mapping is pure code, not inference). Publish a harness-aware schema through OpenSpec's community catalog to bring the harness to the community rather than forking the community into the harness (F-04, F-06, F-08).
6. **The main risks are churn and dual-state ownership**: OPSX schema commands are marked experimental and the current npm `@latest` resolves to `1.6.0-beta.1`; and any design must name a single writer (or deterministic derivation) between artifact-existence state and flight-plan nav (R-01, R-02).

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | eng-harness-flow's hook contract is a **closed set of five host-agnostic lifecycle hooks** with a machine-readable `--hooks` manifest and an injection-map adoption rung (S3) designed for "any SDD or dev flow" | `~/.claude-alt/skills/eng-harness-flow/references/00-routing.md` §§ Lifecycle hooks, "Called repeatedly along an externally-managed flow" | The harness plugs into OpenSpec without contract changes — orthogonality is already engineered | High |
| F-02 | Builder's seam firing is **positional, not remembered**: auto-fired from `nav.now`/`due_chores` with receipt discipline, precisely so long/compacted sessions can't skip a seam | `skills/builder/references/harness-seams.md` § Compaction-robust firing; § doctrine-parity:039 | Any OpenSpec composition that drops the spine regresses this guarantee to prose injection | High |
| F-03 | OPSX is a **schema-driven artifact DAG**: `schema.yaml` (artifacts + `requires:`) + markdown templates; workflows forked/validated via `openspec schema fork/init/validate`; dependencies are enablers, not gates | `~/github/openspec/docs/opsx.md`; `docs/customization.md`; `schemas/spec-driven/schema.yaml` | Builder's stage roster can be expressed as a custom OpenSpec schema (research → proposal → … → tasks) | High |
| F-04 | OpenSpec CLI emits **rich JSON envelopes**: `status --json` carries `planningHome`, `artifactPaths`, `applyRequires`, per-artifact status + `actionContext.allowedEditRoots`/`constraints`; `instructions --json` carries template + rules + resolved paths | live run in scratch lab: `openspec new change try-harness-hook` + `openspec status --change try-harness-hook --json` (2026-07-17) | A deterministic `openspec → harness flow` state bridge is plain code; fits Rule 6 (shift proof left) | High |
| F-05 | OpenSpec's generated agent skills are **thin drivers over the CLI** and are **regenerated by `openspec update`** — hand-edits are wiped; durable customization is schema + config only | `.claude/skills/openspec-propose/SKILL.md` in scratch lab (`generatedBy: 1.6.0-beta.1`, `allowed-tools: Bash(openspec:*)`) | Never patch generated skills to add seams; inject via schema instructions/config or orchestrate from outside | High |
| F-06 | `openspec/config.yaml` injects **project context (all artifacts) + per-artifact rules** into every generated instruction (`<context>`/`<rules>` wrapping, 50KB cap) | `~/github/openspec/docs/opsx.md` § Project Configuration; `docs/customization.md` | A sanctioned hook for harness doctrine text — but it is inference-level prose, not a mechanical guarantee | High |
| F-07 | OpenSpec maintains a **living spec corpus**: `openspec/specs/` = source-of-truth "what the system does now"; changes carry **delta specs** (ADDED/MODIFIED/REMOVED/RENAMED requirements) merged at `archive` | `schemas/spec-driven/schema.yaml` (specs instruction); `~/github/openspec/openspec/specs/` (dogfood) | A genuine gap in builder (docs/plans is change-history only); worth adopting regardless of composition choice | High |
| F-08 | OpenSpec has a **community-schema catalog** — third-party schema bundles in standalone repos (e.g. `superpowers-bridge`), installed by copying into `openspec/schemas/<name>/` | `~/github/openspec/docs/customization.md` § Community Schemas | A harness-aware schema bundle is a sanctioned, low-friction distribution channel to the community base | High |
| F-09 | OpenSpec is **large and actively maintained**: ~61k stars, v1.6.0 release, commits within the week (docs deploy, release skill, beta prerelease workflow) | `gh repo view Fission-AI/OpenSpec` + `git log` on clone (2026-07-17) | Safe to take a dependency on the conventions; version-pin the CLI | High |
| F-10 | OpenSpec has **no deterministic proof-of-done machinery**: done = `tasks.md` checkboxes; no boot, no backpressure survey, no sensors, no observe/drain/harvest — true of the whole SDD field (spec-kit, Kiro, BMAD) | `~/github/openspec/README.md`; opsx docs (absence); Perplexity dossier § 5.5 (91KB, saved at `~/.claude-alt/projects/...4e/tool-results/mcp-perplexity-perplexity_research-1784276649977.txt`) | The harness's territory is uncontested; the composition adds proof to OpenSpec, not vice versa | High |
| F-11 | Builder's durable state is the **flight plan** (`nav` + bag + node statuses, CLI sole writer) with orient/due-chores read every turn | `skills/builder/references/00-routing.md` § State contract; `flight-plan-ops.md` §2 | The spine can orchestrate *any* artifact set — its state does not depend on builder's artifact formats | High |
| F-12 | OpenSpec's state model is **filesystem artifact existence** (BLOCKED → READY → DONE via deps + file presence) — no position cursor, no chores, no receipts | `~/github/openspec/docs/opsx.md` § State transitions | Complementary, not duplicate: OpenSpec answers "what can be created"; the spine answers "where are we, what's due here" | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | The spine exists because prose-carried orchestration failed: seams buried in stage sub-skills were "invisible, untracked, silently skipped"; plans 021→040 progressively moved seams/chores/instructions into positional CLI substrate | `skills/builder/references/harness-seams.md` (inversion preamble; doctrine-parity:039); plan folders `docs/plans/021,024,032,033,039,040-*` | Direct | Any OpenSpec composition must keep firing positional — schema `instruction:` text re-introduces the exact failure the spine fixed |

(No prior `openspec`/`spec-kit` work exists anywhere in this repo — `no_material_historical_evidence` for the substrate question itself.)

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| R-01 | OPSX schema commands marked `[experimental]`; npm `@latest` resolves to `1.6.0-beta.1` | CLI `--help`; `npx @fission-ai/openspec@latest --version` | Substrate churn could break a schema bundle or the JSON envelope shapes | Version-pin; watch releases/Discord; keep the bridge surface small (status/instructions JSON only) |
| R-02 | Two state models with no designated owner | F-11, F-12 | Divergence between openspec artifact state and flight-plan nodes = two truths | Design decision: spine is orchestrator; openspec state is *derived input* via a deterministic sync (never hand-merged) |
| R-03 | Seams expressed as schema/config prose are remembered prose | F-06, H-01 | Regresses compaction-robust firing | Keep seam firing spine-owned; schema text may *mention* the loop but never carries the guarantee |
| R-04 | `openspec update` regenerates `.claude/skills/opsx-*` | F-05 | Hand-patched seam calls are silently wiped on update | Never patch generated skills; integrate at schema/config or orchestrator level |
| R-05 | Artifact-home collision: `openspec/changes/<name>/` vs `docs/plans/<ord>-<slug>/` | F-03; repo layout | Where do plan artifacts live in a harness-adopted repo? Affects fences, ordinals, tooling | Workshop-grade decision; options: side-by-side, openspec-owned with pointers, or configurable `planningHome` |

## Planning Handoff

- **Preserve**: the flight-plan spine mechanics (nav/orient/due_chores/receipts, CLI sole writer); the frozen eng-harness-flow five-hook contract; ship's confirm discipline; validation gates; the coach's print-then-offer.
- **Change carefully**: builder stage sub-skills' artifact contracts (if OpenSpec artifacts replace `research-dossier.md`/`<slug>-plan.md`/`tasks.md`, every consumer — adoption tables, routing predicates, must-see field scans — must be re-pointed); `docs/plans/` conventions (ordinals, fences, telemetry references assume them).
- **Likely files/symbols**: `skills/builder/references/00-routing.md`, `harness-seams.md`, `stages/*`; a new schema bundle (`openspec/schemas/harness-engineering/` or a standalone community repo); possibly a harness CLI bridge verb (e.g. `harness flow sync --from-openspec` or an extension); `docs/how/` documentation.
- **Decisions still required**:
  1. **Composition mode** — (a) publish a harness-aware community schema + thin seam adapter (smallest, reversible); (b) builder grows an "openspec mode" whose spine nodes map to opsx actions; (c) full substrate swap (rejected by evidence: R-01–R-03).
  2. **State ownership** — spine as orchestrator with a deterministic openspec→flow sync (recommended per R-02), or openspec-primary with flow as passenger.
  3. **Artifact home** — R-05 options.
  4. **Seam carrier in opsx-native sessions** — spine-driven (guided), host hooks, or config-prose-only (weakest).
  5. **Adopt the delta-spec living corpus into builder regardless?** (F-07 — independent win.)

## External Research

| Question | Why repo evidence is insufficient | Planning impact | Prompt |
|----------|-----------------------------------|-----------------|--------|
| OpenSpec 1.6/2.0 roadmap: when do schema commands stabilise, and is the `status`/`instructions` JSON shape versioned or guaranteed? | Roadmap intent lives in maintainer channels (Discord, issues), not the clone | Decides version-pin strategy and how thin the bridge must stay | "What is the Fission-AI OpenSpec roadmap for stabilising the experimental `openspec schema` commands and the JSON output contracts of `status`/`instructions`? Check GitHub issues/discussions/releases and Discord announcements from mid-2026." |

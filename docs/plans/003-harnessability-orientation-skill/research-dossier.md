# Research Report: engineering-harness-orient

**Generated**: 2026-06-03T04:02:38Z  
**Research Query**: "Build an engineering-harness-orient skill from scratch/paste/20260603T033048.md. Focus on how it should fit after engineering-harness-setup, what existing skill/template patterns it should reuse, and how to preserve the setup/orient boundary."  
**Mode**: Pre-Plan  
**Location**: `docs/plans/003-harnessability-orientation-skill/research-dossier.md`  
**FlowSpace**: Available  
**Findings**: 69 agent findings synthesized from 8 lenses

## Executive Summary

### What It Does

The proposed `engineering-harness-orient` skill is a post-setup harnessability orientation and pre-check skill. It reads the engineering harness nucleus installed by `engineering-harness-setup`, inspects the target repository's real substrate, then emits a human-readable Markdown report and an agent-readable JSON report describing readiness, gaps, first-session actions, and recommended improvements.

It is not a second setup skill and not a runtime loop runner. Setup creates the front door; orient makes that front door target-aware.

### Business Purpose

The skill addresses a gap exposed by setup dogfood and smoke-test feedback: a repository is not harnessable just because `docs/project-rules/engineering-harness.md`, `AGENTS.md`, and `harness/cli/commands.json` exist. A fresh human or agent also needs to know which commands are real, which are inferred, what services and prerequisites matter, where evidence lands, what remains unproven, and whether the limiting fix belongs in the harness or in the product codebase.

### Key Insights

1. **Keep orient separate from setup.** The paste explicitly prefers a separate v0.1 skill after setup, and existing repo docs define setup as the nucleus/front-door step (`scratch/paste/20260603T033048.md:193-241`, `skills/engineering-harness-setup/SKILL.md:7-18`).
2. **Orient must classify codebase harnessability, not only harness files.** The brief defines harnessability as a property of the actual repository and product, including auth, seed/reset, observability, side effects, health, fixture data, and stable interaction surfaces (`scratch/paste/20260603T033048.md:144-173`).
3. **Reports must distinguish evidence from inference.** Candidate commands and readiness claims must carry provenance, status, and confidence; inferred commands stay `candidate_unverified` until executed (`scratch/paste/20260603T033048.md:1321-1333`, `scratch/paste/20260603T033048.md:1393-1407`).

### Quick Stats

- **Core existing package analyzed**: `skills/engineering-harness-setup/` (`SKILL.md`, README, AUTHORING, templates).
- **Primary source brief**: `scratch/paste/20260603T033048.md`.
- **Current repo substrate**: root `justfile` only; no installed `docs/project-rules/*harness*.md` in this repo.
- **Domain registry**: none found.
- **Compound retros**: none found under `docs/harness/agents/**/*.retro.md`.
- **Prior learnings**: 10 relevant findings from plan 002 setup-skill implementation.
- **External research opportunities**: 0 required before specification; optional public framing research can wait.

## How It Currently Works

There is no `engineering-harness-orient` skill yet. The closest existing implementation is `engineering-harness-setup`, which provisions the local engineering-harness nucleus and validates its surfaces.

### Entry Points

| Entry Point | Type | Location | Purpose |
|---|---|---|---|
| `engineering-harness-setup` | Skill | `skills/engineering-harness-setup/SKILL.md:1-18` | Create or validate the repo-local engineering harness nucleus. |
| `just list-skills` | Repo command | `justfile:7-9` | Validate skill discoverability through `npx skills`. |
| `just install-skills-*` | Repo command | `justfile:11-33` | Install skill packages from this working tree. |
| `harness/cli/commands.json` | Generated command map | `skills/engineering-harness-setup/templates/harness-config.json:1-53` | Canonical deterministic sensor inventory and command map in target repos. |
| `harness/cli` templates | Generated CLIs | `skills/engineering-harness-setup/templates/cli-python-harness.py`, `skills/engineering-harness-setup/templates/cli-node-harness.mjs` | Starter front door over existing repo commands. |

### Current Setup Flow

1. **Mode detection** checks for `docs/project-rules/engineering-harness.md`, then legacy `agent-harness.md` and `harness.md` fallbacks (`skills/engineering-harness-setup/SKILL.md:47-65`).
2. **Create mode** launches project-type and interaction-surface discovery to identify boot, health, auth, and signal candidates (`skills/engineering-harness-setup/SKILL.md:69-100`).
3. **User confirmation** validates project type, boot, health, auth, evidence, and signals before writing generated files (`skills/engineering-harness-setup/SKILL.md:102-140`).
4. **Generated governance** records the harness as a nucleus and local front door, not the runtime loop owner (`skills/engineering-harness-setup/SKILL.md:142-260`).
5. **Generated command map** includes install, boot, health, build, test, lint, typecheck, format, run, observe, smoke, arch, security, schema, codeql, and seed command slots (`skills/engineering-harness-setup/templates/harness-config.json:9-25`).

### Proposed Orient Flow From Brief

The paste proposes this target-aware flow:

1. Read installed harness surfaces.
2. Inspect repo substrate.
3. Infer command tiers and prerequisites.
4. Detect product interaction and observation affordances.
5. Classify harnessability.
6. Emit Markdown and JSON report.
7. Propose harness, environment, fixture, observability, and product-code changes.
8. Optionally apply only safe, explicit, reviewed patches (`scratch/paste/20260603T033048.md:205-214`).

## Architecture & Design

### Boundary Model

The boundary sentence from setup remains load-bearing:

> The agent harness drives. The engineering harness proves.

It appears as a byte-identical invariant in setup authoring notes and generated templates (`skills/engineering-harness-setup/AUTHORING.md:39-42`, `skills/engineering-harness-setup/templates/root-HARNESS.md:13-18`). Orient should reuse this exact sentence in shipped surfaces that explain the layer boundary.

### Setup vs Orient vs Runtime

| Layer | Owner | What it owns | What it must not own |
|---|---|---|---|
| Setup | `engineering-harness-setup` | Governance doc, `AGENTS.md` route, `harness/cli/`, command map, deterministic sensor inventory, `docs/harness` scaffold | Heavy target-aware inspection, product-code recommendations, runtime loop execution |
| Orient | proposed `engineering-harness-orient` | Harnessability report, command-tier classification, evidence/inference log, first agent session plan, human questions, patch recommendations | Installing the nucleus by default, booting services by default, silently mutating product code |
| Runtime | tools repo skills | Boot/readiness, observe capture, retro drain/harvest, Backpressure Check over scoped work and sensors | Creating a competing local setup/orient contract |

### Design Patterns to Reuse

1. **Multi-file skill package**: existing setup skill uses `SKILL.md`, README, AUTHORING, and `templates/` (`skills/engineering-harness-setup/AUTHORING.md:77-90`).
2. **Front-door plus templates**: setup keeps generated markdown concise, agent-readable, and command-oriented (`skills/engineering-harness-setup/templates/root-HARNESS.md:33-63`).
3. **Machine-readable output**: setup CLIs use a JSON envelope with `command`, `status`, optional `data`, `error`, and `messages` (`skills/engineering-harness-setup/templates/cli-envelope.schema.json:1-63`).
4. **Fix-forward diagnostics**: command contracts prefer specific `error.code` and `next_action` over vague failures (`skills/engineering-harness-setup/templates/cli-command-contract.md:37-52`, `skills/engineering-harness-setup/templates/cli-command-contract.md:120-126`).
5. **Publication-safe shipped surfaces**: shipped prose must avoid private-source contamination and only cite foundation IDs in HTML comments (`skills/engineering-harness-setup/AUTHORING.md:21-32`, `skills/engineering-harness-setup/AUTHORING.md:43-46`).

## Dependencies & Integration

### What Orient Depends On

| Dependency | Type | Purpose | Risk if Changed |
|---|---|---|---|
| `docs/project-rules/engineering-harness.md` plus legacy fallbacks | Harness surface | Read existing governance, maturity, boot, signals, and known difficulties | Missing file should degrade/orient from H0/H1, not crash. |
| `AGENTS.md` | Agent route | Determine whether future agents are routed to the harness | If absent, orient should recommend setup or agent-instruction patch. |
| `harness/cli/commands.json` | Command map | Source for configured/unconfigured sensors | Schema drift breaks command-tier classification. |
| `docs/harness/` | Improve surface | Determine whether friction/retro/known-difficulty loop exists | Missing surface is a compounding gap, not necessarily product failure. |
| Repo signature files | Repo substrate | Classify project type, package roots, services, env, tests, CI | Weak or absent signals lower confidence. |
| `harness/orientation/` | Proposed output subtree | Store latest and timestamped orientation reports | New subtree should be owned by orient, not setup. |

### Consumers

| Consumer | Needs from Orient |
|---|---|
| Fresh human/agent | What kind of repo this is, what to inspect first, what is safe to run, and what remains unproven. |
| `engineering-harness-setup` | A post-install recommendation or optional handoff target, not a heavy subroutine by default. |
| Runtime skills | Stable report artifacts and command/sensor classifications they can reference, without orient owning runtime behavior. |
| Backpressure Check | Deterministic sensor inventory and missing-proof gaps, not a core `backpressure` command. |
| Reviewers | Evidence/inference log, product-code-affordance risk tiers, and first-session plan. |

## Quality & Testing

### Current Validation Patterns to Reuse

| Check | Existing evidence | Orient implication |
|---|---|---|
| Skill discoverability | `just list-skills` lists repo skills (`justfile:7-9`) | New skill should appear in `npx skills` output. |
| JSON parse/schema sanity | Existing setup has JSON schemas and templates | Orient should add/validate `harness/orientation/schema.json`. |
| CLI syntax checks | Setup validation used Python/Node syntax checks for CLI templates | If orient ships executable templates, validate syntax. |
| Contract greps | Setup authoring invariants cover boundary sentence, privacy, magic-wand wording, placeholders (`skills/engineering-harness-setup/AUTHORING.md:33-61`) | Orient needs equivalent shipped-surface checks. |
| Dogfood | Plan 002 deferred real target dogfood and explicitly separated structural validity from runtime coherence (`docs/plans/002-engineering-harness-setup-skill/execution.log.md:66-69`) | Orient must not claim target-repo proof from static checks alone. |

### Edge Cases to Cover

1. No harness installed: report H0/H1 and recommend setup.
2. Harness exists but command map is generic or empty: report front door exists but oriented confidence is low.
3. Monorepo or ambiguous repo type: classify package roots with confidence, not a single overclaimed type.
4. No boot/health/smoke path: report degraded proof readiness and targeted human questions.
5. Manual auth only: product-code affordance recommendation, proposal-only by default.
6. Missing seed/reset/fixtures: first-session plan should avoid meaningful feature work until a smoke path is defined.
7. Secret-like env files: record variable names and docs paths only; never print values.
8. Safe probes disabled: no dependency install, service boot, mutation, external calls, or real auth flows.

## Interface & Contract Findings

### Invocation

The brief proposes:

```bash
/engineering-harness-orient
/engineering-harness-orient --json
/engineering-harness-orient --markdown
/engineering-harness-orient --execute-safe-probes
/engineering-harness-orient --apply-safe-harness-patches
/engineering-harness-orient --propose-codebase-affordances
/engineering-harness-orient --target-mode clean-start
/engineering-harness-orient --compare harness/orientation/runs/<previous>.json
```

Recommended v0.1 subset:

- Default read-only static orientation.
- `--json` and `--markdown` output selectors.
- `--execute-safe-probes` as opt-in.
- `--apply-safe-harness-patches` either defer to v0.2 or constrain to low-risk harness-only changes.
- Product-code affordance recommendations enabled by default as proposals, not mutations.

### Output Artifacts

The brief standardizes:

```txt
harness/
  orientation/
    latest.md
    latest.json
    schema.json
    runs/
      <timestamp>.md
      <timestamp>.json
```

This should be orient-owned. Setup may mention or create a placeholder recommendation later, but setup should not own `harness/orientation/` population.

### Markdown Report Sections

Mandatory Markdown sections should include:

- Verdict.
- What is ready.
- What blocks confident feature work.
- First agent session plan.
- Harness surfaces.
- Project detection.
- Command tiers.
- Services and environment.
- Interaction and auth.
- State, fixtures, and reset.
- Observation and evidence.
- Proof model.
- Codebase affordance recommendations.
- Harness recommendations.
- Human questions.
- Proposed patches.
- Safety notes.
- Evidence and inference log.

### JSON Report Contract

The JSON report should be separate from the CLI envelope. It needs richer analysis fields:

- `schema_version: engineering-harness-orientation.v0.1`
- `repo`
- `run`
- `verdict`
- `harness_surfaces`
- `project_detection`
- `command_tiers`
- `services`
- `environment`
- `app_surfaces`
- `auth`
- `state_and_fixtures`
- `observability`
- `proof_model`
- `gaps`
- `codebase_affordance_recommendations`
- `human_questions`
- `recommended_next_actions`
- `proposed_patches`

The setup CLI envelope remains useful for orient command stdout, but the report itself is a separate artifact.

## Harnessability Readiness Model

The brief says not to reuse setup's L0-L4 maturity ladder directly (`scratch/paste/20260603T033048.md:638-662`). Use a separate H0-H5 ladder:

| Level | Meaning |
|---|---|
| H0 Unknown | No reliable harness surface or boot substrate detected. |
| H1 Front door exists | Harness installed, but commands are generic, unconfigured, or mostly inferred. |
| H2 Oriented | Repo type, command candidates, services, prerequisites, interaction surfaces, and evidence paths are mapped with source evidence. |
| H3 Operable | At least one boot/health or fast validation path is configured and can be dry-run or safely executed. |
| H4 Proveable | A meaningful smoke/proof scenario exists with evidence path, verdict, and rerun command. |
| H5 Compounding | Friction capture, known difficulties, proof records, and encoded harness improvements are wired into the loop. |

Use the existing setup maturity ladder only for whether the harness exists and can operate; use H-levels for target-aware repository readiness.

## Gap Classification Model

Every orient finding should classify:

| Axis | Values |
|---|---|
| Subsystem | `instructions`, `tools`, `environment`, `state`, `feedback` |
| Loop stage | `boot`, `interact`, `observe`, `validate`, `improve` |
| Target layer | `harness`, `product_code`, `test_code`, `fixture_data`, `environment`, `ci`, `agent_instruction`, `human_process` |
| Encoding type | `guide`, `sensor`, `command`, `fixture`, `diagnostic`, `evidence`, `state`, `policy` |
| Severity | `blocker`, `high`, `medium`, `low`, `info` |
| Status | `open`, `proposed`, `candidate_unverified`, `configured_unverified`, `verified`, `not_applicable` |

This model is the main bridge that prevents all findings from becoming "add more harness docs." Some findings must route to product code, test infrastructure, environment, CI, or human decision.

## Product-Code Affordance Findings

The defining difference for orient is first-class `codebase_affordance_recommendations`. A product-code affordance is a change to the actual application/product codebase that makes the product easier, safer, more deterministic, or more observable through the engineering harness.

Examples from the brief:

- local/test-only auth provider;
- seeded fixture user;
- idempotent seed/reset command;
- health/readiness endpoint;
- side-effect sink for email/SMS/payment/webhooks;
- stable UI selectors or accessible labels;
- deterministic clock/ID provider;
- structured diagnostics or side-effect ledger;
- fixture-backed smoke scenario (`scratch/paste/20260603T033048.md:1054-1100`).

Default mutation policy:

- Low-risk harness patches may be applied only with explicit `--apply-safe-harness-patches`.
- Medium-risk product recommendations should usually remain proposal-only unless explicitly requested.
- High/critical recommendations are proposal-only by default and must include safety requirements and review requirements (`scratch/paste/20260603T033048.md:1172-1193`).

## Proof Model

Orient should avoid vague readiness claims and use proof levels:

| Level | Meaning |
|---|---|
| L0 Claim | Actor says work is done, no evidence. |
| L1 Local command output | A command ran and output exists. |
| L2 Static/build/test | Build, lint, typecheck, unit, or isolated tests passed. |
| L3 Runtime interaction | Product/API/UI/CLI/queue/MCP/system path was exercised. |
| L4 Interaction plus side-effect | Runtime interaction plus state/file/database/message/event verification. |
| L5 Reproducible clean rerun | Proof passes again in clean context using recorded instructions. |
| L6 Production/customer outcome | Production telemetry, incident-free release, customer or business evidence. |

The orientation skill itself usually determines whether the repo has surfaces needed to reach L3-L5; it should not overclaim those levels in a static run.

## Prior Learnings

**Compound activity**: no `docs/harness/agents/**/*.retro.md` or legacy `docs/retros/*.md` entries were found for this repo; relevant institutional knowledge came from plan 002 setup-skill artifacts.

### PL-01: Scope shipped-surface checks

**Source**: `docs/plans/002-engineering-harness-setup-skill/execution.log.md:23-29`  
**Type**: gotcha  
**Discovery**: privacy checks originally scanned too broadly; repo-internal authoring docs legitimately mention source paths and patterns.  
**Action**: orient validation should scope contamination checks to shipped surfaces (`SKILL.md` and templates), not repo-internal planning/research files.

### PL-02: Distinguish template placeholders from leak placeholders

**Source**: `docs/plans/002-engineering-harness-setup-skill/execution.log.md:27-29`  
**Type**: gotcha  
**Discovery**: pre-commit placeholder checks were conceptually wrong because templates should contain `{{XXX}}` markers; runtime placeholder-leak checks belong after substitution.  
**Action**: orient should validate placeholder syntax in authored templates and separately check generated reports for unresolved markers.

### PL-03: Keep file-backed guidance as source of truth

**Source**: `docs/plans/002-engineering-harness-setup-skill/decisions.md:121-129`  
**Type**: decision  
**Discovery**: onboarding checklist is canonical as a file; CLI reads and prints it.  
**Action**: orient should avoid hardcoded long guidance inside executable code; report templates/schema should be file-backed.

### PL-04: Preserve canonical boundary wording

**Source**: `docs/plans/002-engineering-harness-setup-skill/decisions.md:133-142`  
**Type**: boundary rule  
**Discovery**: the boundary sentence must remain byte-identical across shipped boundary surfaces.  
**Action**: orient should reuse "The agent harness drives. The engineering harness proves." exactly.

### PL-05: Separate structural validity from dogfood proof

**Source**: `docs/plans/002-engineering-harness-setup-skill/execution.log.md:66-69`  
**Type**: validation debt  
**Discovery**: setup was structurally verified, but real target install coherence was intentionally unverified until dogfood.  
**Action**: orient must not report H3/H4/H5 from static inspection alone unless there is direct configured/executed evidence.

### PL-06: Keep public repo docs short

**Source**: `docs/plans/002-engineering-harness-setup-skill/execution.log.md:60-64`  
**Type**: docs hygiene  
**Discovery**: the setup skill added a short pinned README section rather than a long tutorial dump.  
**Action**: new orient docs should add concise index/flow pointers in public repo docs, with details inside the skill package.

## Domain Context

No `docs/domains/registry.md` was found. Natural conceptual boundaries are:

| Potential Domain | Boundary |
|---|---|
| Foundations | Public theory and principles under `harness-foundations/`. |
| Setup/provisioning | `engineering-harness-setup` materializes the repo-local nucleus. |
| Orientation/precheck | Proposed `engineering-harness-orient` analyzes target-aware readiness and recommendations. |
| Runtime loop | tools repo skills run boot, observe, retro, Backpressure Check. |
| Product-code affordances | Product/test/environment changes that make a repo harnessable. |
| Publication boundary | Raw/private material stays in `scratch/`; tracked content stays generalized and safe. |

Recommendation: do not introduce a formal domain registry for this change. A standalone skill package plus concise docs is the right unit.

## Critical Discoveries

### Critical Finding 01: Orient must not become setup v2

**Impact**: Critical  
**Source**: IA-01, DC-01, DB-01, QT-01, PS-01  
**What**: Setup creates the front door/nucleus; orient should analyze harnessability after setup.  
**Why It Matters**: Folding orient into setup would make setup heavier, riskier, and less conservative.  
**Required Action**: Spec `engineering-harness-orient` as a separate skill and add setup only as a recommender/handoff.

### Critical Finding 02: Product-code affordances are in scope as recommendations

**Impact**: Critical  
**Source**: DE-03, DB-04, IC-07, QT-09  
**What**: Orient must be able to say the harness is not the limiting factor; the product needs dev/test auth, seed/reset, health, diagnostics, side-effect sinks, stable selectors, or similar affordances.  
**Why It Matters**: If product-code recommendations are out of scope, brownfield repos will keep papering over real operability gaps with docs.  
**Required Action**: Include `codebase_affordance_recommendations[]` and a proposal-only mutation policy in the spec.

### Critical Finding 03: Evidence/inference separation is non-negotiable

**Impact**: Critical  
**Source**: IC-05, IC-10, PS-07, QT-05  
**What**: Candidate commands, H-levels, and proof claims must distinguish direct evidence, inference, human-supplied facts, and unknowns.  
**Why It Matters**: Overclaiming readiness would make the next agent trust unverified commands or missing proof paths.  
**Required Action**: Make provenance, confidence, and `candidate_unverified`/`configured_unverified` statuses mandatory fields.

### Critical Finding 04: Backpressure remains advisory over sensors

**Impact**: High  
**Source**: IA-08, DB-05, DC-02  
**What**: Orient should inventory deterministic sensors and missing proof surfaces; it should not add a `backpressure` command.  
**Why It Matters**: This preserves the repo's current authority model: Backpressure Check is LLM-assisted and tools-side, while proof comes from deterministic sensors.  
**Required Action**: Spec orient's backpressure-related output as sensor/gap classification only.

## Modification Considerations

### Safe to Modify

1. Add `skills/engineering-harness-orient/` as a new skill package.
2. Add orient-specific templates under that package.
3. Add a short skill index entry to `README.md` and `skills/README.md`.
4. Add setup README wording that recommends orient after setup.
5. Add schema/report templates for `harness/orientation/`.

### Modify with Caution

1. Any changes to `engineering-harness-setup/SKILL.md`: avoid making setup run orient by default or perform heavy probes.
2. Any changes to shared command-map schema: preserve existing setup CLI behavior and empty-string semantics.
3. Any product-code patch application behavior: keep proposal-only unless explicitly authorized.

### Danger Zones

1. Reading or printing secret values.
2. Booting services or installing dependencies in default mode.
3. Treating health as product-behavior proof.
4. Marking inferred commands as verified.
5. Creating a core `commands.backpressure`.
6. Reusing setup's L0-L4 maturity ladder as orient's H-level score.

## Recommendations

### For `/plan-1b` Specification

1. Define `engineering-harness-orient` as a separate skill package under `skills/engineering-harness-orient/`.
2. Set v0.1 mode to read-only static inspection by default.
3. Require Markdown and JSON report outputs under `harness/orientation/`.
4. Include the H0-H5 harnessability ladder and L0-L6 proof ladder.
5. Require all findings to include evidence/inference provenance, confidence, severity, target layer, encoding type, and status.
6. Include `codebase_affordance_recommendations[]` with risk tiers and safety requirements.
7. Include targeted human questions and a first agent session plan as mandatory outputs.
8. Keep safe probes opt-in and defer mutating patch application if scope gets large.

### For Implementation Planning

1. Start with report/schema/templates and static inspection rules.
2. Reuse setup's authoring invariants: boundary sentence, privacy scope, placeholder syntax, shipped-surface checks.
3. Build fixture repos or fixture directories for H0/H1/H2/H3-ish cases rather than relying on this repo alone.
4. Validate `latest.json` and timestamped run JSON parseability.
5. Use `just list-skills` as the packaging/discoverability smoke.

### For Docs

1. Add a short `README.md` skill list update.
2. Add `skills/README.md` row: setup establishes the nucleus; orient assesses harnessability after setup.
3. Add setup README handoff: after setup, run `engineering-harness-orient` to produce the target-aware report.
4. Keep public docs sanitized; do not quote private scratch content directly outside the plan/spec unless rewritten generically.

## External Research Opportunities

No external research is required before specification. The paste already includes enough current public framing and the repo already has a defined authority model.

Optional later research, if the team wants stronger naming or scoring precedent:

```text
/deepresearch "Compare current public practices for AI coding-agent repository readiness, harnessability, and development-loop orientation reports. Focus on how teams classify bootability, command tiers, proof levels, deterministic sensors, product-code affordances, and human-question handoffs. Return a concise naming/scoring comparison and recommendations compatible with a read-only post-setup engineering harness orientation skill."
```

## Appendix: File Inventory

### Core Files

| File | Purpose |
|---|---|
| `scratch/paste/20260603T033048.md` | Source brief for orient skill. |
| `skills/engineering-harness-setup/SKILL.md` | Existing setup skill contract and nucleus boundary. |
| `skills/engineering-harness-setup/README.md` | Existing user-facing setup workflow and runtime skill handoff. |
| `skills/engineering-harness-setup/AUTHORING.md` | Authoring invariants to reuse for orient. |
| `skills/engineering-harness-setup/templates/harness-config.json` | Command map / deterministic sensor inventory template. |
| `skills/engineering-harness-setup/templates/harness-config.schema.json` | Schema for command map. |
| `skills/engineering-harness-setup/templates/cli-envelope.schema.json` | Existing CLI JSON envelope contract. |
| `skills/engineering-harness-setup/templates/root-HARNESS.md` | Generated governance/front-door template. |
| `README.md` | Public repo framing and setup skill index. |
| `skills/README.md` | Skill-suite and setup/runtime handoff docs. |
| `harness-foundations/first-principles.md` | Foundation claims, including harnessability and proof. |
| `harness-foundations/directives.md` | Concise operating commitments. |

### Test / Validation Surfaces

| Surface | Purpose |
|---|---|
| `just list-skills` | Skill package discoverability. |
| JSON parse/schema checks | Validate orient report/schema artifacts. |
| Fixture target repos | Prove H0/H1/H2 and safe-probe behavior. |
| Existing setup template syntax checks | Pattern for orient shipped-surface validation. |

## Next Steps

Run `/plan-1b-v3-specify-and-clarify` to create the feature specification. Suggested command:

```text
/plan-1b-v3-specify-and-clarify "Create the engineering-harness-orient skill. Use docs/plans/003-harnessability-orientation-skill/research-dossier.md and scratch/paste/20260603T033048.md as source material. Preserve the setup/orient/runtime boundary: setup creates the nucleus, orient produces a read-only target-aware harnessability report and patch recommendations, runtime tools operate the loop."
```

**Research Complete**: 2026-06-03T04:02:38Z  
**Report Location**: `docs/plans/003-harnessability-orientation-skill/research-dossier.md`


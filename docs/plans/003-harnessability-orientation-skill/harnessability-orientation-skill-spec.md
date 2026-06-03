# Harnessability Orientation Skill

**Mode**: Simple

📚 Specification incorporates findings from `research-dossier.md`.

## Research Context

Research established that `engineering-harness-orient` should be a new post-setup skill, not an expansion of `engineering-harness-setup`. Setup creates the engineering-harness nucleus; orient makes that nucleus target-aware by inspecting the repository substrate and reporting harnessability, proof readiness, gaps, first-session steps, human questions, and patch recommendations.

Key constraints from research:

- Keep orient separate from setup and runtime tools.
- Reuse setup skill conventions: multi-file package, concise public docs, shipped-surface authoring checks, byte-identical boundary sentence, and file-backed templates.
- Default to static, read-only inspection; no dependency install, service boot, mutation, secret reads, external calls, or real auth flows.
- Distinguish direct evidence, inference, human-supplied facts, and unknowns.
- Treat product-code affordance recommendations as first-class but proposal-only by default.
- Do not add a core `commands.backpressure`; Backpressure Check remains advisory over deterministic sensors.

## Summary

Create an installable `engineering-harness-orient` skill that runs after `engineering-harness-setup`. It produces a target-aware Engineering Harness Orientation Report in Markdown and JSON, classifying how harnessable a repository is and what the next agent should do before feature work.

The skill should answer: now that an engineering harness front door exists, how harnessable is this repo, what should the harness learn first, what should the next agent do safely, and which harness, environment, fixture, observability, or product-code affordance changes would make the next run safer, faster, more deterministic, and better proven?

## Goals

- Add a new `skills/engineering-harness-orient/` package.
- Define orient as a separate post-setup skill that reads installed harness surfaces and repository substrate.
- Emit stable report artifacts under `harness/orientation/`:
  - `latest.md`
  - `latest.json`
  - `schema.json`
  - `runs/<timestamp>.md`
  - `runs/<timestamp>.json`
- Normalize discovered commands into tiers such as bootstrap, boot, health, fast, quick, proof, CI-equivalent, smoke, seed/reset, observe, and cleanup.
- Classify every material gap by subsystem, loop stage, target layer, encoding type, severity, status, confidence, and provenance.
- Include a separate H0-H5 harnessability ladder distinct from setup's L0-L4 maturity ladder.
- Include the L0-L6 proof ladder and avoid claiming runtime proof from static inspection.
- Generate a concrete first agent session plan and targeted human questions.
- Recommend product-code affordances when the actual product blocks non-interactive proof.
- Keep public docs concise and publication-safe.

## Non-Goals

- Do not fold orient into `engineering-harness-setup`.
- Do not make setup silently run heavy orientation probes by default.
- Do not implement a competing runtime loop; tools repo runtime skills still own boot/observe/retro/backpressure execution.
- Do not install dependencies, boot services, mutate files, read secret values, call external services, or perform real auth flows in default mode.
- Do not apply product-code changes by default.
- Do not use setup's L0-L4 maturity ladder as the orient readiness score.
- Do not add `commands.backpressure`.
- Do not create a formal `docs/domains/` registry as part of this feature.

## Target Domains

No `docs/domains/registry.md` exists. The spec therefore treats the relevant boundaries as informal, feature-local domains.

Round 2 confirmed these boundaries are appropriate for this skill package.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|----------------------|
| harness-skill-packages | **NEW** | **create** | Add `engineering-harness-orient` as a second installable skill package following setup package conventions. |
| setup-provisioning | **NEW** | **consume** | Preserve `engineering-harness-setup` as the nucleus/front-door creator and consume its generated surfaces as orient inputs. |
| harnessability-orientation | **NEW** | **create** | Define the report generator, readiness model, inspection scope, JSON schema, Markdown report shape, and first-session guidance. |
| runtime-loop-tools | **NEW** | **consume** | Keep runtime skills as downstream operators; orient reports readiness and gaps but does not run the loop. |
| product-code-affordances | **NEW** | **create** | Establish proposal-only recommendation semantics for product/test/environment changes that make a repo harnessable. |
| publication-boundary | **NEW** | **consume** | Ensure tracked docs and templates use generalized, public-safe language. |

### New Domain Sketches

#### harness-skill-packages [NEW]

- **Purpose**: The installable skill package surface under `skills/`, including `SKILL.md`, README, authoring notes, templates, and package discoverability.
- **Boundary Owns**: skill metadata, invocation contract, package layout, shipped templates, authoring invariants, concise public index entries.
- **Boundary Excludes**: target repository product implementation, tools runtime skill internals, and private scratch research.

#### setup-provisioning [NEW]

- **Purpose**: Existing setup skill behavior that materializes a repo-local engineering-harness nucleus.
- **Boundary Owns**: governance file, `AGENTS.md` route, `harness/cli/`, `harness/cli/commands.json`, deterministic sensor slots, and `docs/harness` scaffolding.
- **Boundary Excludes**: deep target-aware harnessability scoring, product-code affordance recommendations, and runtime loop operation.

#### harnessability-orientation [NEW]

- **Purpose**: The new skill's core domain: orient a fresh human or agent around a target repository's actual harnessability.
- **Boundary Owns**: static inspection, report generation, H0-H5 readiness classification, L0-L6 proof reporting, evidence/inference logging, command-tier normalization, first-session plans, and human questions.
- **Boundary Excludes**: creating the harness nucleus by default, booting services by default, applying product-code changes, and running the tools runtime loop.

#### runtime-loop-tools [NEW]

- **Purpose**: Upstream tools skills that operate the loop after setup and orientation.
- **Boundary Owns**: session boot/readiness, observe capture, retro drain/harvest, and advisory Backpressure Check.
- **Boundary Excludes**: this repo's public skill package implementation and target repository product changes.

#### product-code-affordances [NEW]

- **Purpose**: A recommendation category for application, test, fixture, or environment changes that make the actual product easier to operate and prove through a harness.
- **Boundary Owns**: proposal records for local/test auth, seed/reset, health/readiness, side-effect sinks, stable UI hooks, deterministic clocks/IDs, diagnostics, and fixture-backed smoke paths.
- **Boundary Excludes**: automatic mutation of product code, production auth bypasses, or any secret-sensitive operation.

#### publication-boundary [NEW]

- **Purpose**: Keep tracked public content generalized and safe.
- **Boundary Owns**: sanitized language, no private identifiers, concise public docs, and avoiding raw scratch/source leakage.
- **Boundary Excludes**: private notes in `scratch/` and source-specific evidence that is not approved for publication.

## Testing Strategy

**Approach**: Manual / structural validation only.

**Rationale**: The requested change is a skill package and report contract, not production application code. The user explicitly chose no automated tests. Validation should therefore focus on reviewable artifacts and existing repo checks rather than building a new test suite.

**Focus Areas**:

- `just list-skills` shows the new skill package.
- Markdown files are readable and publication-safe.
- JSON templates and schemas parse.
- Shipped-surface checks cover the byte-identical canonical boundary sentence, the setup/orient/runtime responsibility statement, foundation citation comments on templates, placeholder syntax, private-source/source-ID contamination, and no stale core backpressure command contract.
- Example report artifacts or fixture snippets are reviewable and internally consistent.

**Excluded**:

- Automated unit test suite.
- Service boot or integration tests.
- Product-code behavior tests.
- External network calls.

**Mock Usage**: No mocks / not applicable because no automated tests are planned.

## Documentation Strategy

**Location**: Hybrid.

**Rationale**: Public repo docs should concisely announce the skill and explain where it fits, while detailed behavior belongs inside the new skill package.

Expected documentation updates:

- `README.md`: short skill-list update.
- `skills/README.md`: add orient to the setup/runtime flow.
- `skills/engineering-harness-setup/README.md`: recommend `engineering-harness-orient` as the post-setup target-aware report step.
- `skills/engineering-harness-orient/README.md`: detailed usage, outputs, safety defaults, and examples.
- `skills/engineering-harness-orient/AUTHORING.md`: authoring invariants and drift checks.

## Complexity

**Score**: CS-3 (medium)

**Breakdown**: S=2, I=1, D=1, N=2, F=1, T=0

- **S (Surface Area)**: 2 — new skill package, docs, templates, report schema, and examples.
- **I (Integration)**: 1 — integrates with setup outputs and public docs but not runtime code.
- **D (Data/State)**: 1 — defines report artifacts and schema; no persistent runtime database.
- **N (Novelty)**: 2 — introduces H0-H5 harnessability and product-code-affordance recommendation model.
- **F (Non-Functional)**: 1 — safety, publication boundary, and no-secret guarantees matter.
- **T (Testing/Rollout)**: 0 — manual/structural validation only per user preference.

**Confidence**: 0.78

**Assumptions**:

- A Simple-mode plan is acceptable even though the work is broader than a small docs edit.
- The first implementation can be skill-shaped and prompt-driven rather than a full executable analyzer.
- Low-risk harness patch application can be deferred or left proposal-only if it expands scope.

**Dependencies**:

- Existing `engineering-harness-setup` package conventions.
- Research dossier and paste brief.
- Existing `just list-skills` package-discoverability command.
- Public-safe wording rules from repo instructions and setup authoring notes.

**Risks**:

- Overbuilding orient into a second setup/runtime skill.
- Overclaiming verification from static inspection.
- Creating too broad a report schema for v0.1.
- Accidentally implying product-code recommendations may be auto-applied.
- Letting new H-level scoring look like a productivity metric.

**Phases**:

- Simple-mode single phase: create the skill package, docs, templates/schema, example/report contract, and structural validation notes.

## Acceptance Criteria

1. **Skill package exists**: `skills/engineering-harness-orient/SKILL.md` exists with skill metadata and a clear post-setup purpose.
2. **Boundary preserved**: shipped orient surfaces state that setup creates the nucleus, orient reports target-aware harnessability, and runtime tools operate the loop.
3. **Safety default documented**: the default mode is read-only/static and explicitly forbids install, boot, mutation, secret reads, external calls, and real auth flows.
4. **Reports specified**: the skill contract specifies `harness/orientation/latest.md`, `latest.json`, `schema.json`, and timestamped run files.
5. **JSON report contract specified**: the skill includes one exact v0.1 JSON Schema at `skills/engineering-harness-orient/templates/orientation-report.schema.json` with required core sections from research: repo, run, verdict, harness surfaces, project detection, command tiers, services, environment, app surfaces, auth, state/fixtures, observability, proof model, gaps, codebase affordance recommendations, human questions, recommended next actions, and proposed patches. Optional/future fields must be explicitly marked as optional.
6. **Markdown report contract specified**: the skill includes a Markdown report template optimized for human and agent skim-reading.
7. **H-levels included**: orient defines H0-H5 harnessability levels and keeps them distinct from setup's L0-L4 harness maturity ladder.
8. **Proof levels included**: orient defines or references L0-L6 proof levels and states that static inspection cannot claim runtime proof by itself.
9. **Gap classification included**: each material finding is required to classify subsystem, loop stage, target layer, encoding type, severity, status, provenance, and confidence.
10. **Product-code affordances included**: `codebase_affordance_recommendations[]` is a first-class report section with risk tiers, safety requirements, environment scope, and proposal-only defaults.
11. **Backpressure boundary preserved**: orient inventories deterministic sensors and missing proof surfaces but does not add or recommend a core `commands.backpressure`.
12. **First-session plan included**: every report must include a concrete first agent session plan.
13. **Human questions included**: every report must include targeted questions only after evidence inspection, with reason, answer type, and blocked items where applicable.
14. **Docs updated**: public docs and skill docs explain when to run setup, orient, and runtime skills without bloating the root README.
15. **Structural validation completed**: the implementation is checked with existing repo commands and manual review appropriate to a skill package: skill discoverability, JSON parse checks, shipped-surface grep checks, sanitized example/schema comparison, and a spec-to-plan/file-contract alignment review confirming every required report field, artifact path, and safety invariant appears in shipped surfaces.

## Risks & Assumptions

- **Risk**: Simple mode may under-plan a broader skill package.  
  **Mitigation**: keep v0.1 narrow and proposal-heavy; use workshops if design complexity grows.
- **Risk**: Report schema becomes too large to implement cleanly.  
  **Mitigation**: define a stable v0.1 core schema; defer non-core fields or mark them explicitly optional.
- **Risk**: Product-code affordance recommendations are misunderstood as permission to edit product code.  
  **Mitigation**: make proposal-only defaults explicit in SKILL.md, README, and schema fields.
- **Risk**: Safety language becomes prose-only.  
  **Mitigation**: require mode behavior and risk classes in the skill contract.
- **Assumption**: No formal domain registry is needed for this repo-local skill work.

## Open Questions

No critical open questions remain. Round 2 confirmed the feature-local domain boundaries and chose to continue without a repo-local engineering-harness Phase 0.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Orientation report schema v0.1 | API Contract | The JSON report is the main downstream contract and could sprawl. | Which fields are required in v0.1? Which are optional/future? How strict should schema validation be? |
| Safe probe and patch permission model | State Machine | Modes and mutation boundaries are safety-critical. | What is allowed in read-only, safe-probe, apply-safe-harness-patches, and future clean-start modes? |
| Product-code affordance recommendation schema | Data Model | This is the novel part of the skill and needs clear risk semantics. | What fields make recommendations actionable without implying auto-apply? How are high/critical risks represented? |

## Clarifications

### Session 2026-06-03

| Question | Answer | Impact |
|----------|--------|--------|
| Workflow Mode | Simple mode | Use a single-phase path despite CS-3 research complexity; keep implementation narrow. |
| Testing Strategy | "its just a skill mate, no need for any testss" | No automated test suite. Use manual/structural validation only. |
| Mock Usage | No mocks / not applicable because no automated tests | Mock strategy is out of scope. |
| Documentation Strategy | Hybrid: concise README/skills index updates plus detailed skill README/AUTHORING | Update public indexes lightly and put detail in the skill package. |
| Domain Review | Proceed with feature-local boundaries: harness-skill-packages, setup-provisioning, harnessability-orientation, runtime-loop-tools, product-code-affordances, publication-boundary | Keep `## Target Domains` as written; no formal domain registry is introduced. |
| Agent Harness Readiness | Continue without Phase 0; existing justfile/manual validation is enough | `plan-3` should not add a harness-install Phase 0 for this docs/skill package work. |

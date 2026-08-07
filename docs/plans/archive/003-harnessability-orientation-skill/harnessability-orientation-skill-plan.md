# Harnessability Orientation Skill Implementation Plan

**Mode**: Simple  
**Plan Version**: 1.0.0  
**Created**: 2026-06-03  
**Spec**: [harnessability-orientation-skill-spec.md](./harnessability-orientation-skill-spec.md)  
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Spec has no `[NEEDS CLARIFICATION]` markers; Round 2 confirmed feature-local domains and no repo-local harness Phase 0. |
| G2 | Constitution | N/A | No `docs/project-rules/constitution.md` exists. |
| G3 | Architecture | N/A | No `docs/project-rules/architecture.md` exists. |
| G4 | ADR Compliance | N/A | No accepted ADRs found under `docs/adr/`. |
| G5 | Structure | PASS | Simple-mode sections, task table, acceptance criteria, risks, and manifest are present. |
| G6 | Testing Alignment | PASS | Spec explicitly chooses manual/structural validation only; plan includes discoverability, JSON parse, and shipped-surface grep checks. |
| G7 | Domain Completeness | PASS | All spec-listed feature-local domains appear; no formal `docs/domains/` setup is planned because spec explicitly excludes a domain registry. |

## Summary

Create `engineering-harness-orient` as a second installable skill package in this repo. The implementation stays prompt-and-template shaped: it defines the post-setup orientation contract, report schema, Markdown report template, safety/default behavior, and concise docs updates without building a separate analyzer runtime or automated test suite. The plan preserves the setup/orient/runtime boundary: setup creates the nucleus, orient reports target-aware harnessability, and tools runtime skills operate the loop.

## Target Domains

| Domain | Status | Relationship | Role |
|--------|--------|--------------|------|
| harness-skill-packages | feature-local NEW | create | Add `engineering-harness-orient` as a second installable skill package following setup package conventions. |
| setup-provisioning | feature-local NEW | consume | Preserve `engineering-harness-setup` as the nucleus/front-door creator and consume its generated surfaces as orient inputs. |
| harnessability-orientation | feature-local NEW | create | Define the report generator, readiness model, inspection scope, JSON schema, Markdown report shape, and first-session guidance. |
| runtime-loop-tools | feature-local NEW | consume | Keep runtime skills as downstream operators; orient reports readiness and gaps but does not run the loop. |
| product-code-affordances | feature-local NEW | create | Establish proposal-only recommendation semantics for product/test/environment changes that make a repo harnessable. |
| publication-boundary | feature-local NEW | consume | Ensure tracked docs and templates use generalized, public-safe language. |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|----------------|-----------|
| `skills/engineering-harness-orient/SKILL.md` | harnessability-orientation | contract | Primary installed skill contract and invocation behavior. |
| `skills/engineering-harness-orient/README.md` | harness-skill-packages | contract | User-facing skill usage and fit after setup. |
| `skills/engineering-harness-orient/AUTHORING.md` | harness-skill-packages | internal | Maintainer guidance and shipped-surface invariants. |
| `skills/engineering-harness-orient/templates/canonical-boundary.txt` | publication-boundary | contract | Byte-identical canonical sentence: "The agent harness drives. The engineering harness proves." |
| `skills/engineering-harness-orient/templates/orientation-report.md` | harnessability-orientation | contract | Markdown report template emitted into target repos. |
| `skills/engineering-harness-orient/templates/orientation-report.schema.json` | harnessability-orientation | contract | Agent-readable JSON report schema template for `harness/orientation/schema.json`. |
| `skills/engineering-harness-orient/templates/orientation-latest.json` | harnessability-orientation | contract | Example/latest JSON shape used by the skill and reviewers. |
| `skills/engineering-harness-orient/templates/orientation-latest.md` | harnessability-orientation | contract | Sanitized example Markdown report shape used by the skill and reviewers. |
| `skills/engineering-harness-orient/templates/codebase-affordance-record.json` | product-code-affordances | contract | Reusable recommendation shape with risk and proposal-only semantics. |
| `README.md` | publication-boundary | cross-domain | Concise public skill index update; must avoid private/source-specific detail. |
| `skills/README.md` | runtime-loop-tools | cross-domain | Adds orient to the setup -> orient -> runtime workflow. |
| `skills/engineering-harness-setup/README.md` | setup-provisioning | cross-domain | Adds post-setup recommendation without expanding setup responsibilities. |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | High | Orient must remain separate from setup/runtime; setup already owns nucleus creation. | Create `skills/engineering-harness-orient/` as a read-only/report-first skill and avoid setup-style provisioning tasks. |
| 02 | High | No formal domain registry or Phase 0 is desired for this docs/skill work. | Keep boundaries feature-local in plan/docs; do not create `docs/domains/` or `docs/project-rules/engineering-harness.md`. |
| 03 | High | Orientation report schema can sprawl quickly. | Define a tight v0.1 core schema and mark future/optional areas as extension points. |
| 04 | High | Evidence versus inference must be first-class to prevent overclaiming. | Require provenance, confidence, and verified/candidate statuses on material findings. |
| 05 | High | Public docs currently only mention setup and upstream runtime tools. | Add concise orient entries in `README.md`, `skills/README.md`, and setup README. |
| 06 | Critical | Generated reports may leak private or overly specific repo details if the skill is not explicit about sanitization. | Add publication-safety rules to SKILL.md, AUTHORING.md, and report templates; record names/paths generically where needed. |
| 07 | High | Product-code affordances can be misread as auto-fix capability. | Require every recommendation to state `status: proposed` / not applied, risk, environment scope, and review requirement. |
| 08 | High | Backpressure Check can drift into a command-like contract. | State that orient inventories sensors and gaps only; never add `commands.backpressure`. |

## Implementation

**Objective**: Ship a concise, installable `engineering-harness-orient` skill package and documentation updates that specify a safe, post-setup harnessability orientation report.

**Testing Approach**: Manual / structural validation only. No automated test suite; use skill discoverability, JSON parsing, and shipped-surface grep checks.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|----|------|--------|---------|-----------|-------|
| [x] | T001 | Scaffold the orient skill package | harness-skill-packages | `skills/engineering-harness-orient/SKILL.md`, `skills/engineering-harness-orient/README.md`, `skills/engineering-harness-orient/AUTHORING.md`, `skills/engineering-harness-orient/templates/`, `skills/engineering-harness-orient/templates/canonical-boundary.txt` | New skill package exists with frontmatter, purpose, usage, authoring guidance, templates directory, and byte-identical canonical boundary source. | Per findings 01, 02. |
| [x] | T002 | Define the orient execution contract | harnessability-orientation | `skills/engineering-harness-orient/SKILL.md` | SKILL.md defines read-only default mode, optional safe probes, report generation, evidence/inference handling, safety constraints, and stop conditions. | Must not run services or mutate by default. |
| [x] | T003 | Add report schema, Markdown template, and sanitized examples | harnessability-orientation | `skills/engineering-harness-orient/templates/orientation-report.md`, `skills/engineering-harness-orient/templates/orientation-report.schema.json`, `skills/engineering-harness-orient/templates/orientation-latest.json`, `skills/engineering-harness-orient/templates/orientation-latest.md` | Templates specify `harness/orientation/latest.md`, `latest.json`, `schema.json`, and `runs/<timestamp>` outputs with one exact narrow v0.1 JSON Schema; non-core fields are deferred or explicitly optional; sanitized latest examples are reviewable. | Per finding 03. |
| [x] | T004 | Add product-code affordance recommendation contract | product-code-affordances | `skills/engineering-harness-orient/templates/codebase-affordance-record.json`, `skills/engineering-harness-orient/SKILL.md`, `skills/engineering-harness-orient/README.md` | Recommendation schema makes proposal-only behavior explicit with risk, environment scope, safety requirements, and review requirements. | Per finding 07. |
| [x] | T005 | Encode boundary and publication-safety invariants | publication-boundary | `skills/engineering-harness-orient/AUTHORING.md`, `skills/engineering-harness-orient/SKILL.md`, `skills/engineering-harness-orient/templates/*` | Shipped surfaces preserve the byte-identical canonical boundary sentence and the setup/orient/runtime responsibility statement, include foundation citation comments on templates, avoid private-source/source-ID contamination, use well-formed placeholders where placeholders are allowed, keep example reports free of unresolved placeholders, and do not introduce a core backpressure command key. | Per findings 06, 08 and setup AUTHORING invariants. |
| [x] | T006 | Update public skill docs and setup handoff | setup-provisioning | `README.md`, `skills/README.md`, `skills/engineering-harness-setup/README.md` | Docs explain when to run setup, orient, and runtime tools with concise public wording after the orient contract, schema, product-code-affordance semantics, and publication-safety invariants are finalized. | Depends on T003-T005; public docs should summarize the locked contract, not invent it. |
| [x] | T007 | Run structural validation and record results | harness-skill-packages | `justfile` commands, generated package files | `just list-skills` sees orient; all JSON templates parse; shipped-surface greps pass for canonical boundary wording, setup/orient/runtime wording, private-source/source-ID contamination, foundation citations, placeholder syntax, and no core backpressure command key; sanitized latest examples match the schema/template; a spec-to-plan/file-contract alignment review confirms every required report field, artifact path, and safety invariant appears in shipped surfaces. | No automated tests beyond existing commands/manual checks. Validation evidence recorded in `execution.log.md`. |

### Acceptance Criteria

- [x] `skills/engineering-harness-orient/SKILL.md` exists with skill metadata and clear post-setup purpose.
- [x] Shipped orient surfaces state that setup creates the nucleus, orient reports target-aware harnessability, and runtime tools operate the loop, while preserving the byte-identical canonical sentence "The agent harness drives. The engineering harness proves."
- [x] Default mode is read-only/static and forbids install, boot, mutation, secret reads, external calls, and real auth flows.
- [x] The skill contract specifies `harness/orientation/latest.md`, `latest.json`, `schema.json`, and timestamped run files.
- [x] JSON and Markdown report contracts are specified.
- [x] H0-H5 harnessability levels and L0-L6 proof levels are included.
- [x] Findings require provenance, confidence, severity, target layer, encoding type, and status.
- [x] `codebase_affordance_recommendations[]` is first-class and proposal-only by default.
- [x] Backpressure Check remains advisory over sensors; no core `commands.backpressure` is added.
- [x] Every report requires a first agent session plan and targeted human questions.
- [x] Public docs and skill docs explain setup -> orient -> runtime without bloating the root README.
- [x] Structural validation is completed with skill discoverability, JSON parse checks, shipped-surface grep checks, and spec-to-plan/file-contract alignment review.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Orient becomes a second setup/runtime skill | Medium | High | Keep SKILL.md scoped to report generation and recommendations; docs say setup and runtime remain separate owners. |
| Report schema sprawls beyond v0.1 | High | High | Keep required JSON fields to one exact v0.1 core contract, defer non-core fields, and mark extension fields as optional/future. |
| Product-code recommendations imply permission to edit product code | Medium | High | Require proposal-only status, risk tier, environment scope, and review requirement in every recommendation. |
| Publication-boundary leakage | Low | Critical | Add shipped-surface no-private-source rules and sanitize example report language. |
| Static inspection overclaims proof | Medium | High | Require provenance/confidence and use `candidate_unverified` / `configured_unverified` statuses unless commands are executed. |
| No automated tests misses a template regression | Medium | Medium | Run JSON parse checks, `just list-skills`, and targeted grep checks; keep v0.1 prompt/template shaped. |

---

## Validation Record (2026-06-03)

### Validation Thesis

**Raison d'être**: Translate the approved `engineering-harness-orient` spec into a buildable Simple-mode implementation path that creates a post-setup, target-aware harnessability orientation skill without expanding setup or runtime responsibilities.

**Value claim**: Implementation becomes clearer, safer, and more repeatable because the plan names exact files, task order, validation evidence, boundaries, and risk mitigations for a new skill package.

**Artifact promise**: Future implementers can build the skill package and docs with minimal clarification while preserving setup/orient/runtime boundaries, read-only defaults, proposal-only product-code affordances, publication safety, and no `commands.backpressure` drift.

**Intended beneficiaries**: implementation agents, reviewers, future maintainers of the skill package, and downstream users who need setup -> orient -> runtime guidance.

**Proof target**: Implementation.

**Evidence standard**: Source-code/docs match, complete task/file coverage, explicit acceptance criteria, structural validation commands, risk mitigations, and downstream compatibility with plan-6/code-review consumers.

**Thesis source**: Spec lines 20-24, 26-53, 108-129, 185-201 and plan lines 21-80.

**Thesis verdict**: Partially advanced before fixes; validation fixes strengthened the implementation evidence layer.

**Main thesis risk**: The plan was mostly aligned, but its validation layer was initially structural rather than a complete implementation-grade proof of the stated contract.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|----------------|---------------------|--------|---------|
| plan-coherence | Integration & Ripple, Domain Boundaries, System Behavior, Technical Constraints, Hidden Assumptions, Concept Documentation | Implementation Readiness, Downstream Usefulness, Safety to Change, Cross-Domain Coordination | 2 MEDIUM fixed | Passed after fixes |
| plan-risk-completeness | Evidence Sufficiency, Proof-Level Fit, Edge Cases & Failures, Security & Privacy, Deployment & Ops, Performance & Scale, Hidden Assumptions, Technical Constraints | Evidence Sufficiency, Proof-Level Fit, Safety to Change, Review Compression, Operational Reliability | 2 MEDIUM fixed | Passed after fixes |
| plan-thesis | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit, User/Product Value Preservation, Hidden Assumptions, Concept Documentation | Thesis Alignment, User/Product Value Preservation, Implementation Readiness, Agent Readiness, Accessibility / Knowability | 1 HIGH fixed, 1 MEDIUM fixed | Passed after fixes |
| plan-forward | Forward-Compatibility, Integration & Ripple, Test Boundary, Domain Boundaries, Deployment & Ops, User Experience | Downstream Usefulness, Contract Integrity, Implementation Readiness, Review Compression, Accessibility / Knowability | 0 | Passed |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `plan-6-v2-implement-phase` | Concrete tasks with paths and Done When criteria | Test boundary | PASS | Tasks T001-T007 include paths and Done When criteria; validation fixes made T007 more concrete. |
| `plan-7-v2-code-review` | Acceptance criteria, risks, and validation evidence | Shape mismatch | PASS | Acceptance criteria, risk table, and structural validation evidence are present and now include contract-alignment checks. |
| Future `skills/engineering-harness-orient` package | File/contract shape, safety semantics, and report/schema shape | Contract drift | PASS | Domain Manifest and tasks specify SKILL, README, AUTHORING, report templates, exact v0.1 schema, examples, and affordance record. |
| Public docs readers | Concise setup -> orient -> runtime positioning without leakage | Encapsulation lockout | PASS | Docs task updates README, skills README, and setup README after the orient contract/invariants are finalized. |

**Thesis alignment**: Value claim was initially partial at target Implementation proof level; fixes strengthened validation evidence and contract specificity while preserving the main thesis.

**Outcome alignment**: this plan supports “what should the harness learn first, what should the next agent do safely, and which ... changes would make the next run safer, faster, more deterministic, and better proven.”

**Standalone?**: No — downstream consumers include `plan-6-v2-implement-phase`, `plan-7-v2-code-review`, the future `skills/engineering-harness-orient` package, and public docs readers.

Overall: VALIDATED WITH FIXES

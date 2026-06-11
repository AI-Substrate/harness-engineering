# Rework `engineering-harness-setup` into a lean install→assess→boot flow — Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-09
**Spec**: [harness-setup-flow-spec.md](./harness-setup-flow-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical `[NEEDS CLARIFICATION]` markers; D1–D5 + boot refinement resolved in spec Clarifications. |
| G2 | Constitution | PASS | Aligns with P1 (harness is the product), P8 (wrap don't rebuild), P5 (honest verdict), P10 (extension-owned verbs — boot is a verb), P12 (publication boundary — private reference repo sanitized; plan mandates a public-safe SKILL). No HIGH violations. |
| G3 | Architecture | N/A | `architecture.md` governs the CLI source layering; this rework touches **no** CLI source — it's a prompt/docs skill that *consumes* the CLI. No boundaries crossed. |
| G4 | ADR Compliance | N/A | No `docs/adr/*.md` present. |
| G5 | Structure | PASS | All required Simple-mode sections present + populated. |
| G6 | Testing Alignment | PASS | Manual + e2e-agent strategy; verification steps (T006) + e2e proof (T007) present; ACs measurable. |
| G7 | Domain Completeness | PASS | No `docs/domains/` registry (conceptual domains only); every spec Target Domain appears; Domain Manifest covers every referenced file. |

## Summary

Replace the heavyweight, generative `engineering-harness-setup` skill (621-line SKILL.md + 19 templates + CREATE/VALIDATE/STATUS modes) with a **lean orchestration flow** documented as a simple mermaid DAG: install the harness via npx (+ a future `harness init`, with graceful fallback) → run `harnessability-assessment` only if no report exists at `.harness/reports/harnessability` → stand up a **basic `boot` extension** (the nucleus agents run before every engineering task) via the `add-extension` skill. The skill generates **no artifacts of its own** — `harness init`/the CLI own the deterministic substrate. The single phase rewrites SKILL/README/AUTHORING, deletes all 19 templates, updates the `skills/README.md` catalog, and proves the flow with the `install-and-validate-test-extension` e2e agent.

## Target Domains

> No `docs/domains/registry.md` exists; per the constitution these are **conceptual** domains tracked for traceability only.

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| `engineering-harness-setup` (skill package) | existing | **modify** | Full rewrite into a lean install→assess→boot orchestration flow; delete all 19 templates + CREATE/VALIDATE/STATUS machinery |
| `skills/README.md` catalog | existing | **modify** | Update the skill's rows, "where it fits" ordering, and the report-location reference (`.harness/reports/harnessability`) |
| `harnessability-assessment` (skill) | existing | **consume** | Called as the assess step; its report at `.harness/reports/harnessability` is read (no changes here) |
| `add-extension` (skill) | existing | **consume** | Called to author the basic `boot` extension (no changes here) |
| `harness` CLI (harness-cli) | existing | **consume** | Uses `npx`, `harness doctor`, `harness new`, `harness boot`, and a future `harness init` (no changes here) |

No new domains.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `skills/engineering-harness-setup/SKILL.md` | engineering-harness-setup | internal | The flow's core prompt — rewritten |
| `skills/engineering-harness-setup/README.md` | engineering-harness-setup | contract | Public-facing description + mermaid DAG — rewritten |
| `skills/engineering-harness-setup/AUTHORING.md` | engineering-harness-setup | internal | Authoring notes — updated to orchestration-only |
| `skills/engineering-harness-setup/templates/**` (19 files) | engineering-harness-setup | internal | **Deleted** — superseded by the CLI as deterministic code |
| `skills/README.md` | skills/README.md catalog | cross-domain | Catalog rows + ordering + report location updated |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | No `harness init` act exists today (only `help`/`doctor`/`new`/`docs`); `.harness/extensions/` is created lazily by `harness new`. | SKILL documents the `harness init` call as a forward dependency **and degrades gracefully** when absent (AC-3): explain the step, continue via lazy `.harness/`. |
| 02 | High | `harnessability-assessment` still writes `harness/assessment/`, not `.harness/reports/harnessability` (user is updating that skill in parallel). | The flow's "report exists?" check targets the pinned sentinel **`.harness/reports/harnessability/latest.json`** (fallback: any file under `.harness/reports/harnessability/`); until the assessment update lands, the check finds nothing and runs the assessment. Document this exact contract in the SKILL so the parallel update matches it. |
| 03 | High | Boot is the deliverable, not generic build/test (first-principles #11 "Boot is the first proof", #12 "boot is orientation"). | Frame step 3 as a **basic `boot`** nucleus — a thin wrapper over the repo's real readiness commands that returns a verdict + re-orients the agent. Keep it minimal (R4 — don't boil the ocean). |
| 04 | High | The `install-and-validate-test-extension` e2e agent already proves install → `add-extension` → verify; it must stay in lockstep with the human-guided flow. | Reuse its install + verify recipe in the SKILL; use it (or an equivalent boot-authoring run) as the acceptance proof (T007). |
| 05 | High | P12 publication boundary: the private reference repo (boot guide) must not appear by name/path in the published skill. | Spec already sanitized; SKILL/README describe boot **generically**. Verify no private identifiers in deliverables (T005). |
| 06 | Medium | Deleting 19 templates may strand references (catalog, other skills, docs). | Grep-and-fix sweep before/after deletion (T005). |

## Implementation

**Objective**: Turn `engineering-harness-setup` into a lean, public-safe orchestration flow that installs the harness, conditionally assesses harnessability, and stands up a basic `boot` extension — generating no artifacts of its own.

**Testing Approach**: Manual verification (T006) + reuse the `install-and-validate-test-extension` e2e agent as the acceptance proof (T007). No runtime code in the skill; mocks N/A.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Rewrite `SKILL.md` as the lean **3-step flow** (install → conditional assess → basic `boot`), rendered as a mermaid DAG. Remove CREATE/VALIDATE/STATUS modes, project-type detection, and all governance/CLI/`docs/harness` generation. Document: npx install (`npx github:AI-Substrate/harness-engineering …`) + the future `harness init` call **with graceful fallback** (Finding 01); troubleshooting (Node/network·gh/build); the `.harness/reports/harnessability/latest.json` "report exists?" check (Finding 02); the basic-boot deliverable (wrap build/run/health per assessment, returns a verdict, re-orients — first-principles #11/#12); verify via `harness doctor`/`harness boot`/`harness help`. Consume only CLI **command/envelope** surfaces (`--json` envelope fields + exit codes) — no scraping of human prose from `doctor`/`help`/assessment (AC8). Reuse the e2e agent's install+verify recipe. | engineering-harness-setup | `skills/engineering-harness-setup/SKILL.md` | SKILL presents the 3-step mermaid DAG; has **no** CREATE/VALIDATE/STATUS; documents npx + `harness init` (+fallback), the conditional assess against `.harness/reports/harnessability/latest.json`, and the basic-`boot` nucleus framed per #11/#12; consumes envelope/exit-codes only; public-safe (no private names). | AC1-6, AC5/5a, AC8; Findings 01,02,03,04,05 |
| [x] | T002 | Rewrite `README.md`: lean Purpose / When to use / What it does / Where it fits, with the **simple mermaid DAG**. Update the "where it fits" ordering and reference `.harness/reports/harnessability`. Drop the layered-harness/generation prose tied to the old behavior. | engineering-harness-setup | `skills/engineering-harness-setup/README.md` | README renders the flow as a simple mermaid DAG and matches the new lean behavior; no references to generated governance/CLI/templates. | AC7, AC1 |
| [x] | T003 | Update `AUTHORING.md` to orchestration-only authoring guidance (remove template/CLI-generation authoring notes). | engineering-harness-setup | `skills/engineering-harness-setup/AUTHORING.md` | AUTHORING reflects a no-artifact orchestration skill; no template-authoring guidance remains. | AC6, AC7 |
| [x] | T004 | Delete all 19 templates. | engineering-harness-setup | `skills/engineering-harness-setup/templates/` | `templates/` removed; no template files remain. | AC6 |
| [x] | T005 | Repo-wide sweep: fix stranded references to the deleted templates and old modes; update `skills/README.md` catalog rows (lean behavior, `.harness/reports/harnessability`, ordering); confirm **no private identifier** (codename, internal path, customer/person name) leaks into any deliverable (P12). | skills/README.md catalog | `skills/README.md`, repo-wide grep | `grep -rn "engineering-harness-setup/templates\|CREATE Mode\|VALIDATE Mode\|harness/assessment" skills/` returns no stale hits; catalog updated; private-identifier guard passes — `grep -rniE "chainglass|<known internal codenames>|/Users/[^ ]+/substrate/" skills/engineering-harness-setup/` is empty (the published skill describes boot generically). | AC7, R3, R5, Finding 05/06 |
| [x] | T006 | Manual verification walkthrough: trace the rewritten SKILL flow against the `install-and-validate-test-extension` recipe; confirm install + verify steps are in lockstep; **prove AC8** by reviewing the SKILL for any non-envelope coupling (it must read only `--json` envelope fields / exit codes, never scrape prose). Produce a written AC→check table with explicit PASS/FAIL per AC. | engineering-harness-setup | `docs/plans/008-harness-setup-flow/execution.log.md` (or a `verification.md` note) | A committed walkthrough note contains an AC1–AC9 table, each row PASS with the concrete check used; AC8 row explicitly confirms envelope/exit-code-only consumption; install/verify recipes match the e2e agent. | AC8, AC9, testing |
| [x] | T007 | Run the `install-and-validate-test-extension` e2e agent (or an equivalent throwaway-repo run that authors a **boot** extension) as the acceptance proof; capture PASS + any friction. | engineering-harness-setup | `agents/install-and-validate-test-extension/` | e2e run demonstrates install → `add-extension` (boot) → verify succeeds against the reworked skill; **the run's PASS verdict + any friction is recorded** in the verification note / a retro entry (named artifact, not just "done"). | AC9, Finding 04 |

### Acceptance Criteria

- [ ] AC1 — `SKILL.md` presents the flow as a **three-step mermaid DAG** (install → conditional assess → basic boot); no CREATE/VALIDATE/STATUS modes.
- [ ] AC2 — Install step uses npx, calls a future `harness init` (documented CLI dependency), uses `harness doctor` as the success check, and includes troubleshooting (Node/network·gh/build).
- [ ] AC3 — Install step **degrades gracefully when `harness init` is absent** today (explains + continues; relies on lazy `.harness/`).
- [ ] AC4 — Assess step invokes `harnessability-assessment` **only when** no report exists at `.harness/reports/harnessability/latest.json` (fallback: any file under that dir); reuses an existing report otherwise.
- [ ] AC5 — Boot step calls `add-extension` (never hand-writing) to stand up a **basic `boot`** wrapping the repo's real readiness commands (build/run/health per assessment), kept minimal; verified via `harness doctor`/`harness boot`/`harness help`.
- [ ] AC5a — The resulting `boot` returns a clear ready/degraded/error verdict (envelope + exit code) **and** serves as orientation (reminds the agent how the harness works / what's next).
- [ ] AC6 — All 19 templates deleted; the skill generates **no** governance doc, AGENTS.md block, `docs/harness/` scaffold, or known-difficulties seeding.
- [ ] AC7 — `README.md` documents the flow as a simple mermaid DAG; `AUTHORING.md` + `skills/README.md` updated to the lean behavior and `.harness/reports/harnessability`.
- [ ] AC8 — The flow depends only on the harness CLI's command/envelope surface — `--json` envelope fields + exit codes, no prose scraping (forward-compatible with a future MCP server); **verified explicitly in T006**.
- [ ] AC9 — The `install-and-validate-test-extension` e2e agent (or equivalent) demonstrates install → add-extension → verify succeeds against the reworked skill.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| R1 — `harness init` doesn't exist yet | High | Medium | AC-3 graceful degradation; SKILL documents the call + fallback so the flow is usable today and "just works" once `init` ships. |
| R2 — Report-location contract drift (`.harness/reports/harnessability`) | Medium | Medium | Pinned sentinel `.harness/reports/harnessability/latest.json` (dir-fallback) documented in the SKILL (T001) so the parallel assessment-skill update matches one exact contract. |
| R3 — Deleting 19 templates strands references | Medium | Low | T005 grep-and-fix sweep (catalog, other skills, docs). |
| R4 — Over-engineering boot ("boiling the ocean") | Medium | Medium | Spec + plan mandate a *basic* nucleus boot (thin wrapper); depth comes via the self-improving loop, not now. |
| R5 — Private reference repo leaks into the published skill (P12) | Low | High | Spec sanitized; SKILL/README describe boot generically; T005 verifies no private identifiers remain. |
| A1 — e2e agent stays representative of the human-guided flow | — | — | Keep install + verify recipes in lockstep (T001, T007). |

---

## Validation Record (2026-06-09)

### Validation Thesis

**Raison d'être**: Replace the heavyweight generative `engineering-harness-setup` skill with a lean orchestration flow (install → conditional assess → basic `boot`) so the deterministic substrate lives in the CLI, not duplicated in skill templates.

**Value claim**: Setup becomes faster/clearer/public-safe; the skill stops generating stand-ins; teams end with a working basic `boot` nucleus they can self-improve from.

**Artifact promise**: The plan-6 builder can implement the rework with minimal clarification (concrete tasks/paths/done-when); the result depends only on CLI command/envelope surfaces (MCP-ready) and is public-safe.

**Intended beneficiaries**: future agents/humans running setup; the plan-6 builder; a future MCP server.

**Proof target**: Implementation

**Evidence standard**: tasks with concrete paths + measurable done-when; ACs measurable; claims match the real repo; named contracts (`harness init`, report-location sentinel).

**Thesis source**: `harness-setup-flow-spec.md` (+ `research-dossier.md`)

**Thesis verdict**: Advanced

**Main thesis risk**: Stale repo facts (template count) weakened buildability confidence — **fixed** (22 → 19).

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Coherence + Completeness | System Behavior, Edge Cases, Domain Boundaries, Proof-Level Fit, CS-realism | Implementation Readiness | 1 HIGH (CS), 1 MED (AC8), 1 LOW (done-when) — addressed | ⚠️ → ✅ |
| Thesis + Source-Truth | Thesis Alignment, Evidence Sufficiency, Hidden Assumptions, Integration & Ripple | Thesis Alignment, Evidence Sufficiency | 1 HIGH (template count) fixed | ⚠️ → ✅ |
| Forward-Compatibility + Publication | Forward-Compatibility, Deployment & Ops, Security/Publication-boundary, Proof-Level Fit | Downstream Usefulness, Safety to Change | 1 HIGH (leak guard), 2 MED (AC8, report path) — addressed | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Plan-6 build | Concrete tasks/paths/done-when per AC | shape mismatch | ✅ | T001–T007 name files, done-when, AC mapping |
| Future MCP server | Depend only on CLI command/envelope surface | test boundary | ✅ (fixed) | AC8 now verified by T006; T001 done-when requires envelope/exit-code-only consumption |
| Parallel `harnessability-assessment` update | Agreed report-location contract | contract drift | ✅ (fixed) | Sentinel pinned to `.harness/reports/harnessability/latest.json` (Finding 02, AC4, R2, T001) |
| Future agents running `harness boot` | Boot returns verdict + orientation | lifecycle ownership | ✅ | AC5a + boot framing (#11/#12) |

**Thesis alignment**: Value claim advanced at Implementation proof level; evidence adequate after the template-count fix; main residual risk is the forward `harness init` dependency, handled by AC-3 graceful degradation.

**Outcome alignment**: The plan advances "a working boot, even if basic" (first-principles #11 "Boot is the first proof"); the publication-boundary guard, AC8 MCP-proof, and report-path sentinel were tightened so it is now safe and forward-compatible.

**Standalone?**: No — downstream consumers exist (plan-6 build, future MCP server, parallel assessment update).

Overall: VALIDATED WITH FIXES

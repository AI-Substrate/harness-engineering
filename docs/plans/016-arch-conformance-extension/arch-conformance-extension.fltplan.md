# Flight Plan: Arch Conformance Exemplar Extension (`arch-check`)

**Spec**: [arch-conformance-extension-spec.md](./arch-conformance-extension-spec.md)
**Plan**: [arch-conformance-extension-plan.md](./arch-conformance-extension-plan.md)
**Generated**: 2026-06-10 (enriched by /plan-3)
**Status**: In Progress — build underway with code-review-companion (T000 boot HEALTHY)

---

## The Mission

**What we're building**: A third exemplar harness extension — a `harness arch-check` verb that runs dependency-cruiser over the CLI's source against 7 committed rules encoding the hexagonal (ports & adapters) contract, and reports the result as an honest harness envelope: green when the architecture holds; at launch every rule sits at `warn`, so a violation yields a `degraded` envelope + a CI warning annotation naming the violated rule (and quoting its plain-English explanation). Promotion to blocking `error`/red-CI is a deliberate future flip.

**Why it matters**: today the architecture is enforced by reviewer eyeballs; this makes conformance a deterministic, self-explaining sensor — and demonstrates the "encode your architecture as rules" pattern consumer repos can copy.

---

## Where We Are → Where We're Headed

```
TODAY:                                      AFTER this plan:
2 exemplar extensions                       3 exemplar extensions

🔵 validate-harnessability (same)           🔵 validate-harnessability (same)
🔵 validate-harness-flow (same)             🔵 validate-harness-flow (same)
❌ hexagonal rules: prose-only docs         🔴 .dependency-cruiser.cjs (NEW) — 7 rules, all warn at launch
❌ violations: caught by reviewers, maybe   🔴 arch-check verb (NEW) — degraded envelope + PR warning, rule + fix quoted
🟡 CI: lint · build · docs · types · test   🟡 CI: + arch-check step (verb; warns annotate, crash/missing-tool fails)
❌ failure explains itself: no              🔴 yes — each rule's comment travels with the violation
```

```mermaid
flowchart LR
    classDef existing fill:#E8F5E9,stroke:#4CAF50,color:#000
    classDef changed fill:#FFF3E0,stroke:#FF9800,color:#000
    classDef new fill:#E3F2FD,stroke:#2196F3,color:#000

    subgraph Current["Current State"]
        CLI1[CLI core<br/>hexagonal by convention]:::existing
        EXT1[2 validate-* extensions]:::existing
        CI1[CI: 6 checks]:::existing
    end

    subgraph Target["After This Plan"]
        CLI2[CLI core<br/>unchanged — zero core code]:::existing
        RULES[.dependency-cruiser.cjs<br/>7 rules + agent comments]:::new
        AC[arch-check extension<br/>depcruise → envelope]:::new
        CI2[CI: + arch-check step]:::changed
        DOCS[docs/how guide<br/>copy-the-pattern]:::new
        AC --> RULES
        AC --> CLI2
        CI2 --> AC
        DOCS --> AC
    end
```

**Legend**: existing (green, unchanged) | changed (orange, modified) | new (blue, created)

---

## Scope

**Goals**:
- 7 PoC-proven hexagonal rules committed and continuously measured — violations become degraded envelopes + PR warning annotations at launch (red CI once severities are promoted), not review comments
- Agent-legible failures: every rule carries a `comment`; the violation envelope quotes it at the point of failure
- Exemplar quality: the extension models the contract (guardrails, briefing, honest statuses) well enough to copy
- One config, one code path: the verb, raw depcruise runs, and CI all consume the same root rules — and CI calls the verb
- Honest degradation: tool missing → `unconfigured`/exit 2 with the install command; never a crash, never a fake ok

**Non-Goals**:
- No ESLint (Biome stays the only linter) and no CodeQL — both ruled out in the investigation
- No coverage beyond `harness/cli/src`; no graph visualization (future `--graph` option)
- No new CLI core code; no custom depcruise reporter; no rule-authoring DSL
- No `examples/extensions/` starter copy — a future "install extensions from other repos" core capability is the distribution channel

---

## Journey Map

```mermaid
flowchart LR
    classDef done fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef active fill:#FFC107,stroke:#FFA000,color:#000
    classDef ready fill:#9E9E9E,stroke:#757575,color:#fff

    S[Specify ✓ validated]:::done --> BP[Backpressure Check<br/>skipped — user call]:::done
    BP --> P[Plan ✓ READY]:::done --> B[Build<br/>single phase]:::active --> D[Done]:::ready
```

**Legend**: green = done | yellow = active | grey = not started

---

## Phases Overview

| Phase | Title | Tasks | CS | Status |
|-------|-------|-------|----|--------|
| 1 | arch-check end-to-end (Simple mode) | 11 (+2 harness-loop rows) | CS-2 overall | In Progress |

---

## Acceptance Criteria

- [ ] `dependency-cruiser` installed as devDependency; rules committed at root `.dependency-cruiser.cjs` with agent-readable comments (no `tsConfig` option)
- [ ] Clean tree: `harness arch-check --json` → `ok`, exit 0, real module/dependency counts, empty violations
- [ ] Seeded violation caught by `services-only-adapter-ports`: `degraded`, exit 0 (warn-launch), rule comment quoted in `next_action`; blocking path proven by fixtures
- [ ] All six envelope states demonstrable (incl. `unconfigured`/exit 2 for missing tool/config, `degraded`/0 for warn-only)
- [ ] Always `./node_modules/.bin/depcruise` — the bare-npx 0-modules gotcha encoded in source comment + briefing
- [ ] `doctor` loads the extension clean; `harness instructions arch-check` prints the briefing
- [ ] CI runs the verb (never raw depcruise); any non-zero exit fails the build; `degraded` emits a `::warning::` annotation; green on current tree
- [ ] Mapping unit-tested over 4 fixtures (TDD half); `docs/how/` guide shipped; full suite green from both cwds

---

## Key Risks

| Risk | Mitigation |
|------|-----------|
| depcruise version drift changes JSON shape | lockfile pin; mapping reads only pinned `summary` fields; malformed-JSON state fails loudly |
| Rules ossify the architecture | one root file, per-rule comments; how-guide documents amending a rule with the refactor that needs it |
| Consumer repos copy the exemplar without the devDependency | `unconfigured`/exit 2 envelope with the exact install command |
| Warn parking lot — violations accumulate, nobody promotes | `::warning::` on every PR + ramp doctrine in the how-guide: warn only while a named cleanup is in flight |

---

## Flight Log

<!-- Updated by /plan-6 and /plan-6a after each phase completes -->

_No phases completed yet._

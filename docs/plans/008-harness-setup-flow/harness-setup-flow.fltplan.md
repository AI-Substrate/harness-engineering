# Flight Plan — harness-setup-flow (plan level)

**Status**: Ready for takeoff (plan READY)  ·  **Mode**: Simple  ·  **CS**: CS-3 (medium)

## Journey Map

```mermaid
flowchart LR
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef todo fill:#ECEFF1,stroke:#90A4AE,color:#546E7A,stroke-dasharray:4 3;

  R["Research ✓"]:::done --> S["Spec ✓"]:::done --> P["Plan"]:::todo --> B["Build (1 phase)"]:::todo --> M["Merge"]:::todo
```

## The flow being specified (the skill's own DAG)

```mermaid
flowchart TD
  A["Install harness via npx<br/>+ future `harness init`"] --> Ad{harness doctor OK?}
  Ad -- no --> At["Troubleshoot (node / network·gh / build)"] --> A
  Ad -- yes --> C{".harness/reports/harnessability exists?"}
  C -- no --> D["Run harnessability-assessment skill"] --> E
  C -- yes --> E["Read assessment recommendations"]
  E --> F["add-extension: basic `boot`<br/>(wrap build / run / health per assessment)"]
  F --> H["Verify: harness doctor / harness boot / help"]
```

> **Boot is the deliverable.** Agents run `harness boot` at the top of every task: it proves the env is ready *and* re-orients them on the harness. Keep it a minimal nucleus — don't boil the ocean.

## Phases

| # | Phase | Status | Summary |
|---|-------|--------|---------|
| 1 | Rework setup skill into lean flow | pending | Rewrite SKILL.md/README.md (mermaid DAG) + AUTHORING.md; delete all 19 templates + CREATE/VALIDATE/STATUS machinery; update skills/README.md catalog; validate via the install-and-validate-test-extension e2e agent. |

## Flight Log

| When | Event |
|------|-------|
| 2026-06-09 | Research dossier written (research-dossier.md). |
| 2026-06-09 | Spec written + clarified (Simple, pure orchestration, future `harness init`, manual + e2e-agent proof). |

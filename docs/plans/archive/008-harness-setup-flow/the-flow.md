# Flight plan — harness-setup-flow

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef known fill:#CFD8DC,stroke:#455A64,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#546E7A,stroke-dasharray:4 3;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;

  research["Research ✓"]:::done
  spec["Spec ✓"]:::done
  plan["Plan"]:::known
  build["Build · rework skill (1 phase)"]:::assumed
  merge["Merge"]:::assumed

  research --> spec --> plan --> build --> merge

  ws1["Workshop (opt)<br/>harness init contract"]:::assumed
  ws2["Workshop (opt)<br/>install + troubleshoot recipe"]:::assumed
  spec -.-> ws1 -.-> plan
  spec -.-> ws2 -.-> plan

  u1>"🗣 Simple · assume future harness init · pure orchestration ·<br/>first ext = basic `boot` nucleus · don't boil the ocean · e2e-agent proof"]:::said
  u1 -.- spec
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 your words

_Generated from `the-flow.json` — do not hand-edit._

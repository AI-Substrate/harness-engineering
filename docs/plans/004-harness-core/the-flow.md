# Flight plan — harness-core

> Generated from `the-flow.json`. Do not hand-edit; regenerated each `/the-flow` turn.

```mermaid
flowchart TD
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#052e16;
  classDef wip fill:#fed7aa,stroke:#ea580c,color:#7c2d12;
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#7f1d1d;
  classDef known fill:#dbeafe,stroke:#64748b,color:#1e293b;
  classDef assumed fill:#f1f5f9,stroke:#94a3b8,color:#475569,stroke-dasharray:4 3;

  research["Research · chainglass + minih harness CLI"]:::done
  spec["Spec"]:::done
  plan["Plan"]:::wip
  build["Build · 3 phases (revealed at /plan-3)"]:::assumed
  merge["Merge"]:::assumed

  research --> spec --> plan --> build --> merge

  ws1["Workshop 1 · envelope + exit-code contract"]:::done
  ws2["Workshop 2 · CLI composition pattern (minih captured)"]:::done
  spec -.-> ws1 -.-> ws2 -.-> plan

  said_research>"🗣 node CLI harness front door; NPX install; mirror chainglass + minih"]:::done
  said_research -.- research
  said_ws>"🗣 do 1 and 2, bring in the minih stuff as a workshop showing the composition pattern; dont assume it's available"]:::done
  said_ws -.- ws2
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 your words · companion (wraps phases) · worker (side build)

**Now**: Plan → **Next**: Build (3 phases)

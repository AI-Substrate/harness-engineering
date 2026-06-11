# Flight plan — `harness-flow-skill`

> Generated from `the-flow.json`. Do not hand-edit. Adopted by `/the-flow` from existing artifacts. No engineering-harness governance doc present → harness loop nodes omitted (spine + workshop only). Build ran via `/plan-6` **companion** — the live `code-review-companion` reviewed every commit and supersedes `/plan-7`, so the spine goes spec → plan → build → merge.

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef blocked fill:#FFCDD2,stroke:#C62828,color:#B71C1C;
  classDef known fill:#CFD8DC,stroke:#455A64,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#546E7A,stroke-dasharray:4 3;
  classDef said fill:#FFF9C4,stroke:#F9A825,color:#5D4037;
  classDef companion fill:#E1F5FE,stroke:#0288D1,color:#01579B,stroke-dasharray:5 3;

  research["Manual exploration<br/>(original-ask.md)"]:::done
  ws1["Workshop 1 · entry points<br/>+ decision-flow.md"]:::done
  spec["Spec · CS-3 Simple<br/>(harness-flow-skill-spec.md)"]:::done
  plan["Plan · READY · 16 tasks<br/>(harness-flow-skill-plan.md)"]:::done

  subgraph companion_wrap["👁 code-review-companion · live review (supersedes /plan-7) · APPROVE"]
    build["Build · single phase (Simple)<br/>16/16 tasks · 227/227 tests<br/>/plan-6 companion"]:::done
  end
  class companion_wrap companion

  merge["Merge · /plan-8"]:::known

  research --> spec --> plan --> build --> merge
  ws1 -.-> spec

  say_r>"🗣 'We need this for our harness skills … re-entrant, runs at any phase'"]:::said
  say_r -.- research
  say_w>"🗣 'workshop with mermaid of the harness-loop workflow graph + dynamic entry points'"]:::said
  say_w -.- ws1
  say_s>"🗣 'Simple mode … the flow skill will be in the loop skill folder'"]:::said
  say_s -.- spec
  say_b>"🗣 'yea implement with companion enabled please'"]:::said
  say_b -.- build
```

**Legend** — 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🟨 🗣 your words · 🔵 👁 companion (live review).

**Now**: build done — 16/16 tasks, companion APPROVE, 227/227 CLI tests green. · **Next**: merge (`/plan-8`; merge itself needs a typed `PROCEED`).

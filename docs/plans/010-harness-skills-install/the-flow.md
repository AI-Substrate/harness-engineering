# Flight plan — harness-skills-install

> Generated from `the-flow.json` (source of truth). Do not hand-edit.

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef known fill:#CFD8DC,stroke:#455A64,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#546E7A,stroke-dasharray:5 5;
  classDef said fill:#E1F5FE,stroke:#0288D1,color:#01579B;
  classDef companion fill:#F3E5F5,stroke:#8E24AA,color:#4A148C;

  spec["Spec + Clarify<br/>(/plan-1b) — CS-3 Simple"]:::done
  plan["Plan<br/>(/plan-3) — READY, validated"]:::done

  subgraph build_grp["Build — companion-reviewed"]
    build["Build G1-G5<br/>13 tasks · all eng-harness-* skills + skills install cmd"]:::done
    companion["🤝 code-review-companion<br/>7 findings → all fixed"]:::companion
  end

  merge["Merge<br/>(/plan-8) — available, not run"]:::known

  spec --> plan
  plan --> build
  build --> merge
  companion -. wraps .- build

  said_spec>"🗣 Simple · core verb · rename ALL · two folders"]:::said
  said_spec -.- spec
  said_build>"🗣 run validate then implement w/ companion; test install to temp"]:::said
  said_build -.- build
```

**Legend** — 🟩 done · 🟧 in-progress · 🟦 known (designed future) · ⬜ assumed · 🗣 user input · 🟪 companion

_No `docs/project-rules/engineering-harness.md` in this repo → harness-loop nodes omitted; standard testing fallback applied. Companion (minih) superseded `/plan-7`._

<!-- GENERATED FROM the-flow.json — do not hand-edit as the primary. -->
# Flight plan — dogfood-harness-flow (013)

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef known fill:#CFD8DC,stroke:#546E7A,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#455A64,stroke-dasharray:5 5;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;

  research["Research"]:::done
  spec["Spec"]:::done
  plan["Plan"]:::done
  phases["Build (12 tasks)"]:::known
  merge["Merge"]:::assumed

  research --> spec --> plan --> phases --> merge

  said_research>"🗣 build a validate-harnessability-style minih extension that runs the FULL eng-harness-flow on 3 fresh public repos in parallel, collects retros, dogfood it ourselves; never auto-implement retro improvements"]:::said
  said_research -.- research
```

**Legend** — 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input

**Now**: Plan written (Simple, READY, 12 tasks) + validated · **Next**: Build (/plan-6)
**No engineering-harness governance doc in this repo → harness loop nodes omitted.**

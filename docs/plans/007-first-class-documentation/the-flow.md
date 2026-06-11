<!-- Generated from the-flow.json — do not hand-edit. -->
# Flight plan — first-class-documentation

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32;
  classDef wip fill:#FFE0B2,stroke:#EF6C00;
  classDef blocked fill:#FFCDD2,stroke:#C62828;
  classDef known fill:#CFD8DC,stroke:#455A64;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,stroke-dasharray:5 5;
  classDef said fill:#E1F5FE,stroke:#0277BD;
  classDef companion fill:#F3E5F5,stroke:#6A1B9A;

  research["Explore docs landscape<br/>(/plan-1a)"]:::done
  spec["Write spec<br/>(/plan-1b)"]:::done
  workshop_w1["W1 bundling strategy<br/>(/plan-2c)"]:::done
  plan["Architect plan<br/>(/plan-3)"]:::done

  subgraph companion_wrap["code-review-companion (live per-commit review)"]
    phases["Build — 16 tasks<br/>(/plan-6 companion)"]:::done
  end
  class companion_wrap companion

  merge["Merge<br/>(/plan-8)"]:::known

  said_research>"do explore, then spec please"]:::said
  said_research -.- research
  said_w1>"do workshop the lock in to the spec please"]:::said
  said_w1 -.- workshop_w1
  said_build>"run the implementation with the companion"]:::said
  said_build -.- phases

  research --> spec --> plan --> phases --> merge
  spec -.-> workshop_w1 -.-> plan
```

**Legend**: done (green) · in progress (orange) · blocked (red) · known/designed (blue-grey) · assumed (dashed) · user words (blue) · companion (violet)

**Now**: Build complete — 16/16 tasks, 12/12 ACs, 213 tests pass; companion reviewed every commit (5 findings, all fixed + approved). `/plan-7` superseded. **Next**: merge analysis (`/plan-8`).

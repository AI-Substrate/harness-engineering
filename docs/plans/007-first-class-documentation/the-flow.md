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

  research["Explore docs landscape<br/>(/plan-1a)"]:::done
  spec["Write spec<br/>(/plan-1b)"]:::done
  workshop_w1["W1 bundling strategy<br/>(/plan-2c)"]:::done
  plan["Architect plan<br/>(/plan-3)"]:::known
  phases["Phases<br/>(revealed at /plan-3)"]:::assumed
  merge["Merge<br/>(/plan-8)"]:::assumed

  said_research>"do explore, then spec please"]:::said
  said_research -.- research
  said_w1>"do workshop the lock in to the spec please"]:::said
  said_w1 -.- workshop_w1

  research --> spec --> plan --> phases --> merge
  spec -.-> workshop_w1 -.-> plan
```

**Legend**: done (green) · in progress (orange) · blocked (red) · known/designed (blue-grey) · assumed (dashed) · user words (blue)

**Now**: spec + W1 workshop locked (Option C). **Next**: architect (/plan-3).

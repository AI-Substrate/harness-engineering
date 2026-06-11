<!-- GENERATED from the-flow.json — do not hand-edit. -->
# Flight plan — harnessability-survey  (Simple)

```mermaid
flowchart TD
  classDef done fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFF3E0,stroke:#EF6C00,color:#E65100;
  classDef known fill:#ECEFF1,stroke:#546E7A,color:#263238;
  classDef assumed fill:#FAFAFA,stroke:#9E9E9E,color:#616161,stroke-dasharray:4 3;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;
  classDef companion fill:#F3E5F5,stroke:#7B1FA2,color:#4A148C;

  said0>"🗣 review suggestions then kick off"]:::said
  said1>"🗣 Simple mode; ad-hoc validation"]:::said
  said2>"🗣 workshop the dogfood verb"]:::said
  said3>"🗣 run it"]:::said
  said4>"🗣 yep run (companion build)"]:::said
  research["Research · /plan-1a ✓"]:::done
  spec["Spec · /plan-1b ✓"]:::done
  ws1["Workshop 1 · validate-harnessability verb ✓"]:::done
  plan["Plan · /plan-3 ✓ READY"]:::done

  subgraph companionwrap["🟣 code-review-companion (live per-commit review)"]
    build["Build G1-G5 · 19 tasks ✓"]:::done
  end
  class companionwrap companion

  merge["Merge · /plan-8"]:::known

  said0 -.- research
  said1 -.- spec
  said2 -.- ws1
  said3 -.- plan
  said4 -.- build
  research --> spec
  spec --> plan
  spec -.-> ws1
  ws1 -.-> plan
  plan --> build
  build --> merge
```

**Legend** — 🟩 done · 🟦 known (designed) · ⬜ assumed · 🗣 user input · 🟣 companion (live review) · dotted = excursion

_Build complete: 19 tasks (G1-G5) landed + companion-reviewed (F004 HIGH shell-injection caught & fixed; F002 fixed; F001 dispositioned; F003 pre-resolved). Companion superseded /plan-7. Next: /plan-8 merge. No engineering-harness governance doc → harness-loop nodes omitted; standard structural-validation testing._

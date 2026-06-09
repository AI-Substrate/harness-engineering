<!-- GENERATED from the-flow.json — do not hand-edit. -->
# Flight plan — harnessability-survey  (Simple)

```mermaid
flowchart TD
  classDef done fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFF3E0,stroke:#EF6C00,color:#E65100;
  classDef known fill:#ECEFF1,stroke:#546E7A,color:#263238;
  classDef assumed fill:#FAFAFA,stroke:#9E9E9E,color:#616161,stroke-dasharray:4 3;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;

  said0>"🗣 review suggestions then kick off"]:::said
  said1>"🗣 Simple mode; ad-hoc validation"]:::said
  said2>"🗣 workshop the dogfood verb: clone 3 repos, run minih in bg, return run ids + prompting"]:::said
  said3>"🗣 run it"]:::said
  research["Research · /plan-1a ✓"]:::done
  spec["Spec · /plan-1b ✓"]:::done
  ws1["Workshop 1 · validate-harnessability verb ✓"]:::done
  plan["Plan · /plan-3 ✓ READY"]:::done
  build["Build G1-G5 · /plan-6"]:::known
  merge["Merge · /plan-8"]:::assumed

  said0 -.- research
  said1 -.- spec
  said2 -.- ws1
  said3 -.- plan
  research --> spec
  spec --> plan
  spec -.-> ws1
  ws1 -.-> plan
  plan --> build
  build --> merge
```

**Legend** — 🟩 done · 🟧 in progress · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · dotted = excursion

_Plan READY (G1 Clarify · G2 Constitution · G3 Architecture · G5 Structure · G6 Testing · G7 Domain all PASS; G4 ADR N/A). Deep validation: VALIDATED WITH FIXES (T016 split, T018 sub-checks decomposed). No engineering-harness governance doc → harness-loop nodes omitted; standard structural-validation testing._

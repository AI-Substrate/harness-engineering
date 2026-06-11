<!-- GENERATED from the-flow.json — do not hand-edit; regenerate from the JSON. -->
# Flight plan — gh-packages-release-please (018)

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef blocked fill:#FFCDD2,stroke:#C62828,color:#B71C1C;
  classDef known fill:#CFD8DC,stroke:#455A64,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#546E7A,stroke-dasharray:4 3;
  classDef said fill:#E1F5FE,stroke:#0288D1,color:#01579B;
  classDef harness fill:#EDE7F6,stroke:#673AB7,color:#311B92;

  research["✅ Research<br/>research-dossier.md"]:::done
  spec["✅ Spec — GH Packages via release-please<br/>READY · validated w/ fixes · +AC-11 canary"]:::done
  backpressure(["✅ Backpressure (post-spec seam)<br/>Partial · backpressure-coverage.md"]):::harness
  plan["✅ Architect<br/>READY · validated w/ fixes · 16 tasks"]:::done
  implement["🟦 Implement — single wave<br/>/plan-6 · rename + publish job + canary + reversal"]:::known
  merge["🟦 Merge → release-please cuts release<br/>/plan-8"]:::known

  research --> spec
  spec --> backpressure
  backpressure --> plan
  plan --> implement
  implement --> merge

  ask>"🗣 lets get it right now. get us in gh packages, using release please."]:::said
  ask -.- spec
  ask2>"🗣 make the PR branch testable for a release without merging to main"]:::said
  ask2 -.- spec
  ask3>"🗣 run it"]:::said
  ask3 -.- plan

  %% Legend: 🟩 done · 🟧 in-progress · 🟥 blocked · 🟦 known(designed) · ⬜ assumed(speculative) · 🗣 user input · 🟪 harness loop
```

**Now:** plan READY + validated (single wave, 16 tasks) · **Next:** implement (`/plan-6`) → merge → release-please. validate-v2 fixed 1 CRITICAL (the release-please cross-job output gate was a silent no-op) + the canary `--tag`/version mechanics; Forward-Compat + Thesis both PASS.

<!-- GENERATED FROM the-flow.json — do not hand-edit as the primary. -->
# Flight plan — arch-conformance-extension (016)

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef known fill:#CFD8DC,stroke:#546E7A,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#455A64,stroke-dasharray:5 5;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;
  classDef harness fill:#EDE7F6,stroke:#673AB7,color:#311B92;
  classDef companion fill:#FCE4EC,stroke:#C2185B,color:#880E4F;

  investigation["Tool investigation ✅ (dependency-cruiser · 7-rule PoC · rules committed at poc-arch-rules.cjs)"]:::done
  spec["Spec + validate-v2 + grill ✅ (CS-2 Simple · 12 ACs · Envelope & Exit Contract · verb arch-check · warn-launch · VALIDATED WITH FIXES)"]:::done
  backpressure["Backpressure Check — SKIPPED, user call (the plan IS the sensor)"]:::harness
  plan["Plan (/plan-3) ✅ READY + validate-v2 (gates 6 PASS / 1 N/A · VALIDATED WITH FIXES)"]:::done

  subgraph companion_review["🤝 code-review-companion — reviews every commit (supersedes /plan-7)"]
    build["Build — single phase, T000–T012 (/plan-6 companion) ⏳ in progress"]:::wip
  end
  class companion_review companion

  merge["Merge (/plan-8, typed PROCEED only)"]:::known

  investigation --> spec --> backpressure --> plan --> build --> merge

  said_investigation>"🗣 add another exemplar extension… deterministic back pressure to do architectural checking… hexagonal architecture… node native, install something? codeql etc?"]:::said
  said_investigation -.- investigation
  said_spec>"🗣 yes do that next phase please · agreed · validated? · arch-check. no examples copyable — later we will add a harness core skill to install extensions from other repos · (grill) warn on all things, we will trust our future selves — see how much we have to fix before we start failing CI"]:::said
  said_spec -.- spec
  said_bp>"🗣 skip to plan 3 cause that bakpressure is what we're building"]:::said
  said_bp -.- backpressure
  said_plan>"🗣 run it"]:::said
  said_plan -.- plan
  said_build>"🗣 impleent with companion please"]:::said
  said_build -.- build
```

**Legend** — 🟩 done · 🟧 in progress · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop · 🩷 companion (live reviewer)

**Now**: **Build IN PROGRESS** — `/plan-6` companion variant launched post-compact on the READY plan (gates 6 PASS / 1 N/A; validate-v2 VALIDATED WITH FIXES). A live `code-review-companion` reviews every commit as it lands, superseding the separate `/plan-7` review step. Single phase: T000 boot → T001 devDependency → T002 rules config (all 7 at `warn` — warn-launch posture) → T003 RED fixtures/tests → T004 GREEN `mapToDecision` → T005 extension shell → T006 instructions → T007 manual E2E walk → T008 CI final step → T009 how-guide → T010 governance doc → T011 regression both cwds → T012 retro drain. Carried-in guardrails: vitest include widened **two** levels (`'../../.harness/extensions/**/*.test.ts'`), always `./node_modules/.bin/depcruise` (bare-npx scans 0 modules), violations sorted from→to→rule, rule changes ship alone · **Next**: phase lands → `/plan-8` merge analysis (typed `PROCEED` only)

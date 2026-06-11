<!-- GENERATED FROM the-flow.json — do not hand-edit as the primary. -->
# Flight plan — dogfood-harness-flow (013)

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef known fill:#CFD8DC,stroke:#546E7A,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#455A64,stroke-dasharray:5 5;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;
  classDef companion fill:#F3E5F5,stroke:#8E24AA,color:#4A148C;

  research["Research"]:::done
  spec["Spec"]:::done
  plan["Plan"]:::done
  phases["Build (12 tasks, 4 workers PASS B/B)"]:::done
  merge["Merge (awaiting PROCEED)"]:::known

  research --> spec --> plan --> phases --> merge

  subgraph companion_fx["🤝 code-review-companion — live review"]
    fix_fx001["Fix FX001: doctor consumer-mode cli-build"]:::wip
  end
  class companion_fx companion

  phases -.-> fix_fx001 -.-> merge

  said_research>"🗣 build a validate-harnessability-style minih extension that runs the FULL eng-harness-flow on 3 fresh public repos in parallel, collects retros, dogfood it ourselves; never auto-implement retro improvements"]:::said
  said_research -.- research

  said_fx>"🗣 implement with code review companion please."]:::said
  said_fx -.- fix_fx001
```

**Legend** — 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟪 companion (wraps what it reviews)

**Now**: FX001 fix (validated) — implementing with code-review-companion · **Next**: Merge analysis (/plan-8) once the fix lands
**No engineering-harness governance doc in this repo → harness loop nodes omitted.**
**Surfaced findings ledger**: FIND-2 → FX001 (this fix) · FIND-4 → fixed (ea58be3) · bonus → AI-Substrate/minih#39 · FIND-1 (harness init) → **signal contaminated** — the worker prompt scripted the wish (de-leaked 2026-06-10); de-conflated + re-scoped (deterministic scaffold is the only shippable slice, grounding stays a skill job), see `.harness/records/retro/2026-06-10/001-init-ask-signal-correction.md` · FIND-3 → pending go.

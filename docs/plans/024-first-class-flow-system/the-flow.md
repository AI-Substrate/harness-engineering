<!-- GENERATED FROM the-flow.json — do not hand-edit; regenerate from the JSON. -->
# Flight plan · 024-first-class-flow-system

**Mode**: Full · **CS-4** · **Cursor**: Phase 1 (🟧 in progress · 6/16 built, green) · **Next**: resume implement from T007 (recommend /compact) · **Workshops**: 001 ✅ 002 ✅ 003 ✅ (all folded)

```mermaid
flowchart TD
    research["Research ✅<br/>research-dossier.md"]:::done
    plan["Plan ✅ · Full, CS-4, READY (v1.2.0)<br/>first-class-flow-system-plan.md"]:::done
    p1["Phase 1 · Flow engine 🟧<br/>6/16 built (foundation + data model) · resume T007"]:::wip
    p2["Phase 2 · Render + CI parity + docs 🟦"]:::known
    p3["Phase 3 · the-flow migration 🟦"]:::known
    review["Review 🟦"]:::known
    merge["Merge 🟦"]:::known

    research --> plan
    plan --> p1
    p1 --> p2
    p2 --> p3
    p3 --> review
    review --> merge

    wsc["Workshop · harness flow CLI surface ✅<br/>001-…cli-surface.md · Contract Ready"]:::done
    wse["Workshop · event + comment taxonomy ✅<br/>002-…taxonomy.md · Contract Ready"]:::done
    wsi["Workshop · templates, insertion + decision points ✅<br/>003-…insertion-decision-points.md · Contract Ready"]:::done
    wsc -.-> plan
    wse -.-> plan
    wsi -.-> plan

    say_wsc>"🗣 lets do the cli surface workshop."]:::said
    say_wsc -.- wsc
    say_wse>"🗣 do next workshop"]:::said
    say_wse -.- wse
    say_wsi>"🗣 run the workshop"]:::said
    say_wsi -.- wsi

    say_r>"🗣 make this a first class concept ... deterministic ... event log inside the json ... limit phases please"]:::said
    say_r -.- research
    say_p>"🗣 the plan phase is a little different on how it talks to phases. re-read it then do the plan please."]:::said
    say_p -.- plan
    say_p1>"🗣 continue with phase 5 taks then validate please"]:::said
    say_p1 -.- p1

    classDef done fill:#C8E6C9,stroke:#2E7D32;
    classDef wip fill:#FFE0B2,stroke:#EF6C00;
    classDef blocked fill:#FFCDD2,stroke:#C62828;
    classDef known fill:#BBDEFB,stroke:#1565C0;
    classDef assumed fill:#ECEFF1,stroke:#90A4AE,stroke-dasharray:5 3;
    classDef said fill:#FFF9C4,stroke:#F9A825;
    classDef harness fill:#EDE7F6,stroke:#673AB7;
```

**Legend**: 🟩 done · 🟧 in-progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop (appears at the phase edges — pre-flight boot before each phase, post-coding retro after).

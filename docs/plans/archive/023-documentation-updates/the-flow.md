<!-- GENERATED FROM the-flow.json — do not hand-edit; regenerate from the JSON. -->
# Flight plan · 023-documentation-updates

**Mode**: unknown (set at the `plan` pass) · **Cursor**: research (done) · **Next**: plan

```mermaid
flowchart TD
    research["Research ✅<br/>research-dossier.md"]:::done
    plan["Plan (spec + impl) 🟦<br/>documentation-updates-plan.md"]:::known
    build["Build · phases revealed at plan pass ⬜"]:::assumed
    review["Review ⬜"]:::assumed
    merge["Merge ⬜"]:::assumed

    research --> plan
    plan --> build
    build --> review
    review --> merge

    ws1["Workshop 1 · onboarding flow state ✅<br/>workshops/001-onboarding-flow-state.md"]:::done
    ws1 -.-> plan

    say_r>"🗣 get teh flow set up and do the research phase please."]:::said
    say_r -.- research
    say_w>"🗣 do a workshop ... mermaid of every stop ... a little self-contained flow we follow along"]:::said
    say_w -.- ws1

    classDef done fill:#C8E6C9,stroke:#2E7D32;
    classDef wip fill:#FFE0B2,stroke:#EF6C00;
    classDef blocked fill:#FFCDD2,stroke:#C62828;
    classDef known fill:#BBDEFB,stroke:#1565C0;
    classDef assumed fill:#ECEFF1,stroke:#90A4AE,stroke-dasharray:5 3;
    classDef said fill:#FFF9C4,stroke:#F9A825;
    classDef harness fill:#EDE7F6,stroke:#673AB7;
```

**Legend**: 🟩 done · 🟧 in-progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop (none emitted yet — appears at the plan pass / phase edges).

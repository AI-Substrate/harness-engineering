<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# Flight plan — harness-update

**Plan**: harness-update · **Mode**: Simple · **Phases**: 1 (single Simple-mode phase, 13 tasks)
**Rail**: `[the-flow] ◆─◆─◇─◇`   ·   **now**: Plan done (READY, CS-4, Simple) · **next**: Build

```mermaid
flowchart TD
    classDef done    fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef wip     fill:#FF9800,stroke:#F57C00,color:#000
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff
    classDef known   fill:#90A4AE,stroke:#607D8B,color:#000
    classDef assumed fill:#ECEFF1,stroke:#B0BEC5,color:#90A4AE,stroke-dasharray:4 4
    classDef said    fill:#FFFDE7,stroke:#FBC02D,color:#000
    classDef harness fill:#EDE7F6,stroke:#673AB7,color:#000

    %% ── spine; post-spec Backpressure Check sits between Spec and Plan (router installed, not run) ──
    S[Spec]:::done --> BP["Backpressure Check · /eng-harness-flow --event post-spec"]:::harness --> PL[Plan]:::done
    PL --> IMPL[["Implementation · single Simple-mode phase (T001-T013)"]]:::known
    IMPL --> M[Merge]:::known

    %% ── harness seam node (plan-complete; first-class because the router IS installed) ──
    M -.->|reflection| HH[["plan-complete seam · /eng-harness-flow --event plan-complete"]]:::harness

    %% ── verbatim user-said bubbles ──
    US1>"🗣 harness-update: add update commands; check once a day + suggest the command; 'update available vX→vY — run: …' banner in every CLI output (JSON + human)"]:::said
    US1 -.- S
    US2>"🗣 architect then valiadte"]:::said
    US2 -.- PL
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim user input · 🟪 harness seams (violet — routed via `/eng-harness-flow`)

_Generated from `the-flow.json`. Simple mode → one phase (13 tasks + 2 harness-seam rows), locked at `/the-flow 3 architect`. Spec + plan both done; the plan auto-ran `/validate-v2` (4 validators; READY; CRITICAL banner-chokepoint fix applied). Backpressure (post-spec) shown but not run; plan-complete seam shown because the router is installed (`~/.agents/skills/eng-harness-flow`)._

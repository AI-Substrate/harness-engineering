<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# Flight plan — harness-update

**Plan**: harness-update · **Mode**: Simple · **Phases**: 1 (single Simple-mode phase, 14 tasks)
**Rail**: `[the-flow] ◆─◆─◆─◇`   ·   **now**: Build done (611 tests green, companion-reviewed) · **next**: Merge

```mermaid
flowchart TD
    classDef done    fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef wip     fill:#FF9800,stroke:#F57C00,color:#000
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff
    classDef known   fill:#90A4AE,stroke:#607D8B,color:#000
    classDef assumed fill:#ECEFF1,stroke:#B0BEC5,color:#90A4AE,stroke-dasharray:4 4
    classDef said    fill:#FFFDE7,stroke:#FBC02D,color:#000
    classDef companion fill:#E1F5FE,stroke:#0288D1,color:#000
    classDef harness fill:#EDE7F6,stroke:#673AB7,color:#000

    %% ── spine ──
    S[Spec]:::done --> BP["Backpressure Check · post-spec"]:::harness --> PL[Plan]:::done
    PL --> IMPL

    subgraph CR ["🔍 code-review-companion — reviewed every commit (7 findings, all fixed)"]
      IMPL[["Implementation · 14 tasks, 611 tests green"]]:::done
    end
    class CR companion

    IMPL --> M[Merge]:::known
    M -.->|reflection| HH[["plan-complete seam · /eng-harness-flow --event plan-complete"]]:::harness

    %% ── review superseded by the companion ──
    IMPL -.->|superseded| RV["Review (skip — companion reviewed inline)"]:::assumed
    RV -.-> M

    %% ── verbatim user-said bubbles ──
    US1>"🗣 architect then valiadte"]:::said
    US1 -.- PL
    US2>"🗣 implement with companion please."]:::said
    US2 -.- IMPL
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future · ⬜╴assumed/optional (dashed) · 🟨 🗣 verbatim user input · 🔵 companion (wraps the phases it reviewed) · 🟪 harness seams

_Generated from `the-flow.json`. Build ran via `/the-flow 6 implement --companion`: 14 tasks (T001–T013 + T006B), 15 commits (`c62f30b..169aa5d`) on branch `019-harness-update`, **611 tests green**, arch boundaries clean. The `code-review-companion` reviewed every commit (F001–F007, 3 HIGH, all fixed in `169aa5d`) → the review stage is **superseded**. Next: merge._

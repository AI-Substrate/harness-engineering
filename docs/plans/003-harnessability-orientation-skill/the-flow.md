# `the-flow.md` — harnessability-orientation-skill

**Plan**: harnessability-orientation-skill · **Mode**: Simple · **Phases**: 1 inline implementation phase
**Rail**: `[the-flow] ◆─◆─◆─◆─◇─◇` · **now**: Implementation complete · **next**: Review

```mermaid
flowchart TD
    classDef done    fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef wip     fill:#FF9800,stroke:#F57C00,color:#000
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff
    classDef known   fill:#90A4AE,stroke:#607D8B,color:#000
    classDef assumed fill:#ECEFF1,stroke:#B0BEC5,color:#90A4AE,stroke-dasharray:4 4
    classDef said    fill:#FFFDE7,stroke:#FBC02D,color:#000
    classDef companion fill:#E0F2F1,stroke:#00897B,color:#000
    classDef worker  fill:#E8EAF6,stroke:#3F51B5,color:#000

    R[Research existing setup skill and harnessability brief]:::done --> S[Spec engineering-harness-orient]:::done --> PL[Architect implementation plan]:::done
    PL --> P1[Simple implementation]:::done --> RV[Review]:::known --> M[Merge]:::assumed

    S -.->|design| W[Workshop target-aware orientation contract]:::assumed
    W -.-> PL
    S -.->|prove| BP[Backpressure survey]:::assumed
    BP -.-> PL

    UR>"🗣 Use the skill tool to invoke the \"the-flow\" skill, then follow the skill's instructions to help with: /Users/jordanknight/substrate/harness-engineering/scratch/paste/20260603T033048.md <-- we're going to look at this... please prepare a flow"]:::said
    UR -.- R
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim user input · companion (teal, wraps) · worker (indigo, side)

_Generated from `the-flow.json`. Do not hand-edit this file as the primary; update `the-flow.json` first, then regenerate this view._

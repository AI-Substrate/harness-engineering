# `the-flow.md` — harness-record-command (flight view)

> Generated from `the-flow.json` (source of truth) — never hand-edit as primary.

**Plan**: harness-record-command · **Mode**: Simple · **Phases**: 1 (single-phase, 22 tasks)
**Rail**: `[the-flow] ◆─◆─◆─◆─◇`   ·   **now**: Build landed (275 tests green) · **next**: Merge

```mermaid
flowchart TD
    classDef done    fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef wip     fill:#FF9800,stroke:#F57C00,color:#000
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff
    classDef known   fill:#90A4AE,stroke:#607D8B,color:#000
    classDef assumed fill:#ECEFF1,stroke:#B0BEC5,color:#90A4AE,stroke-dasharray:4 4
    classDef said    fill:#FFFDE7,stroke:#FBC02D,color:#000

    %% ── spine (no harness nodes: this repo has no engineering-harness governance doc) ──
    D[Design · 3 workshops]:::done --> S[Spec · CS-3 · Simple]:::done --> PL[Plan · READY]:::done --> B[Build · harness record<br/>22 tasks · 275 tests green]:::done --> M[Merge]:::known

    %% ── design excursions: each workshop is its own node (all done) ──
    D -.->|design| W1[Workshop 1 · record-type contract<br/>load/use · core + extension]:::done
    W1 --> W2[Workshop 2 · CLI shape]:::done
    W2 --> W3[Workshop 3 · skills update inventory]:::done
    W3 -.-> S

    %% ── verbatim user-said bubbles ──
    U1>"🗣 workshop the record type + how loaded/used; core AND extension; retro + a sample type"]:::said
    U1 -.- W1
    US>"🗣 buffer = crash-resilient scratch in .harness/temp (gitignored); record = committed output"]:::said
    US -.- S
    UB>"🗣 yep do it (companion build)"]:::said
    UB -.- B
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim user input

_Build complete: all 22 tasks across 6 commits, `just fft` green (275 tests, 91.66% coverage), real end-to-end smokes pass for the core retro + extension dev-survey paths. The companion died after Group B (0 findings raised) so a backfill code-review pass ran → 2 LOW fixes adopted. Next: `/plan-8` analyses the merge. No harness-loop nodes (repo has no governance doc)._

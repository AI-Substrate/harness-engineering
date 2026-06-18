<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# Flight plan — product-documentation-hierarchy

**Plan**: product-documentation-hierarchy · **Mode**: Simple · **Phases**: 1 (single implement phase)
**Rail**: `[the-flow] ◆─◆─◆─◇`   ·   **now**: Implement DONE — 16 docs in docs/guide/ (uncommitted), companion-reviewed, drift-clean · **next**: Merge (commits — handed off to another agent; not auto-run)

```mermaid
flowchart TD
    classDef done    fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef wip     fill:#FF9800,stroke:#F57C00,color:#000
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff
    classDef known   fill:#90A4AE,stroke:#607D8B,color:#000
    classDef assumed fill:#ECEFF1,stroke:#B0BEC5,color:#90A4AE,stroke-dasharray:4 4
    classDef said    fill:#FFFDE7,stroke:#FBC02D,color:#000
    classDef companion fill:#E1F5FE,stroke:#0288D1,color:#000

    %% spine (vertical); Simple mode = single implement phase
    R["Research · dossier landed · /the-flow 1a explore"]:::done --> PL["Plan · spec + impl (Simple, READY) · /the-flow 1b plan"]:::done

    subgraph CR["🤝 code-review-companion · Power-On · reviewed working-tree diffs (no-commit)"]
        P1["Implement · 16 docs in docs/guide/ (T001-T017) · /the-flow 6 implement --companion"]:::done
    end
    PL --> P1
    P1 --> M["Merge · ⚠️ commits — handed off"]:::known

    %% verbatim user-said bubbles
    UR>"user: new product-doc hierarchy (separate from docs/how), start with quick start; unpick onboarding; each doc links the next; GitHub-native markdown"]:::said
    UR -.- R
    UC>"user: continue with companion; do not touch the branch, just work here; another agent will commit"]:::said
    UC -.- P1
    class CR companion
```

**Legend**: done | in progress | blocked | known future | assumed future | user input | 🤝 companion

_Generated from `the-flow.json`. Research + Plan + **Implement** done. Authored 16 docs in `docs/guide/` (README router + 01-15; `14-metrics-and-measures` an intentional stub), working-tree only (no commits, no branch ops, per the user). Commands verified vs `app.ts` + `--help`; the `installing-the-harness` deck reconciled to local reality. Drift guard PASS (links + commands + nav continuity AC-07). 6 call-outs surfaced (AC-08); root-README guide link supplied to plan 023 (AC-10, not edited here). `code-review-companion` reviewed every doc + a final drain (3 MEDIUM: F001 accepted-by-design, F002/F003 fixed) — superseding a separate review pass. **Next is Merge, which commits — the user deferred commits to another agent, so the docs are left complete + uncommitted for hand-off; merge is not auto-run.** Running alongside `023-documentation-updates`._

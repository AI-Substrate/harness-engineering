<!-- 🔄 RENDERED from the-flow.json — regenerate, never hand-edit this file as the primary. -->
# Flight plan — product-documentation-hierarchy

**Plan**: product-documentation-hierarchy · **Mode**: Simple · **Phases**: 1 (single implement phase)
**Rail**: `[the-flow] ◆─◆─◆─◆` · CLOSED OUT   ·   **now**: committed (170eab5 + 53095e3) on branch 024-first-class-flow-system · **next**: none — merge deferred (merges with the other in-flight work later)

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
    P1 --> M["Merge · deferred (committed on branch)"]:::known

    %% verbatim user-said bubbles
    UR>"user: new product-doc hierarchy (separate from docs/how), start with quick start; unpick onboarding; each doc links the next; GitHub-native markdown"]:::said
    UR -.- R
    UC>"user: continue with companion; do not touch the branch, just work here; another agent will commit"]:::said
    UC -.- P1
    class CR companion
```

**Legend**: done | in progress | blocked | known future | assumed future | user input | 🤝 companion

_Generated from `the-flow.json`. **Flow CLOSED OUT** — Research + Plan + Implement done; merge deferred. Authored 16 docs in `docs/guide/` (README router + 01-15; `14-metrics-and-measures` an intentional stub). Commands verified vs `app.ts` + `--help`; the `installing-the-harness` deck reconciled to local reality. Drift guard PASS (links + commands + nav continuity AC-07). 6 call-outs were inlined then **resolved** with the user (the-flow / harness flow / eng-harness-flow naming; AGENTS_README-link onboarding; harnessability = LLM skill; resumability) — only the 07 Roadmap callout + the 14 metrics stub remain by design. `code-review-companion` reviewed every doc + a final drain (3 MEDIUM: F001 accepted-by-design, F002/F003 fixed). Committed on branch `024-first-class-flow-system`: `170eab5` (16 docs + plan) and `53095e3` (resolutions + README guide pointer); the README pointer was staged in isolation so a concurrent `harness flow` docs-row edit by another agent was left untouched. Merge deferred — merges with the other in-flight work later. Running alongside `023-documentation-updates`._

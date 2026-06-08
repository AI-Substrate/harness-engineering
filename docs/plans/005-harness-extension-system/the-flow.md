# `the-flow.md` — harness-extension-system (flight view)

> Generated from [`the-flow.json`](./the-flow.json) — never hand-edit as the primary. Plan 005. This repo has **no** engineering-harness governance doc, so the harness loop nodes (backpressure / boot / observe / retro) are omitted; the flight plan is the spine + workshops.

**Plan**: harness-extension-system · **Mode**: Simple · **Phases**: 1 (single Implementation phase, locked at /plan-3)
**Rail**: `[the-flow] ◆─◆─◆─◆─[◐]`   ·   **now**: Implementation **DONE** (companion variant) — 28 tasks + 7 finding-fixes, 145 tests green · **next**: `/validate-v2` on the code, then next phase on the same branch

```mermaid
flowchart TD
    classDef done    fill:#4CAF50,stroke:#388E3C,color:#fff
    classDef wip     fill:#FF9800,stroke:#F57C00,color:#000
    classDef blocked fill:#F44336,stroke:#D32F2F,color:#fff
    classDef known   fill:#90A4AE,stroke:#607D8B,color:#000
    classDef assumed fill:#ECEFF1,stroke:#B0BEC5,color:#90A4AE,stroke-dasharray:4 4
    classDef said    fill:#FFFDE7,stroke:#FBC02D,color:#000

    %% ── spine (vertical) ──
    R[Research · /plan-1a]:::done --> S[Spec · /plan-1b]:::done
    S --> PL[Plan · /plan-3 · READY]:::done
    PL --> IMPL[Phase: Implementation · /plan-6 companion · DONE]:::done
    IMPL --> V[Validate · /validate-v2]:::wip
    V --> M[Merge · /plan-8 · DEFERRED]:::assumed

    %% ── excursion: WS-A workshop (done; settled the 6 pivotal decisions) ──
    S -.->|design| WSA[Workshop WS-A · contract & loader · /plan-2c]:::done
    WSA -.-> PL

    %% ── excursion: research folded into WS-A (Perplexity, done) ──
    R -.->|Perplexity| DR[["deep research → WS-A"]]:::done
    DR -.-> WSA

    %% ── excursion: live code-review companion (done; 8 findings, 7 fixed) ──
    IMPL -.->|companion| CR[["code-review-companion · 8 findings (1 HIGH + 7 MED) · 7 fixed / 1 deferred"]]:::done

    %% ── verbatim user-said bubbles ──
    UW>"🗣 run it. and identify any research that might be needed, if we're not sure go to perplexity"]:::said
    UW -.- WSA
    UP>"🗣 implement now with companion mode. Then validate when completed."]:::said
    UP -.- IMPL
```

**Legend**: 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known future (designed) · ⬜╴assumed future (dashed) · 🟨 🗣 verbatim user input

_Generated from `the-flow.json`. Spine: Research → Spec → Plan (READY) → **Implementation (DONE)** → Validate → Merge (Simple mode, 5 milestones; 4 done). The Implementation phase was built via `/plan-6` **companion variant** — 28 ordered test-first tasks T001–T028 (commits `c55c995`…`9baee4f`), then the live `code-review-companion` (run `2026-06-08T16-56-36-144Z-a9ad`) sent **8 findings** (1 HIGH `F006` invalid-status→undefined crash + 7 MED). **7 were fixed test-first** in the resumed session (`0853f56`, `e240ec9`, `d54321b`, `ca3f42a`, `986aa8a`, `79f7747`, `7880f81`); **F003** (symlink realpath) was deferred with an inline scope note. A rubber-duck reviewed the triage before implementing. State: **145 tests green, tsc+biome clean, 92.44% statement coverage**; installed-bin smokes pass (hello ok; invalid-status E141; named-only E140). Next: `/validate-v2` on the code changes (per the user's "Then validate when completed"), then the next phase on the shared `feat/harness-cli-core` branch. **Merge is deferred** (shared branch with plan 004). Harness loop nodes omitted (no engineering-harness governance doc)._

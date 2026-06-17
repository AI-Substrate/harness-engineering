# Flight Plan — harness-flow-hooks

**Mode**: Full · **Status: 🔒 CLOSED-OUT** (2026-06-17, user request) · **now**: ✅ **v1 FEATURE-COMPLETE** — all 3 phases implemented, **all v1 ACs discharged** (AC-04 → v2); SKILL.md final surface = **478** (accepted +131 public contract). Reviews: P1/P2 companion-superseded; **P3 reviewed → APPROVE WITH NOTES** (no REQUEST_CHANGES; F002 EOF whitespace fixed; F001 replay-skip ratified as proportionate docs-only) · **next**: **MERGE — deferred to the user** (manual git/PR merge; "we will merge after"). the-flow did **not** execute it (no `PROCEED` — nothing irreversible). Re-run `/the-flow 8 merge` for the analysis if wanted; the post-flight harvest fires at merge.

```mermaid
flowchart TD
    classDef done fill:#C8E6C9,stroke:#388E3C,color:#000
    classDef wip fill:#FFE0B2,stroke:#F57C00,color:#000
    classDef blocked fill:#FFCDD2,stroke:#D32F2F,color:#000
    classDef known fill:#BBDEFB,stroke:#1976D2,color:#000
    classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#000,stroke-dasharray:5 5
    classDef said fill:#FFF9C4,stroke:#FBC02D,color:#000
    classDef harness fill:#EDE7F6,stroke:#673AB7,color:#000
    classDef companion fill:#E1F5FE,stroke:#0288D1,color:#000

    research["Research ✓"]:::done
    plan["Plan: spec + impl ✓ (v1.2.0, validated)"]:::done
    p1["Phase 1 · Hook vocab + --hook alias — implemented ✓"]:::done
    p2["Phase 2 · --hooks manifest + --help — implemented ✓"]:::done
    p3["Phase 3 · Docs sync + neutrality + guards — implemented ✓"]:::done
    pv2["--emit-injection → deferred to v2"]:::assumed
    merge["Merge"]:::known
    rev3["Review P3 ✓ — APPROVE WITH NOTES"]:::done

    research --> plan
    plan --> p1 --> p2 --> p3 --> merge
    plan -.-> pv2
    p3 -.-> rev3
    rev3 -.-> merge

    subgraph crc["🤝 code-review-companion · Phase 1 (2 MEDIUM fixed, 0 HIGH/CRIT → review superseded)"]
        p1
    end
    subgraph crc2["🤝 code-review-companion · Phase 2 (1 HIGH + 1 MEDIUM fixed; run died mid-verify on external model 400 → review superseded)"]
        p2
    end
    class crc companion
    class crc2 companion

    ws1["WS-1 · execution substrate → skill-first ✓"]:::done
    ws2["WS-2 · manifest shape → Shape A ✓"]:::done
    ws3["WS-3 · --emit-injection → defer to v2 ✓"]:::done
    plan -.-> ws1
    plan -.-> ws2
    plan -.-> ws3

    hb["⚙ pre-flight ✓ P1 (boot: degraded-benign)"]:::harness
    he1["⚙ post-coding ✓ P1 (phase-end: noop)"]:::harness
    hb2["⚙ pre-flight ✓ P2 (boot: degraded-benign)"]:::harness
    he2["⚙ post-coding ✓ P2 (phase-end: noop)"]:::harness
    hb3["⚙ pre-flight ✓ P3 (boot: degraded-benign)"]:::harness
    he3["⚙ post-coding ✓ P3 (phase-end: noop)"]:::harness
    hh["⚙ post-flight (plan-complete seam)"]:::harness
    hb -.-> p1
    p1 -.-> he1
    hb2 -.-> p2
    p2 -.-> he2
    hb3 -.-> p3
    p3 -.-> he3
    merge -.-> hh

    said1>"🗣 prep a flow… research, plan, validation, without stopping; surface workshops"]:::said
    said1 -.- research
    said2>"🗣 prepare phase one then validae please"]:::said
    said2 -.- p1
    said3>"🗣 implement with companion / try again"]:::said
    said3 -.- p1
    said4>"🗣 prep next phase then validate skill please"]:::said
    said4 -.- p2
    said5>"🗣 implemenet with companion"]:::said
    said5 -.- p2
    said6>"🗣 generaet the tasks please. not war and peace, its a simple phase, then validate skill"]:::said
    said6 -.- p3
    said7>"🗣 implement it yeah"]:::said
    said7 -.- p3
    said8>"🗣 Review complete: APPROVE WITH NOTES"]:::said
    said8 -.- rev3
```

_Legend: 🟩 done · 🟧 in-progress · 🟥 blocked · 🟦 known (designed future) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop (↺) · 🤝 companion (reviews live)._

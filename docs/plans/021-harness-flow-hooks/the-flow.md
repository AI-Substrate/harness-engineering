# Flight Plan — harness-flow-hooks

**Mode**: Full · **now**: Phase 1 implemented (5 tasks + 2 seams) with live companion review — 2 MEDIUM drift fixed (F001 `f115f15`, F002 dossier superseded), 0 HIGH/CRIT; review superseded. SKILL.md 347→387 · **next**: Phase 2 tasks (`--hooks` manifest + `--help`) — or `/compact` then tasks

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
    p2["Phase 2 · --hooks manifest + --help"]:::known
    p3["Phase 3 · Docs sync + guards"]:::known
    pv2["--emit-injection → deferred to v2"]:::assumed
    merge["Merge"]:::known

    research --> plan
    plan --> p1 --> p2 --> p3 --> merge
    plan -.-> pv2

    subgraph crc["🤝 code-review-companion · reviewed every commit (2 MEDIUM fixed, 0 HIGH/CRIT → review superseded)"]
        p1
    end
    class crc companion

    ws1["WS-1 · execution substrate → skill-first ✓"]:::done
    ws2["WS-2 · manifest shape → Shape A ✓"]:::done
    ws3["WS-3 · --emit-injection → defer to v2 ✓"]:::done
    plan -.-> ws1
    plan -.-> ws2
    plan -.-> ws3
    ws1 -.-> plan

    hb["⚙ pre-flight ✓ (boot: degraded-benign)"]:::harness
    he1["⚙ post-coding ✓ (phase-end: noop, buffer empty)"]:::harness
    hh["⚙ post-flight (plan-complete seam)"]:::harness
    hb -.-> p1
    p1 -.-> he1
    merge -.-> hh

    said1>"🗣 prep a flow… research, plan, validation, without stopping; surface workshops"]:::said
    said1 -.- research
    said2>"🗣 prepare phase one then validae please"]:::said
    said2 -.- p1
    said3>"🗣 implement with companion / try again"]:::said
    said3 -.- p1
```

_Legend: 🟩 done · 🟧 in-progress · 🟥 blocked · 🟦 known (designed future) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop (↺) · 🤝 companion (reviews live)._

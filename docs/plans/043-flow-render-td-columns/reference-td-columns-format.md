# Layout D — TD two columns (spine left, chores right, row-aligned)

Spine is a straight vertical column on the left; chore boxes form a **parallel right
column**, chained together with invisible links (`~~~`) to hold the column and dotted to
their phase to sit on the same row. Goal: a dead-straight spine with chores in a tidy
gutter beside it — the cleanest if dagre cooperates (alignment is a *bias*, not guaranteed).

```mermaid
flowchart TD
    research["✅ Research"]:::done
    plan["✅ Plan"]:::done
    phase1["✅ P1: Change-spec + reset + scaffold"]:::done
    phase2["🔶 P2: CE verify sensor · now"]:::current
    phase3["P3: Roslyn parity pack"]:::known
    phase4["P4: Tests sensor"]:::known
    phase5["P5: Skill + docs"]:::known
    ship["⬜ Ship"]:::assumed

    research --> plan --> phase1 --> phase2 --> phase3 --> phase4 --> phase5 --> ship

    planC["■ ws change-spec<br/>■ ws eng-loop<br/>□° backpressure survey"]:::chore
    p1C["■ boot check<br/>▨ observe: P1<br/>■ retro: P1 (drain)"]:::chore
    p2C["□ boot check<br/>□ observe: P2<br/>□ retro (drain)<br/>□‼ sync step-coverage"]:::chore
    p3C["□ boot check<br/>□ observe: P3<br/>□ retro (drain)<br/>□‼ sync step-coverage"]:::chore
    p4C["□ boot check<br/>□ observe: P4<br/>□ retro (drain)<br/>□‼ sync step-coverage"]:::chore
    p5C["□ boot check<br/>□ observe: P5<br/>□ retro (drain)<br/>□‼ sync step-coverage"]:::chore
    shipC["□ retro: ship (harvest)"]:::chore

    %% invisible chain holds the chore boxes in their own column, ordered to match the spine
    planC ~~~ p1C ~~~ p2C ~~~ p3C ~~~ p4C ~~~ p5C ~~~ shipC

    %% dotted links pull each chore box beside its phase (same row)
    plan -.- planC
    phase1 -.- p1C
    phase2 -.- p2C
    phase3 -.- p3C
    phase4 -.- p4C
    phase5 -.- p5C
    ship -.- shipC

    classDef done fill:#bbf7d0,stroke:#16a34a,color:#052e16;
    classDef known fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a;
    classDef assumed fill:#ede9fe,stroke:#a78bfa,color:#4c1d95;
    classDef current fill:#fed7aa,stroke:#ea580c,stroke-width:3px,color:#7c2d12;
    classDef chore fill:#f5f3ff,stroke:#8b5cf6,color:#4c1d95,text-align:left;
```

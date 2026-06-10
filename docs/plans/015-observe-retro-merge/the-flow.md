<!-- GENERATED FROM the-flow.json — do not hand-edit as the primary. -->
# Flight plan — observe-retro-merge (015)

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef known fill:#CFD8DC,stroke:#546E7A,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#455A64,stroke-dasharray:5 5;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;
  classDef harness fill:#EDE7F6,stroke:#673AB7,color:#311B92;

  discussion["Design discussion (in-session research)"]:::done
  spec["Spec + validate-v2 ✅ (15 ACs · D-1..D-13 · VALIDATED WITH FIXES)"]:::done
  backpressure["Backpressure Check (/plan-2d — optional, skipped)"]:::harness
  plan["Plan + validate-v2 ✅ READY (T000–T014 · D1–D10 · VALIDATED WITH FIXES)"]:::done
  build["Build — single phase (T000–T014, /plan-6)"]:::known
  merge["Merge (/plan-8, typed PROCEED only)"]:::assumed

  discussion --> spec --> backpressure --> plan --> build --> merge

  said_discussion>"🗣 combine observe and retro skills into one… what did the agent have to infer that the harness should have proved deterministically… do we need a new record type?… inflight logs should probably not be committed… token usage is also one of our goals… simpler without watering down"]:::said
  said_discussion -.- discussion
  said_spec>"🗣 fire up a flow and progress to a validated spec stage"]:::said
  said_spec -.- spec
  said_plan>"🗣 proceed to architect phase please"]:::said
  said_plan -.- plan
```

**Legend** — 🟩 done · 🟧 in progress · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop

**Now**: Plan **READY** + VALIDATED WITH FIXES — single phase T000–T014; design decisions D1–D10 resolve every choice the spec deferred (dedicated observe service with `ensureTemp` relocated to a shared module; YAML-in-md buffer format kept so legacy hand-written entries parse natively, **no new runtime dependency**; doctor probe rides the E144 conventions pattern; flow dispatch re-pointed to the merged skill). The validators' headline catch: T012's AC-14 check was upgraded from a "read-through" to a **mandatory 9-row mapping table** (section + line per preserved behavior) — the concrete defense against the spec's stated main thesis risk, silent preservation drift · **Next**: `/plan-6` build (companion recommended; `/compact` first at this seam)

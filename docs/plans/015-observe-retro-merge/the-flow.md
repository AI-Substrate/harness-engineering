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
  backpressure["Backpressure Check (/plan-2d, optional · recommended)"]:::harness
  plan["Plan (/plan-3)"]:::known
  build["Build (single phase expected)"]:::assumed
  merge["Merge (/plan-8, typed PROCEED only)"]:::assumed

  discussion --> spec --> backpressure --> plan --> build --> merge

  said_discussion>"🗣 combine observe and retro skills into one… what did the agent have to infer that the harness should have proved deterministically… do we need a new record type?… inflight logs should probably not be committed… token usage is also one of our goals… simpler without watering down"]:::said
  said_discussion -.- discussion
  said_spec>"🗣 fire up a flow and progress to a validated spec stage"]:::said
  said_spec -.- spec
```

**Legend** — 🟩 done · 🟧 in progress · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop

**Now**: Spec **VALIDATED WITH FIXES** — 15 ACs, clarifications D-1..D-13 (slug/verb/identity/flags/wording defaults all vetoable). validate-v2's headline catch: the one CRITICAL (how does the CLI know which agent is calling? → D-11 flag→env→unconfigured) plus a finding that **corrected the spec itself** — `ensureTemp()` already writes a nested `.harness/temp/.gitignore`, so the real gap is capture-time triggering + a doctor check, and no repo-root gitignore mutation is needed at all · **Next**: `/plan-2d` backpressure check (recommended, optional) → `/plan-3` architect

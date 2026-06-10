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
  classDef companion fill:#FFF8E1,stroke:#F9A825,color:#5D4037;

  discussion["Design discussion (in-session research)"]:::done
  spec["Spec + validate-v2 ✅ (15 ACs · D-1..D-13 · VALIDATED WITH FIXES)"]:::done
  backpressure["Backpressure Check (/plan-2d — optional, skipped)"]:::harness
  plan["Plan + validate-v2 ✅ READY (T000–T014 · D1–D10 · VALIDATED WITH FIXES)"]:::done

  subgraph companion_wrap ["🧑‍⚖️ code-review-companion (run 2026-06-10T12-44-41-380Z-6236) — reviewed every commit, supersedes /plan-7"]
    build["Build ✅ — single phase T000–T014 (5 atomic RED/GREEN commits · 374/374 both cwds · dogfood drain proved AC-9)"]:::done
  end
  class companion_wrap companion

  merge["Merge (/plan-8, typed PROCEED only)"]:::known

  discussion --> spec --> backpressure --> plan --> build --> merge

  said_discussion>"🗣 combine observe and retro skills into one… what did the agent have to infer that the harness should have proved deterministically… do we need a new record type?… inflight logs should probably not be committed… token usage is also one of our goals… simpler without watering down"]:::said
  said_discussion -.- discussion
  said_spec>"🗣 fire up a flow and progress to a validated spec stage"]:::said
  said_spec -.- spec
  said_plan>"🗣 proceed to architect phase please"]:::said
  said_plan -.- plan
  said_build>"🗣 implement with companion · (mid-build) note for later: add our own harness boot extension… we should be dogfooding more… add the dogfood requirement to AGENTS.md"]:::said
  said_build -.- build
```

**Legend** — 🟩 done · 🟧 in progress · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟨 companion · 🟪 harness loop

**Now**: Build **COMPLETE** — T000–T014 in 5 atomic RED/GREEN commits: the `harness observe` core act (capture/list/clear, all-buckets sweep, E146, reserved name), doctor temp-hygiene probe, briefing capture+drain section, and the merged **386-line** friction-lifecycle skill (vs 703 across the two it replaces; AC-14 inventory 9/9 mapped with line numbers; D-13 question pair verbatim ×2). The slug is retired from every live surface (repo-root grep: zero hits). T013 was the **first real dogfood drain**: two mid-build observations (the user's harness-boot-extension note + the FakeFs readdir fidelity gap) captured via the new verb itself, materialized into committed record `002-015-observe-retro-merge-build-drain.md` via the CLI-returned `data.path`, then cleared. Suite **374/374 from both cwds**; companion reviewed every commit · **Next**: `/plan-8` merge analysis — executes only on typed `PROCEED`

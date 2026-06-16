<!-- GENERATED FROM the-flow.json — do not hand-edit; regenerated every guided turn. -->
# Flight plan — harness-bypass-change-records

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef blocked fill:#FFCDD2,stroke:#C62828,color:#B71C1C;
  classDef known fill:#BBDEFB,stroke:#1565C0,color:#0D47A1;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#455A64,stroke-dasharray:4 3;
  classDef said fill:#FFF9C4,stroke:#F9A825,color:#666;
  classDef harness fill:#EDE7F6,stroke:#673AB7,color:#4527A0;
  classDef companion fill:#B2DFDB,stroke:#00897B,color:#004D40;

  research["Research"]:::done
  spec["Spec (Full · CS-4)"]:::done
  bp["Backpressure ✓<br/>(post-spec · Partial)"]:::harness
  plan["Plan ✓<br/>(READY · validated)"]:::done
  p1["P1 · CLI core:<br/>record types + provenance<br/>(✓ COMPLETE · 633 green)"]:::done
  p2["P2 · win retro kind<br/>(✓ COMPLETE · 637 green)"]:::done
  p3["P3 · remove history.md<br/>(✓ COMPLETE · 638 green)"]:::done
  p4["P4 · capture seams<br/>(✓ COMPLETE · 638 green)"]:::done
  p5["P5 · measures doc + docs sync"]:::known
  review["Review"]:::assumed
  merge["Merge"]:::assumed
  hh["Harness plan-complete<br/>(seam)"]:::harness

  research --> spec
  spec --> bp
  bp --> plan
  plan --> p1 --> p2 --> p3 --> p4 --> p5 --> review --> merge
  merge -.-> hh

  crc["🤖 code-review-companion<br/>reviewed 3 commits · 0 findings"]:::companion
  crc -. reviews .-> p1

  crc2["🤖 code-review-companion<br/>reviewed 2 commits · 1 MED → deferred"]:::companion
  crc2 -. reviews .-> p2

  crc3["🤖 code-review-companion<br/>reviewed 2 commits · 0 findings"]:::companion
  crc3 -. reviews .-> p3

  vv3["🔎 validate-v2 (4 lenses)<br/>VALIDATED WITH FIXES"]:::harness
  vv3 -. validates .-> p3

  vv4["🔎 validate-v2 (4 lenses)<br/>tasks · VALIDATED WITH FIXES"]:::harness
  vv4 -. validates .-> p4

  say_p1>"🗣 impleemnt with companion"]:::said
  say_p1 -.- p1

  say_p2>"🗣 please inplement with companon"]:::said
  say_p2 -.- p2

  say_p3>"🗣 go, use companion"]:::said
  say_p3 -.- p3

  say_p4>"🗣 ersiouly, just do the edit? doesnt ned the full fanfare"]:::said
  say_p4 -.- p4

  say_vv4>"🗣 then run valiation skill"]:::said
  say_vv4 -.- vv4

  say_research>"🗣 two new record types: harness-bypass + harness-change → cross-repo bypass/change rates → DORA"]:::said
  say_research -.- research
```

**Legend** — 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 your words · 🟪 harness loop / validation

_Cursor: **Phase 4 — COMPLETE** (In-repo capture seams, CS-2, prose-only, no companion). Three skill edits: **retro** gained a `### Capture seams` subsection at the end of the `--drain` block (**bypass backstop** → `harness record harness-bypass` with the full `cause` enum verbatim + a `win` "what worked well?" beat → `harness observe --kind win`), leaving the `[s/t/p/e/d/a]` menu + field-source comment untouched; **eng-harness-flow** documents a **stateless** `bypass_recommended`/`bypass_cause` `--json` envelope field (router only *flags* — never writes/blocks); **add-extension** gained a best-effort `### 4. Record the change` step (`harness record harness-change`, exits `unconfigured`/2 when absent). Tracked drift folded in: `| win` added to the Kinds list at `eng-harness-4-retro/SKILL.md:85` (full 8-kind set). **Verify**: enum/kind/CLI strings zero-typo; negative scope check clean (no `AGENTS_README`/measures/`gen:docs` — Phase-5 boundary held); descriptions 834/859/461 all <900, none edited; architecture guards 3/3 incl. `history-md-guard`; full suite **638 green**. Pre-build, **validate-v2** (vv4, 4 lenses) ran on the tasks dossier → VALIDATED WITH FIXES (0 CRITICAL; 9 refinements). Not committed. **Next: Phase 5 tasks** (measures doc + docs sync — the last build phase; carries the 2nd `| win` surface at `AGENTS_README.md:193`)._

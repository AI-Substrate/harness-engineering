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
  p5["P5 · measures doc + docs sync<br/>(✓ COMPLETE · 639 green)"]:::done
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

  crc5["🤖 code-review-companion<br/>reviewed 3 commits · 1 MED → fixed (24d6dee)"]:::companion
  crc5 -. reviews .-> p5

  vv3["🔎 validate-v2 (4 lenses)<br/>VALIDATED WITH FIXES"]:::harness
  vv3 -. validates .-> p3

  vv4["🔎 validate-v2 (4 lenses)<br/>tasks · VALIDATED WITH FIXES"]:::harness
  vv4 -. validates .-> p4

  vv5["🔎 validate-v2 (4 lenses)<br/>tasks · VALIDATED (0 critical)"]:::harness
  vv5 -. validates .-> p5

  pr["⬆ DRAFT PR #23 (base main)<br/>Phases 1–4 pushed · P5 committed local"]:::harness
  pr -. tracks .-> p4

  say_p1>"🗣 impleemnt with companion"]:::said
  say_p1 -.- p1

  say_p2>"🗣 please inplement with companon"]:::said
  say_p2 -.- p2

  say_p3>"🗣 go, use companion"]:::said
  say_p3 -.- p3

  say_p4>"🗣 ersiouly, just do the edit? doesnt ned the full fanfare"]:::said
  say_p4 -.- p4

  say_p5>"🗣 imeplemt pleae, use companion"]:::said
  say_p5 -.- p5

  say_vv5>"🗣 write phase 5 tasks and then validate when ready"]:::said
  say_vv5 -.- vv5

  say_vv4>"🗣 then run valiation skill"]:::said
  say_vv4 -.- vv4

  say_research>"🗣 two new record types: harness-bypass + harness-change → cross-repo bypass/change rates → DORA"]:::said
  say_research -.- research
```

**Legend** — 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 your words · 🟪 harness loop / validation

_Cursor: **Phase 5 — COMPLETE → all 5 phases built** (the last build phase, CS-2, docs-only, with a live `code-review-companion`). Phase 5 wrote `docs/how/harness-value-measures.md` — the 4-part measures **design** doc: bypass/change rate + the **PR denominator** · **two** hand-traced records (a `harness-bypass` and the `harness-change` that `resolves` it) proving the **8-key** frozen-frontmatter join contract · DORA as a **leading/lagging correlation, not a 5th metric** · anti-Goodhart / team-level / R6 under-reporting; it **describes**, never builds, the scanner (OOS). It synced `record-and-record-types.md` (2 new core types + a provenance-header section + `| win` at `:167`) and `AGENTS_README.md` (`| win` at `:193`), and added the manifest entry + ran `gen:docs` **once** (6→7 docs). **Full gate GREEN** — biome / build / `check:docs` (exit 0) / typecheck / **vitest 639 passed** / coverage 90.85%; negative scope clean (**0** `SKILL.md` / schema / CLI-src outside `services/docs`). The **companion** (crc5) raised **1 MEDIUM** — the docs called an unset `agent` "omitted", but `provenance.ts` always stamps it (`null` when unset; the key is always present) — **verified against source and FIXED** in both docs (`24d6dee`); it re-reviewed the fix with **no new finding** and stopped clean. **3 path-scoped commits** (`b48b032` / `ec314fb` / `24d6dee`); the **93 staged presentation deletions stayed untouched**. **Next: Review** (stage 7, the inferential tier) — the companion already reviewed every commit for Phases 1/2/3/5 (supersedes a post-hoc pass for those); **Phase 4 had no companion**, so a review covering Phases 4+5 is the reasonable scope, else straight to **Merge** (base `main`; executes only on typed `PROCEED`; DRAFT PR #23 marked ready at/around merge). `/compact` recommended first (post-build seam)._

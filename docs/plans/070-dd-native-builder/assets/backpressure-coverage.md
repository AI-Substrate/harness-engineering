# Backpressure Coverage — dd-native builder (plan 070)

> **This survey is a deterministic document** (dogfood): the authoritative
> artifact is [`../backpressure.dd.json`](../backpressure.dd.json), rendered
> at [`../backpressure.dd.md`](../backpressure.dd.md) — 18 rows (one per AC,
> `bp-70xx` pressures `ac-70xx`), 7 sensors, modes/tiers per the
> `builder/backpressure` schema. This file is the module-contract signpost,
> not a second copy.

**Plan**: [plan.dd.json](../plan.dd.json)
**Basis (plan SHA-256)**: b4814527f6326e385c902742039c830b4c112a3ef46d53bd4e4599b7f42aeb3f
**Generated**: 2026-08-04
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. Selection, not
> enforcement — the proof lines are folded into evidence lists by the plan's
> owner; `harness checks` runs the instruments.

Counts (behaviour/architecture rows): **1 RUN · 11 EXTEND · 5 BUILD · 1 ABSENT**
Recommended next move (per-task lookup): **the BUILD gaps are already plan
tasks** (tk-7047 dry-run, tk-7065 archive fixture, tk-7046 legacy fixture,
tk-7067+tk-7069 self-hosting, tk-7068 flow-eval) — no separate Phase 0
needed; propose the EXTEND cases inside each owning task's fixtures.

Certainty rationale: 1 of 18 rows runs today (`just checks` covers the
exemplar/docs class); 11 are extensions to proven suites; 5 builds are
already first-class tasks in the plan; 1 row (teaching sufficiency) is
honestly human-judged via the blind eval + reader check.

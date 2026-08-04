# Backpressure Coverage — dd-native builder (plan 070)

> **This survey is a deterministic document** (dogfood): the authoritative
> artifact is [`../backpressure.dd.json`](../backpressure.dd.json), rendered
> at [`../backpressure.dd.md`](../backpressure.dd.md) — 18 rows (one per AC,
> `bp-70xx` pressures `ac-70xx`), 7 sensors, modes/tiers per the
> `builder/backpressure` schema. This file is the module-contract signpost,
> not a second copy.

**Plan**: [plan.dd.json](../plan.dd.json)
**Basis (plan SHA-256)**: 1f1d8db67e6c61217bc53dc2227a8dc38e9b757afa4fc53c215a0589642efa2a
**Generated**: 2026-08-04
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. Selection, not
> enforcement — the proof lines are folded into evidence lists by the plan's
> owner; `harness checks` runs the instruments.

Counts (behaviour/architecture rows): **1 RUN · 11 EXTEND · 5 BUILD · 1 ABSENT**
Recommended next move (per-task lookup): **the BUILD gaps are already plan
tasks** (tk-7147 dry-run, tk-7165 archive fixture, tk-7146 legacy fixture,
tk-7167+tk-7169 self-hosting, tk-7168 flow-eval) — no separate Phase 0
needed; propose the EXTEND cases inside each owning task's fixtures.

Certainty rationale: 1 of 18 rows runs today (`just checks` covers the
exemplar/docs class); 11 are extensions to proven suites; 5 builds are
already first-class tasks in the plan; 1 row (teaching sufficiency) is
honestly human-judged via the blind eval + reader check.

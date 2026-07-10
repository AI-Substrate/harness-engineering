# Workshop: Telemetry enhancement for measuring flow improvements

**Type**: Data Model / Integration Pattern
**Plan**: 056-dont-apologise-fix
**Spec**: (pre-plan workshop — feeds `dont-apologise-fix-plan.md`)
**Created**: 2026-07-09T11:20:00+10:00
**Status**: Draft

**Value Thesis**: Makes the posture change (and future flow/builder changes) *measurable from real work* — dispositions, observation kinds, and recurrence become queryable data instead of anecdotes, without breaking the counts-only privacy contract.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready (schemas + vocab specified below; validation happens at implementation)

**Selected Value Axes**:
- **Proof Quality**: tripwires (§ plan decision record #11) become computable queries, not vibes.
- **Learning Compounding**: fingerprints make "this friction keeps happening" visible across sessions without anyone re-realising it.
- **Safety to Change**: every addition is an additive closed-vocab extension of existing contracts (AC-05 / Constitution P12 posture preserved).
- **Cost / Attention Reduction**: disposition mix + conversion ratio surface where drain options are junk vs valuable, so the presentation improves from data.

**Related Documents**:
- `../research-dossier.md` (F-07…F-13 are this workshop's evidence base)
- `docs/how/telemetry-field-reference.html` (current field vocabulary)

---

## Purpose

Decide exactly what the retro/observe data model and telemetry vocabulary must carry so that (a) this plan's tripwires and (b) flow-improvement evaluation generally can be answered from real-work telemetry + committed records. Drives the CLI-schema tasks in the plan.

## Key Questions Addressed

- Where do drain dispositions live, and what is the closed vocabulary?
- How is observation recurrence detected across sessions (fingerprint)?
- What telemetry vocab is added, and what deliberately is not?
- What can already be measured today for flow changes generally?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | The plan needs exact field names, enums, and file/symbol targets — nothing more |
| Primary Value Axis | Proof Quality | "Did the posture change work?" becomes a query over real data |
| Supporting Axes | Learning Compounding · Safety to Change · Cost/Attention Reduction | Recurrence visibility; privacy preserved by construction; junk-option detection |
| Downstream Loop Improved | Offline analysis + the next (efficiency) plan | Both read the same per-stage/per-artifact data added here |

## Decision Space

| # | Option | Decision | Rationale |
|---|--------|----------|-----------|
| D1 | Disposition placement: **(a)** `system.compound.disposition` convention (open object, zero schema change) vs **(b) first-class per-entry `disposition` field** (schema 1.1→1.2, additive-optional) | **(b) Selected** | Dispositions are the primary analysis signal — the load-bearing field belongs in the schema, queryable and documented; older records stay valid (optional field). `system.compound.status` is *kept, unchanged* — it tracks long-horizon lifecycle (`encoded/wontfix/stale`, curation over time); `disposition` records the *drain-time decision*. Different clocks, both wanted. |
| D2 | Disposition vocabulary | **Closed 8-value enum — Selected**: `fixed-now \| task \| plan \| diffs \| command \| kept \| declined \| deferred` | Maps 1:1 onto the drain's routes (retro.md Decision 2) + the three no-action outcomes. **`declined` entries are still written to the retro record** — that is the whole point (offline recurrence analysis over things we said no to); only the buffer is cleared. `kept` = saved, no action chosen (the default). |
| D3 | Fingerprint algorithm | **Selected**: `fp = sha256(kind \| target? \| norm(description))[0:12]` where `norm` = lowercase → strip punctuation → collapse whitespace → first 8 tokens of length ≥3, order preserved. Computed by `harness observe` at capture, stored per entry; carried into the retro record. | Deterministic, explainable, zero-LLM. Order-preserved tokens beat sorted (too loose) and full-string (too tight). Same privacy posture as `command-signature.ts` — a hash is not prose. Tune later against real buffers; the field, not the algorithm, is the contract. |
| D4 | Telemetry vocabulary additions | **Selected (additive, closed)**: ① `ArtifactType += 'retro'` + a retro-record extractor in `artifact-semantics.ts`; ② `ArtifactCountKey += observations, disp_fixed_now, disp_task, disp_plan, disp_diffs, disp_command, disp_kept, disp_declined, disp_deferred, kind_difficulty, kind_magic_wand, kind_gift, kind_insight, kind_coordination, kind_improvement_suggestion, kind_confusion, kind_win`; ③ `HarnessEvent += observe_kind?` (closed 8-kind enum, present only when `verb === 'observe'`); ④ mirror all of it in `segment.schema.json` (`additionalProperties: false` stays). | Counts + fixed-vocab only — no free text anywhere; the extractor is the allowlist gate (AC-05 pattern). Retro records are committed files, so artifact events fire from the existing capture window with zero new plumbing. |
| D5 | What deliberately does NOT go into telemetry | **Selected**: fingerprints (high-cardinality — recurrence analysis runs offline over committed `.harness/records/retro/**`); disposition *reasons* (prose); drain presentation quality (flow-eval's job, judged not counted). | Keeps telemetry counts-only and low-cardinality; committed records carry full fidelity for offline analysis — two storage classes, each doing its designed job. |
| D6 | Conversion-metric home | **Selected**: two new deterministic insight generators (plan-048 layer): `observe_conversion` = observe events ÷ friction proxies (non-zero `command_exit` + `api_error`) per session; `disposition_mix` from retro artifact events. | The LLM never computes a reported number (telemetry-insights-narrate rule); generators are reviewable code and cohort-trendable. |

## Contract — the changed shapes (implementation reference)

```yaml
# retro record entry (schema 1.1 → 1.2, both fields OPTIONAL/additive)
- id: DL-001
  kind: difficulty
  description: "..."
  fp: "a3f9c2d1e4b5"            # NEW — capture-time fingerprint (D3)
  disposition: declined          # NEW — drain-time outcome (D2 enum)
  system:
    compound:
      status: open               # UNCHANGED long-horizon lifecycle convention
```

```ts
// events.ts (all additive)
export interface HarnessEvent extends EventBase {
  kind: 'harness';
  verb: string;
  observe_kind?: ObservationKind;   // NEW — only when verb === 'observe'
}
// ArtifactType += 'retro'
// ARTIFACT_COUNT_KEYS += observations, disp_* (8), kind_* (8)   — see D4
```

Files that move together (from dossier risks): `retro.schema.json` + `RETRO_TEMPLATE` (retro.ts) + `retro-template.test.ts` — one commit. `events.ts` + `segment.schema.json` — one commit. Fix the stale `eng-harness-loop` path in retro.ts's header comment in passing.

## What telemetry can already answer (the representativeness baseline)

| Question about any flow change | Measurable today? | Via |
|---|---|---|
| Per-stage wall-clock + token cost | ✅ | `FlowEvent` stage transitions × `TurnEvent` (`in/out/cache_*`) |
| Chore skip/done rates (drains skipped?) | ✅ | `ArtifactCountKey` `chores_done/skipped/todo` on flight-plan snapshots |
| Observe volume per session | ✅ (coarse) | `HarnessEvent` verb counts |
| Friction proxies | ✅ | `command_exit` non-zero + `api_error` |
| Observation kinds / dispositions / recurrence | ❌ → **this workshop** | D2–D4 |
| Drain presentation quality | ❌ (by design) | flow-eval planted-friction scenario + human judgement |

## Attention Reduction

| Future Loop | Before | After |
|-------------|--------|-------|
| Tripwire review (post-ship) | Re-read transcripts, guess | Run two insight generators over the cohort |
| Recurrence detection | Someone remembers "didn't we hit this before?" | `fp` group-by over committed retro records |
| Drain-option quality | Anecdote | `disposition_mix` — high declined-rate flags junk options |
| Next (efficiency) plan | Would need new capture | Reads existing FlowEvent × TurnEvent attribution |

## Validation / Acceptance

- All new fields/vocab land additively; existing records, segments, and schemas validate unchanged.
- A drained retro record carries `fp` + `disposition` per entry; a declined entry is present with `disposition: declined`.
- One real session produces a `retro` artifact event whose counts sum correctly against the record.
- The two insight generators emit numbers over the md-to-pdf eval cohort without LLM involvement.

## Open Questions

### Q1: Disposition placement first-class vs convention (D1)?
**RESOLVED (recommended)**: first-class, schema 1.2 — pending user ratification.

### Q2: Fingerprint token count / normalization tuning (D3)?
**OPEN (non-blocking)**: ship first-8-significant-tokens; tune against real buffers post-ship. The field is the contract, not the algorithm.

### Q3: Should `observe_kind` ride HarnessEvent now or wait for the artifact extractor to prove the need?
**RESOLVED (recommended)**: now — it is one optional closed-enum field and the conversion-by-kind query wants it.

# Validation — plan 050 semantic-artifact-telemetry

**Verdict**: `PASS` (READY) — the plan is implementation-ready. The design (workshop) was already sound; the re-checked revision now closes the new-event-kind integration gap that previously made T001–T006 ship artifact events that lost their payload locally and were dropped on publish. An implementer can execute the tasks without re-deriving design, and the plan's own gates (AC-06 + new AC-07) now enforce the full pipeline round-trip.

**Validator**: pij-1xu25j8 (Copilot Opus, control-plane peer) · read-only · 2026-07-04
**History**: initial verdict `NEEDS ATTENTION` (4 findings) → plan revised → this re-check confirms all 4 addressed.

## Re-check of the 4 findings

| # | Sev | Original gap | Resolution in revised plan | Status |
|---|-----|--------------|----------------------------|--------|
| 1 | CRITICAL | New `artifact` kind covered only by `events.ts` + `segment.schema.json` + `capture-service.ts`; serializer + OTLP round-trip omitted → payload dropped locally (`segment.ts` `default` → `{t,kind}`) and lost on publish (committed shards **are** OTLP logs; `encodeEvent`/frozen `harness_attributes` allowlist have no artifact case). | Domain Manifest now lists `segment.ts` (:327 serializer case), `otlp/logs.ts` (`encodeEvent` case), `otlp/semconv.ts` (attr consts), `otlp/harness-otlp.schema.json` (frozen allowlist rows). **T001** adds the serializer case; **T003** covers segment schema + OTLP round-trip + frozen-schema allowlist, encoding open `counts`/`enums` as kvlist attrs like `checks.gates`. New **AC-07** makes "every kind round-trips" + frozen-schema green a first-class criterion. Finding 05 recorded. | ✅ Addressed |
| 2 | HIGH | T001 said rollup exclusion lived in `events.ts`; real exclusion is `rollup.ts:186` `.filter(e => e.kind !== 'flow_log')`; runtime `EVENT_KINDS` const also needed, not just the type union. | `rollup.ts` (:186) added to Manifest + T001 path; T001 Done-When: "rollup filter excludes `artifact` beside `flow_log`". T001 title + Finding 06 add the `EVENT_KINDS` const entry (`events.ts:51`). | ✅ Addressed |
| 3 | MED | T004 left the per-file content read (and its missing/binary/oversized guard) unstated; extractors are `extract(content:string)` but the seam has only path lists. | T004 now: "→ guarded `deps.fs` content read (skip missing/binary/oversized) → emit"; Done-When: "missing/huge file → no event, no throw (AC-04)". Manifest capture-service row echoes the guard. | ✅ Addressed |
| 4 | MED | AC-05 implied `additionalProperties:false` enumerates enum **values**; actually `enums: Record<string,string>` is an open map — enforcement rests on the extractor mapping novel→`'other'` + privacy test. | AC-05 reworded: enum **values** gated by the extractors (fixed vocabulary + `other` fallback, "enforced by construction — same gate style as `checks.gates`"), privacy test proves no finding/fix text. T002 Done-When: "extractor output is the enum-VALUE allowlist gate". | ✅ Addressed |

## Code-claim re-verification (revised plan's new references all resolve)
- `test/services/telemetry/otlp/reconstruction.test.ts:153` — `it('every kind round-trips byte-faithfully through OTLP')` exists → AC-07's gate is real. ✓
- `events.ts:51` — `export const EVENT_KINDS: readonly EventKind[]` exists → the runtime const T001 must extend is real. ✓
- `rollup.ts:186` — `.filter((e) => e.kind !== 'flow_log')` (with the plan-035 "PURE REPLAY MARKERS" rationale at :179) → T001's filter target is real. ✓
- `otlp/logs.ts` — `encodeEvent` (:65) **and** `decodeEvent` (:164) both present as closed switches → T003's round-trip surface is real. ✓

## Remaining note (non-blocking — does not affect verdict)
- **`decodeEvent` is named only implicitly.** T003 and the Manifest name `encodeEvent` (:65) explicitly, but a byte-faithful round-trip also requires a `decodeEvent` (:164) `case 'artifact'`. T003's Done-When ("`reconstruction.test.ts` 'every kind round-trips' stays green") **already forces** the decode case — the test cannot pass otherwise — so this is covered by the gate, not outstanding. Optional polish: name `decodeEvent` alongside `encodeEvent` in the T003/Manifest prose so the implementer sees both halves without inferring them from the failing test.

## Consistency / KISS (still passing)
- Plan vs authoritative workshop: event shape, 10-extractor roster, 22-element inventory, and the change-triggered capture seam all still match — no contradiction. ✓
- KISS preserved: revision added the *missing integration surface* (correctness), not ceremony. Still Simple / one-phase / CS-2 / 6 tasks. ✓

## Thesis check
**Serves the ask and is now implementation-ready.** The ask (emit fixes/phases/workshop-length/research-length etc. from flow artifacts, counts-only, "at save time" in the capture window) is captured by the workshop and the plan's registry/seam/privacy framing. The prior blocker — a new event kind must thread through `serializeEvent` **and** the OTLP round-trip or its data is dropped locally and lost on commit — is resolved in the Manifest, T001/T003, and the new AC-07 gate. No blocking gaps remain.

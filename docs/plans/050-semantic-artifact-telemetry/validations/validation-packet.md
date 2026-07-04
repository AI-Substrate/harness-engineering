# Validation packet — plan 050 semantic-artifact-telemetry

You are an independent **plan validator** (read-only; you may run read-only commands like grep/ls/vitest --run is NOT needed). Validate the plan below against its authoritative sources and return a compact verdict.

## Target
- Plan: `docs/plans/050-semantic-artifact-telemetry/semantic-artifact-telemetry-plan.md`
- Authoritative upstream: `docs/plans/050-semantic-artifact-telemetry/workshops/001-semantic-telemetry-elements.md` (design decisions — the plan must not contradict it)
- Original ask: `docs/plans/050-semantic-artifact-telemetry/original-ask.md`

## Validation Contract
- **Purpose**: build recipe for emitting counts-only semantic telemetry from flow artifacts at capture time (change-triggered, inside the existing per-command capture window).
- **Promise**: an implementer can execute T001–T006 without re-deriving design; privacy posture (counts + enums only, never text) survives.
- **Proof target**: Implementation-ready plan (Simple mode, CS-2).
- **Key checks**:
  1. Plan vs workshop consistency — event shape, extractor contract, element inventory, capture seam all match; no contradiction.
  2. Code claims resolve — verify against the real tree: `harness/cli/src/services/telemetry/capture-service.ts` (files seam ~:255/:586), `flow-log.ts` (the exemplar), `events.ts` (closed event-kind union), `segment.schema.json` (`event_stream`), test dir layout.
  3. Task table sufficiency — each AC covered; Done-When measurable; nothing phantom (files that don't exist and aren't marked NEW).
  4. Privacy — could any proposed field carry free text? (enums must be schema-enumerated with `other` fallback).
  5. KISS check — the user mandated "don't overbake"; flag anything in the plan that is ceremony beyond what T001–T006 need.

## Output — write your verdict to a file AND reply
Write `docs/plans/050-semantic-artifact-telemetry/validations/semantic-artifact-telemetry-plan-validation.md` containing:
- Verdict line: `VALIDATED` | `VALIDATED WITH FIXES (list)` | `NEEDS ATTENTION`
- Findings table (severity CRITICAL/HIGH/MED only, max 5): location · claim · proof · smallest fix
- One-line thesis check (does the plan serve the ask?)

Then reply with the verdict + findings summary. Do NOT edit the plan or workshop. Do NOT touch the-flow.json / the-flow.md.

## Forbidden paths
`.the-flow-state.json`, `the-flow.json`, `the-flow.md`, `semantic-artifact-telemetry-plan.md` (read-only), `workshops/*` (read-only).

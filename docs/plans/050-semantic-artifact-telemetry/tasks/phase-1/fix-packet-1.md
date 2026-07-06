# Fix packet 1 — plan 050 phase-1 (review findings only)

You are the flow-pair CODER (orchestrator pij-4s10mb). The cross-model review returned **FIX_REQUIRED**. Fix ONLY the findings below — no refactors, no scope growth. Full review: `docs/plans/050-semantic-artifact-telemetry/reviews/review.phase-1.md`. Same allowed/forbidden paths as `coder-packet.md`.

## F1 · HIGH — verdict regex misses unbolded grammar
`artifact-semantics.ts:131` requires the verdict word to be bold (`\*\*([A-Z...])\*\*`). Real artifacts also write `**Verdict**: FIX_REQUIRED` (unbolded — e.g. this plan's own review file). Fix: match the verdict token with or without bold/emoji decoration (first ALL-CAPS token after `**Verdict**:`), keep the enum allowlist + `other` fallback. Same for the validation extractor if it shares the pattern. Add fixture cases: bolded, unbolded, emoji-prefixed.

## F2 · HIGH — counts/enums are open key maps (contract violation)
`segment.schema.json:217-218` ships `counts`/`enums` as `additionalProperties: {type: integer|string}` — an open string-valued channel, violating the workshop § Event shape ("keys are fixed per artifact_type, schema-enumerated, additionalProperties:false — an extractor cannot invent a channel that leaks text") and AC-05. Fix (KISS): enumerate the **global fixed key union** across the 10 extractors as explicit `properties` with `additionalProperties:false` on both maps (per-artifact_type conditionals NOT required — one honest union is enough); constrain each `enums` property to its fixed vocabulary `enum [..., 'other']`. Mirror the same key discipline in the TS type (a keyed interface or a `satisfies` const of allowed keys used by the extractors) so a rogue key is a compile error, and confirm OTLP kvlist attrs (`harness.artifact.counts/enums`) carry only those keys. Update tests: a payload with an un-enumerated key must FAIL schema validation (add that negative case).

## F3 · MED — inventory gaps vs workshop rows
See the review file's F3 for the specific workshop § Element inventory rows the extractors under-cover; close each named gap (or, where the review is wrong about a row, say so in your report with the workshop row cited).

## Done means
- The three findings fixed; new negative/fixture cases added.
- `just build` then `harness checks` exit 0 (hard gates green; pre-existing warn-launch degradeds tolerated).
- execution.log.md appended (fix round entry).
- Report: `pij send pij-4s10mb "<what changed per finding + checks verdict>"`. No commits.

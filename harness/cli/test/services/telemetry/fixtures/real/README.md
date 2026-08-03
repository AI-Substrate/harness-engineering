# Real-capture fixture corpus

Real harness session logs captured from a developer machine, **scrubbed** of machine
paths / identity / secrets but **keeping prompts and tool calls verbatim**, committed so
the telemetry adapters are tested against truth — not synthetic guesses.

These are **additive**: the synthetic fixtures one level up (`../claude-transcript.jsonl`
etc.) keep their hand-derived, negative-control unit assertions and are never replaced.

## Layout

```
fixtures/real/<surface>/<instance>/
  raw.<ext>              # the scrubbed pre-adapter INPUT, captured verbatim
                         #   claude        → raw.jsonl
                         #   copilot-cli   → raw.events.jsonl + raw.process.log
                         #   copilot-vscode→ raw.rows.json   (extracted rows, no message text)
                         #   cursor        → raw.jsonl [+ raw.rows.json]
                         #                   (the bubble rows exist only for IDE
                         #                    sessions; a headless CLI conversation
                         #                    has none — see 2026-08-03-applypatch-textstat)
  expected-segment.json  # the committed GOLDEN: adapter.extract → serializeSegment output
  invariants.json        # the hand-pinned, human-reviewed invariants (the per-instance
                         #   source of truth — real-capture.e2e.test.ts asserts against it)
  meta.json             # capture provenance + scrub attestation (no invariants)
```

One `<instance>` = one captured session. Add more instances **alongside** (capture is
additive); scenarios/tests choose which instance to drive.

### `meta.json` (provenance)

```jsonc
{
  "surface": "claude",            // claude | copilot-cli | copilot-vscode | cursor
  "captured_utc": "2026-06-25",   // capture date (day granularity)
  "harness": "claude-code",        // adapter harness id
  "scrubbed": true,                // scrub applied + manual "anything bad" review passed
  "scrub_categories": [ … ],       // NON-SENSITIVE attestation of what was scrubbed (no tokens)
  "note": "<one line: what this session was>"
}
```

### `invariants.json` (the hand-pinned source of truth)

Minted from the segment by `REGEN_GOLDEN=1`, then **human-reviewed** and committed; the
E2E asserts the live segment matches it (no values duplicated as test constants):

```jsonc
{
  "token_grand_total": 1019867,
  "token_total": 1019867,
  "subagent_tokens": 0,
  "user_prompts": [ … ],
  "prompt_count": 7,
  "event_count": 30,
  "event_stream_present": true,   // real captures are TIMESTAMPED → exercises the
  "timestamps": "exact"           //   event_stream path synthetics never hit. Claude
}                                  //   stamps are EXACT (no t_precision); `anchored` is
                                   //   only for APPROXIMATED stamps (cursor/flow).
```

## The two privacy guards

1. **Serializer allowlist** (`serializeSegment`) protects the *output* golden — it never
   spreads input, so a planted secret can't reach the segment.
2. **Raw-fixture byte-scan** (`fixture-privacy-scan.test.ts`) is the *only* guard on the
   committed `raw.*` input — it scans the committed BYTES of every instance artifact
   (raw, golden, invariants, meta) for `/Users/`, Windows paths (JSON-doubled *and*
   plain-text variants), emails, api-key shapes (shared with `fixture-scrub`), and identity
   tokens. Generic markers are durable on CI; capture-time identity tokens are scanned via
   the runtime env or an explicit `HARNESS_FIXTURE_SCRUB_TOKENS` denylist (never committed)
   plus the manual review.

A captured fixture is only committed after the **manual "anything bad" review** (these land
in a public repo, permanently in git history). The capture tool stages to a gitignored
`scratch/` first; promotion to this dir happens only on scrub-pass + human sign-off.

See the runbook (Phase 3: `docs/how/telemetry-fixtures.md`) for the capture workflow.

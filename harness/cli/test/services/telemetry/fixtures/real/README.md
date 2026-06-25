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
                         #   cursor        → raw.jsonl + raw.rows.json
  expected-segment.json  # the committed GOLDEN: adapter.extract → serializeSegment output
  meta.json             # capture provenance + hand-pinned invariants (see below)
```

One `<instance>` = one captured session. Add more instances **alongside** (capture is
additive); scenarios/tests choose which instance to drive.

### `meta.json`

```jsonc
{
  "surface": "claude",            // claude | copilot-cli | copilot-vscode | cursor
  "captured_utc": "2026-06-25",   // capture date (day granularity)
  "harness": "claude-code",        // adapter harness id
  "scrubbed": true,                // scrub applied + manual "anything bad" review passed
  "note": "<one line: what this session was>",
  "invariants": {                  // hand-pinned, asserted by real-capture.e2e.test.ts
    "token_grand_total": 0,
    "prompt_count": 0,
    "event_stream_present": true,  // real captures are TIMESTAMPED → exercises the
    "t_precision": "anchored"      //   anchored event_stream path synthetics never hit
  }
}
```

## The two privacy guards

1. **Serializer allowlist** (`serializeSegment`) protects the *output* golden — it never
   spreads input, so a planted secret can't reach the segment.
2. **Raw-fixture byte-scan** (`fixture-privacy-scan.test.ts`) is the *only* guard on the
   committed `raw.*` input — it scans the committed BYTES of both the raw fixture and the
   golden for `/Users/`, `C:\`, usernames, api-key shapes, and configured names.

A captured fixture is only committed after the **manual "anything bad" review** (these land
in a public repo, permanently in git history). The capture tool stages to a gitignored
`scratch/` first; promotion to this dir happens only on scrub-pass + human sign-off.

See the runbook (Phase 3: `docs/how/telemetry-fixtures.md`) for the capture workflow.

<!-- foundations: patterns-that-work#P10, first-principles#48, #51 -->

# Harness Friction Log Compatibility Summary

Canonical harness friction and improvement records live in `docs/harness`.

If this file is generated under `harness/state/`, it is a compatibility summary or pointer only. Do not append authoritative raw session buffers or retros here.

Use the runtime observe/retro flow instead:

```txt
docs/harness/_buffers/<agent>.session-buffer.md
docs/harness/agents/<agent>/<date>/*.retro.md
docs/harness/<thing>/<slug>
```

The harness ledger is an improvement backlog, not a diary.

Record material friction that made the repo harder to enter, run, validate, observe, prove, or improve through `docs/harness`.

Prioritise entries that are recurring, severe, stale, or easy to encode.

## Open entries summary

<!-- USER CONTENT START -->
_No compatibility summary entries yet. See `docs/harness` for canonical records._
<!-- USER CONTENT END -->

## Entry template

```md
### YYYY-MM-DD — <short title>

- Status: open | planned | encoded | dismissed
- Severity: blocker | degrading | annoying
- Recurrence: first-seen | repeated | frequent
- Layer: instructions | tools | environment | state | feedback | validation | signal | product
- What happened:
- Evidence:
- Workaround used:
- Candidate encoded fix:
- Human decision needed:
- Next action:
```

Required fields: **status, severity, recurrence, layer** plus at least one of {candidate encoded fix, next action}. Entries that name only "what happened" without proposing a fix are diary, not friction-log. Promote them once a candidate fix exists.

## Magic-wand prompt

At the end of meaningful work, ask:

> If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, higher quality, or better proven? Be concrete — name a command, flag, output field, fixture, diagnostic, template, sensor, check, or workflow change.

Then ask:

> What did the agent or reviewer have to infer that the harness should have proved?

Route the reviewed answer through `docs/harness` with a `magicWandTarget` annotation: `project` (the answer is about the product itself), `harness` (the answer is about this harness — most likely to be encoded), or `agent` (the answer is about the model runtime — usually out of this repo's reach).

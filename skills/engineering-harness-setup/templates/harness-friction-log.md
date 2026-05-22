<!-- foundations: patterns-that-work#P10, first-principles#48, #51 -->

# Harness Friction Log

This is an improvement backlog, not a diary.

Record material friction that made the repo harder to enter, run, validate, or improve.

Prioritise entries that are recurring, severe, stale, or easy to encode.

## Open entries

<!-- USER CONTENT START -->
_No entries yet._
<!-- USER CONTENT END -->

## Entry template

```md
### YYYY-MM-DD — <short title>

- Status: open | planned | encoded | dismissed
- Severity: blocker | degrading | annoying
- Recurrence: first-seen | repeated | frequent
- Layer: instructions | tools | environment | state | feedback | validation | product
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

> If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, or higher quality? Be concrete — name a command, flag, output field, fixture, diagnostic, template, or workflow change.

Append the answer here with a `magicWandTarget` annotation: `project` (the answer is about the product itself), `harness` (the answer is about this harness — most likely to be encoded), or `agent` (the answer is about the model runtime — usually out of this repo's reach).

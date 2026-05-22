<!-- foundations: first-principles#37, patterns-that-work#P10 -->

# Known Difficulties

This file lists recurring project difficulties that a fresh human or agent should know at boot.

Keep this file capped and useful. If an entry recurs, promote it into a harness command, check, fixture, diagnostic, or clearer error. The friction-log is where new difficulties arrive; this file is where stable, *active* difficulties live until they are encoded away.

## Active known difficulties

<!-- USER CONTENT START -->
_No known difficulties recorded yet._
<!-- USER CONTENT END -->

## Entry format

```md
### <short name>

- Status: active | mitigated | encoded | obsolete
- Layer: instructions | tools | environment | state | feedback | validation | product
- Symptom:
- Current workaround:
- Candidate encoded fix:
- Related harness command or file:
```

## Lifecycle

- **active** → still bites people; documented here as a temporary shield.
- **mitigated** → the workaround is well-known; the entry is still useful until a harness fix lands.
- **encoded** → a harness command, check, fixture, or diagnostic now prevents this; the entry is a tombstone explaining what used to hurt.
- **obsolete** → the underlying cause is gone; delete the entry on the next review.

Stale **active** entries are a signal that the harness is not closing the loop.

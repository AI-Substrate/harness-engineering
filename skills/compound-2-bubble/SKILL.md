---
name: compound-2-bubble
description: Session-end triage for the compounding-value loop. Reads docs/compound/_buffers/<agent>.session-buffer.md, presents one soft prompt if non-empty, saves selected friction/signal entries as durable retros, and clears the buffer.
---
# compound-2-bubble

Run this skill at the end of meaningful work or at a logical pause. It is the one normal user-facing surface of the compound loop.

If the buffer is empty, be silent. If `docs/compound/.disabled` exists, no-op silently.

---

## When to run

- End of an engineering session.
- End of a plan phase or implementation checkpoint.
- Before a handover.
- Before a merge/review close-out.
- Start of a new session if a prior buffer is non-empty.
- Manually whenever the user asks to review captured friction.

Never prompt repeatedly for the same buffer. Once drained, a second run on the same state should be silent.

---

## Step 1: Read the buffer

Path:

```txt
docs/compound/_buffers/<agent>.session-buffer.md
```

If missing or empty, exit silently.

If non-empty, parse the YAML list entries. Skip malformed entries with a warning only if needed; do not let one bad entry corrupt the whole bubble.

---

## Step 2: Present one soft prompt

Use a compact prompt:

```txt
compound - 4 entries from this session:

1. [difficulty/observe] Health check failed without dependency-level diagnosis
   encode as: add failure category to health output

2. [magic-wand/tooling] A single boot-and-health command would shorten startup
   encode as: harness command or just recipe

3. [signal-gap/architecture] Architecture boundary was review-only, not checked
   encode as: lint rule, CodeQL query, or harness arch command

4. [insight/docs] AGENTS.md pointed at the harness correctly
   encode as: no action unless repeated

[s]elect save  [t]ask  [p]lan  [e]ncode  [d]ismiss  [a]ll-save
Default: all-save
```

Actions:

| Action | Meaning |
|---|---|
| `a` all-save | Save all entries to one durable retro and clear the buffer. Default. |
| `s` select save | Save selected entries, discard the rest, clear the buffer. |
| `t` task | Print copy-pasteable task/fix prompts for encodable entries, save entries, clear buffer. |
| `p` plan | Print copy-pasteable plan prompts for larger work, save entries, clear buffer. |
| `e` encode | Stage suggested diffs or concrete edit instructions for review; save entries as suggested; clear buffer. |
| `d` dismiss | Drop entries and clear the buffer. |

Do not auto-apply fixes.

---

## Step 3: Save durable retro

Write one file:

```txt
docs/compound/agents/<agent>/<YYYY-MM-DD>/T<HH-MM-SS>Z-<hash>.retro.md
```

Shape:

```yaml
---
schema_version: "1.0"
retro_id: "2026-05-26T00-00-00Z-github-copilot-ab12cd"
agent: github-copilot
plan_id: "002-engineering-harness-setup-skill"
started_at: "2026-05-26T00:00:00Z"
ended_at: "2026-05-26T00:30:00Z"
summary: "compound-2-bubble save (4 entries)"
system:
  compound:
    bubble_action: "all-save"
---

entries:
  - id: DL-001
    kind: difficulty
    description: "..."
    target: observe
    system:
      compound:
        status: open
```

Plan ID detection:

1. If cwd is under `docs/plans/<slug>/`, use that slug.
2. Else if git branch starts with a plan slug, use the branch.
3. Else use `null`.

After saving, truncate the buffer to empty. Keep the file path.

---

## Encode action rule

For `[e]ncode`, stage suggestions for review only. If creating a patch under `scratch/encode-<id>-<target>.diff`, include a validation footer:

```md
## Validation

Run:
  <command>

Expected:
  - <observable outcome>

Compound lifecycle:
  <entry-id> transitions system.compound.status: suggested -> encoded when this lands.
  resolved_by: <commit-sha-after-land>
```

The footer makes "encoded" mean the loop changed and has a proof path.

For signal-gap, sensor-gap, or weak-back-pressure entries, suggested encodings should name the smallest deterministic signal that would have changed the prior run. Examples:

| Gap | Encoding candidate |
|---|---|
| Agent could not inspect the website | `harness run observe`, Playwright smoke, screenshot/evidence path |
| Human caught the same architecture issue again | lint rule, custom static check, CodeQL query, `harness run arch` |
| Tests passed but the app failed a user flow | `harness run smoke` for the core journey |
| Error required log spelunking | structured diagnostic field or dependency-level health output |

---

## What this skill does not do

- No mid-session prompting.
- No auto-applying fixes.
- No global harvest or clustering.
- No status mutation after save. `compound-3-harvest` owns curation.

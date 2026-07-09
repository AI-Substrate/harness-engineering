# Orchestrator — planted-friction scenario

Drive a BLIND subject peer through the task in `scenario.json`. The subject must
not see this file, the assertions, or the nature of the planted friction.

## Setup (before the subject starts)

1. Create the subject worktree from `base.ref`.
2. Copy `planted/broken-check.sh` into the worktree root as `broken-check.sh`
   (`chmod +x`). This is the **planted misleading error**: it fails with a message
   blaming the subject's feature when the real cause is its own hard-coded path.
3. Hand the subject only `prompts/subject.md`.

## What this scenario measures

The environment-first posture under a misleading environment failure:

- **Friction → observe/fix within the phase** (A2): the subject captures the
  misleading error with `harness observe` the moment it bites — or fixes the
  helper (small + reversible) — rather than apologising and routing around it.
- **Drain format + dispositions recorded** (A5–A9): the phase-end drain is
  recommendation-led and writes a retro record whose entries each carry a
  `disposition` (schema 1.2), **including at least one `declined` and one
  `deferred`** — the headline promise that declines are recorded, not dropped.

Score with `harness flow-eval` against `assertions.json` once the subject session
completes. The judge (`A10`) reviews the produced retro record artifact only.

# Original ask — harness-flow-hooks
**Captured**: 2026-06-16T22:06:51Z  ·  **By**: /the-flow

> lets prep a flow for this wrk, make it first clas. do research, then build the plan then run the validation skill, all without stopping to ask. then surfgace any workshops needed.

**Context (the "work" being prepped)** — a design conversation that landed a concrete shape:
re-map `eng-harness-flow` to expose its loop as **four neutral lifecycle "hooks"** —
`pre-flight` · `pre-coding` · `coding` · `post-coding` — that host flows call, with:
- `--hooks [--json]` — a discovery **manifest** the router advertises (turns the S3 "inject" rung into a handshake);
- `--hook <name>` — the primary **invocation** verb, aliasing the existing `--event`;
- `--emit-injection <idiom>` — optional host-snippet generator (`make`/`ci`/`shell`/`sdd-skill`), **idiom not product** (no `the-flow` profile — it self-adapts from `--hooks`);
- `--help` — a concise, print-and-stop program-style usage block.

Constraints: keep it **neutral from `the-flow`**; keep the skill **lean** (no bloat — `--help` should *replace* longhand prose, not add to it); grow the **n** behind each hook, never the hook count.

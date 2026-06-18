# Extending the Harness

> **Author your own `harness` verb.** For when the supported path is missing a command. ~5 min.

The harness is meant to grow. When you find yourself reaching for a raw shell command again and again — to boot, seed, smoke-test, or check something — that is the signal to encode it as an extension ([10 · Encoding & Learning Loops](10-encoding-and-learning-loops.md)).

## The fast path
```bash
harness new boot --wrap "docker compose up -d && ./scripts/wait-for-ready.sh"
```
`harness new <name>` scaffolds a new extension. `--wrap "<cmd>"` wraps a command you already have, so the verb works immediately; you refine from there. Add `--js` for a JavaScript entry instead of TypeScript. Your new verb shows up in `harness help` and `harness doctor` right away.

## Where extensions live
Each extension is a small package under `.harness/extensions/<name>/`:
- an entry file (`extension.ts` or `.js`) — what the verb does;
- an `instructions.md` — how an agent should use the verb.

They are discovered at runtime and committed with your repo ([06 · Repo Layouts](06-repo-layouts.md)).

## The guided path
Prefer to be walked through it? The `/eng-harness-flow` router can run the `add-extension` skill, which guides you from "what do you need?" to a working, wired-up verb — handy for your first one.

## The full author contract
This page is the orientation. The actual contract — the verb interface, structured output, exit codes, and safety rules — lives in one place, so it never drifts:
- [`docs/how/extend-the-harness.md`](../how/extend-the-harness.md) — the how-to;
- `harness docs authoring-verbs` — the author contract, straight from the CLI.

## Where next
- Keeping core and extensions current → [13 · Maintaining the Harness](13-maintaining-the-harness.md).

---

<sub>[← Prev: Backpressure Patterns](11-backpressure-patterns.md) · [↑ Start Here](README.md) · [Next: Maintaining the Harness →](13-maintaining-the-harness.md)</sub>

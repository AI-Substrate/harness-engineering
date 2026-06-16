---
name: eng-harness-0-add-extension
description: Scaffold and validate a new harness extension — the encoding move of the harness loop, turning inferred knowledge into a runnable, discoverable part of the repo's deterministic layer. Reuses already-gathered intent (spec/plan/workshop/conversation) when it is obvious, otherwise asks; calls `harness new` to create a loadable extension skeleton in .harness/extensions/, fills the verb handler from that intent, and verifies with `harness doctor`/`harness help`.
---
# eng-harness-0-add-extension

Add a new `harness <verb>` extension to the current repo with near-zero friction.
The deterministic scaffolding is owned by the CLI (`harness new`); this skill owns
the **judgement**: figure out what verb the user wants, scaffold it, fill the
handler, and prove it loaded.

This is the **encoding move** — the moment a piece of inferred knowledge (a
weird boot sequence, an eyeballed check, a tribal command) becomes a runnable
part of the repo's **deterministic layer**, discoverable by every future agent
and human via `--help`. Each extension makes that layer a little more
first-class and the next session a little cheaper.

> **Stay thin.** If the wanted extension is obvious from context, just build it.
> If it is ambiguous, ask one short question. Do **not** build an elaborate
> context-ranking system — obvious → use it, ambiguous → ask.

## Inputs you need (and where to get them)

A verb needs three things. Gather them in this order, stopping as soon as it's clear:

1. **From the live conversation / a spec / plan / workshop** — if the user (or an
   in-flight spec-driven flow) already described the extension, use that. e.g. a
   spec that says "add a `ci-smoke` verb that runs `just ci-smoke`" gives you the
   name *and* the wrapped command.
2. **Ask only what's still missing.** Typically just:
   - **name** — the verb (`harness <name>`); lowercase, hyphenated.
   - **what it does** — either *wrap a real repo command* (most common — the
     harness's "wrap, don't rebuild" principle) or *custom logic*.
   - (optional) **TypeScript or plain JS** — default TypeScript.

If everything is obvious, skip the questions entirely.

## Steps

### 1. Scaffold with `harness new`

Run the CLI scaffolder (it writes a valid, loadable stub — never start from a
blank file):

```bash
# wrap a real command (most common):
harness new <name> --wrap "<command>"      # e.g. harness new ci-smoke --wrap "just ci-smoke"

# minimal custom-logic stub:
harness new <name>

# plain JavaScript instead of TypeScript:
harness new <name> --js
```

The extension lands as a little package at `.harness/extensions/<name>/` —
`extension.ts` (or `.js`) plus a starter `instructions.md` (the briefing for the
calling agent; author it as part of this skill, then check it with
`harness instructions <name>`). Confirm the `ok` envelope and note `data.path` +
`data.instructionsPath`. The stub already loads and returns `unconfigured`
("not built yet") until you fill it.

> `harness` is the npx-installed core. If it isn't on PATH, the repo installed it
> via `npm install github:AI-Substrate/harness-engineering` (or a local path);
> use `npx harness …` if needed.

### 2. Fill the handler from the gathered intent

Open the scaffolded file and implement `run(ctx)`:

- **Wrap variant** — the `ctx.exec(...)` body is already wired to the command you
  passed; adjust the success/error data and `next_action` if needed. Often it's
  already correct.
- **Custom variant** — replace the `ctx.unconfigured(...)` line with real logic.
  Use the `ctx` helpers: `ctx.ok(data)`, `ctx.degraded(data, next_action)`,
  `ctx.error(code, message, { next_action })`, `ctx.unconfigured(next_action)`.
  Read inputs from `ctx.options`/`ctx.args`; reach the filesystem/git/env via
  `ctx.fs`/`ctx.git`/`ctx.env` (never import `node:*` directly).

See [authoring-verbs.md](https://github.com/AI-Substrate/harness-engineering/blob/main/harness/cli/docs/authoring-verbs.md)
(and [extend-the-harness.md](https://github.com/AI-Substrate/harness-engineering/blob/main/docs/how/extend-the-harness.md))
for the full contract.

### 3. Verify — show the proof

Never claim success without checking. Run and surface the output:

```bash
harness doctor          # the new extension must show `loaded` (not failed/conflict)
harness help            # the verb must appear in the list
harness <name> --help   # usage renders
harness <name>          # invoke it — ok (filled) or unconfigured exit 2 (still a stub)
```

Report to the user: the path created, that `doctor` shows it loaded, and the
result of invoking it.

### 4. Record the change (best-effort)

Once the extension verifies, log it as a `harness-change` record so the
changelog reflects what was added:

```bash
harness record harness-change --slug <name>
# change_type: new-command (or sensor) · target: the verb/recipe added · resolves: why it was added
```

Optional and non-blocking — if the harness isn't configured the command exits
`unconfigured` (exit 2) and nothing else changes. Skip it for throwaway or
experimental extensions.

## Guardrails

- **Reserved names**: `help`, `doctor`, `new` are core commands — `harness new`
  will reject them (E151). Pick another name.
- **`--wrap` is for simple `cmd arg arg` commands** (v1). For anything with
  quotes, pipes, or shell operators, scaffold without `--wrap` and write the
  `ctx.exec(...)` calls by hand.
- **Don't overwrite by accident**: `harness new` refuses an existing file unless
  `--force`.
- **Trust model**: extensions run with full Node privileges (like an ESLint
  plugin). Only add extensions you'd run anyway.

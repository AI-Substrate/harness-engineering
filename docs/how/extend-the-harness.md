# Extend the harness

How to add a new `harness <verb>` command to your repo — the fast path
(`harness new`) and the guided path (the `eng-harness-0-add-extension` skill).

> **Where docs live (for now):** user guides live under `docs/how/`. Documentation
> is planned to become a first-class, CLI-surfaced concept later; this guide is
> written standalone so it can be promoted/indexed without moving.

---

## The model in one minute

The harness core (installed via `npx`) ships a few built-in commands —
`help`, `doctor`, `new`, `docs`, `skills`, and `record`. **Every other command is an extension** you add
to your own repo:

```
<your repo>/
└── .harness/
    └── extensions/
        └── greet.ts        ← a file that default-exports a HarnessVerb → `harness greet`
```

The core discovers `.harness/extensions/` at runtime and turns each verb into a
top-level `harness <verb>` command with its own `--help`, options, structured
output, and exit code.

---

## Fast path: `harness new`

`harness new` scaffolds a new extension file that is **immediately loadable** —
it shows up in `harness help`/`harness doctor` right away and honestly reports
`unconfigured` ("not built yet") until you implement it.

```bash
harness new <name>                       # minimal TypeScript stub
harness new <name> --wrap "<command>"    # a stub that wraps a real repo command
harness new <name> --js                  # a plain-JavaScript stub (JSDoc contract)
harness new <name> --force               # overwrite an existing file
```

### What gets created, and where

| Command | Writes | Body |
|---------|--------|------|
| `harness new greet` | `.harness/extensions/greet.ts` | minimal stub → `ctx.unconfigured(...)` |
| `harness new greet --js` | `.harness/extensions/greet.js` | minimal stub, JSDoc contract, no runtime import |
| `harness new test --wrap "npm test"` | `.harness/extensions/test.ts` | wraps `npm test` via `ctx.exec('npm', ['test'])` |
| `harness new test --wrap "npm test" --js` | `.harness/extensions/test.js` | wrap body, plain JS |

The file lands at `<cwd>/.harness/extensions/<name>.<ext>` (the folder is created
if missing). The success Envelope reports the path:

```bash
$ harness new greet
{"command":"new","status":"ok","timestamp":"…","data":{"path":".harness/extensions/greet.ts","verb":"greet","variant":"minimal-ts"}}
```

### Naming rules

- Lowercase, hyphenated, starting with a letter: `greet`, `ci-smoke`. (Invalid
  names — uppercase, leading digit, spaces, path separators — are rejected, `E150`.)
- `help`, `doctor`, `new`, `docs`, `skills`, and `record` are reserved core commands and can't be used (`E151`).
- `harness new` won't overwrite an existing file (`E152`) unless you pass `--force`.

### Then: implement it

Open the file and fill `run(ctx)`. The minimal stub:

```ts
import type { HarnessVerb } from 'harness-engineering/contract';

const greet: HarnessVerb = {
  name: 'greet',
  summary: 'TODO: one-line summary of what `harness greet` does.',
  run(ctx) {
    return ctx.unconfigured('Implement run() in .harness/extensions/greet.ts');
  },
};

export default greet;
```

Replace the `ctx.unconfigured(...)` line with real logic using the `ctx` helpers
(`ctx.ok`, `ctx.degraded`, `ctx.unconfigured`, `ctx.error`, `ctx.exec`, `ctx.fs`,
`ctx.git`, `ctx.env`). The full contract is in
[`harness/cli/docs/authoring-verbs.md`](../../harness/cli/docs/authoring-verbs.md).

### Wrap, don't rebuild

The most valuable extensions wrap a command your repo already has. `--wrap`
writes that for you:

```bash
$ harness new ci-smoke --wrap "just ci-smoke"
# → .harness/extensions/ci-smoke.ts whose run() calls ctx.exec('just', ['ci-smoke'])
```

`--wrap` supports a simple `cmd arg arg` line. For commands with quotes, pipes,
or shell operators, scaffold without `--wrap` and write the `ctx.exec(...)` calls
by hand.

---

## Guided path: the `eng-harness-0-add-extension` skill

If you're working with an agent, the **`eng-harness-0-add-extension` skill** does the whole
flow for you: it reuses any intent already gathered (a spec/plan/workshop or the
conversation), runs `harness new`, fills the handler, and verifies. It only asks
when something is genuinely unclear. See
[`skills/eng-harness-setup/eng-harness-0-add-extension/`](../../skills/eng-harness-setup/eng-harness-0-add-extension/).

---

## Verify it loaded

After creating (and filling) an extension:

```bash
harness doctor          # the extension shows `loaded` (or `failed`/`conflict` with the reason)
harness help            # the verb appears in the command list
harness <verb> --help   # usage for the verb
harness <verb>          # run it — `ok` once filled, or `unconfigured` (exit 2) while it's a stub
```

Exit codes are part of the contract: `0` ok/degraded, `1` error, `2`
unconfigured.

---

## Safety

Extensions are arbitrary code with full Node privileges — the same trust model as
ESLint/Vite plugins. A broken extension is isolated (reported by `doctor` as
`failed`/`E140`, never crashing the others). To skip extensions entirely, use
`harness --no-extensions <cmd>` or `HARNESS_NO_EXTENSIONS=1`.

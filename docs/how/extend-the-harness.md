# Extend the harness

How to add a new `harness <verb>` command to your repo — the fast path
(`harness new`) and the guided path (the `add-extension` verb, reached via `/eng-harness-flow`).

> **Where docs live (for now):** user guides live under `docs/how/`. Documentation
> is planned to become a first-class, CLI-surfaced concept later; this guide is
> written standalone so it can be promoted/indexed without moving.

---

## The model in one minute

The harness core (installed via `npx`) ships a few built-in commands —
`help`, `doctor`, `instructions`, `new`, `docs`, `skills`, and `record`.
**Every other command is an extension** you add to your own repo. An extension
is a **little package**: a folder under `.harness/extensions/` with two
convention-required files and any internals it wants:

```
<your repo>/
└── .harness/
    └── extensions/
        └── greet/
            ├── extension.ts      ← default-exports a HarnessVerb → `harness greet`  (required)
            ├── instructions.md   ← the agent briefing for this verb               (required)
            └── lib/…             ← free-form internals, imported relatively        (optional)
```

The core discovers `.harness/extensions/` at runtime and turns each folder's
verb into a top-level `harness <verb>` command with its own `--help`, options,
structured output, and exit code. Within a folder the entry resolves in this
order: `package.json` `harness.extensions[]` manifest → `extension.ts` →
`extension.js` → `index.ts` → `index.js` (`.tsx`/`.mjs`/`.cjs` entries are
reachable only via the manifest). Internals (`lib/*.ts`, subfolders) are
imported with ordinary relative imports — the loader resolves them.

**Flat files are not supported.** A loose `.harness/extensions/<name>.ts` is
rejected at discovery (`E143`) and `harness doctor` tells you exactly what to
do: move it to `<name>/extension.ts`.

---

## Agent instructions: the `instructions.md` briefing

Each extension carries an `instructions.md` beside its entry — a **briefing
for the calling agent**, not a human README. The split it encodes: *the verb
brings the determinism, the agent brings the inference.* The file states what
the verb computes deterministically, what role the agent plays around that
output, and what judgment is expected back.

- **Audience**: the agent about to run the verb. Write it second-person,
  operational.
- **Convention name**: exactly `instructions.md`, one per extension folder.
  Multi-verb extensions share their folder's single briefing.
- **Served by**: `harness instructions <verb>` — the whole file, verbatim,
  **read from disk at every invocation**. Edit it any time; the next call
  serves the new content, no rebuild.
- **Discoverable via**: `harness help --json` (per-verb `has_instructions`)
  and bare `harness instructions` (the baked core briefing +
  `verbs_with_instructions[]`).
- **Enforced by**: `harness doctor` — a loaded extension without
  `instructions.md` still runs, but doctor wails: a per-extension complaint
  (`E144`), an author-this `next_action`, and an overall `degraded` envelope
  (still exit 0).

> **Not minih.** If you also run [minih](https://github.com/AI-Substrate/minih)
> workers, note the distinction once and keep it: a minih agent folder's
> `prompt.md`/`instructions.md` configure the **worker inside the minih
> runtime**. A harness extension's `instructions.md` briefs the **calling
> agent operating the CLI from the outside**. Same filename, different
> audience — never copy one into the other.

A good starter shape (what `harness new` scaffolds for you):

```markdown
# `harness <verb>` — agent briefing

## What this verb computes (the deterministic part)
## Your role (the inference part)
## Watch out for
```

---

## Fast path: `harness new`

`harness new` scaffolds a new extension **package** that is immediately
loadable — it shows up in `harness help`/`harness doctor` right away and
honestly reports `unconfigured` ("not built yet") until you implement it.

```bash
harness new <name>                       # minimal TypeScript stub
harness new <name> --wrap "<command>"    # a stub that wraps a real repo command
harness new <name> --js                  # a plain-JavaScript stub (JSDoc contract)
harness new <name> --sub reset,seed      # a stub with nested subverbs
harness new <name> --sensor              # a typed command-wrapper sensor stub
harness new <name> --force               # overwrite an existing entry file
```

> **Record types have no scaffold flag.** `--record` was retired; author a
> record-type extension by hand — see
> [record and record types](./record-and-record-types.md#author-a-new-record-type).

### What gets created, and where

| Command | Entry written | Body |
|---------|--------------|------|
| `harness new greet` | `.harness/extensions/greet/extension.ts` | minimal stub → `ctx.unconfigured(...)` |
| `harness new greet --js` | `.harness/extensions/greet/extension.js` | minimal stub, JSDoc contract, no runtime import |
| `harness new test --wrap "npm test"` | `.harness/extensions/test/extension.ts` | wraps `npm test` via `ctx.exec('npm', ['test'])` |
| `harness new db --sub reset,seed` | `.harness/extensions/db/extension.ts` | a verb with nested `reset`/`seed` subverb stubs |
| `harness new lint-speed --sensor` | `.harness/extensions/lint-speed/extension.ts` | a typed command-wrapper sensor stub |

Every variant ALSO writes a starter `.harness/extensions/<name>/instructions.md`
(a guided TODO addressed to the calling agent). `--force` replaces the entry
file but never clobbers an authored `instructions.md`. The success Envelope
reports both paths:

```bash
$ harness new greet
{"command":"new","status":"ok","timestamp":"…","data":{"path":".harness/extensions/greet/extension.ts","instructionsPath":".harness/extensions/greet/instructions.md","verb":"greet","variant":"minimal-ts"}}
```

### Naming rules

- Lowercase, hyphenated, starting with a letter: `greet`, `ci-smoke`. (Invalid
  names — uppercase, leading digit, spaces, path separators — are rejected, `E150`.)
- `help`, `doctor`, `new`, `docs`, `skills`, `record`, and `instructions` are
  reserved core commands and can't be used (`E151`).
- `harness new` won't overwrite an existing entry file (`E152`) unless you pass `--force`.

### Then: implement it (and author the briefing)

Open `extension.ts` and fill `run(ctx)`. The minimal stub:

```ts
import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

const greet: HarnessVerb = {
  name: 'greet',
  summary: 'TODO: one-line summary of what `harness greet` does.',
  run(ctx) {
    return ctx.unconfigured('Implement run() in .harness/extensions/greet/extension.ts');
  },
};

export default greet;
```

Replace the `ctx.unconfigured(...)` line with real logic using the `ctx` helpers
(`ctx.ok`, `ctx.degraded`, `ctx.unconfigured`, `ctx.error`, `ctx.exec`, `ctx.fs`,
`ctx.git`, `ctx.env`). The full contract is in
[`harness/cli/docs/authoring-verbs.md`](../../harness/cli/docs/authoring-verbs.md).

Then replace the TODOs in `instructions.md` with the real briefing — what the
verb computes, the judgment expected back, the traps. `harness instructions
<name>` is how you (or any agent) check it reads well.

As the extension grows, split internals into the folder freely:

```
.harness/extensions/ci-smoke/
├── extension.ts          # entry — imports './lib/report.ts'
├── instructions.md
└── lib/
    └── report.ts
```

### Wrap, don't rebuild

The most valuable extensions wrap a command your repo already has. `--wrap`
writes that for you:

```bash
$ harness new ci-smoke --wrap "just ci-smoke"
# → .harness/extensions/ci-smoke/extension.ts whose run() calls ctx.exec('just', ['ci-smoke'])
```

`--wrap` supports a simple `cmd arg arg` line. For commands with quotes, pipes,
or shell operators, scaffold without `--wrap` and write the `ctx.exec(...)` calls
by hand.

A worked, multi-tool example lives in-tree: **`harness markdown-lint`**
([`.harness/extensions/markdown-lint/`](../../.harness/extensions/markdown-lint/))
wraps three third-party tools behind **one** honest envelope — markdownlint-cli2
(style), remark-validate-links (in-repo links + heading anchors), and a headless
`mermaid.parse()` subprocess (mermaid syntax, no Chromium) — with the risk-carrying
glue (scope, fence extraction, the envelope decision) in unit-tested `lib/` and a
warn-launch posture (findings = `degraded`/exit 0). It's wired into `just fft`.

---

## Guided path: the `add-extension` verb (`/eng-harness-flow`)

If you're working with an agent, the **`add-extension` verb** — reached through the
`/eng-harness-flow` router — does the whole
flow for you: it reuses any intent already gathered (a spec/plan/workshop or the
conversation), runs `harness new`, fills the handler AND the briefing, and
verifies. It only asks when something is genuinely unclear. See
[`skills/eng-harness-flow/references/stages/add-extension.md`](../../skills/eng-harness-flow/references/stages/add-extension.md).

---

## Verify it loaded

After creating (and filling) an extension:

```bash
harness doctor               # the package shows `loaded` + convention checks (instructions.md present?)
harness help                 # the verb appears in the command list (📖 = briefing authored)
harness instructions <verb>  # the briefing serves verbatim
harness <verb> --help        # usage for the verb
harness <verb>               # run it — `ok` once filled, or `unconfigured` (exit 2) while it's a stub
```

Exit codes are part of the contract: `0` ok/degraded, `1` error, `2`
unconfigured.

---

## Safety

Extensions are arbitrary code with full Node privileges — the same trust model as
ESLint/Vite plugins (and their `instructions.md` briefings share that trust
domain — repo-trusted content, served verbatim). A broken extension is isolated
(reported by `doctor` as `failed`/`E140`, never crashing the others). To skip
extensions entirely, use `harness --no-extensions <cmd>` or
`HARNESS_NO_EXTENSIONS=1`.

# Authoring a harness verb

A **harness extension** is a TypeScript (or JavaScript) file in your repo's
`.harness/extensions/` folder that default-exports one or more **verbs**. Each
verb becomes a top-level `harness <verb>` command with its own `--help`,
options, structured Envelope output, and exit code.

> The core ships no built-in verbs. Everything you can run beyond `help`,
> `doctor`, and `new` is something an extension contributed.

> **Start here:** the fastest way to create one is `harness new <name>` — it
> scaffolds a loadable stub for you (see [`docs/how/extend-the-harness.md`](../../../docs/how/extend-the-harness.md)).
> Add `--wrap "<command>"` to wrap a real repo command, or `--js` for a plain-JS
> starter. This page documents the contract that scaffolded file follows.

## 1. Where extensions live

Discovery scans `<cwd>/.harness/extensions/` **one level deep**, in sorted name
order:

```
.harness/extensions/
├── hello.ts                 # a direct file            → loaded
├── build.js                 # a .js file               → loaded (no transpile)
├── seed/
│   └── index.ts             # a subdir with index.ts   → loaded
└── lint/
    ├── package.json         # { "harness": { "extensions": ["main.ts"] } }
    └── main.ts              # resolved via the manifest → loaded
```

- `.ts` / `.tsx` files are loaded with [jiti](https://github.com/unjs/jiti)
  (full transpile — enums, etc.); `.js` / `.mjs` / `.cjs` load via native
  `import()` (no transpile, fastest).
- If two extensions declare the same verb name, the **first (sorted) wins**; the
  duplicate is reported by `doctor` as a conflict (never silently dropped).
- `help`, `doctor`, and `new` are reserved core commands — an extension can't shadow them.
- Absent / empty folder is **not** an error: `help` says "no extensions
  installed yet".

## 2. The contract

Import the types from the published package (they're erased at runtime, so even
a plain `.js` extension can reference them via JSDoc with no runtime dependency):

```ts
import type { HarnessVerb, VerbContext, VerbResult } from 'harness-engineering/contract';
```

A verb is a declarative object:

```ts
export interface HarnessVerb {
  name: string;            // 'build' → `harness build`
  summary: string;         // one line — shown in `help` + `doctor`
  description?: string;    // longer body shown by `harness <verb> --help`
  options?: VerbOption[];  // commander-style flags: { flags: '--name <name>', description, defaultValue? }
  args?: VerbArg[];        // commander-style: { name: '<target>', description } — no variadics in v1
  run(ctx: VerbContext): VerbResult | Promise<VerbResult>;
}
```

> **v1 limitation:** positional args are single-valued — a variadic arg
> (`<files...>`) is rejected at load time (the extension is reported as `failed`
> by `doctor`) because `ctx.args` values are `string | undefined`. Use a
> repeatable option or a comma-separated value instead.

Your `run` handler receives a `VerbContext` and returns a `VerbResult`. You
never build the Envelope or call `process.exit` yourself — the kernel finalizes
your result (adds `command` + `timestamp`, maps status → exit code).

## 3. The context (`ctx`)

```ts
interface VerbContext {
  cwd: string;                                   // the repo cwd
  args: Record<string, string | undefined>;      // parsed positionals, by arg name
  options: Record<string, unknown>;              // parsed flags, by camelCased name

  // Wrap a REAL repo command (the point of a verb — "wrap, don't rebuild"):
  exec(command: string, args?: string[], opts?: { cwd?: string }): Promise<ExecResult>;
  //   → { code, stdout, stderr, ok }   (cwd defaults to ctx.cwd; never throws)

  fs:   { exists(p): boolean; readText(p): string | null; readdir(p): string[] };
  env:  { get(name): string | undefined };
  git:  { isRepo(): boolean; currentBranch(): string | null };
  clock:{ nowIso(): string };

  // Envelope helpers — one of these is your return value:
  ok<T>(data: T, opts?): VerbResult;                            // → exit 0
  degraded<T>(data: T, next_action: string, opts?): VerbResult; // → exit 0 (with caveats)
  unconfigured(next_action: string, opts?): VerbResult;        // → exit 2 (honest "not built yet")
  error(code: string, message: string, opts?): VerbResult;     // → exit 1
}
```

`next_action` is **required** for any non-`ok` result — the contract guarantees a
machine-readable "what to do next" on every failure.

## 4. Two worked examples

### `hello.ts` — the minimal verb

```ts
import type { HarnessVerb } from 'harness-engineering/contract';

const hello: HarnessVerb = {
  name: 'hello',
  summary: 'Say hello.',
  options: [{ flags: '--name <name>', description: 'who to greet', defaultValue: 'world' }],
  run(ctx) {
    return ctx.ok({ greeting: `hello, ${ctx.options.name}` });
  },
};
export default hello;
```

```bash
$ harness hello --name pi
{"command":"hello","status":"ok","timestamp":"…","data":{"greeting":"hello, pi"}}   # exit 0
```

### `build.ts` — wrapping a real command (the point)

```ts
import type { HarnessVerb } from 'harness-engineering/contract';

const build: HarnessVerb = {
  name: 'build',
  summary: 'Build the project (wraps `npm run build`).',
  async run(ctx) {
    const r = await ctx.exec('npm', ['run', 'build']);
    return r.ok
      ? ctx.ok({ command: 'npm run build' }, { evidence: [{ label: 'build log', none: true }] })
      : ctx.error('E1', `build failed (exit ${r.code})`, {
          details: r.stderr,
          next_action: 'Fix the build error above.',
        });
  },
};
export default build;
```

`harness build` runs `npm run build`; the exit code mirrors the child (0 on
success, 1 on failure), and the failure carries the stderr + a next action.

## 5. Trust & safety

Extensions are **arbitrary code with full Node privileges** — the same trust
model as ESLint/Prettier/Vite plugins ("if you run this repo, you already trust
its code"). There is no sandbox. Two safety affordances:

- **Per-extension isolation** — a broken extension is reported by `doctor`
  (`E140`) and skipped; the others still load. A handler that throws becomes an
  `E141` error Envelope (no raw stack), never a crash.
- **Safe mode** — `harness --no-extensions <cmd>` or `HARNESS_NO_EXTENSIONS=1`
  skips discovery entirely (core commands only).

## 6. Checking your work

```bash
harness doctor          # lists every extension: loaded / failed / conflict, with paths + errors
harness help            # lists the verbs your extensions contributed
harness <verb> --help   # the commander-generated usage for one verb
```

The fastest way to get a starter is `harness new <name>` (see
[`docs/how/extend-the-harness.md`](../../../docs/how/extend-the-harness.md)).
Copyable static starters also live in [`../examples/extensions/`](../examples/extensions/).

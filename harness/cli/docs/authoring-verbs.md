# Authoring a harness verb (v1 — still supported)

> **Compatibility contract:** v1 extensions remain supported indefinitely and
> keep their existing behavior. `harness new` now emits the v2 extension shape;
> use [Authoring extensions v2](../../../docs/how/authoring-extensions-v2.md) for
> new work. This page remains the authoritative contract for existing v1 verbs.

A **harness extension** is a TypeScript (or JavaScript) file in your repo's
`.harness/extensions/<name>/` package folder whose entry default-exports one or more **verbs**. Each
verb becomes a top-level `harness <verb>` command with its own `--help`,
options, structured Envelope output, and exit code.

> The core ships no built-in verbs. Everything you can run beyond `help`,
> `doctor`, `new`, and `docs` is something an extension contributed.

> **Starting new work?** Run `harness new <name>` for a v2 factory scaffold
> (or `--sub`, `--wrap`, or `--js`) and follow the
> [v2 guide](../../../docs/how/authoring-extensions-v2.md). This v1 page is for
> maintaining or understanding old exports; no migration is required.

## 1. Where extensions live

Discovery scans `<cwd>/.harness/extensions/` **one level deep**, in sorted name
order. Every extension is a **folder** (a little package); within it the entry
resolves manifest → `extension.ts` → `extension.js` → `index.ts` → `index.js`:

```
.harness/extensions/
├── hello/
│   ├── extension.ts         # the canonical entry      → loaded
│   └── instructions.md      # agent briefing (`harness instructions hello`)
├── build/
│   └── extension.js         # a .js entry              → loaded (no transpile)
├── seed/
│   └── index.ts             # index fallback           → loaded
├── lint/
│   ├── package.json         # { "harness": { "extensions": ["main.ts"] } }
│   ├── main.ts              # resolved via the manifest → loaded
│   └── lib/extra.ts         # free-form internals, imported relatively
└── legacy.ts                # a FLAT file              → rejected (E143; move to legacy/extension.ts)
```

- `.ts` / `.tsx` entries are loaded with [jiti](https://github.com/unjs/jiti)
  (full transpile — enums, etc.); `.js` / `.mjs` / `.cjs` load via native
  `import()` (no transpile, fastest). `.tsx`/`.mjs`/`.cjs` entries are reachable
  only via the manifest. Package-internal relative imports
  (`./lib/extra.ts`) resolve through the same loader.
- Beside the entry, the convention requires an `instructions.md` — the briefing
  for the calling agent, served verbatim by `harness instructions <verb>`.
  Missing it never blocks the verb, but `harness doctor` wails (`E144`).
- If two extensions declare the same verb name, the **first (sorted) wins**; the
  duplicate is reported by `doctor` as a conflict (never silently dropped).
- `help`, `doctor`, `new`, `docs`, `skills`, `record`, and `instructions` are reserved core commands — an extension can't shadow them.
- Absent / empty folder is **not** an error: `help` says "no extensions
  installed yet".

## 2. The contract

Import the types from the published package (they're erased at runtime, so even
a plain `.js` extension can reference them via JSDoc with no runtime dependency):

```ts
import type { HarnessVerb, VerbContext, VerbResult } from '@ai-substrate/engineering-harness/contract';
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
  exec(command: string, args?: string[], opts?: {
    cwd?: string;
    timeoutMs?: number;                            // SIGKILL at deadline; code 124
    env?: Record<string, string | undefined>;      // overlay on inherited env
  }): Promise<ExecResult>;
  //   → { code, stdout, stderr, ok }   (cwd defaults to ctx.cwd; never throws)

  fs:   { exists(p): boolean; readText(p): string | null; readdir(p): string[] };
  env:  { get(name): string | undefined };
  git:  { isRepo(): boolean; currentBranch(): string | null };
  clock:{ nowIso(): string };
  steps?: () => StepRunner;                        // additive; feature-detect

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

### `hello/extension.ts` — the minimal verb

```ts
import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

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

### `build/extension.ts` — wrapping a real command (the point)

```ts
import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

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

For new extensions, use `harness new <name>` and the
[Authoring extensions v2](../../../docs/how/authoring-extensions-v2.md) guide.
Copyable v1 examples remain in [`../examples/extensions/`](../examples/extensions/)
for maintenance and compatibility testing.

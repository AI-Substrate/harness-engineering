# Authoring extensions v2

Use the v2 extension contract for new harness commands. It gives extensions a
single package-level definition, typed factory authoring, real nested subverbs,
bounded execution, step aggregation, and an explicit API-evolution contract.
Existing v1 verbs and record exports remain supported; see the
[v1 contract](../../harness/cli/docs/authoring-verbs.md) when maintaining one.

## Start with `harness new`

```bash
harness new greet
harness new db --sub reset,seed
harness new checks --wrap "npm test"
harness new seed --js
```

Every command creates a package with an entry and an agent briefing:

```text
.harness/extensions/greet/
├── extension.ts
└── instructions.md
```

The four generated variants are:

| Command | Variant | Authoring form |
|---------|---------|----------------|
| `harness new greet` | `v2-ts` | TypeScript factory with one verb stub |
| `harness new db --sub reset,seed` | `v2-sub-ts` | TypeScript factory with real nested commands |
| `harness new checks --wrap "npm test"` | `v2-wrap-ts` | TypeScript factory wrapping a command with a timeout |
| `harness new seed --js` | `v2-js` | Plain-JavaScript bare literal; no runtime import |

`--sub`, `--wrap`, and `--js` select different starter forms and cannot be
combined. `--force` replaces the entry file but preserves an existing
`instructions.md`. The loader still accepts v1 forever, but `harness new` no
longer creates v1 exports.

## TypeScript: use `defineExtension`

```ts
import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: 'greet',
  summary: 'Greeting commands.',
  verbs: {
    greet: {
      summary: 'Greet a person.',
      options: [
        {
          flags: '--name <name>',
          description: 'Person to greet',
          defaultValue: 'world',
        },
      ],
      run(ctx) {
        return ctx.ok({ greeting: `hello, ${ctx.options.name}` });
      },
    },
  },
});
```

The factory adds `kind: 'extension'` and preserves the literal's inferred types.
It deliberately does **not** add `api`: an absent API means API 2 by contract,
not “whatever version of the core loaded this file.” TypeScript entries resolve
the factory to the running core through the loader, so a consumer repository
does not need a local package link.

A definition describes one extension package:

```ts
interface ExtensionDefinition {
  kind: 'extension';
  api?: number; // absent => 2
  name: string;
  summary: string;
  description?: string;
  verbs?: Record<string, VerbDecl>;
  records?: Record<string, RecordDecl>;
  sensors?: Record<string, object>;
  custom?: Record<string, Record<string, CustomItem>>;
}
```

## Plain JavaScript: use the bare literal

JavaScript entries load through native `import()`, so they do not use the
TypeScript loader's runtime alias. Export the sanctioned literal instead:

```js
/** @type {import('@ai-substrate/engineering-harness/contract').ExtensionDefinition} */
const extension = {
  kind: 'extension',
  name: 'greet',
  summary: 'Greeting commands.',
  verbs: {
    greet: {
      summary: 'Greet a person.',
      run(ctx) {
        return ctx.ok({ greeting: 'hello' });
      },
    },
  },
};

export default extension;
```

The factory is a type-safety convenience, not a load requirement. The loader
classifies both forms by `kind: 'extension'`.

## Nested subverbs

Declare one structural level under `sub`. Do not parse a prose positional or
write a dispatch `switch`:

```ts
import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: 'db',
  summary: 'Local database loop.',
  verbs: {
    db: {
      summary: 'Database commands.',
      options: [
        { flags: '--profile <name>', description: 'Shared database profile' },
      ],
      sub: {
        reset: {
          summary: 'Reset and seed the database.',
          options: [{ flags: '--force', description: 'Bypass the safety check' }],
          args: [{ name: '<files...>', description: 'Seed files' }],
          async run(ctx) {
            const files = Array.isArray(ctx.args.files) ? ctx.args.files : [];
            return ctx.ok({ files, profile: ctx.options.profile });
          },
        },
      },
    },
  },
});
```

```bash
harness db --profile local reset --force seed-a.sql seed-b.sql
harness db reset --help
```

- Subverb options and positional args are scoped to that child command.
- Parent options are shared with children through `ctx.options`.
- A v2 variadic such as `<files...>` arrives as `string[]`. Only the v2 context
  has `Record<string, string | string[] | undefined>` args; the v1 type stays
  unchanged.
- `run` and `sub` may coexist. If `run` is absent, bare `harness db` returns the
  kernel's actionable “pick a subverb” `unconfigured` envelope.
- An unknown child returns a kernel error envelope. Nesting below one subverb
  level is rejected at load time.

## Bounded commands and environment overlays

`ctx.exec` wraps an existing project command without a shell. `cwd` defaults to
the repository root; `timeoutMs` kills a child with `SIGKILL` at the deadline
and returns code `124`; `env` overlays the inherited environment.

```ts
async run(ctx) {
  const result = await ctx.exec('npm', ['run', 'build'], {
    timeoutMs: 120_000,
    env: {
      NODE_ENV: 'production',
      REMOVE_THIS_KEY: undefined,
    },
  });

  return result.ok
    ? ctx.ok({ stdout: result.stdout })
    : ctx.error('E_BUILD', `build failed (exit ${result.code})`, {
        details: result.stderr,
        next_action: 'Fix the build output and run the command again.',
      });
}
```

The call always resolves to `{ code, stdout, stderr, ok }`; spawn failures use
code `127`, and timeouts use `124`.

## Aggregate work with `ctx.steps()`

`ctx.steps` is an additive capability, so feature-detect it when an extension
must also run on an older core. `fail()` stops only the current step; later steps
still run and `finish()` returns one rollup.

```ts
async run(ctx) {
  const steps = ctx.steps?.();
  if (!steps) {
    return ctx.unconfigured('Run `harness update` for the step-runner capability.');
  }

  await steps.run('migrate', async () => {
    const result = await ctx.exec('npm', ['run', 'migrate'], { timeoutMs: 60_000 });
    if (!result.ok) steps.fail('migration failed', { stderr: result.stderr });
  });

  await steps.run('seed', async () => {
    const result = await ctx.exec('npm', ['run', 'seed'], { timeoutMs: 60_000 });
    if (!result.ok) steps.fail('seed failed', { stderr: result.stderr });
  });

  return steps.finish({
    errorCode: 'E_DB_RESET',
    next_action: 'Fix the failed database steps, then run reset again.',
  });
}
```

The rollup includes every step's name, elapsed milliseconds, `✅`/`❌` mark,
passed/failed counts, and failure details. All-pass returns `ok`; any failure
returns `error` with the rollup in `error.details` and a non-empty
`next_action`.

## Records and reserved sections

V2 record declarations are keyed by record type. The normalizer adds the v1
`kind` and `type` fields before registration:

```ts
records: {
  decision: {
    description: 'Architecture decision record.',
    template: '---\nrecord_type: decision\n---\n',
  },
}
```

API 2 also reserves `sensors` and `custom`. Phase 1 preserves these declarations
through normalization but does not activate handlers for them. `harness doctor`
prints an explicit `declared, handler not yet active` info line; declarations
are never silently dropped.

## API evolution and honest failures

API levels govern top-level vocabulary and semantics:

- Omitted `api` means `2`.
- An extension newer than the running core fails only that extension with
  `E147`; its `next_action` tells the caller to run `harness update`.
- An unknown top-level section fails with `E148`. This catches typos and prevents
  a newer capability from being silently ignored.
- Unknown fields inside a known structure are tolerated and reported as doctor
  info. This lets compatible fields be added without churning old cores.
- Context capabilities such as `ctx.steps` are presence-detected and additive;
  they do not require an API bump.

The internal registry normalizes v1 and v2 once, then help, doctor, dispatch,
instructions, and record registration consume the same current shape. A mixed
array containing v1 and v2 entries is legal and routes each entry independently.

## Verify the package

```bash
harness doctor
harness help --json
harness instructions <verb>
harness <verb> --help
harness <verb>
```

Doctor reports `format: v1` or `format: v2 (api N)` for every discovered entry,
along with tolerant-field and reserved-section info. A load or validation
failure is isolated to its file and carries an actionable `next_action`.

Extensions are repository-trusted code with full Node privileges, like build or
lint plugins. Use `harness --no-extensions <command>` or
`HARNESS_NO_EXTENSIONS=1` when you need the core commands without loading repo
extensions.

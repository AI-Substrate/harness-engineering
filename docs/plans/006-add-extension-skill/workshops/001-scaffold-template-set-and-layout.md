# Workshop: Scaffold template set + layout

**Type**: CLI Flow / Storage Design
**Plan**: 006-add-extension-skill
**Spec**: [../add-extension-skill-spec.md](../add-extension-skill-spec.md)
**Created**: 2026-06-08
**Status**: Draft

**Value Thesis**: Pins *exactly* what `harness new` writes, *where* it writes it, and *where the template sources live* — turning three prose ideas into copy-paste-exact fixtures an implementer can TDD against and a reviewer can diff, so the build phase needs zero "what should the stub look like?" round-trips.
**Target Proof Level**: Implementation Ready
**Current Proof Level**: Contract Ready → Implementation Ready

**Selected Value Axes**:
- **Implementation Readiness**: the emitted strings below are the test fixtures — the implementer asserts byte-equality, not vibes.
- **Proof Quality**: every starter is grounded in a real, already-loading extension (`hello.ts`, `build.ts`, `greetjs.js`).
- **Safety to Change**: surfaces the one real contract change this needs — `FsPort` is read-only today and must gain write methods.
- **Cost / Attention Reduction**: the scaffolded stub is valid + honest from second zero, so authoring never starts from a broken file.

**Related Documents**:
- [005 Workshop 001 — extension contract & loader](../../005-harness-extension-system/workshops/001-extension-contract-and-loader.md) (authoritative runtime this consumes)
- [harness/cli/docs/authoring-verbs.md](../../../../harness/cli/docs/authoring-verbs.md) (the manual this scaffolder operationalizes)

---

## Purpose

Answer the three questions the user asked: **what** gets scaffolded (verbatim file contents per flag), **where** it lands (the write path + folder creation), and **where the template sources live** (in the CLI package, as pure functions). Leave behind copy-exact fixtures so `/plan-3` can table the tasks and the implementer can write the test first.

## Fresh Entrant Outcome

A fresh human or agent can use this workshop to reach **Implementation Ready** with no extra context. They can:

- Reproduce the exact bytes `harness new <name>` writes for each of the 4 flag combinations.
- Place the write at the correct path and know when the folder is created.
- Know where the template functions live and why they aren't loose files.
- Implement name validation, the error-code band, and the `FsPort` write extension.

## Key Questions Addressed

- What does each starter (minimal / `--wrap` / `--js` / `--wrap --js`) contain, verbatim?
- Where is the file written, and what folders get created?
- Where do the template *sources* live — CLI package or skill? Loose files or functions?
- What names are valid? What happens on collision / reserved / invalid name?
- What new port surface and error codes does this require?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Implementation Ready | The build phase is TDD; it needs exact expected output, not descriptions. |
| Primary Value Axis | Implementation Readiness | Templates-as-fixtures collapse the build's ambiguity to zero. |
| Supporting Value Axes | Proof Quality, Safety to Change, Attention Reduction | Grounded in real extensions; surfaces the FsPort write gap up front. |
| Downstream Loop Improved | Implementation + Review | Implementer asserts byte-equality; reviewer diffs against fixtures. |

## 1. Command surface

```
harness new <name> [--wrap <command>] [--js] [--force]
```

| Element | Meaning |
|---------|---------|
| `<name>` | The verb name → becomes `harness <name>` AND the filename. Required positional. |
| `--wrap <command>` | Emit the "wrap a real repo command" starter (a `ctx.exec(...)` body) instead of the minimal stub. The value is the command line to wrap, e.g. `--wrap "npm test"`. |
| `--js` | Emit a plain-`.js` + JSDoc starter (no runtime contract import) instead of `.ts`. |
| `--force` | Overwrite an existing file at the target path. Default: refuse. |

`new` is a **core** command (the third reserved name) — it must be added to `RESERVED_NAMES` (`{help, doctor}` → `{help, doctor, new}`) so an extension can never shadow it. Like `help`/`doctor`, it is never an extension and runs even in `--no-extensions` safe mode.

## 2. Where the file is written (layout)

```
<cwd>/
└── .harness/
    └── extensions/
        └── <name>.ts        ← written here (.js with --js)
```

- Write path: `path.join(cwd, '.harness', 'extensions', '<name>.<ext>')` where `<ext>` = `js` if `--js` else `ts`.
- `cwd` is the **same resolved cwd discovery uses** (the developer repo root) — so a freshly scaffolded file is immediately on the discovery path.
- `.harness/extensions/` is created recursively if absent (first extension in a fresh repo is the common case — must not error).
- One level deep only (matches discovery's one-level scan). v1 writes a flat `<name>.ts`, never a `<name>/index.ts` subdir form.

## 3. Where the template *sources* live (the decision)

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A — Pure functions in the CLI package** (`harness/cli/src/services/scaffold/templates.ts`) returning strings | Each variant is a function `minimalTs(name) → string`, etc. | Survives bundling + `npx` (no path-relative file reads); trivially unit-testable (assert exact string); parameter substitution is just template literals | Template text lives in code, not a `.tmpl` file | **SELECTED** |
| B — Loose `.tmpl` files shipped beside `dist/`, read at runtime + token-replaced | Templates as data files resolved via `import.meta.url` | "Templates look like the output" | Fragile under bundling/npx path resolution; needs file-read + token engine; harder to snapshot | Rejected |
| C — Templates owned by the **skill** (`skills/add-extension/templates/`) | The skill holds the starters | Keeps CLI tiny | CLI command can't stand alone without the skill; duplicates intent | Rejected for the deterministic starters |

**Boundary**: the deterministic minimal/wrap/js starters live in the **CLI** (Option A). The **skill does not duplicate them** — it calls `harness new` and then edits the result. (The skill may keep its *own* richer narrative examples for interview prompts, but those are not the scaffold source of truth.)

Proposed structure:

```
harness/cli/src/services/scaffold/
├── scaffold-service.ts     # validate name → resolve path → pick template → write (via FsPort)
└── templates.ts            # minimalTs/minimalJs/wrapTs/wrapJs (pure string builders)
harness/cli/src/acts/
└── new.ts                  # registers `harness new`, wires real adapters, finalizes Envelope
```

## 4. The emitted starters (verbatim fixtures)

> `<name>` = the given verb name (kebab-ok). `<ident>` = the camelCase of `<name>` (e.g. `ci-smoke` → `ciSmoke`) so the local `const` is always a valid JS identifier. Validation (§5) guarantees `<name>` starts with a letter, so `<ident>` is always valid.

### 4a. Minimal `.ts` (default) — `harness new greet`

```ts
import type { HarnessVerb } from 'harness-engineering/contract';

const greet: HarnessVerb = {
  name: 'greet',
  summary: 'TODO: one-line summary of what `harness greet` does.',
  // options: [{ flags: '--example <value>', description: 'an example flag' }],
  run(ctx) {
    // TODO: implement this verb. Until you do, it honestly reports "not built yet".
    return ctx.unconfigured('Implement run() in .harness/extensions/greet.ts');
  },
};

export default greet;
```

Running it immediately: `harness greet` → `{"command":"greet","status":"unconfigured",...,"next_action":"Implement run() in .harness/extensions/greet.ts"}` (exit 2). Loads in `doctor`/`help` from second zero.

### 4b. Wrap `.ts` — `harness new test --wrap "npm test"`

```ts
import type { HarnessVerb } from 'harness-engineering/contract';

const test: HarnessVerb = {
  name: 'test',
  summary: 'TODO: summary (wraps `npm test`).',
  async run(ctx) {
    const r = await ctx.exec('npm', ['test']);
    return r.ok
      ? ctx.ok({ command: 'npm test' })
      : ctx.error('E1', `npm test failed (exit ${r.code})`, {
          details: r.stderr,
          next_action: 'Fix the failure above, then re-run `harness test`.',
        });
  },
};

export default test;
```

The `--wrap` value is split on whitespace into `argv0` + rest for the `ctx.exec(argv0, [...rest])` call (`"npm test"` → `'npm', ['test']`). **v1 non-goal**: shell quoting/operators — the survey value is a plain `cmd arg arg` line; a comment in the file tells the author to edit for anything richer.

### 4c. Minimal `.js` — `harness new greet --js`

```js
/** @type {import('harness-engineering/contract').HarnessVerb} */
const greet = {
  name: 'greet',
  summary: 'TODO: one-line summary of what `harness greet` does.',
  run(ctx) {
    // TODO: implement this verb.
    return ctx.unconfigured('Implement run() in .harness/extensions/greet.js');
  },
};

export default greet;
```

Mirrors the real `greetjs.js` integration fixture: JSDoc `@type` only, **no runtime import** of the core (loads via native `import()`, zero runtime dependency on the package).

### 4d. Wrap `.js` (`--wrap "npm test" --js`)

Same body as 4b but with the JSDoc `@type` header (no `import type` line) and the `.js` `next_action` path. Flags compose: `--js` chooses the extension + comment style; `--wrap` chooses the body.

## 5. Name validation

| Rule | Valid | Invalid |
|------|-------|---------|
| Pattern `^[a-z][a-z0-9-]*$` (lowercase, start with a letter, kebab) | `greet`, `ci-smoke` | `Greet`, `2fast`, `my verb`, `a/b`, `` (empty) |
| Not a reserved core name | — | `help`, `doctor`, `new` |
| No path separators / traversal | `seed` | `../escape`, `a/b`, `a\b` |

Invalid → error Envelope, **no file written**. (Reusing the same name regex the registry expects keeps a scaffolded verb guaranteed-loadable.)

## 6. Error codes (new band E15x)

| Code | Constant | Cause | Exit |
|------|----------|-------|------|
| E150 | `SCAFFOLD_INVALID_NAME` | `<name>` fails the §5 pattern / has separators | 1 |
| E151 | `SCAFFOLD_NAME_RESERVED` | `<name>` ∈ {help, doctor, new} | 1 |
| E152 | `SCAFFOLD_FILE_EXISTS` | target file exists and `--force` not passed | 1 |
| E153 | `SCAFFOLD_WRITE_FAILED` | the write/mkdir itself failed (permissions, etc.) | 1 |

Every error carries a `next_action` (e.g. E152 → "Pass --force to overwrite, or choose another name.").

## 7. Port change required (the one real contract impact)

`FsPort` is **read-only today** (`exists` / `readText` / `readdir` — see `harness/cli/src/adapters/fs/fs-port.ts`). The scaffolder must write. Extend the port:

```ts
export interface FsPort {
  exists(path: string): boolean;
  readText(path: string): string | null;
  readdir(path: string): string[];
  // NEW — for the scaffolder:
  mkdirp(path: string): void;            // recursive create; no-op if present
  writeText(path: string, contents: string): void;
}
```

- `NodeFs` implements via `node:fs` (`mkdirSync({recursive:true})`, `writeFileSync`).
- `FakeFs` gains an in-memory write + records written files → the scaffold service is **fully unit-testable with the fake** (assert exact emitted string, no real disk). This preserves the plan 004/005 fake-driven TDD convention.

> This is the only shared-contract change. It is additive (no existing reader breaks). Flag for `/plan-3` as the one cross-cutting edit.

## 8. CLI flow

```
$ harness new ci-smoke --wrap "just ci-smoke"

┌─────────────────────────────────────────────────────────────┐
│ validate name 'ci-smoke'  → ok (matches ^[a-z][a-z0-9-]*$)   │
│ resolve path → <cwd>/.harness/extensions/ci-smoke.ts         │
│ exists? no  (or --force)                                     │
│ mkdirp <cwd>/.harness/extensions/                            │
│ render wrapTs('ci-smoke', 'just ci-smoke') → write           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
  {"command":"new","status":"ok","timestamp":"…",
   "data":{"path":".harness/extensions/ci-smoke.ts","verb":"ci-smoke","variant":"wrap-ts"}}   # exit 0

  next: `harness doctor` shows it loaded · `harness ci-smoke --help` · edit the TODOs
```

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation | "what exactly does the stub contain / where does it go?" | §4 verbatim fixtures + §2 path |
| Review | reconstruct intended output | diff actual write against §4 |
| Testing | invent expected strings + a write fake | §4 strings + §7 FakeFs write contract |
| Architecture | guess the blast radius | §7 names the one shared-port change |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| 4 verbatim starters | §4a–4d | stub validity + byte-equality tests | Ready |
| Write path + folder rule | §2 | path-resolution test | Ready |
| Templates-as-functions decision | §3 | structure of `src/services/scaffold/` | Ready |
| Name regex + reserved set | §5 | validation tests | Ready |
| E15x band | §6 | error-path tests | Ready |
| FsPort write extension | §7 | the cross-cutting contract task | Ready |

## Validation / Acceptance

Reaches Implementation Ready when:
- An implementer can write a failing test asserting the exact §4a output **before** any code exists.
- The write path and folder-creation behavior are unambiguous (§2).
- The template-source location is decided (§3 — Option A) and the FsPort change is specified (§7).

## Open Questions

### Q1: Command name `new`?
**RESOLVED (default, architect may override)**: `harness new <name>` (cargo/rails-style). Alternatives `scaffold`/`add`/`init` noted in the spec's Open Questions.

### Q2: camelCase identifier vs fixed `const verb`?
**RESOLVED**: camelCase `<name>` → `<ident>` (matches the real examples' style; validation guarantees validity).

### Q3: `--wrap` shell parsing depth?
**RESOLVED (v1)**: whitespace-split `cmd arg arg` only; quoting/operators are a documented non-goal with an in-file edit hint.

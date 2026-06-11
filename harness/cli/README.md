# harness — engineering harness CLI

The agent-friendly **front door** to this repo's engineering harness. A small, well-structured Node + TypeScript (ESM) CLI whose verbs are **owned by extensions**: each is a little package at `.harness/extensions/<name>/` (entry `extension.ts`, agent briefing `instructions.md`) and becomes a `harness <verb>` command with its own `--help`, options, structured output, and exit codes. A few commands are always built in (`help`, `doctor`, `instructions`, `new`, `docs`, `skills`, `record`); everything else is contributed by extensions you add.

> This is the **engineering harness** (the project's development loop), not an agent runtime. It studies how a human or agent can boot, run, and prove the software safely and quickly.

## Install / run

The CLI is published to **GitHub Packages** as `@ai-substrate/engineering-harness` (bin `harness`). GitHub Packages requires authentication even for public packages, so a one-time consumer setup is needed:

1. Point the `@ai-substrate` scope at GitHub Packages — add to your repo's (or `~/`) `.npmrc`:

   ```ini
   @ai-substrate:registry=https://npm.pkg.github.com
   ```

2. Authenticate with a GitHub token carrying the **`read:packages`** scope (a classic PAT, or `GITHUB_TOKEN` in CI) — either log in once:

   ```bash
   npm login --scope=@ai-substrate --registry=https://npm.pkg.github.com
   ```

   …or add the token to `.npmrc`: `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}`.

3. Install and run (Node `>= 22`):

   ```bash
   npm install @ai-substrate/engineering-harness
   npx harness doctor
   ```

The published tarball bakes in the built `dist` and declares `commander` + `jiti` as runtime dependencies, so an `--omit=dev` install resolves everything — no install-time build, no git-clone fragility. Pin a version the usual way (`@ai-substrate/engineering-harness@0.1.0`).

For local development in this repo:

```bash
npm install
npm run build
node harness/cli/dist/index.js doctor
```

## Extensions: the focal point

The core ships **no** built-in verb list. In your *own* repo, each extension is a little **package folder**:

```
<your-repo>/
└── .harness/
    └── extensions/
        ├── hello/
        │   ├── extension.ts      ← the entry (default-exports a HarnessVerb)
        │   └── instructions.md   ← the agent briefing (`harness instructions hello`)
        └── build/
            ├── extension.ts
            └── instructions.md
```

Each entry **default-exports** a `HarnessVerb` (or an array of them). The installed core discovers `.harness/extensions/` at runtime, resolves each folder's entry (manifest → `extension.ts` → `extension.js` → `index.ts` → `index.js`), loads it (`.ts`/`.tsx` via jiti, `.js` natively — package-internal relative imports like `./lib/helper.ts` just work), and registers one `harness <verb>` command per declared verb. Flat files directly under `extensions/` are rejected (`E143`) with doctor guidance.

**Quick start — install an extension** (in your repo):

```bash
mkdir -p .harness/extensions/hello
cat > .harness/extensions/hello/extension.ts <<'TS'
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
TS

harness hello --name pi      # → {"command":"hello","status":"ok","data":{"greeting":"hello, pi"}}
harness hello --help         # commander-generated usage from the verb's options
harness help                 # lists hello among the installed verbs
harness doctor               # enumerates which extensions loaded / failed (and wails if instructions.md is missing)
```

See [`docs/authoring-verbs.md`](./docs/authoring-verbs.md) for the full contract, and copyable starters in [`examples/extensions/`](./examples/extensions/).

## Command surface

| Command | What it does | Status |
|---------|--------------|--------|
| `harness help` | Explain purpose, the **dynamic verb list**, output modes, safe first actions. `help --json` is machine-readable (`data.verbs[]`). | ✅ core |
| `harness doctor` | Report readiness (toolchain, cli-build) **and enumerate the installed extensions** (loaded / failed / conflict, with paths + errors) — without invoking any verb. Safe at session start. | ✅ core |
| `harness new <name>` | Scaffold a new, immediately-loadable extension package into `./.harness/extensions/<name>/` (entry + starter `instructions.md`). | ✅ core |
| `harness docs [id]` | List the bundled, curated docs (`harness docs`), or print one verbatim to stdout (`harness docs <id>`). Offline; ships with the CLI. | ✅ core |
| `harness skills install` | Install **this harness's own skills** into a CLI — a transparent pass-through to Vercel's [`npx skills add`](https://github.com/vercel-labs/skills). Picks target(s) (`--target claude-code\|codex\|cursor\|github-copilot\|opencode\|pi`, repeatable) and scope (`--global` or project-local). **Announces the exact `npx` line before running** and always passes `-y` (the blocking picker never appears). Missing `--target` → `E108` (non-blocking). | ✅ core |
| `harness <verb> […]` | Any verb a discovered extension contributes, with its own `--help`, options, args, Envelope, and exit code. | 🧩 extension |

`help`, `doctor`, `new`, `docs`, and `skills` are **reserved** core commands — no extension can shadow them (doctor is the diagnostic that *checks* the extension system). Safe mode: `--no-extensions` or `HARNESS_NO_EXTENSIONS=1` skips discovery entirely (core commands only).

```bash
harness help --json                     # machine-readable verb map (data.verbs[])
harness doctor                          # readiness + extension enumeration
harness docs                            # list the bundled docs
harness docs extend-the-harness         # print one doc's markdown to stdout
harness skills install --target github-copilot --global   # install this harness's skills (wraps npx skills add)
harness --no-extensions help            # core-only (skip discovery)
```

## Output modes

**Most** commands emit a stable **envelope** in one of two renderings:

- **JSON** — one parseable line on stdout (for agents / pipes).
- **Human** — a readable summary on stdout, diagnostics + next action on stderr.

The one deliberate exception is `harness docs <id>`, which writes the doc's **raw
markdown** to stdout (no envelope, in both modes) so it pipes/redirects cleanly —
mirroring how a doc dump should behave. The doc **list** (`harness docs`) still
uses the envelope.

Selection precedence (highest wins):

1. `--json` / `--no-json` flag
2. `HARNESS_JSON=1` environment variable (handy in CI)
3. TTY detection — piped output → JSON, an interactive terminal → human

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | `ok` or `degraded` — the command reported successfully. |
| `1` | `error` — something failed; see `error.code` + `next_action`. No raw stack traces. |
| `2` | `unconfigured` — a verb reported it has no behaviour mapped yet. |
| `E140/E141/E142` | (in `error.code`) extension load failure / runtime throw / verb-name conflict. |
| `E160` | (in `error.code`) `harness docs <id>` — no curated doc with that id (exit 1). |

`unconfigured → 2` is deliberate: a script or agent can distinguish "not built yet" (2) from "broke" (1), and `doctor` still exits `0` because it succeeded at *reporting*.

## Envelope shape

```jsonc
{
  "command": "doctor",
  "status": "ok | error | degraded | unconfigured",
  "timestamp": "2026-06-08T07:20:00.000Z",
  "data": { /* command-specific */ },
  "error": { "code": "E120", "message": "...", "details": [/* ... */] },
  "evidence": [{ "label": "doctor report", "none": true }],
  "next_action": "Always present when status is not ok."
}
```

## Architecture

Ports & Adapters (Hexagonal): a thin commander **entrypoint** (`index.ts` → `app.ts`'s async `main`) discovers + loads extensions, then registers per-command **acts** → adapter-agnostic **services** → injected **adapters** (`fs` / `process` / `git` / `env` / `clock` / **`exec`** for wrapping real commands / a **module loader** for jiti). Extension verbs receive a `VerbContext` of those ports + envelope helpers and return a `VerbResult` the kernel finalizes. Business logic lives in services and is unit-tested through fakes with zero real I/O. See the authoritative design in [`docs/plans/005-harness-extension-system/workshops/001-extension-contract-and-loader.md`](../../docs/plans/005-harness-extension-system/workshops/001-extension-contract-and-loader.md), the output/exit contract in [`docs/plans/004-harness-core/workshops/001-output-envelope-and-exit-codes.md`](../../docs/plans/004-harness-core/workshops/001-output-envelope-and-exit-codes.md), and the authoring guide in [`docs/authoring-verbs.md`](./docs/authoring-verbs.md).

## Continuous Integration & Release

CI runs on every pull request and on pushes to `main` (`.github/workflows/ci.yml`):

- **`build-test`** — Node 22 & 24 matrix: `npm ci` → Biome check → build → `tsc --noEmit` → `vitest run --coverage` → `npm audit` (advisory). Coverage prints a text summary and uploads `harness/cli/coverage/lcov.info` as an artifact.
- **`package-smoke`** — packs the tarball, installs it into a clean temp project with `--omit=dev`, drops a real `.harness/extensions/hello/extension.ts` package fixture, and asserts the installed `harness` bin discovers + jiti-loads the verb and runs it (proving jiti resolves as a runtime dependency), plus a flat `legacy.ts` file is rejected with `E143` — the npx/bin-symlink + extension contract end-to-end.
- **`ci-required`** — a stable aggregation job that fails if any required job failed. Branch protection requires this one matrix-independent check.

**Releases** are automated with `release-please` (`.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`): conventional commits on `main` open a Release PR that bumps the version and updates `CHANGELOG.md`; merging it tags a semver release **and the `publish` job pushes `@ai-substrate/engineering-harness` to GitHub Packages** (gated on release-please actually cutting a release). A branch-dispatchable **canary** job proves the publish + authed-install path before merge (push a `canary/**` branch, or `workflow_dispatch` once the workflow is on `main`). Install from the registry — see *Install / run* above.

**Branch protection** on `main` requires the `ci-required` check to pass before merge. Applied with (requires repo admin):

```bash
gh api -X PUT repos/AI-Substrate/harness-engineering/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["ci-required"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

Verify with `gh api repos/AI-Substrate/harness-engineering/branches/main/protection`.

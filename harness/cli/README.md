# harness — engineering harness CLI

The agent-friendly **front door** to this repo's engineering harness. A small, well-structured Node + TypeScript (ESM) CLI that reports how the repo wants to be worked with, checks readiness, and exposes command *slots* that later extensions fill. Two commands genuinely work today (`help`, `doctor`); the rest are honest **`unconfigured`** stubs — they never fake success.

> This is the **engineering harness** (the project's development loop), not an agent runtime. It studies how a human or agent can boot, run, and prove the software safely and quickly.

## Install / run

No install required — run straight from the repo URL with `npx`:

```bash
npx github:AI-Substrate/harness-engineering help
npx github:AI-Substrate/harness-engineering doctor
```

`npx` clones the repo, runs the `prepare` build (`tsc` → `harness/cli/dist`), and invokes the `harness` bin (`./harness/cli/dist/index.js`). Requires Node `>= 20`.

For local development in this repo:

```bash
npm install
npm run build
node harness/cli/dist/index.js doctor
```

## Command surface

| Command | What it does | Status |
|---------|--------------|--------|
| `harness help` | Explain purpose, the command map, output modes, safe first actions. `help --json` is machine-readable (`data.slots[]`). | ✅ works |
| `harness doctor` | Report what is configured vs unconfigured (toolchain, cli-build, command-slots) with a next action per layer. Safe at session start. | ✅ works |
| `harness run <slot> [--dry-run]` | Run the command mapped to `<slot>`. Every slot is unconfigured in this slice, so this reports `unconfigured` (exit 2). `--dry-run` never executes anything. | 🟡 unconfigured |
| `harness <slot> [--dry-run]` | Convenience top-level form for `validate` / `build` / `lint` / `test` / `smoke` / `health` / `observe`. Each returns `unconfigured` (exit 2); `validate` accepts `--dry-run`. | 🟡 unconfigured |

The slots (`run`, `validate`, `build`, `lint`, `test`, `smoke`, `health`, `observe`) are a **seed set**, not a closed universe — a future extension system can fill or add slots without reshaping the core.

```bash
harness help --json                     # machine-readable command map
harness doctor                          # readiness report
harness run smoke                       # unconfigured slot → exit 2
harness run smoke --dry-run             # shows it would do nothing → exit 2
harness run                             # missing slot → E108 → exit 1
```

## Output modes

Every command emits a stable **envelope** in one of two renderings:

- **JSON** — one parseable line on stdout (for agents / pipes).
- **Human** — a readable summary on stdout, diagnostics + next action on stderr.

Selection precedence (highest wins):

1. `--json` / `--no-json` flag
2. `HARNESS_JSON=1` environment variable (handy in CI)
3. TTY detection — piped output → JSON, an interactive terminal → human

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | `ok` or `degraded` — the command reported successfully. |
| `1` | `error` — something failed; see `error.code` + `next_action`. No raw stack traces. |
| `2` | `unconfigured` — no behaviour is mapped to this slot yet. |

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

Ports & Adapters (Hexagonal): a thin commander **entrypoint** → per-command **acts** → adapter-agnostic **services** → injected **adapters** (`fs` / `process` / `git` / `env` / `clock`), each with a fake for testing. Business logic lives in services and is unit-tested through fakes with zero real I/O. See [`docs/plans/004-harness-core/workshops/002-cli-composition-pattern.md`](../../docs/plans/004-harness-core/workshops/002-cli-composition-pattern.md) and [`001-output-envelope-and-exit-codes.md`](../../docs/plans/004-harness-core/workshops/001-output-envelope-and-exit-codes.md).

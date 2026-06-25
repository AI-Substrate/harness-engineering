# `harness checks` — agent briefing

## What this verb computes (the deterministic part)

`harness checks` is this repo's **mandated quality gate** — the one command you run
**before considering work done**, and the **same command CI and the `.githooks/pre-push`
hook run** (so local and CI can't drift). It **composes** the repo's deterministic
checks into a single honest envelope (it never auto-fixes, unlike `just fft`):

| Gate | Runs | Posture |
|---|---|---|
| `tests` | `npx vitest run --coverage` (harness/cli) | **hard** — `error` on failure |
| `biome` | `npx biome check harness/cli` | **hard** — `error` on lint/format issue |
| `typecheck` | `npx tsc --noEmit -p harness/cli/tsconfig.json` | **hard** — `error` on type error |
| `check:docs` | `npm run check:docs` | **hard** — `error` on generated-docs drift |
| `check:flows` | `npm run check:flows` | **hard** — `error` on flow schema/render drift |
| `check:telemetry-fixtures` | `npm run check:telemetry-fixtures` | **hard** — `error` on golden drift |
| `arch-check` | `harness arch-check` | warn-launch — findings → `degraded` |
| `skills-check` | `harness skills-check` | **hard** — `error` on violation |
| `markdown-lint` | `harness markdown-lint` | warn-launch — findings → `degraded` |
| `windows-check` | `harness windows-check` | warn-launch — findings → `degraded` |

**Prerequisite:** the caller must `npm run build` first — `bin/harness.js` runs from
`dist/` and the drift guards need it (CI and the pre-push hook both build first;
`just checks` does too). `data` carries `{ durationMs, summary, gates[] }`, where each
gate is `{ name, status, exit, note }`.

### Verdicts

| Situation | Status | Exit |
|---|---|---|
| every gate `ok` | `ok` | 0 |
| any hard gate (`tests`/`biome`/`typecheck`/`check:*`/`skills-check`) `error` | `error` (`E_CHECKS_FAILED`) | 1 |
| only warn-launch gates `degraded`/`unconfigured` | `degraded` | 0 |
| run from outside the repo root | `unconfigured` | 2 |

## Your role (the inference part)

- On **`ok`**, the gate is green — work is safe to call done.
- On **`error`**, a hard gate failed. Read `error.details.gates` + `next_action`;
  reproduce the failing gate directly (`just test`, or `harness skills-check`) and
  fix before re-running.
- On **`degraded`**, only warn-launch gates have findings (the repo's launch
  posture — visible, non-blocking). Triage them; they don't block, but they're the
  backlog. A gate is promoted from warn → hard by changing its line in
  `checks/extension.ts`.

## Extending the gate

This is the **growth point**: add a new check (coverage, a security audit, schema
validation, a `tsc --noEmit` typecheck) by adding one gate line in
`checks/extension.ts`. Every caller — `harness checks` directly, and `harness boot`
which composes it — picks it up for free. Keep gates **read-only** (no `--write`).

## Watch out for

- **`checks` runs the test suite** — it's as slow as vitest; keep the suite fast.
- **Don't duplicate this into `boot`.** `boot` composes `harness checks`; the gate
  has exactly one definition here.
- Trust the **envelope + exit code**, never scraped prose.

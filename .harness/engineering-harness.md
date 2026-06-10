# Engineering harness — harness-engineering (this repo)

> **AGENTS START HERE → `npx harness instructions`** — the CLI's baked agent
> briefing (envelope contract, role split, discovery loop). Then
> `npx harness instructions <verb>` for each verb you'll use. `harness help`
> and `harness doctor --json` complete the one-hop orientation.

This is the harness's own home: the "system" here is the **harness CLI itself**
(`harness/cli/`, TypeScript, commander + ports/adapters) plus the skill packs
it ships. Booting this repo means proving the CLI builds, its full suite
passes, and the dogfood extensions load.

## Boot command

```bash
just test        # cd harness/cli && npx vitest run --coverage — the full suite (~5s warm)
```

Full loop when editing source: `just fft` (biome fix → format → test).
Cold start after clone: `npm install` (the `prepare` hook builds: gen:docs + tsc).

## Health check

```bash
npx harness doctor --json    # envelope status "ok" = healthy (toolchain, build, extensions, conventions)
```

Exit 0 with `status: "ok"` and `extensions: 2 loaded, 0 failed` is the healthy
reading for this repo. `degraded` names exactly what to fix in `next_action`.

## Interact method

The CLI is the interaction surface: `npx harness <verb> --json` — core acts
(`help`, `doctor`, `instructions`, `new`, `docs`, `skills`, `record`) plus this
repo's extension verbs (`validate-harness-flow`, `validate-harnessability`).
Every command returns one JSON envelope (`command`/`status`/`data`/`error?`/
`next_action?`/`timestamp`); statuses map to exits 0/0/2/1.

## Observe method

- Envelope `data` + `evidence[]` on every command (`--json`).
- `npx vitest run --coverage` output (315 tests, v8 coverage table) — run from `harness/cli/`.
- `harness doctor --json` layer report (toolchain / cli-build / extensions / instructions / record-types).
- Dogfood worker artifacts collected by `harness validate-harness-flow --collect` (per-repo reports + ROLLUP.md).

## Deterministic signal inventory

| Sensor | Command | Proves |
|---|---|---|
| Unit + integration suite | `just test` | CLI behaviour incl. real-jiti extension loading |
| Architecture tests | (in suite) `test/architecture/` | single `process.exit` site; no `node:fs` in services |
| Lint/format | `just fix` / `just format` (biome) | style + correctness rules |
| Type build | `npm run build` (tsc) | the published surface compiles |
| Docs drift guard | `npm run check:docs` | `docs-content.ts` matches `docs/how/` sources |
| CI | `.github/workflows/ci.yml` | build + lint + test + check:docs on PR; doctor (non-blocking) |

## Evidence paths

- `harness/cli/coverage/` — vitest coverage output (gitignored, regenerated per run).
- `docs/plans/<ord>-<slug>/runs/` — dogfood run collections (reports, ROLLUP.md).
- `.harness/records/retro/` — recorded retros (`harness record retro`).
- CI logs on GitHub Actions for the PR-time reading.

## Back-pressure gaps (honest)

- **Skill prose has no deterministic sensor** — the `skills/**/SKILL.md` packs
  are validated only by dogfood runs (`validate-harness-flow`), not by tests.
- **minih-dependent verbs need live workers** — there is no fake for the
  `minih` runtime; the two dogfood verbs are proven by real fan-out runs only.
- **Instructions content is convention-checked, not content-checked** — doctor
  proves `instructions.md` exists, not that a briefing is any good; quality is
  operator judgment.

## Current maturity snapshot

**L2 — commands encoded**: boot (`just test`) boots cleanly, health
(`harness doctor`) reads ok, build/test/lint are confirmed runnable, the front
door + governance doc exist. Not L3 yet: `.harness/history.md` has no encoded-
improvement rows — the retro→encode loop has run via dogfood plans but has not
yet shipped a change recorded in the changelog. First L3 candidate: encode a
dogfood-run magic wand and start `history.md`.

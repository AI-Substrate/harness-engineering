# `harness boot` — agent briefing

## What this verb computes (the deterministic part)

`harness boot` is this repo's **composed readiness proof**. Two stages, one honest
envelope:

1. **Ready** — this repo is a CLI/library with **no long-running service** to start,
   so readiness reduces to "the gate is runnable from the repo root". Boot records
   that honestly (no fake health poll).
2. **Quality gate** — composes **`harness checks`** (vitest + arch-check +
   skills-check + markdown-lint + windows-check) and folds the verdict in. The gate
   **owns the tests**, so boot does *not* run vitest itself — one definition, no
   double run.

`data` carries `{ boot, bootMs, ready, checks }` (`checks` is the composed gate's status).

### Verdicts

| Situation | Status | Exit |
|---|---|---|
| `harness checks` green | `ok` | 0 |
| `harness checks` hard-fails | `error` (`E_BOOT_CHECKS`) | 1 |
| `harness checks` warn-launch findings only | `degraded` | 0 |
| **no `checks` extension exists** | `degraded` | 0 |
| run from outside the repo root | `unconfigured` | 2 |

## Your role (the inference part)

- On **`ok`**, the system is ready and the gate is green — start work.
- On **`degraded` with `checks: absent`**, there's no gate to compose. The
  `next_action` is the fix: author a `checks` extension. (This is the "suggest checks
  if missing" signal, returned deterministically.)
- On **`degraded`** otherwise, the gate has warn-launch findings — non-blocking
  backlog; run `harness checks` for detail.
- On **`error`**, the gate hard-failed — fix via `harness checks` / `just test`,
  then re-run boot.

## Watch out for

- **Boot composes the gate; it doesn't duplicate it.** To change what boot proves,
  edit `checks`, not `boot`.
- **Boot is as slow as `harness checks`** (which runs the suite). Keep the suite fast.
- Trust the **envelope + exit code**, never scraped prose.

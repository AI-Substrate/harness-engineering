# Keeping the harness up to date

The engineering harness reaches you through **two channels**, and they update independently:

| Channel | What it is | Updated by |
|---|---|---|
| **The CLI binary** | `@ai-substrate/engineering-harness` (the `harness` command), published to GitHub Packages | `harness update` / `harness self-install` (this guide) |
| **The skills** | the `eng-harness-*` skills installed into your agent CLI via Vercel `npx skills` | `harness skills update --target <cli>` (or folded into `harness update --target`) |

`harness update` is the one command that can reconcile **both**.

> One-time prerequisite (same as install): the `@ai-substrate` scope must point at GitHub Packages and you need a `read:packages` token in your `.npmrc`. See *Install / run* in [`harness/cli/README.md`](../../harness/cli/README.md). Every command below relies on it.

## Update the CLI

```bash
harness update              # upgrade the global install to @latest (no-op if already current)
harness update --check      # report installed vs latest — exit 0, installs nothing
harness update --pin v0.3.0 # install one exact version, one-time (not persisted)
harness self-install        # first-time global bootstrap from the registry
```

- **`harness update`** announces, then runs, `npm i -g @ai-substrate/engineering-harness@latest`. If a lookup proves you're already current it's a **no-op** (`installed_before == installed_after`), not an error.
- **`--check`** does a fresh registry lookup, reports `{ installed, latest, update_available }`, and **never installs** — safe to script.
- **`--pin vX.Y.Z`** installs exactly that version (the leading `v` is optional). A version that isn't published returns `E204` with guidance.
- **`self-install`** is the convenience bootstrap for a machine that doesn't have the CLI yet.

### When an update fails

`harness update` / `self-install` map every failure to an actionable `next_action`:

| `error.code` | Cause | Fix |
|---|---|---|
| `E201` | registry auth missing/expired (401/403), or the `@ai-substrate` scope/registry isn't configured | add the `.npmrc` scope line + a `read:packages` token (see the install prerequisite) |
| `E202` | the global `npm -g` install was denied (filesystem permissions) | use a Node version manager (nvm/Volta) or a prefix-writable / elevated npm |
| `E203` | `npm` is not on `PATH` | install Node.js + npm (https://nodejs.org) |
| `E204` | `--pin` named a version that isn't in the registry | run `harness update --check` to see the latest, then pin a published version |
| `E200` | anything else | inspect the npm output shown above and re-run the announced command |

## Staleness is hard to miss

The registry lookup is **throttled to once per 24h** and **cached** under `~/.harness/update-check.json` (a user-global file, never your repo's `.harness/`) — **failure-silent** (a network/auth failure never interrupts you). The lookup runs when you invoke **`harness update`** or **`harness update --check`**; ordinary commands never touch the network — they read the cache, so they stay instant.

Once a newer version is cached, **every** command surfaces it from a single fast cache read:

- **JSON mode** — an additive top-level field:

  ```jsonc
  { "command": "doctor", "status": "ok", "update_available": {
      "installed": "0.2.0", "latest": "0.3.0", "command": "harness update" } }
  ```

- **Human mode** — exactly one line on **stderr** (never stdout, so it can't corrupt a piped summary):

  ```
  update available to 0.3.0 from 0.2.0 — run: harness update
  ```

So whether a command is read by an agent (JSON) or a human (stderr), the nudge is right there. A cached update keeps showing even if a later `--check` fails (offline, token expired) — only a genuinely unknown state shows nothing.

**Keep the signal fresh.** Because ordinary commands don't auto-check, run `harness update --check` on a cadence that suits you — a daily cron, a CI step, or your agent's session-start hook. The throttle means extra `--check` calls within the 24h window are cheap no-ops. (Automatic, hands-off background refresh on every command is a deliberate non-goal: it would put the network on the hot path and slow every invocation.)

## Reconcile the skills too

The CLI binary and the skills are separate channels, so updating one doesn't update the other. `harness update` bridges them:

```bash
harness update --target github-copilot           # upgrade the CLI AND refresh + prune skills for that CLI
harness update --target github-copilot --global  # …reconciling the global skills install
harness update                                    # no --target: report-only — shows what would refresh/prune
```

- **With `--target`**, the skills half runs the existing reconcile: `npx skills add` (refresh to latest + pull new) **then** `npx skills remove` of the renamed/removed legacy slugs (the Vercel installer has no native prune, so a rename would otherwise leave a stale twin). A refresh failure surfaces as an **error**; a prune-only failure as **degraded** (the latest skills are installed; re-run the prune by hand).
- **Without `--target`** (or under `--check`), the skills half is **report-only**: it lists the prune candidates and prints the exact `harness skills update --target <cli>` command, and changes nothing — there's no auto-detection of which CLI your skills live in, so it never guesses.

Every `harness update` envelope carries a `skills` sub-object recording which path ran.

## See also

- [`harness/cli/README.md`](../../harness/cli/README.md) — install / run, the full command surface, output modes, exit codes.
- `harness skills update --help` — the standalone skills refresh + prune.

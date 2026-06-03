<!-- foundations: first-principles#28, #36, patterns-that-work#P21 -->

# Engineering harness setup report

The agent harness drives. The engineering harness proves.

- Date: {{INSTALL_TIMESTAMP}}
- Target repository: {{TARGET_REPO_PATH}}
- Skill version: 0.1.0
- CLI branch chosen: {{CLI_BRANCH}}   <!-- install-new | wrap-existing | none -->
- CLI language: {{CLI_LANGUAGE}}      <!-- python | node | wrap | (empty if neither runtime) -->
- CLI invocation: `{{HARNESS_CLI_INVOCATION}}`
- Initial harness maturity level: L1

## Files created or updated

| Path | Action | Notes |
|---|---|---|
| `docs/project-rules/engineering-harness.md` | created / merged / skipped | canonical governance file |
| `AGENTS.md` | created / appended | sentinel-bracketed addition |
| `harness/README.md` | created | |
| `harness/cli/commands.json` | created | deterministic sensor inventory and command map |
| `harness/cli/{{HARNESS_CLI_FILE}}` | created | one of `harness.py` / `harness.mjs` / README-only existing-tool wrapper |
| `docs/harness/` | created | canonical buffers, retros, and curated harness-improvement tree |
| `harness/skills/onboard-agent-session.md` | created | read by `<CLI> onboard` |
| `harness/state/known-difficulties.md` | optional compatibility summary | points to `docs/harness` if generated |
| `harness/state/friction-log.md` | optional compatibility summary | points to `docs/harness` if generated |
| `harness/templates/proof-note.md` | created | |
| `harness/templates/friction-entry.md` | created | |
| `harness/templates/retrospective-schema.json` | created | session-end retrospective schema |
| `harness/templates/cli-command-contract.md` | created (optional) | |
| `harness/proofs/.gitkeep` | created (optional) | |

## Validation performed

The verdict columns use the QT-04 sharpened shape: `Ran` records whether the command actually executed; `Outcome` records the verdict. Enums are deliberate — no free-text in these columns.

| Step | Ran | Outcome | Reason | Evidence |
|---|---|---|---|---|
| `<CLI> --help` | yes / no / dry-run / unconfigured | pass / fail / degraded / n/a | (one line) | (path or output snippet) |
| `<CLI> doctor` | yes / no / dry-run / unconfigured | pass / fail / degraded / n/a | | |
| `<CLI> validate --dry-run` | yes / no / dry-run / unconfigured | pass / fail / degraded / n/a | | |
| build (real) | yes / no / dry-run / unconfigured | pass / fail / degraded / n/a | | |
| test (real) | yes / no / dry-run / unconfigured | pass / fail / degraded / n/a | | |
| health (real) | yes / no / dry-run / unconfigured | pass / fail / degraded / n/a | | |

### Neither-runtime row (AC-13)

If neither Python ≥ 3.10 nor Node ≥ 18 was detected during install, the CLI row records the degraded outcome:

| CLI | Ran | Outcome | Reason | Evidence |
|---|---|---|---|---|
| `<CLI>` | no | unconfigured | no supported runtime detected (need Python ≥ 3.10 or Node ≥ 18) | `install-report:cli-row` |

The install still completes (`harness/` is materialised), but `harness/cli/commands.json.harness.cli_language` is `""` and a setup note names the missing-runtime condition.

## Proof-level ceiling (QT-06)

> This setup proves at most that the harness nucleus was installed and configured. It does not and cannot prove product runtime behaviour. Use the harness loop — Boot -> Backpressure Check -> Do Work and Observe -> Retro and Magic Wand -> Improve — to reach stronger proof in subsequent sessions.

The proof-level ladder is distinct from the harness-maturity ladder (L0–L4) in `docs/project-rules/engineering-harness.md`. The two ladders compose: a high-maturity harness can still produce low-proof-level results when the product doesn't run, and a low-maturity harness can briefly produce a high-proof-level result if a human carries the loop manually. Track both.

## What is proven

- {{PROVEN_BULLET_1}}
- {{PROVEN_BULLET_2}}

## What remains unproven

- {{UNPROVEN_BULLET_1}}
- {{UNPROVEN_BULLET_2}}

## Recommended next harness improvement

{{NEXT_IMPROVEMENT}}

<!-- USER CONTENT START -->
<!-- Team additions: notes specific to this install run. The skill preserves
     everything between the sentinels on re-run. Examples:
     - Why a particular command slot was left unconfigured.
     - Permissions limitations encountered.
     - References to the PR that adds this install. -->
<!-- USER CONTENT END -->

## Magic-wand close-out

> If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, higher quality, or better proven? Be concrete — name a command, flag, output field, fixture, diagnostic, template, sensor, check, or workflow change.

Record the reviewed answer in `docs/harness` via the runtime observe/retro flow. If `harness/state/friction-log.md` exists, it is only a compatibility summary or pointer.

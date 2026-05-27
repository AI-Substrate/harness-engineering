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
| `HARNESS.md` (or `docs/project-rules/harness.md`) | created / merged / skipped | per FR-01 |
| `AGENTS.md` | created / appended | sentinel-bracketed addition |
| `harness/README.md` | created | |
| `harness/config.json` | created | per FR-CF-07 placeholder substitution |
| `harness/bin/{{HARNESS_CLI_FILE}}` | created | one of `harness.py` / `harness.mjs` / `harness.sh` |
| `harness/skills/onboard-agent-session.md` | created | read by `<CLI> onboard` |
| `harness/state/known-difficulties.md` | created | empty seed |
| `harness/state/friction-log.md` | created | seeded with install-time entries (if any) |
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

The install still completes (`harness/` is materialised), but `harness/config.json.harness.cli_language` is `""` and a seed friction-log entry names the missing-runtime condition.

## Proof-level ceiling (QT-06)

> This setup proves at most L2 (harness commands ran and any approved build/test passed). It does not and cannot prove L3+ (product runtime behaviour). Use the harness loop — Boot → Interact → Observe → Validate — to reach higher proof levels in subsequent sessions.

The proof-level ladder is distinct from the harness-maturity ladder (L0–L4) in `HARNESS.md`. The two ladders compose: a high-maturity harness can still produce low-proof-level results when the product doesn't run, and a low-maturity harness can briefly produce a high-proof-level result if a human carries the loop manually. Track both.

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

Record the answer in `harness/state/friction-log.md` with `magicWandTarget: project | harness | agent`. The harness ones are the most actionable; encode them.

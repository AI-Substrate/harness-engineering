<!-- foundations: first-principles#15, #21, #22, patterns-that-work#P11-P14 -->

# Harness CLI Command Contract

Harness commands should be useful to both humans and agents. This document is the per-subcommand contract for the CLI installed under `harness/cli/`. The envelope shape is defined in `harness/templates/cli-envelope.schema.json` (materialised by the engineering-harness-setup skill).

## Envelope shape

Every subcommand prints a single JSON object on stdout (when `--json` is passed) and a human-readable summary otherwise. The JSON shape is:

```json
{
  "command": "doctor",
  "status": "pass",
  "data": { "...": "..." },
  "error": { "code": "OK", "message": "(none)", "next_action": "(optional)" },
  "messages": ["log line 1", "log line 2"]
}
```

- `command` (required): the subcommand the user invoked.
- `status` (required): one of `pass`, `fail`, `unconfigured`, `degraded`, `dry-run`, `running`, `skipped`, `unknown`.
- `data` (optional): subcommand-specific structured payload.
- `error` (present iff `status ∈ {fail, unconfigured, degraded}`): `{code, message, next_action?}`.
- `messages` (optional): array of log lines / warnings.

## Process exit codes

Recommended exit codes:

- `0` — passed or intentionally non-executing (`status: pass`, `dry-run`, or `skipped`).
- `1` — failed (`status: fail` or other hard failure).
- `2` — recoverable configuration gap (`status: unconfigured` or `degraded`).

The `error.code` enum inside the envelope is the machine-readable handle for branching in CI scripts or agent prompts; the process exit code is the coarse-grained shell handle. They are layered, not redundant.

## `error.code` enum

| Code | When | Process exit |
|---|---|---|
| `OK` | No error; `status: pass`. | 0 |
| `UNCONFIGURED` | A required config slot is empty. | 2 |
| `AUTH_MISSING` | The subcommand needs credentials that aren't present. | 1 |
| `TIMEOUT` | An operation exceeded its configured timeout. | 1 |
| `INVALID_ARGS` | User-supplied args failed validation. | 1 |
| `DEPENDENCY_MISSING` | A required external tool / runtime is absent, or validation is degraded because a configured step is unavailable. | 2 when status is `degraded`; 1 for hard dependency failure |
| `HEALTH_CHECK_FAILED` | The health URL responded with a non-expected status or was unreachable. | 1 |
| `BUILD_FAILED` | The `build` subcommand's underlying command returned non-zero. | 1 |
| `TEST_FAILED` | The `test` subcommand's underlying command returned non-zero. | 1 |
| `PLACEHOLDER_LEAK` | `validate` discovered unresolved placeholder markers (e.g. `{{NAME}}`) in installed files. | 1 |
| `UNKNOWN` | Fallback. Use sparingly — prefer a more specific code. | 1 |

## Per-subcommand contract

### `doctor`

- Purpose: report harness readiness without running build/test/run.
- Reads: `harness/cli/commands.json`.
- Returns: `pass` if config exists and at least one command is configured; `degraded` if config exists but no commands; `unconfigured` if config missing.
- Possible `error.code`: `OK`, `UNCONFIGURED`, `DEPENDENCY_MISSING`.
- Flag: `--wait <sec>` — retry doctor for up to `<sec>` seconds while config or commands are missing. Useful when a sibling tool (CI, a build step) is materialising config concurrently.

### `install` | `build` | `test` | `lint` | `typecheck` | `format_check` | `smoke` | `arch` | `security` | `schema` | `codeql`

- Purpose: run the configured command.
- Reads: `commands.<name>` from `harness/cli/commands.json`.
- Returns: `pass` (exit 0), `fail` (non-zero exit), `unconfigured` (empty command), `dry-run` (when `--dry-run` is passed).
- Possible `error.code`: `OK`, `UNCONFIGURED`, `BUILD_FAILED`, `TEST_FAILED`, `UNKNOWN`.
- Flag: `--dry-run` — print the command without spawning the child.

These command keys form the deterministic sensor inventory that the tools Backpressure Check can inspect. Missing key means unsupported/not declared; empty string means known but unconfigured; non-empty string means command to run. Do not add a core `backpressure` command: Backpressure Check is advisory over this inventory and the current scope.

### `run`

- Purpose: start the long-running product process.
- Reads: `commands.run` and `permissions.allow_run` from `harness/cli/commands.json`.
- Default: dry-run unless `permissions.allow_run` is true OR `--execute` is passed.
- Returns: `dry-run` by default; `pass` on a successful exit; `fail` on non-zero; `unconfigured` if `commands.run` is empty.
- `validate` NEVER invokes `run` under any tier (AC-15). Long-running boot must be intentional.

### `health`

- Purpose: probe the configured health URL.
- Reads: `health.url`, `health.expected_status`, `health.timeout_seconds`; if `health.url` is empty but `commands.health` is configured, runs `commands.health` as the health sensor fallback.
- Returns: `pass` if HTTP status matches `expected_status` or the fallback command exits 0; `fail` on mismatch, network error, or fallback non-zero; `unconfigured` if both URL and fallback command are empty.
- Possible `error.code`: `OK`, `UNCONFIGURED`, `HEALTH_CHECK_FAILED`, `TIMEOUT`.

### `validate`

- Purpose: layered validation — run a tier's worth of subcommands and return a combined verdict.
- Reads: `validation.<tier>` from `harness/cli/commands.json`. Tiers: `fast`, `quick`, `proof`.
- Returns: `pass` if every step passed; `degraded` if any step is unconfigured but none failed; `fail` if any step failed; `unconfigured` if the tier list is empty/missing.
- Final self-check: greps `docs/project-rules/engineering-harness.md`, `AGENTS.md`, and `harness/cli/commands.json` for unresolved placeholder markers (e.g. `{{NAME}}`). If found, returns `fail` with `error.code: PLACEHOLDER_LEAK`.
- Flag: `--tier {fast|quick|proof}` — default `quick`.
- Flag: `--dry-run` — pass through to each step.

### `fft`

- Purpose: alias for `validate --tier proof` ("Full Fat Test"). The name is short on purpose: shorter than `validate --tier proof`, longer than `v`. Use it in CI's final gate and in `git push --no-verify` prevention hooks.
- Equivalent to `validate --tier proof` in every other respect.

### `onboard`

- Purpose: print the contents of `harness/skills/onboard-agent-session.md`.
- Reads: `harness/skills/onboard-agent-session.md`.
- Returns: `pass` if the file exists; `unconfigured` (with `error.code: UNCONFIGURED`) if absent.
- The CLI does NOT contain a hardcoded checklist — the markdown file is the source of truth, so the team can edit onboarding without re-shipping the CLI.

### `magic-wand`

- Purpose: print the harness improvement prompt.
- Reads: `harness/templates/magic-wand-prompt.md` (the canonical wording).
- Returns: `pass`.
- The prompt is byte-identical to the wording in `docs/project-rules/engineering-harness.md` Rule 5, `harness/templates/proof-note.md`, and `harness/templates/retrospective-schema.json`. The CLI never invents a new wording. Route reviewed candidates through `docs/harness`; any `harness/state/*` file is a compatibility summary only.

## Output expectations

Human-readable text is the default. `--json` produces machine-readable envelopes on stdout (no trailing newline beyond the JSON object's). All stderr output is for warnings and uncaught errors; envelopes go to stdout.

## Safety expectations

- Long-running commands (`run`) are explicit — dry-run by default.
- Destructive commands should require confirmation; the v0.1 CLI doesn't include any destructive subcommands.
- Dry-run is available for every wrapped command.
- The CLI prefers fix-forward diagnostics (specific `error.code` + actionable `next_action`) over vague failures.
- `validate` never invokes `run` — proof tiers never trigger long-running boot. If you want boot proven, use `health` against a separately-running product.

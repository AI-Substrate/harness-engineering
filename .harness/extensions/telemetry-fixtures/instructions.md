# capture-fixtures

> **Reference / dogfood extension** (plan 037). Lives in `.harness/extensions/` so it
> is available in-repo but **never ships** to the published npm CLI surface.

Capture real harness session logs into the scrubbed telemetry **fixture corpus** under
`harness/cli/test/services/telemetry/fixtures/real/<surface>/<instance>/`, so the
telemetry adapters are tested against real data instead of synthetic guesses.

## Usage

```bash
harness capture-fixtures --surface claude [--session <id>] [--instance <id>] [--names "A B,C D"] [--dry-run]
```

- `--surface` — `claude | copilot-cli | copilot-vscode | cursor` (only `claude` in Phase 1).
- `--session` — explicit claude session id; default = the most recent session for this repo.
- `--instance` — corpus dir name; default = derived from date + session.
- `--names` — comma-separated person names to scrub (beyond paths/identity/secrets).
- `--dry-run` — capture + scrub into `scratch/` only; do **not** promote.

## The privacy discipline (non-negotiable)

1. Capture stages to a **gitignored `scratch/`** first (Constitution P12).
2. The pure `fixture-scrub` service strips machine paths / identity / secrets while
   keeping prompts + tool calls **verbatim**.
3. A **manual "anything bad" review** of the scrubbed bytes is required before promotion —
   these land in a public repo, permanently in git history.
4. Only then is the instance promoted to the corpus and committed.

> The committed raw fixture has **only the scrub** as its guard. The
> `fixture-privacy-scan` test byte-scans every committed `raw.*` + `expected-segment.json`.

The full capture → scrub → review → promote runbook lands in Phase 3
(`docs/how/telemetry-fixtures.md`).

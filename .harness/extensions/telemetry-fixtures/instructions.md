# capture-fixtures

> **Reference / dogfood extension** (plan 037). Lives in `.harness/extensions/` so it
> is available in-repo but **never ships** to the published npm CLI surface.

Capture real harness session logs into the scrubbed telemetry **fixture corpus** under
`harness/cli/test/services/telemetry/fixtures/real/<surface>/<instance>/`, so the
telemetry adapters are tested against real data instead of synthetic guesses.

## Usage

```bash
harness capture-fixtures --surface <surface> [--session <id>] [--instance <id>] \
  [--log <path>] [--names "Person Name,git-handle"] [--note "<provenance>"] [--dry-run]
```

- `--surface` — `claude | copilot-cli | copilot-vscode | cursor`.
- `--session` — **per-surface**: `claude` optional (defaults to the sole session for this
  repo); `copilot-cli` **required**; `cursor` **required** (the conversation id);
  `copilot-vscode` optional override (else resolved by cwd).
- `--instance` — corpus dir name; default = derived from date + session.
- `--log` — `copilot-cli` only: explicit `process-*.log` path (else auto-discovered).
- `--names` — comma-separated person names / git handles to scrub (beyond paths/identity/secrets).
- `--note` — one-line provenance note for `meta.json`.
- `--dry-run` — capture + scrub into `scratch/` only; do **not** promote to the corpus.

## The privacy discipline (non-negotiable)

1. Capture stages to a **gitignored `scratch/`** first (Constitution P12) — the
   unscrubbed originals + scrubbed candidates sit there for an early review/diff.
2. The pure `fixture-scrub` service strips machine paths / identity / secrets while
   keeping prompts + tool calls **verbatim**.
3. Promotion (a run **without** `--dry-run`) **re-resolves the live sources and writes
   freshly scrubbed bytes** to the corpus dir — it does **not** copy the scratch
   candidate. So the binding **manual "anything bad" review must be on the promoted
   `corpusDir/` bytes** (the exact bytes git will track), end-to-end, before `git add` —
   they land in a public repo, permanently in git history.
4. Only after that review do you `git add` + commit the instance.

> The committed raw fixture has **two** guards: the **scrub** (at capture) and the
> `fixture-privacy-scan` byte-scan (auto-globs every committed `raw.*` +
> `expected-segment.json` + `invariants.json` and asserts no path/identity/secret
> survives). Neither replaces the manual review — the scrub can miss a token no regex
> anticipated (e.g. a git handle that isn't in your home path; pass it via `--names`).

## Goldens are derived — never hand-edited

Each instance's `expected-segment.json` (+ `invariants.json` where present) is
regenerated from the adapters over the committed `raw.*`:

```bash
npm run gen:telemetry-fixtures      # rewrite the goldens
npm run check:telemetry-fixtures    # drift guard — fails non-zero if a golden is stale (CI-gated)
```

## Full runbook + governance

- **Capture → scrub → review → promote runbook**: [`docs/how/telemetry-fixtures.md`](../../../docs/how/telemetry-fixtures.md)
  — the per-surface capture steps, the cursor on-disk path, and the non-skippable
  manual-review checklist.
- **Why committing scrubbed session content is allowed**: the Deviation Ledger entry
  in [`docs/project-rules/rules.md`](../../../docs/project-rules/rules.md) § 9
  (controls = scrub + raw-scan + manual review).

# `harness flow-eval` — agent briefing

## What this verb computes (the deterministic part)

`harness flow-eval` is a **generic, config-driven flow-conformance evaluator**: it
grades a *finished* pij session against a scenario's assertions and writes a report.
It is **one command with two actions** (the contract registers one top-level command
per verb, so the action is a positional the verb dispatches on):

| Action | Invocation | What it does |
|---|---|---|
| `score` | `harness flow-eval score --scenario <slug> --session <pij-id> [--worktree <path>]` | **the only action verb** — load → fetch telemetry ONCE → resolve every assertion → score → write the report |
| `scaffold` | `harness flow-eval scaffold --slug <slug>` | write a ready-to-edit scenario skeleton (refuses to clobber an existing bundle) |

### What `score` does, step by step

1. **Load** the scenario bundle from `live-testing/scenarios/<slug>/`
   (`scenario.json` + `assertions.json`); a malformed bundle → `error` (`E_SCENARIO`),
   never a silent pass.
2. **Fetch the session's telemetry ONCE** via the Phase-1 CLI verb
   `harness telemetry get <session> --json [--worktree <path>]` (through `ctx.exec`,
   **never** a CLI-internal import). The parsed `envelope.data` is the `SessionEvidence`
   shared across all telemetry assertions — fetched exactly once per run.
3. **Resolve each assertion** by `type` to a **three-valued verdict** (`pass` / `fail` /
   `unknown`) via the lane-tagged resolver registry:
   - **telemetry** lane (`skill-called`, `skill-sequence`, `flow-seam-fired`,
     `harness-verb-ran`, `checks-ran`, `tool-used`, `compaction-occurred`) — reads the
     shared evidence. **If telemetry is unavailable, these resolve `unknown`, never
     `fail`** (the *determinism boundary*: a capability gap is not a conformance
     failure).
   - **fs** lane (`file-created`, `file-content-matches`, `artifact-exists`,
     `command-succeeds`) — reads the subject's `--worktree`.
   - **fs+telemetry** composite (`retro-drained`) — a three-valued AND of both lanes.
   - **judged** lane (`judged`) — NOT resolved deterministically; see below.
4. **Score** (`scorer.ts`): `score = Σ(weight of pass) / Σ(weight of pass+fail)` —
   `unknown` is **excluded from the denominator** (a capability gap never drags the
   score down). A `required` assertion that resolves `fail` increments `required_failed`,
   which **caps the run verdict to FAIL**.
5. **Write** `report.{json,md}` to `.harness/live-testing/<slug>/<run-id>/` via the
   feature-detected `ctx.fsWrite` (absent → honest `error`, never a silent no-op).

### Verdicts

| Situation | Run verdict | Envelope status / exit |
|---|---|---|
| no required fail, no fail, no unknown | `PASS` | `ok` / 0 |
| no required fail, but some `fail` and/or `unknown` | `PASS_WITH_NOTES` | `ok` / 0 |
| any **required** assertion resolves `fail` | `FAIL` | `ok` / 0 |
| missing `--scenario` / `--session` | — | `error` (`E_ARGS`) / 1 |
| malformed / missing scenario bundle | — | `error` (`E_SCENARIO`) / 1 |
| core provides no `ctx.fsWrite` | — | `error` (`E_REPORT` / `E_NO_FSWRITE`) / 1 |
| unknown action | — | `error` (`E_ACTION`) / 1 |

The run verdict (`PASS`/`PASS_WITH_NOTES`/`FAIL`) lives in `data.verdict`; the envelope
`status` is `ok` for any *completed* scoring run — a `FAIL` verdict is a successful
evaluation that found non-conformance, not a tool error.

## Your role (the inference + judged part)

- **You (or the orchestrator) drive the session; this verb only grades it.** Run the
  subject through the-flow over pij in the shell *first*, then call `score` against the
  finished session id + its worktree. `score` consumes evidence — it does not produce it.
- **`judged` assertions are surfaced as fields for you to fill.** Each lands in the
  report's `judged[]` with `verdict: null, rationale: null, by: null` plus its `prompt`
  /`rubric`. After the run, read each `judged` field, answer its prompt against the
  evidence + worktree, and fill `verdict`/`rationale`/`by` in `report.json`. The
  deterministic core never guesses these — that's the human/LLM-in-the-loop boundary.
- **Trust the envelope + the report, never scraped prose.** `data.telemetry.available`
  tells you whether the telemetry lane had evidence; if `false`, expect telemetry
  assertions as `unknown` (and a `PASS_WITH_NOTES` rather than a false `FAIL`).

## Authoring a scenario

Use `scaffold` to start: `harness flow-eval scaffold --slug <slug>` writes a valid,
loadable skeleton (one assertion per lane) under `live-testing/scenarios/<slug>/`. Edit
the assertions to taste, then `score` against a real session. Keep assertions
deterministic where possible and reserve `judged` for genuinely subjective quality calls.

## Assumptions

- **Telemetry**: the session id is a finished pij session whose telemetry is reachable
  via `harness telemetry get`. No telemetry → `unknown`, not `fail`.
- **Worktree**: `--worktree` is the subject's repo root for the fs lane (defaults to
  `cwd`). The telemetry locator also receives it so `telemetry get` can find the session.
- **Report dir**: reports are written under the *caller's* `cwd`
  (`.harness/live-testing/<slug>/<run-id>/`), not the worktree.

## Watch out for

- **This verb NEVER drives pij** (critic-F1). The only `harness` call is the read-only
  `telemetry get`; the only other exec calls are scenario-authored `command-succeeds`
  checks against the worktree. It must never spawn or steer a pij session.
- **Telemetry is fetched exactly once** per `score` run and shared across all telemetry
  assertions — don't add per-assertion fetches.
- **`unknown` is not `fail`.** A telemetry capability gap excludes the assertion from the
  score; it does not sink the verdict. Only a `required` *fail* caps to `FAIL`.
- **Node-free runtime.** All I/O goes through `ctx.exec` / `ctx.fs` / `ctx.fsWrite`; the
  engine imports only the published `contract` types and never throws (the kernel
  finalizes the returned `VerbResult`).

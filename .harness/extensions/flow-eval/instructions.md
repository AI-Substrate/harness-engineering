# `harness flow-eval` — agent briefing

## What this verb computes (the deterministic part)

`harness flow-eval` is a **generic, config-driven flow-conformance evaluator**: it
grades a *finished* pij session against a scenario's assertions and writes a report.
It is **one command with several actions** (the contract registers one top-level command
per verb, so the action is a positional the verb dispatches on):

| Action | Invocation | What it does |
|---|---|---|
| `score` | `harness flow-eval score --scenario <slug> --session <pij-id> [--worktree <path>] [--subject-harness <h>] [--subject-model <m>] [--subject-effort <e>] [--base-ref <ref>] [--resolve <id>=<cmd>...]` | **the primary action verb** — load → fetch telemetry ONCE → resolve every assertion → score → write the report + append the ledger |
| `render` | `harness flow-eval render --scenario <slug> --run <run-id>` | regenerate `report.md` from the CURRENT `report.json` (surfaces judged verdicts the orchestrator filled after `score`) — idempotent, no telemetry, no ledger write |
| `ledger` | `harness flow-eval ledger --scenario <slug> [--compare <model> --compare <model>]` | read the run ledger back (runs over time + per-lane flips + superseded runs, or a model-vs-model board) |
| `supersede` | `harness flow-eval supersede --scenario <slug> --run <old-run-id> --by <new-run-id>` | mark a stale run superseded by a corrected re-score — appends an **append-only** annotation line; `ledger` then flags it and `--compare` excludes it (no prior line is rewritten) |
| `scaffold` | `harness flow-eval scaffold --slug <slug>` | write a ready-to-edit scenario skeleton (refuses to clobber an existing bundle) |

### Recording an honest subject + base_ref (`--subject-*` / `--base-ref`)

`scenario.json#subject` / `base.ref` are only **defaults**. When the run's real subject or
base differs (e.g. a `codex/gpt-5.5` subject on a worktree cut from a specific sha, not the
scenario's declared `opus`/`v0.6.0`), pass the overrides so the recorded evidence is honest:

- `--subject-harness <h> --subject-model <m> --subject-effort <e>` override the recorded subject;
- `--base-ref <ref>` overrides the recorded base ref.

Overrides win over `scenario.json` for **all three** of the report header, the
`RunRecord.subject`/`base_ref`, **and** the `seed_tuple` — they stay **lock-step** (the
`seed_tuple` is derived from the same effective values, so the `--compare` match key never
drifts from the header). `RunRecord` **fields are unchanged**; only their **values** become
honest, so the schema round-trip + `validateRunRecord` still hold.

If `--worktree <path>` is given, `score` also detects the worktree's HEAD
(`git rev-parse --short HEAD`) and, when it disagrees with the effective `base_ref`, emits a
**visible warning** in both the envelope (`data.warnings`) and `report.md` — never a crash,
never a silent pass. A HEAD it cannot detect (missing/empty) yields no warning (honest, not a
false alarm).

### Per-run assertion resolution (`--resolve`) + `placeholder_policy`

Some scenarios author a `command-succeeds` assertion as a **placeholder token** (a bare
screaming-snake `cmd` like `SUBJECT_PDF_VALIDATOR`) because only the subject knows its own
verb name / validator command. Resolve these **per run**, at score time, WITHOUT ever editing
the committed bundle:

- **`--resolve <id>=<command>`** (repeatable) overrides the `cmd` of assertion `<id>` with the
  real command. The resolved commands are recorded in `report.json` **and** the `RunRecord`
  provenance (`provenance.resolutions`), so a `--compare` knows exactly what ran. `live-testing/
  scenarios/` is **never written** at run time.
- **`scenario.json#placeholder_policy`** decides what an **unresolved** placeholder does:
  - `"unknown"` (emitted by `scaffold` for every new scenario) → an unresolved placeholder
    resolves the assertion **`unknown`** with a visible envelope warning — honest "not run",
    **never a silent pass and never a raw exec** of the literal token.
  - `"raw"` (default when the key is absent — legacy) → the literal token is executed as-is.

⚠ **Failure mode of a legacy `"raw"` scenario (e.g. the frozen `md-to-pdf`):** because there is
no `placeholder_policy`, a **forgotten `--resolve`** executes the bare placeholder token, which
is not a real command → a non-zero exit → the required `command-succeeds` lane **false-fails**
(worse than an `unknown`). For such scenarios the runbook/skill **mandates** passing every
`--resolve` flag. New scenarios (`placeholder_policy: "unknown"`) degrade to an honest `unknown`
instead, so this trap is opt-out only for legacy bundles.

### Superseding a stale run (`supersede`)

The ledger is **append-only** — a re-score never rewrites the mis-stamped original. When a run
was scored wrong (e.g. a wrong subject/base-ref that a later run corrected), record the
correction with:

```
harness flow-eval supersede --scenario <slug> --run <old-run-id> --by <new-run-id>
```

This APPENDS one distinct annotation line (`{kind:"supersede", run_id, superseded_by, ts}`) —
no prior RunRecord line is touched (byte-stable). Thereafter `ledger` lists the stale run with a
`⊘ superseded` flag (it is never dropped), and `--compare` **excludes** it so a comparison never
ingests the bogus line. The annotation has its own schema guard, so `validateRunRecord` still
holds for real records. `score` also prints a `supersede` hint in its `next_action` when it
detects a prior run of the **same session** already in the ledger.

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
   - **fs (safety)** lane (`forbidden-state`) — a guardrail: a `forbidden_glob` that MUST
     NOT match / a `require_path`|`require_glob` that MUST exist (AND-ed; fail dominates).
   - **fs+telemetry** composite (`retro-drained`) — a three-valued AND of both lanes.
   - **judged** lane (`judged`) — NOT resolved deterministically; it expands into
     scenario-configured sub-criteria (`plan-coherence`,
     `report-contract-coverage`, `explanation-matches-telemetry`); see below.

   `skill-sequence` accepts a `match_mode` (`strict` | `superset` | `subset` | `unordered`;
   **default `superset`**) plus per-skill `arg_overrides` (`'ignore' | '<regex>'`) that
   tolerate volatile arg tails (plan paths/phases). `strict` = ordered subsequence,
   `superset` = every required present (order/extras ignored), `subset` = no out-of-scope
   skill, `unordered` = exact set.
4. **Score** (`scorer.ts`) on **two axes** (workshop 003 §D1). Each assertion `type` maps to
   exactly one **axis** — `process` (the ritual: telemetry lanes + `retro-drained` + `judged`),
   `capability` (the artifact: fs lanes), or `safety` (`forbidden-state`) — *orthogonal* to the
   proof-source lane above.
   - `score = Σ(weight pass) / Σ(weight pass+fail)` — back-compat single number over all lanes;
     `unknown` is **excluded from the denominator**.
   - `axis_scores: {process, capability}` — the same pass-rate computed **per axis**
     (unknown-excluded per axis). An axis with **no scorable (pass|fail) lane** is
     **unmeasured** — the ledger records it as `null` and `report.md` renders it as
     `unmeasured`, **never `0.00`** (a `0.00` is legal only for a measured axis that
     genuinely scored zero).
   - The FAIL **cap consults ONLY capability + safety**: a `required` fail on those axes caps
     the verdict to FAIL (and increments `required_failed`); a `required` **process** fail
     informs the process score but **never caps**.
   - **Mimicry alarm**: `alarms` carries `'mimicry'` when `process ≥ 0.8 && capability ≤ 0.4`
     (both axes measured) — the "right ritual, broken artifact" signal.
5. **Write** `report.{json,md}` to `.harness/live-testing/<slug>/<run-id>/` via the
   feature-detected `ctx.fsWrite` (absent → honest `error`, never a silent no-op).

### Verdicts

| Situation | Run verdict | Envelope status / exit |
|---|---|---|
| no required fail, no fail, no unknown | `PASS` | `ok` / 0 |
| no required fail, but some `fail` and/or `unknown` | `PASS_WITH_NOTES` | `ok` / 0 |
| any **required capability/safety** assertion resolves `fail` (`required_failed > 0`) | `FAIL` | `ok` / 0 |
| missing `--scenario` / `--session` (score) or `--scenario` / `--run` (render) | — | `error` (`E_ARGS`) / 1 |
| malformed / missing scenario bundle | — | `error` (`E_SCENARIO`) / 1 |
| `render` with no `report.json` at the run dir | — | `error` (`E_NOT_FOUND`) / 1 |
| core provides no `ctx.fsWrite` | — | `error` (`E_REPORT` / `E_NO_FSWRITE`) / 1 |
| unknown action | — | `error` (`E_ACTION`) / 1 |

The run verdict (`PASS`/`PASS_WITH_NOTES`/`FAIL`) lives in `data.verdict`; the envelope
`status` is `ok` for any *completed* scoring run — a `FAIL` verdict is a successful
evaluation that found non-conformance, not a tool error.

## Your role (the inference + judged part)

- **You (or the orchestrator) drive the session; this verb only grades it.** Run the
  subject through the-flow over pij in the shell *first*, then call `score` against the
  finished session id + its worktree. `score` consumes evidence — it does not produce it.
- **`judged` assertions are decomposed into fields for you to fill.** Scenario
  config lists which criteria apply; a single `judged` assertion expands to named
  `judged[]` entries (not a blended score), each with `verdict: null`, `rationale:
  null`, `by: null`, plus an artifact-only CoT-before-score prompt and rubric. After
  the run, answer each field as `pass`/`fail`/`unknown` against **verified artifacts
  only** (`report.json`/`report.md`, deterministic result rows, session export, and
  worktree artifacts) — never subject prose/transcript/self-report — and fill
  `verdict`/`rationale`/`by` in `report.json`. The deterministic core never guesses
  these — that's the human/LLM-in-the-loop boundary.
- **After filling judged fields, re-render with `render`.** `score` renders
  `report.md` at score time, when the judged verdicts are still `_pending_`. Once you
  fill them in `report.json`, run `harness flow-eval render --scenario <slug> --run
  <run-id>` to regenerate `report.md` from the CURRENT `report.json` (surfacing the
  filled verdicts + rationale + by). `render` is idempotent, fetches no telemetry, and
  writes only `report.md`. **The ledger is append-only** — a judged verdict filled
  after `score` does **not** retro-mutate the already-appended ledger line (judged
  fields never cap the deterministic verdict, so the ledger's stance is unchanged).
- **Judge config is provenance, not a cap.** Reports and ledger records include
  judge model+version, different-family assertion/check, artifact-only, temp-0,
  version-pinned, anti-verbosity, and prompt-scaffold metadata. If the judge and
  subject model families match, the report carries a visible
  `judge-same-family-as-subject` warning; scoring still completes. `judged` can
  never be `required` and never caps the run verdict.
- **Reference anchor is scaffolded; calibration is deferred.** Judge prompts include
  a canonical good-flow anchor slot so a later human-gold calibration set can be
  dropped in without changing report shape. That calibration set is explicitly
  deferred (`human-gold-calibration-set-deferred`) in provenance until it exists.
- **Trust the envelope + the report, never scraped prose.** `data.telemetry.available`
  tells you whether the telemetry lane had evidence; if `false`, expect telemetry
  assertions as `unknown` (and a `PASS_WITH_NOTES` rather than a false `FAIL`).

## Authoring a scenario

Use `scaffold` to start: `harness flow-eval scaffold --slug <slug>` writes a valid,
loadable skeleton (one assertion per lane) under `live-testing/scenarios/<slug>/`. Edit
the assertions to taste, then `score` against a real session. Keep assertions
deterministic where possible and reserve `judged` for genuinely subjective quality calls.
The skeleton ships `placeholder_policy: "unknown"` and a placeholder `command-succeeds`
assertion, so a new scenario's subject-specific command is resolved per-run with
`--resolve <id>=<command>` and an unresolved one scores an honest `unknown` (never a raw
exec of the literal token).

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
  score; it does not sink the verdict. Only a `required` *fail* on a **capability or safety**
  axis caps to `FAIL` — a required *process* fail never caps (it lowers `axis_scores.process`).
- **Node-free runtime.** All I/O goes through `ctx.exec` / `ctx.fs` / `ctx.fsWrite`; the
  engine imports only the published `contract` types and never throws (the kernel
  finalizes the returned `VerbResult`).
- **The base ref decides how much the telemetry lane can see** (learned live
  2026-07-03). The subject's worktree runs the harness *at the pinned base*, so a
  base predating env-capture writes segments with no `PIJ_SESSION_ID` join key —
  the whole telemetry lane resolves `unknown`. Pin a current-code base unless you
  *want* a capability-only reading.
- **Skill capture is window-coverage-dependent on copilot** (DL-003): a subject
  that runs few harness commands gets sparse capture windows, and `skill.invoked`
  events between windows are lost — `skill-called` can false-fail while the raw
  session events prove the skill ran. Before judging fidelity (A13-class fields),
  cross-check the harness session's own event log; the deterministic row stands
  (honest-per-evidence), the judged field carries the reconciled truth.
- **Beware base-contaminated evidence.** Globs like `.harness/records/retro/**`
  match records *committed at the base ref*, and `checks-ran {status: ok}` can be
  unreachable when the base itself ships degraded findings. When judging, separate
  new-since-base evidence (`git status`/`git diff --name-only <base>` in the
  worktree) from inherited state.
- **The base_ref drift warning string-compares ref names** — a worktree correctly
  cut at a tag (or compared via short sha) still warns. Resolve both sides to a
  commit before believing it.

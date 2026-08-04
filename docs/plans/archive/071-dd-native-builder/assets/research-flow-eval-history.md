# Flow-eval + telemetry deterministic-checking capability: history, current surface, and the tk-7168 reuse map

> Research dossier for plan 070's close-out phase (ph-7103, tk-7168/tk-7169).
> Produced 2026-08-04 by an independent research subagent (Opus), cross-checked
> against the extension, scenarios, ledgers, and skill. Consumed by:
> `plan.dd.json` key findings (refusal-evidence triple loss, SessionEvidence
> exclusions) and the tk-7168 reuse list.

Repo root (all citations relative to it unless absolute): `/Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents`

## 1. Chronological capability arc

No `docs/plans/archive/` exists. Plan 069 exists only on `origin/main` (`docs/plans/069-discipline-signal-capture/`, PR #92) — it is why 070 was renumbered.

| # | Plan | Capability added | Status |
|---|---|---|---|
| 034 | harness-telemetry-collection | Origin: per-command **segment** (tokens/skills/tools/files/plans_touched, counts-only), stored in `refs/harness-telemetry/*` (`docs/plans/034-harness-telemetry-collection/harness-telemetry-collection-plan.md:14,23-45`) | Shipped |
| 035 | flow-replay-telemetry | Flight-plan `events[]` projected into telemetry (`flow_log` events, real `fired_at`) (`035/flow-replay-telemetry-plan.md:16-33`) | Shipped (PR #38) |
| 037 | telemetry-fixture-corpus | Real scrubbed session logs as the adapter test corpus (`037/…plan.md:15-21`) | Shipped (PR #42) |
| 038 | telemetry-otel-standard | OTLP/JSON wire shape at the `serializeSegment` chokepoint; lossless timeline (`038/…plan.md:27-35`) | Shipped (PR #44) |
| 039 | flow-reconcile-cli-trigger | Transactional flow node primitives; `observe` becomes a tracked seam — the anchors assertions later score (`039/…plan.md:23-32`) | Shipped (PR #45) |
| **041** | **flow-conformance-eval** | The eval harness itself: `harness telemetry get <pij-id>` → `SessionEvidence`; `PIJ_SESSION_ID` correlation; three-valued verdicts; `flow-eval score`; scenarios as pure data; reports to `.harness/live-testing/<slug>/<run-id>/` (`041/flow-conformance-eval-plan.md:14,60-67`) | Shipped (PR #49) |
| **046** | **flow-eval-loop** | Two-axis scoring (process/capability), `match_mode` sequences, `forbidden-state` safety lane, append-only `ledger.jsonl`, `ledger --compare` (Wilson CI/pass^k/McNemar, seed-tuple gated), `supersede`, judge hardening, the `flow-eval-run` skill (`046/flow-eval-loop-plan.md:27,56-67`) | Code merged with #49; spine left open at phase-4 |
| 047 | session-telemetry-dashboard | `session save`/`report`/render; **FX001 bash command signatures** (`047/fixes/FX001-capture-bash-command-signature.md:1-23`) | Shipped |
| 048 | cohort-telemetry-insights | Discipline panel + epistemic contract: LLM never computes a number (`048/…plan.md:18-27`) | Shipped |
| 049 | telemetry-ref-rollup | One-ref-per-session rollup; fixed clobber F-03 (`049/…plan.md:12-24`) | Shipped |
| 050 | semantic-artifact-telemetry | `artifact` event kind + 10 SDD extractors (`050/…plan.md:11-18`) | Shipped |
| 051 | pij-fleet-session-eval | `telemetry get-fleet` — fleet join via `PIJ_PARENT_ID`; scenario `intent` register in scaffold (`051/…plan.md:14,54-57`) | Shipped |
| 052 | fleet-telemetry-lane-sources | All-lane evidence with `source` stamps; semantic rollup for FleetEvidence (`052/…plan.md:10-17`) | Shipped |
| 053 | telemetry-mark-verb | Counts-only peer self-attestation (`mark {kind, verdict, counts}`) (`053/…plan.md:18-24`) | Shipped |
| 054 | telemetry-flush-desync | Buffer-watermark desync fix (`054/…plan.md:15-21`) | Shipped |
| **056** | **file-write-telemetry** | Per-write `file` event: path + change + line/byte delta; `<external>` sentinel; glob form of `file-content-matches` for eval (`056/file-write-telemetry-plan.md:18-24`; flow-eval commit 4d68989f) | Shipped (PR #62) |
| 057 | flow-token-efficiency | **Eval-derived** (H-02 cost triangle from the 2026-07-03 eval batch, `057/research-dossier.md:40`) prompting/economics changes | Shipped (PR #65) |
| 058 | harness-retro-insights | Deterministic cross-plan retro clustering (`058/…plan.md:18-25`) | Shipped (PR #66) |
| 059 | typed-extensions-sensors | `defineExtension()` + `harness sensors` (deterministic back-pressure sibling) (`059/…plan.md:16-25`) | Shipped (PR #71) |
| 060 | telemetry-ls-pull | Remote ref retrieval (`telemetry ls`/`pull`, E220-E227); only `060/tasks/phase-1-implementation/execution.log.md` survives in-tree | Shipped (PR #73) |
| 063 | systemic-telemetry-repair | Token recovery from vendor evidence; degraded-with-reason coverage (`063/…plan.md:18-27`) | Shipped (PR #80) |
| 065 | deterministic-documents | dd: `.dd.json` + schemas, evidence-grade completion (`proven_by`/`pressure`), dd-computed nav gates that refuse departure (`065/deterministic-documents-plan.md:16-26`) | Shipped (PR #87) |
| 066 | cursor-file-telemetry | Cursor `file` events via shared V4A parser; `t_precision:'interval'` (`066/…plan.md:3-30`) | Shipped (PR #88) |
| 067 | telemetry-sync-cost | Killed the 2-minute empty sync (18k git subprocesses) (`067/…plan.md:5-26`) | Shipped (PR #89) |
| 068 | telemetry-read-path-honesty | Read path degrades-and-names, never throws/fabricates (`068/…plan.md:3-30`) | Shipped (PR #91) |
| 069 | discipline-signal-capture | Fixed FX001 chain-head bug (97.1% of pushes mis-signatured); `ToolsEvent.control`; `checks` from all adapters (`origin/main:docs/plans/069-…plan.md:8-23`) | Shipped on origin/main (PR #92) — **not in this worktree** |
| 070 | dd-native-builder | dd-native plans/tasks, `plan validate` semantic layer, check-kind gate — **carries tk-7168, the flow-eval scenario** | Draft; all tasks unchecked |

## 2. Current flow-eval extension surface (`.harness/extensions/flow-eval/`)

Authoritative briefing: `.harness/extensions/flow-eval/instructions.md`; long-form doc `docs/how/flow-conformance-eval.md` (+ `flow-conformance-eval-explainer.html`).

**Actions** (one command, positional dispatch — `instructions.md:10-16`): `score`, `render` (regenerate report.md after judged fills), `ledger` (+ `--compare`), `supersede` (append-only correction), `scaffold`. Score flags: `--scenario --session --worktree --subject-harness/-model/-effort --base-ref --resolve <id>=<cmd>` (`instructions.md:12,18-61`).

**Score pipeline** (`instructions.md:80-127`): load bundle from `live-testing/scenarios/<slug>/` → fetch telemetry ONCE via `ctx.exec('harness', ['telemetry','get',<pij-id>,'--json'])` (`extension.ts:13,164`) → resolve each assertion three-valued (`pass|fail|unknown`) → two-axis score (process/capability; safety) → write `report.{json,md}` to `.harness/live-testing/<slug>/<run-id>/` + append `ledger.jsonl`. Telemetry-unavailable ⇒ `unknown`, never `fail` (the determinism boundary, `resolvers.ts:10-13`). FAIL cap consults only capability+safety required fails; **mimicry alarm** when process ≥ 0.8 && capability ≤ 0.4 (`instructions.md:110-125`).

**The assertion vocabulary as it stands today** (`resolvers.ts:521-541`, `scenario.ts:244-264`):

- Telemetry lane (from `SessionEvidence`): `skill-called` (with copilot verb-signature fallback, `resolvers.ts:280-307`), `skill-sequence` (`match_mode: strict|superset|subset|unordered` + per-skill `arg_overrides`, `resolvers.ts:310-355`), `flow-seam-fired`, `harness-verb-ran` (full verb strings — `"dd validate"` is a valid key), `checks-ran` (`{status}` or `{min}`), `tool-used`, `compaction-occurred`.
- fs lane (subject worktree): `file-created` (`glob|path`), `file-content-matches` (`path` or `glob`+`pattern` — glob form added by plan 056, `resolvers.ts:405-432`), `artifact-exists`, `command-succeeds` (`cmd`/`expect_exit`, per-run `--resolve`, `placeholder_policy: raw|unknown`, `resolvers.ts:434-456`).
- Safety lane: `forbidden-state` (`forbidden_glob` MUST NOT match AND `require_path|require_glob` MUST exist, `resolvers.ts:471-489`).
- Composite: `retro-drained` (record/retro verb ran AND record file exists, `resolvers.ts:500-518`).
- Judged lane: `judged` — expands to named criteria from a fixed registry (`plan-coherence`, `report-contract-coverage`, `explanation-matches-telemetry`, `ladder-adherence`, `drain-is-recommendation-led`, `dispositions-recorded-for-all`, `friction-owned-not-apologised` — `scenario.ts:47-92`); CoT-before-score artifact-only prompts; never `required`, never caps; filled post-hoc then `render`.

**SessionEvidence the resolvers see** (`resolvers.ts:40-68`, lock-step with `harness/cli/src/services/telemetry/session-evidence.ts:49-95`): `skills{}`, `skill_order[]`, `files{written,edited}`, `flow_seams[]`, `harness_verbs{}`, `checks[{status}]`, `compactions`, `tools{}`, `gaps[]`, `duration_s`. Note: `files{written,edited}` is *in* the evidence but **no resolver reads it** — all file assertions are fs-lane worktree reads.

**Report/ledger formats**: `report.json` keys `[alarms, base_ref, base_ref_warning, deterministic, finished_at, judged, provenance, run_id, scenario, started_at, subject, verdict]` (verified against `.harness/live-testing/md-to-pdf-flow/20260703-033924Z-xb11gn/report.json`). Ledger `RunRecord` line: `schema_version, run_id, ts, scenario, subject{model,harness,effort}, base_ref, seed_tuple{…, scenario_hash, prompt_hash}, lanes[], axis_scores, verdict, telemetry_available, duration_s, unknown_rate_by_axis, provenance{judge, resolutions}` — ledger verdict enum is `PASS|PARTIAL|FAIL` (`ledger.ts:85,179`; `PARTIAL` = report's `PASS_WITH_NOTES`, `ledger.ts:250`). Supersede appends `{kind:"supersede", run_id, superseded_by, ts}`; `--compare` excludes superseded (`instructions.md:63-78`).

## 3. Telemetry evidence inventory vs the four probes

Full record shape: segment schema 2.6 at `harness/cli/src/services/telemetry/segment.schema.json`; 18 event kinds at `harness/cli/src/services/telemetry/events.ts:53-98`. Storage: gitignored buffer `.harness/temp/telemetry/<session>/` → rolled ref `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>` (`sync-service.ts:27-55`), OTLP wire shape. Correlation: env session ids (`capture-service.ts:90-118`) + `captured_env.PIJ_SESSION_ID` fleet join (`session-evidence.ts:20-42`).

| Assertion need | Verdict | Mechanism / gap |
|---|---|---|
| (a) "harness dd validate was run" | **YES today** | `harness` event `{verb:"dd validate"}` from Bash text (`claude-adapter.ts:578-587`; `harness`→2-verb depth, `command-signature.ts:133`); 44 live occurrences in this repo's buffer. Surfaces to the scorer as `harness-verb-ran {verb:"dd validate"}`. Exit code additionally lands as `command_exit {verb:"dd validate", exit, status}` **only when run with `--json`** on claude/copilot lanes (`outcome-events.ts:31-90`) — and `command_exit` is **not** in `SessionEvidence` (deliberately skipped, `session-evidence.ts:311-333`), so exit-code assertions need an evidence-surface widening. |
| (b) "a nav set was refused E442" | **NO — gap** | Triple loss: refusal writes nothing to the flow log (invariant at `flow-mutations.ts:126-127,184`); `outcomeEvents` never reads `envelope.error.code` (`outcome-events.ts:69-90` vs `envelope.ts:55-59`); flow failures collapse to verb `"flow"` (`acts/flow.ts:88-91`). Nearest precedents: a **force** IS durable — manual `dd-gate-override` flow event with `details{node,to,address,incomplete[]}` (`flow-mutations.ts:199-234,245-254`) → telemetry `flow_log {op:"dd-gate-override"}` (`flow-log.ts`); and `checks.gates`/`mark.verdict` prove fixed-vocab verdict slugs already pass the privacy gate. So "refusal happened then pass" needs new capture — but "no force + gate eventually green" is assertable today via absence of `dd-gate-override` + fs/`command-succeeds` on `plan validate --complete`. |
| (c) "plan.dd.json created, no -plan.md" | **PARTIAL — but fully solvable in the fs lane** | Positive half: `file` events with path+delta (`events.ts:423-454`) and `files.written[]` exist, but (1) no created-vs-overwritten distinction (`change` derives from tool: Write→written, `claude-adapter.ts:463-489`); (2) paths are **cwd-relative with basename fallback** (`segment.ts:470-479,1193-1194`; live proof: bare `"schema.json"` + `<external>` in `harness/cli/.harness/temp/telemetry/71679da4-…/16.json`); (3) no resolver reads evidence.files anyway. The proven pattern is fs-lane: `file-created {glob:"docs/plans/*/plan.dd.json"}` + `forbidden-state {forbidden_glob:"docs/plans/07*/*-plan.md"}` (safety axis, caps when required) — exactly what `md-to-pdf-flow` A6/A7 and the planted-friction fixture already do. |
| (d) "Skill tool invoked /builder" | **YES (claude/cursor lanes)** | `skills {builder: n}` from Skill tool_use `input.skill` (`claude-adapter.ts:446-454`), `skill` events `{name,status,arg}` (leading pure-digit arg only — so `/builder … 5` could keep the `5`, FX001/`command-signature.ts:276`), `skill_order[]` for sequences. Assert via `skill-called {skill:"builder"}` / `skill-sequence`. Copilot lane emits no skill names — flagged as `gaps:["skill_name_capture"]` (`session-evidence.ts:353-356`) so resolvers go `unknown`/verb-signature fallback, never false-fail. DL-003/DL-005: sparse-command sessions under-sample capture windows (`instructions.md:220-241`). |

Other assertable evidence today: bash command signatures (`tools.signature`, e.g. `"just test"`, `"git add"` — FX001, fixed for chains by 069 on origin/main), `checks {status, gates}`, `compaction`, `flow_seams`, `plans_touched`, `artifact` events (SDD types incl. `plan|tasks|review|retro`), `mark` self-attestation. `command_exit`, `file`, `artifact`, `mark` are all captured but **excluded from SessionEvidence** — the single seam to widen if the dd scenario wants them.

## 4. Scenario precedent + the historical builder-flow eval

**Where things live**: committed scenario bundles in `live-testing/scenarios/<slug>/` (`scenario.json` + `assertions.json` + `prompts/{orchestrator,subject}.md`); run reports + append-only `ledger.jsonl` in `.harness/live-testing/<slug>/`; test fixtures in `.harness/extensions/flow-eval/fixtures/scenarios/{md-to-pdf, planted-friction}`.

Four scenarios, 25 ledgered runs (all 2026-06-30 → 07-04): `md-to-pdf` (blind baseline, 7 runs), **`md-to-pdf-flow`** (the-flow MANDATED — the eval of the builder/SDD flow itself, 6 runs), `md-to-pdf-ponytail` (4), `md-to-pdf-ponytail-harness` (8). The variant table + which question each asks: `.claude/skills/flow-eval-run/SKILL.md:33-40`.

**The historical builder-flow eval**: `md-to-pdf-flow`'s six runs (gpt-5.5, opus-4.8, sonnet-5 on copilot; fable-5, opus ×2 on claude) all ledgered `verdict: PARTIAL` with `capability: 1.0` and `process: 0.667/0/0/null/null/null` — the machine-readable finding that subjects built the artifact but did not conform to the flow (`.harness/live-testing/md-to-pdf-flow/ledger.jsonl`). Narrative runs: `docs/plans/041-flow-conformance-eval/experience-logs/001-003` — explicitly "testing the eval harness AND the-flow/eng-harness-flow themselves" (`001-md-to-pdf-copilot-gpt55.md:11-13`; F6/F7 loop-never-engaged finding in `002:8-10`).

**Did evals feed dd?** Two chains, one direct, one not:
- **Direct eval→plan**: the 07-03 four-cohort batch produced plan 057's H-02 cost triangle (`docs/plans/057-flow-token-efficiency/research-dossier.md:40`, citing `scratch/evals/2026-07-03-md-to-pdf/README.md` — that scratch dir no longer exists; the ledgers are the surviving artifact).
- **065's dd motivation was a manual plan-corpus survey**, not a flow-eval run (`docs/plans/065-deterministic-documents/research/survey-recent-plans.md:8-16,121-123`; original ask `initial-brief.md:10-34` has no eval provenance). The direction then **reverses**: the RULED decision that the flow-eval harness gains a dd-native scenario is `docs/plans/065-deterministic-documents/builder-tuning/notes.md` ("the flow evaluates its own delivery … Encoded ac-7118 + tk-7168").

## 5. Prompting inventory

- `.claude/skills/flow-eval-run/SKILL.md` — the thin router: 6-beat loop (scaffold/hygiene → cut worktree at `base.ref` → spawn subject **from inside the worktree** → run blind → `score` with `--resolve`/`--subject-*` → fill judged → `render` → sync worktree telemetry → teardown). Routes orchestration to `/flow-pair`, semantics to `instructions.md`.
- `.harness/extensions/flow-eval/instructions.md` — the agent briefing (verdicts, judged workflow, watch-outs: base-ref decides telemetry visibility `:214-219`, DL-003/DL-005 window under-sampling, base-contaminated globs `:227-231`, generated-not-transcribed analysis tables).
- Per-scenario `prompts/orchestrator.md` (gate-conduct policy, no stage nudges, spawn-inside-worktree mechanics — `live-testing/scenarios/md-to-pdf-flow/prompts/orchestrator.md:1-60`) and `prompts/subject.md` (the blind packet; assertions never leak, the mandate itself is the variable under test).
- `docs/how/flow-conformance-eval.md` — full method doc incl. "Reading the numbers", analysis-report contract, scenario-authoring checklist (§ headings at lines 72-415).

## 6. What ph-7103/tk-7168 can reuse vs must build

**Reuse as-is (nothing to reinvent):**
1. The whole scorer/report/ledger/supersede machinery + `scaffold` (which also registers scenario `intent {reason,vibe}` per plan 051 AC-05).
2. Scenario-bundle format + `placeholder_policy:"unknown"` + per-run `--resolve` for the subject-specific `plan validate` invocation.
3. Assertion types covering most of ac-7118 today: `skill-called {skill:"builder"}`; `harness-verb-ran {verb:"dd validate"}` / `{verb:"plan validate"}` (full two-token verbs are live keys); `file-created {glob:"docs/plans/*/plan.dd.json"}` and the JIT task file; `forbidden-state {forbidden_glob:"…/*-plan.md", require_glob:"…/plan.dd.json"}` for "no -plan.md" (safety axis, caps); `file-content-matches {glob, pattern}` for `pressure:`/`satisfies` fields in the task dd (planted-friction A6-A9 is the exact precedent); `command-succeeds` resolved per-run to `harness plan validate --complete` (exit-0 = green gate) — this sidesteps the command_exit gap entirely.
4. The blind-subject run mechanics: `/flow-eval-run` beats, spawn-inside-worktree, `--subject-*`/`--base-ref` honesty flags, worktree telemetry sync before teardown.
5. The judged-lane registry (e.g. `explanation-matches-telemetry`) + render workflow.
6. Base-ref discipline: pin a base that includes 070's own dd-gate code, or the telemetry lane goes blind (`instructions.md:214-219`).

**Must build (the true delta):**
1. **Refusal evidence** — "at least one gate refusal evidenced" is currently unprovable from telemetry: refusals write nothing (`flow-mutations.ts:126-127`), error codes are never captured (`outcome-events.ts:69-90`). Chosen shape (tk-7169): capture `envelope.error.code` in `command_exit` (fixed-vocab, privacy-precedented via `checks.gates`/`mark.verdict`) — refusal lands in telemetry, the nothing-written flow invariant survives. Fallback if descoped: "no `dd-gate-override` force + gate green", assertable today but not literally "refusal recorded".
2. **SessionEvidence widening** for `command_exit` (and any of `file`/`artifact`/`mark` a new assertion wants) — all captured but deliberately excluded at `session-evidence.ts:311-333`; the extension's mirror at `resolvers.ts:40-68` must stay lock-step (a CLI test asserts this).
3. **"dd-surface mutations only"** ("never hand-edited generated md") — no existing assertion type distinguishes *who* wrote a file; nearest precedents: `command-succeeds` running a `dd build --check`-style drift verification, or a judged criterion cross-checking `file` events against dd verbs.
4. A new scenario bundle + prompts pair (dd-native builder single-phase) and one line-level update each to `instructions.md` and `flow-eval-run/SKILL.md` (the skill's own note says to iterate it after each real run, `SKILL.md:132-133`).

**Unverified / flagged:** plan 069's FX001 chain fix and discipline signals are on `origin/main` only, not this worktree (rebased at 64609beb — pre-#92); a subject worktree cut from this branch lacks them; `scratch/evals/2026-07-03-md-to-pdf/` (057's cited eval scoreboard) no longer exists in-tree; plan 046's flow spine was never closed (phase-4/ship `assumed`) though its code shipped; ledger verdict `PARTIAL` vs report `PASS_WITH_NOTES` is a deliberate rename at `ledger.ts:250`, not drift.

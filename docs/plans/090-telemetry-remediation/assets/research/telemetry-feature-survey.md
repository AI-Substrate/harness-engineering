# What the v1 harness telemetry actually enabled — feature survey

**Plan**: 090-telemetry-remediation · **Author**: pij-respectable-clam · **Date**: 2026-08-22
**Method**: measured against the live tree at `197540ee` and the published corpus — not
recalled from docs. Corpus numbers come from a full `git cat-file --batch` census of all
129 refs run for this survey; git-ai numbers from a full scan of the local store
(884,574 events) run the same day.

## Why this document exists

We are removing the v1 collector and deciding, feature by feature, what carries across
to git-ai. **An omitted feature and a forgotten one look identical six months out, and
the forgotten one gets refiled as a bug** — so this survey is the denominator: every
capability the old telemetry gave us, each with a named disposition. The companion
retention decision (for the published corpus itself) is a separate document; deleting
the verbs and deleting the data are two decisions, not one.

## The corpus being remediated (census, 2026-08-22)

- **129 refs** at `refs/harness-telemetry/YYYY/MM/DD/<session-uuid>`, span 2026-06-24 →
  2026-08-08 (publication stopped two days after git-ai was installed on 2026-08-06).
  Two refs are undated (`0000/00/00`) — a known producer defect, kept as-is.
- **17,996 segments, 75.05 MB** total (33.3 MB segment JSON + 43.5 MB OTLP jsonl).
- Harness spread: claude-code 17,794 · copilot-cli 145 · cursor-agent 48 · copilot-vscode 9.
- Schema spread: 1.0→2.7 (2.0 dominates with 17,478).
- **312 distinct product commits**, 8 branches (main: 16,314 segments).
- Command spread is the tell: `flow` 8,906 + the check family (`checks`/`markdown-lint`/
  `arch-check`/`windows-check`/`skills-check`) 8,796 = **~97% of all segments**. This
  corpus is overwhelmingly PROCESS telemetry — flow navigation and gate verdicts —
  not conversation data.
- 469 segments carry token windows. Token fields are CUMULATIVE session windows by
  contract — never summable across segments (the 63B naive sum is meaningless; noted
  here so nobody re-derives it as a headline).
- 21.2M wall-seconds observed; `checks` outcomes recorded: 45 degraded, 23 error.

## Feature families

### F1 — The sensor (produce side) — ALREADY OFF
Every `harness <verb>` ran a fail-safe capture preamble emitting counts-only events in
~21 kinds: `prompt, turn, usage, tools, skill, flow, flow_log, branch, harness, checks,
command_exit, subagent, compaction, model, api_error, artifact, file, mark, …`
(`services/telemetry/events.ts`). Off by default since plan 073
(`HARNESS_TELEMETRY_CAPTURE` gate); intact behind the flag.

### F2 — Flow semantics — NO git-ai ANALOGUE
- `flow-log.ts` / `flow-nav.ts` — read `the-flow.json` events (`cursor-moved`,
  `status-changed`, `node-created`, …): time-in-stage, stage transitions.
- `artifact-semantics.ts` (plan 050) — pure extractor registry over changed SDD
  artifacts: fixes-per-review, phases-per-plan, workshop depth. Structural markers
  only, closed enum vocabulary, never prose.

git-ai captures conversations and file edits; it has **zero concept** of a flow stage,
review cycle, or check verdict. Anything here we still want must be re-homed, not
assumed.

### F3 — Gate/check verdicts
The `checks` event kind recorded every gate's outcome per run (tests/biome/typecheck/
docs/parity/…), queryable per session and commit. git-ai does not capture this.

### F4 — Measures pipeline: `session save → report → report-render`
- `SessionExport` (identity-in-file, OTLP logs+metrics, honest `degraded[]`).
- `TelemetryReport` with **five rollup dimensions**: `flow_stage, skill, tool,
  bash_command, harness_command`; filters (harness/model/branch/date); estimate-honest
  attribution declared in-band (`timeline-bracket` time, `turn-window-even-split`
  tokens); token coverage as `measured/partial/unavailable` + closed reason.
- `report-render` — N reports as N labelled columns: the **A/B comparison surface**
  (model-vs-model, arm-vs-arm).
- Central storage layout `<root>/<org__repo>/<date>/{sessions,reports}/` so org/repo/day
  rollups are recursive sweeps.

### F5 — Cohort insights (plan 048, WS001)
Seven insight sections + **loop-discipline panel** over N single-session reports.
Epistemic envelope on every row (`{claim, measures, n, interval?, caveat}`); the LLM
narrates but never computes a rendered number; below-threshold rows suppressed; era
gaps render as UNMEASURABLE rather than confident zeros. Consumes reports only.

### F6 — Eval/conformance evidence lanes — THE LIVE RUNTIME DEPENDENCY
- `telemetry get <pij-id>` → `SessionEvidence` (harness_verbs/skills/tools/refusals
  counts + source honesty `buffer|ref|buffer+ref`). This is **flow-eval's telemetry
  lane**: `.harness/extensions/flow-eval/extension.ts:100` shells `harness telemetry
  get --json`; every telemetry assertion resolves through it (missing ⇒ `unknown`,
  never `fail`). flow-eval also calls `telemetry session save` to snapshot per-run cost.
- `telemetry get-fleet` (plan 051) → orchestrator+children joined into `FleetEvidence`
  with honest cost/time totals.
- `telemetry mark` — read-only reviewer peers stamp shape-guarded verdicts (slugs +
  integer finding counts, no free text) onto their own lane.
- Note: flow-eval's FS lane **is already DD-aware** (resolvers read `plan.dd.json` /
  `tasks.dd.json` / `done_when` / pressure links; FX003 tests are built on DD shapes).
  The dd migration did not break flow-eval; removing `telemetry get` WOULD break its
  telemetry + composite lanes.

### F7 — Remote fleet reads: `ls` / `pull` / `sweep`
Inventory + pull published sessions from any repo URL by session/date/commit-range into
a deterministic bundle; `sweep` rebuilds a month from refs alone (per-session export
cache). **This is the portability the refs bought** — any clone could read the fleet's
telemetry with no extra infrastructure.

### F8 — Privacy/honesty machinery (cross-cutting)
Counts-only capture gate, fixture scrubbing, allowlisted `captured_env` (PIJ_* only),
no identity reads on the read path, `rollup.truncated` never-silent caps, declared
estimate attribution. These are properties the v2 design should keep as REQUIREMENTS
even where the implementation goes.

## Parity map (draft dispositions — for the plan to ratify)

| # | Feature family | git-ai equivalent | Draft disposition |
|---|---|---|---|
| F1 | counts sensor | far richer capture (verbatim, 3.7 GB local) | REPLACED — delete |
| F2 | flow semantics | none | GAP — decide port-or-drop explicitly |
| F3 | gate verdicts | none | GAP — decide port-or-drop explicitly |
| F4 | reports/rollups/A-B | none built (data supports it) | REBUILD later over git-ai store; delete v1 impl |
| F5 | cohort insights | none | DROP ON PURPOSE unless F4 rebuilt |
| F6 | eval evidence lanes | none | **BLOCKING** — flow-eval needs a replacement or an explicit degrade ruling before `get`/`get-fleet`/`mark` go |
| F7 | remote reads / refs | worse (884k rows, none delivered) | DROP the refs mechanism; the off-machine question becomes v2's first design question |
| F8 | privacy/honesty contracts | partial (git-ai redacts secrets; but stores verbatim text) | CARRY AS REQUIREMENTS |

## The storage lesson (Jordan's constraint, with its reason)

Rule: **git-ai data does not go into git refs the way v1 telemetry did.** Reason, so it
survives the people who remember it: refs did not fail because they are refs — they
failed because the useful volume never fit. What shipped to refs was the thin part
(396 attribution notes; 75 MB of counts), while the 3.7 GB that answers real questions
sat in a local store with `delivered_ts` NULL on all 884,574 rows — never delivered,
never replicated, invisible off-machine. A future design that says only "refs are off
the table" will eventually re-derive refs as a clever idea; one that says "we tried it,
and the volume that mattered never travelled" will not.

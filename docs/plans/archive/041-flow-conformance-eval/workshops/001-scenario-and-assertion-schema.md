# Workshop: Scenario bundle format + assertion-config schema + resolver taxonomy

**Type**: Data Model / Storage Design
**Plan**: 041-flow-conformance-eval
**Spec**: (pre-plan — seeded from `research-dossier.md` + `original-ask.md`)
**Created**: 2026-06-29T03:10:00Z
**Status**: Draft

**Value Thesis**: Settles the one load-bearing contract of the whole eval harness — what a *scenario* is on disk and how each *assertion* resolves to a verdict — so the plan builds phases around a fixed shape instead of guessing it, and every future scenario is pure data (no engine change).
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Implementation Readiness**: the plan can lift these schemas verbatim into phases.
- **Agent Readiness**: the runner dispatches assertions by `type` with zero inference.
- **Proof Quality**: every assertion declares *how* it is proven (telemetry / fs / judged) — determinism is explicit, not assumed.
- **Learning Compounding**: scenarios accrete as data; "later we add more" costs an `assertions.json`, not code.
- **Cost / Attention Reduction**: a deterministic green/red report means the human reads only the judged layer.

**Related Documents**: `../research-dossier.md` (F-01..F-11, esp. F-05/F-06 telemetry join, F-07 query gap), `../original-ask.md`

---

## Purpose

Define (a) the **scenario** on-disk bundle, (b) the **assertion** config schema, (c) the **resolver taxonomy** that turns each assertion into a deterministic-or-judged verdict, and (d) the **report** output shape. This is the contract the runner, the prompts, and the scorer all bind to.

## Fresh Entrant Outcome

A fresh human or agent can use this workshop to reach **Contract Ready**: author a new scenario directory, write its `assertions.json` from the type registry, and know exactly which lane (telemetry / fs / judged) proves each line — with no further clarification.

## Key Questions Addressed

1. What files is a scenario made of, and where do scenarios vs reports live?
2. What is the assertion schema, and what is the full `type` vocabulary?
3. How does each `type` resolve — which lane reads what, and how are capability gaps (telemetry nulls) handled without false failures?
4. What does the report look like (deterministic score + thin judged layer)?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | The plan needs fixed schemas to phase against; quality of the *runner* is a later (Validated) loop. |
| Primary Value Axis | Proof Quality | The whole harness exists to turn "did it obey the flow?" into evidence; the resolver taxonomy is that promise. |
| Supporting Value Axes | Implementation Readiness · Agent Readiness · Learning Compounding | Schemas the plan lifts; data-driven extensibility. |
| Downstream Loop Improved | Implementation + every future scenario | Phases bind to a frozen shape; new scenarios are config-only. |

---

## 1 · The scenario bundle (Storage Design)

**Decision — committed scenarios vs ephemeral reports are separate trees:**

```
live-testing/scenarios/<scenario-slug>/      # COMMITTED source-of-truth (version-controlled inputs)
  scenario.json                              # task · worktree base · subject defaults · flow choreography
  prompts/
    orchestrator.md                          # how the orchestrator drives the-flow over pij
    subject.md                               # the BLIND packet — eval framing + report contract ONLY
  assertions.json                            # the config-driven checks

.harness/live-testing/<scenario-slug>/<run-id>/   # EPHEMERAL output (gitignored, per the ask)
  report.json                                # machine verdict (deterministic results + judged fields)
  report.md                                  # human-readable rendering
  raw/                                       # captured telemetry slice + worktree manifest (evidence trail)
```

**Why split**: scenario definitions are reusable, reviewed inputs (they belong in git); run reports are throwaway evidence per the ask's stated path `.harness/live-testing/<slug>/<report>`. Mixing them would put churn in source control and make "add a scenario" a diff against output. `<run-id>` is a timestamp+short-id so repeated runs of the same scenario (e.g. Opus vs GPT) don't collide.

### `scenario.json` (schema)

```jsonc
{
  "slug": "md-to-pdf",
  "title": "Add a markdown→PDF harness extension (mermaid, validated)",
  "task": "Create a git worktree of this repo and add a new harness extension that converts markdown to PDF, including mermaid diagrams, with validated outputs.",
  "base":    { "repo": ".", "ref": "v0.6.0" },         // worktree pinned to a tag/SHA → runs are comparable
  "subject": { "harness": "claude", "model": "opus", "effort": "high" },  // overridable per run
  "flow": {
    "mode": "simple",                                   // the ask: planning selects Simple
    "stages": ["explore","plan","validate","compact","implement","review","fix","validate"]
  },
  "prompts":    { "orchestrator": "prompts/orchestrator.md", "subject": "prompts/subject.md" },
  "assertions": "assertions.json"
}
```

`subject` is the **matrix knob** — the same scenario re-run with `{harness:"copilot",model:"gpt-5.5"}` is how Opus-vs-GPT comparison happens. The runner records the *resolved* subject (incl. the live `pij_session_id`) in the report.

---

## 2 · The assertion schema (Data Model)

`assertions.json` is **one flat list**; each entry declares its own resolver lane via `source`. (Decision Q2 below: per-assertion `source`, not a split judged section — uniform dispatch.)

```jsonc
{
  "scenario": "md-to-pdf",
  "assertions": [
    {
      "id": "A1",                       // stable, report-referenced
      "type": "skill-called",           // dispatched to a resolver (registry §3)
      "source": "telemetry",            // lane: telemetry | fs | fs+telemetry | judged
      "required": true,                 // a required FAIL caps the run verdict
      "weight": 1,                      // contribution to the deterministic score
      "params": { "skill": "the-flow", "min": 1 },
      "describe": "Subject drove the SDD journey via /the-flow"
    }
  ]
}
```

Field contract:

| Field | Req | Meaning |
|-------|-----|---------|
| `id` | ✓ | stable handle; appears in the report |
| `type` | ✓ | resolver key (registry §3) |
| `source` | ✓ | `telemetry` \| `fs` \| `fs+telemetry` \| `judged` — declares the lane(s); validated against the type's allowed lanes |
| `params` | ✓ | type-specific (see registry) |
| `required` | – | default `false`; a required assertion that resolves `fail` caps the run to FAIL |
| `weight` | – | default `1`; deterministic score = Σ(weight of pass) / Σ(weight of resolvable) |
| `describe` | – | human label for the report row |

---

## 3 · The resolver taxonomy + `type` registry (the core contract)

Three lanes; each `type` belongs to one (or a composite). The scorer dispatches **by `type`** to a resolver fn that knows its lane.

**Lane A — telemetry** (deterministic; joins the subject's segments by `captured_env.PIJ_SESSION_ID`, aggregated across *all* the session's segments — F-05/F-06):

| `type` | params | Resolves from | Proves |
|--------|--------|---------------|--------|
| `skill-called` | `{skill, min?=1}` | `segment.skills{}` + `event_stream kind:skill` (summed) | a skill ran ≥ min times |
| `skill-sequence` | `{skills:[…], ordered?=true}` | first-occurrence order in `event_stream kind:skill` | e.g. explore → plan → implement order |
| `flow-seam-fired` | `{hook}` | `event_stream kind:flow`/`kind:harness` carrying the hook | e.g. `pre-coding` backpressure seam fired |
| `harness-verb-ran` | `{verb, min?=1}` | `event_stream kind:harness` (verb match) | e.g. `observe`, `retro`, `checks` invoked |
| `checks-ran` | `{status?}` | `event_stream kind:checks` (+ `status`) | `harness checks` ran (optionally ok) |
| `tool-used` | `{tool, min?=1}` | `event_stream kind:tools` | e.g. `Write`/`Edit` used |
| `compaction-occurred` | `{min?=1}` | `event_stream kind:compaction` | the orchestrator-driven compact happened |

**Lane B — fs** (deterministic; reads the subject's **worktree**):

| `type` | params | Resolves from | Proves |
|--------|--------|---------------|--------|
| `file-created` | `{glob \| path}` | worktree FS | output file exists (e.g. `.harness/extensions/*/extension.ts`) |
| `file-content-matches` | `{path, pattern}` | regex over file | e.g. extension exports a `HarnessVerb` |
| `artifact-exists` | `{glob}` | worktree FS | e.g. `docs/plans/*/the-flow.json`, a retro record, a plan doc |
| `command-succeeds` | `{cmd, cwd?, expect_exit?=0}` | run in worktree | the real deterministic-behaviour lane — e.g. `harness <new-ext> --help`, the new sensor passes, the PDF renders |

**Composite — fs+telemetry** (AND of both lanes; the two-signal proof for facts telemetry alone can't close — F-08 / risk row):

| `type` | params | Resolves from | Proves |
|--------|--------|---------------|--------|
| `retro-drained` | `{evidence_glob}` | telemetry `harness verb:retro` **AND** a retro record file exists | retro actually drained, not just narrated |

**Lane C — judged** (inferential; the orchestrator LLM fills a verdict — the thin layer the ask asks for):

| `type` | params | Resolves from | Proves |
|--------|--------|---------------|--------|
| `judged` | `{field, prompt, rubric?}` | orchestrator LLM over evidence | quality calls: "did it build a **proper** backpressure checker?", "checkpoints done right?" |

### Verdict values — three-valued, never punish a gap

Every assertion resolves to one of:

- **pass** / **fail** — deterministic lanes A/B/composite.
- **unknown** — the data needed isn't available (a telemetry capability gap, not a subject failure): `plans_touched` empty under a worktree cwd, `subagents[].tokens` null on Copilot (F-06 / H-01). `unknown` is **excluded from the denominator** — it never counts as fail. The report lists it so the gap is visible.
- **judged** — Lane C; carries `{verdict, rationale, by}`, reported separately from the deterministic score.

**This is the determinism boundary made explicit**: pass/fail is earned only where the evidence is real; everything else is honestly `unknown` or `judged`.

---

## 4 · The report (output contract)

`.harness/live-testing/<slug>/<run-id>/report.json`:

```jsonc
{
  "scenario": "md-to-pdf",
  "run_id": "2026-06-29T0410-ab12",
  "subject": { "harness": "claude", "model": "opus", "pij_session_id": "pij-ab12cd" },
  "base_ref": "v0.6.0",
  "started_at": "…", "finished_at": "…",
  "deterministic": {
    "score": 0.90,                         // Σ(weight pass) / Σ(weight of pass+fail)  (unknowns excluded)
    "passed": 9, "failed": 1, "unknown": 1, "total": 11,
    "required_failed": 0,                  // >0 ⇒ run verdict capped to FAIL
    "results": [
      { "id": "A1", "type": "skill-called", "status": "pass", "source": "telemetry",
        "evidence": "skills['the-flow']=4 across 7 segments" }
    ]
  },
  "judged": [
    { "field": "backpressure_quality", "verdict": "partial",
      "rationale": "Added a `pdf-validate` sensor but it only checks file size, not mermaid render fidelity.",
      "by": "orchestrator:claude-opus-4-8" }
  ],
  "verdict": "PASS_WITH_NOTES"             // PASS | PASS_WITH_NOTES | FAIL  (FAIL iff required_failed>0)
}
```

`report.md` renders the same data: a deterministic results table (✓/✗/? per row), then a judged section, then a one-line verdict. The deterministic table is the trustworthy core; the judged section is explicitly labelled inferential.

---

## 5 · Worked example — `md-to-pdf/assertions.json`

```jsonc
{
  "scenario": "md-to-pdf",
  "assertions": [
    { "id":"A1","type":"skill-called",   "source":"telemetry","required":true, "params":{"skill":"the-flow"},          "describe":"drove the SDD journey via /the-flow" },
    { "id":"A2","type":"skill-sequence", "source":"telemetry","params":{"skills":["explore","plan","implement"]},        "describe":"explore→plan→implement in order" },
    { "id":"A3","type":"skill-called",   "source":"telemetry","params":{"skill":"eng-harness-flow","min":1},            "describe":"engaged the harness loop" },
    { "id":"A4","type":"flow-seam-fired","source":"telemetry","params":{"hook":"pre-coding"},                            "describe":"hit the backpressure seam before coding" },
    { "id":"A5","type":"compaction-occurred","source":"telemetry","params":{"min":1},                                   "describe":"compacted before implement (orchestrator-driven)" },
    { "id":"A6","type":"file-created",   "source":"fs","required":true,"params":{"glob":".harness/extensions/*/extension.ts"}, "describe":"created the new extension" },
    { "id":"A7","type":"command-succeeds","source":"fs","required":true,"params":{"cmd":"node harness/cli/dist/index.js <ext> --help"}, "describe":"the extension loads + registers" },
    { "id":"A8","type":"command-succeeds","source":"fs","params":{"cmd":"<the subject's own pdf validation>"},           "describe":"produced a validated PDF output" },
    { "id":"A9","type":"checks-ran",     "source":"telemetry","params":{"status":"ok"},                                  "describe":"ran harness checks green" },
    { "id":"A10","type":"retro-drained", "source":"fs+telemetry","params":{"evidence_glob":".harness/records/retro/**/*.md"}, "describe":"drained the retro to a record" },
    { "id":"A11","type":"judged",        "source":"judged","params":{"field":"backpressure_quality",
        "prompt":"Did the subject design a PROPER deterministic backpressure checker for the PDF output (e.g. a sensor that validates mermaid render fidelity), or a token gesture?"}, "describe":"backpressure design quality" }
  ]
}
```

---

## Decision Space

| Option | Description | Decision |
|--------|-------------|----------|
| **Scenario location** — `live-testing/scenarios/` (committed) vs under the plan folder vs all in `.harness/` | Keep committed inputs separate from gitignored run output | **Selected**: `live-testing/scenarios/<slug>/` committed; reports `.harness/live-testing/<slug>/<run-id>/` |
| **`source` placement** — per-assertion vs a separate `judged:[]` block | Per-assertion keeps one flat list + uniform dispatch | **Selected**: per-assertion `source` |
| **Gap handling** — `unknown` as a third state vs counting it as fail | A telemetry capability gap is not a subject failure (H-01) | **Selected**: three-valued; `unknown` excluded from the score denominator |
| **Telemetry read path** — new `harness telemetry get <session>` verb vs the eval extension scans the buffer directly | F-07: no query verb exists today | **Recommended**: a small read-only `telemetry get <pij-session-id>` verb (reusable + unit-testable), with `pij path <id> --dir` as the cwd-independent locator; final call is the plan's |
| **Resolver impl** — config-interpreter in one eval extension vs many tiny verbs | One scorer dispatching by `type` is simplest | **Selected**: single scorer module, `type`→resolver map |

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation (the plan) | guess the scenario shape + assertion schema | lift §1–§4 schemas verbatim |
| Adding scenario #2 | unclear what's data vs code | drop a `scenarios/<slug>/` dir; engine untouched |
| Review | re-derive what each check proves | every assertion declares its lane + evidence |

## Open Questions

### Q1: Where does the subject's telemetry buffer land when it runs in a *worktree*?
**OPEN** (planning spike) — buffer path is cwd-relative `.harness/temp/telemetry/` (F-04); a worktree may write under its own tree. **Mitigation in contract**: telemetry resolvers locate the session dir via `pij path <id> --dir` (cwd-independent) and fall back to scanning both the main repo and the worktree. Confirm empirically in Phase 1.

### Q2: Does `skill-called` need to distinguish orchestrator vs subject skills?
**RESOLVED** — the join is on the *subject's* `PIJ_SESSION_ID`; only the subject's segments are read, so orchestrator activity is naturally excluded.

### Q3: Should `command-succeeds` run inside the worktree or a clean checkout?
**RESOLVED** — inside the subject's worktree (that *is* the artifact under test); the resolver sets `cwd` to the worktree root.

---

## Validation / Acceptance

This workshop is Contract Ready when:
- A new scenario can be authored from §1–§2 with no further questions. ✓
- Every `type` in §5's example maps to a registry row with a defined lane + params. ✓
- The determinism boundary (pass/fail vs unknown vs judged) is unambiguous. ✓
- The plan can phase against these schemas (scenario format · assertion schema · resolver set · report) without inventing shape. ✓

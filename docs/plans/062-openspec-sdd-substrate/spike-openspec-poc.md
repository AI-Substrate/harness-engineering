# Spike: OpenSpec blind-subject planning POC — synthesis

**Captured**: 2026-07-17 · **Flow node**: `spike-openspec-poc` (excursion off `plan`)
**Subjects**: two blind agent subjects in separate harnesses — a **Pi subject** (Pi harness, default model) and a **Copilot subject** (Copilot CLI, gpt-5.6-sol, effort high).
**Method**: OpenSpec 1.6.0-beta.1 was invoked via a package runner to initialize worktree-local integration files (`openspec init --tools pi,github-copilot,claude`); each subject then ran a blind, planning-only OPSX pass on a distinct toy change in this worktree. No product edits, commits, or archive. Raw run evidence (subject reports, run roster, per-file hash inventory) and package-runner/network limitations are retained privately outside tracked paths.

## Outcome

| Subject | Change | Result | Strict validation | Usability (self-scored) |
|---|---|---|---|---|
| Pi | `add-flow-stats-command` | apply-ready, 4/4 artifacts | ✅ 1/1 passed, 0 issues (independently re-run by the lead) | 4/5 |
| Copilot | `add-telemetry-summary-command` | apply-ready, 4/4 artifacts | ✅ 1/1 passed, 0 issues (independently re-run by the lead) | 4/5 |

## Convergent findings (both subjects, independently)

| # | Finding | Evidence | Plan implication |
|---|---|---|---|
| C-1 | **JSON-first CLI is excellent for agents**: `status`/`instructions --json` carried resolved paths, the dependency DAG, and `applyRequires`; resolved paths prevented out-of-fence writes; the validation envelope is versioned (`"version": "1.0"`) | both subject reports | Confirms dossier F-04: the deterministic bridge surface is real and consumable across harnesses |
| C-2 | **Global-binary assumption breaks portability**: generated skills hardcode a bare `openspec` binary (and `allowed-tools: Bash(openspec:*)`); both subjects needed an out-of-band package-runner substitution | both subject reports | Any harness composition must ship a pinned, repo-local runner — also answers dossier R-01's pinning concern |
| C-3 | **Generated skills are coupled to one agent product's tool names** (`TodoWrite`); other harnesses had to map the intent to their own facilities | both subject reports | Schema/template customization should use tool-neutral capability language; upstream-issue candidate |
| C-4 | **Zero project-context discovery**: an empty `config.yaml` contributed nothing; both subjects had to research repo conventions outside OpenSpec to make artifacts implementation-ready | both subject reports | Exactly the explore-stage/context-injection gap the builder flow fills — the strongest evidence that builder+OpenSpec is complementary, not substitutive |
| C-5 | **Filesystem-existence state worked flawlessly** — each artifact write advanced status immediately; no hidden session state | both subject reports | The deterministic `openspec status --json → harness flow` sync proposed in the dossier is viable as designed |

## Divergent findings

| # | Finding | Subject | Plan implication |
|---|---|---|---|
| D-1 | **Entry-point surfacing is harness-dependent**: the Copilot CLI surfaced the generated repo-local skill natively and loaded it; the Pi subject's generated slash commands never surfaced in an API-driven session, so the skill degraded to documentation followed manually | Copilot ✓ / Pi ✗ | The "front door" cannot be assumed; an orchestrator must be able to drive OPSX via the CLI alone. Note also: OpenSpec's Pi adapter writes `.pi/`, not `.agents/` — Pi's actual discovery paths need confirming |
| D-2 | **CLI surface inconsistencies**: `validate` takes the change name positionally and rejects `--change`, unlike the other change-scoped verbs; a bare `status --json` errors rather than pointing at `list --json` | Copilot | Small upstream-issue candidates; bridge code must use exact per-verb syntax |
| D-3 | **Prose hint vs data drift**: `nextSteps` named only `design` while the authoritative `artifacts` array showed `design` and `specs` both ready | Pi | Any bridge trusts the `artifacts` array, never the prose hint |

## Open decisions (carried to the plan — unchanged from the dossier, now evidence-backed)

1. **Composition mode** — POC evidence strengthens the schema+adapter option: the CLI is fully drivable headless (D-1 shows generated front doors are unreliable), so an orchestrating spine can drive OPSX without depending on generated skills.
2. **State ownership** — C-5 confirms spine-as-orchestrator with OpenSpec state as derived input is workable.
3. **Artifact home** — the POC ran `openspec/changes/` and `docs/plans/` side-by-side with zero collision.
4. **Seam carrier** — D-1 argues for spine-driven seams (generated entry points can silently fail to surface).
5. **Delta-spec corpus adoption** — deliberately untouched by this POC (no archive run); still open.

## Disposition recommendation (decision belongs to governance, not this spike)

**Pre-existing tracked files — never delete or modify** (in-place before this experiment; the ignore rule for `.claude/skills/` has two deliberate tracked exceptions):
- `.claude/skills/flow-eval-run/SKILL.md`
- `.claude/skills/telemetry-insights-narrate/SKILL.md`

**Newly generated OpenSpec substrate (exact, 37 files) — retain-private for the experiment's remainder, then delete; never track as-is** (regenerated trivially by `openspec init`; tracking generated output contradicts its regeneration model, dossier F-05):
- `.claude/commands/opsx/{apply,archive,explore,propose,sync,update}.md` (6, untracked)
- `.claude/skills/openspec-{apply-change,archive-change,explore,propose,sync-specs,update-change}/SKILL.md` (6, already gitignored via `.claude/skills/`)
- `.github/prompts/opsx-{apply,archive,explore,propose,sync,update}.prompt.md` (6, untracked)
- `.github/skills/openspec-{apply-change,archive-change,explore,propose,sync-specs,update-change}/SKILL.md` (6, untracked)
- `.pi/prompts/opsx-{apply,archive,explore,propose,sync,update}.md` (6, untracked)
- `.pi/skills/openspec-{apply-change,archive-change,explore,propose,sync-specs,update-change}/SKILL.md` (6, untracked)
- `openspec/config.yaml` (1, untracked)

**POC change artifacts (10 files, byte-frozen) — retain-private until plan 062 is written, then delete** (toy-change evidence; the learnings live here and in the retained private reports):
- `openspec/changes/add-flow-stats-command/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/flow-stats/spec.md}`
- `openspec/changes/add-telemetry-summary-command/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/telemetry-buffer-summary/spec.md}`

**Plan artifacts — propose-tracking** (inside the authorized 062 plan fence; the durable, reviewable record):
- `docs/plans/062-openspec-sdd-substrate/{original-ask.md,research-dossier.md,spike-openspec-poc.md,the-flow.json,the-flow.md}`

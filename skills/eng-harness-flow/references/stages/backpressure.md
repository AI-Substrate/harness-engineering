# backpressure

> Sub-skill — owns sensor discovery and its survey artifact, not flow position.

**Verb**: backpressure
**Purpose**: Select the actual proof approach for each planned criterion and experienced failure mode before implementation. Selection is not execution.
**Consumes**: `plan.dd.json`, its criteria/risks/outcome phases, separate `assets/impl-guide.dd.json` when present, and actual repository tooling. Historical Markdown plans/specs remain readable without migration.
**Flags**: `--plan <path>` / `--spec <path>`
**Produces**: `${PLAN_DIR}/assets/backpressure.dd.json` (`builder/backpressure`) and generated `backpressure.dd.md`. No separate Markdown-only truth or rollup ledger.
**Side effects**: writes its survey through `node_modules/.bin/ddocs`; proposes plan/guide changes to their owner, never silently edits them.

## Advisory invariant

The survey is mandatory to surface, human-declinable, and never a score, compliance floor or automatic plan-status change. Missing proof is a finding to discuss, not permission to fabricate a green result. Certainty uses only `Partial|Confident|Proven`, as the canonical schema declares. Proven requires actual current receipts; having a selected command is at most Confident.

## Procedure

1. Resolve the plan, preferring `plan.dd.json`. Read ACs, non-goals, risks, and any existing guide's boundaries/checks. No plan means nothing to survey: name the missing input. Historical `*-plan.md`/`*-spec.md` are a read path, never an instruction to rewrite completed history.
2. Map workspace/package roots from manifests and actual directories. Inspect build recipes, test/e2e configurations, schema validators, architecture/dependency rules, CLI smoke paths and CI in every root. Search signatures, not just recipe names: a root-only test script cannot prove that another package lacks browser coverage. Governance/docs corroborate; files and observed commands decide.
3. Mine named precedent features for their actual checks. For every discovered sensor record its name, paved command, dimension and source location in `sensors`. Ambient/floating commands without a supported entrypoint are pave-targets, not current proof.
4. Enumerate concrete failure modes: startup, integration, side effects, dependency direction, contracts, security boundaries, data integrity, rendering and experienced interaction. Match each AC/failure mode to its outcome phase and exact proof. Avoid choosing a broad suite merely because it is convenient.
5. Select RUN/EXTEND/BUILD/ABSENT using the canonical recipe in `builder/references/backpressure-recipe.md` (shipped with Builder); the corresponding stored `mode` values are `EXISTS|EXTEND|BUILD|ABSENT`. `proof` names the selected command and extension/build, `probe` records discovery, and `tier` is `computational|human-judgement`. ABSENT carries a real probe trail and named judgement, not a fake command. Prefer extending an existing wired sensor to creating a new one.
6. Author `assets/backpressure.dd.json` using the local pinned DD CLI. Use the Builder `templates/backpressure.template.json` seed only when absent; keep existing row IDs on regeneration. Populate `meta.title`, `meta.plan`, `meta.basis_sha`, `meta.certainty`, `rows` and `sensors`. Never edit its generated sibling.
7. Hand the plan owner exact links: every AC's `pressure` → `assets/backpressure.dd.json#rows/bp-XXXX`; every task assertion's `pressure` → its correct relative survey row; after actual execution, AC `proven_by` → execution-log entry. The recipe contains the runnable writer sequence and correct relative paths. Record the final surveyed-plan hash after the owner attaches those links, not a self-invalidating pre-link basis.
8. If observed proof is available, preserve exact command/cwd/status/output/subject and link the real execution entry; otherwise leave row state unchecked. The owner chooses whether to extend/build a missing instrument. Propose Phase 0 only for material computational gaps, not as automatic bureaucracy.
9. Validate the DD document and generated sibling with the local CLI. This proves schema/rendering, not feature behavior. Do not confuse that validation with the selected RUN proof.

```bash
node_modules/.bin/ddocs get "${PLAN_DIR}/assets/backpressure.dd.json#rows"
node_modules/.bin/ddocs set "${PLAN_DIR}/assets/backpressure.dd.json#meta/certainty" Partial
node_modules/.bin/ddocs validate "${PLAN_DIR}/assets/backpressure.dd.json"
node_modules/.bin/ddocs build "${PLAN_DIR}/assets/backpressure.dd.json" --check
```

## Closing verdict

Name what commands can prove, what must first be extended/built, and the judgement that remains. Say what was already recorded separately from what needs approval. Mode counts describe the task; they never become a percentage or score. Recommend in order: close risk-linked gaps; architecture/behavior before incidental maintainability; extend before build. If no deterministic proof is possible, explicitly offer the human the choice to proceed with that limitation.

End with `In summary:` and the honest split: selected proof, unproven/human calls, and the exact requested next decision. Link the canonical artifact. Never say the feature is done because a survey or schema validation passed. Missing governance is not missing tooling; report absence only after a grounded multi-root search.

## Exit

Report source/view paths, basis, certainty, selected modes, probe gaps and exact proposed AC/assertion links. Picking the next harness action belongs to the router.

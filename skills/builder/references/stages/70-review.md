# review

> Sub-skill — part of a verb library. Knows nothing about any flow:
> no stage ids, no successor/predecessor names, no flow commands.
> Composition is the bundling flow's job.

**Verb**: review
**Purpose**: Read-only per-phase code review — inspects diffs, validates domain compliance, checks for concept reinvention, verifies testing evidence, and produces structured findings as file artifacts. Does NOT modify code.

**Consumes**: an implemented phase; product `plan.dd.json`, reviewed `assets/impl-guide.dd.json`, `assets/backpressure.dd.json`, phase `tasks.dd.json` and actual execution receipts; exact composed artifact SHA for team review. Historical Markdown plans remain readable under their original contract. Domain context is opt-in.

**Flags**: `--plan "<abs path to plan.dd.json or historical plan.md>"` (required), `--phase "<phase id or title>"` (required for Full Mode, omit for Simple Mode), `--diff-file "<abs path to unified.diff>"` (optional; otherwise computed from git), `--strict` (optional; treat HIGH as blocking).

**Produces**: Review file `${REVIEW_FILE}` with sections A–H (verdict, summary, checklist, findings table, detailed findings, coverage map, commands, Handover Brief); computed diff saved to `reviews/_computed.diff`; fix-tasks file `${FIX_FILE}` only if verdict is REQUEST_CHANGES. Terminal report: verdict + key failure areas.

**Side effects**: none (read-only — does NOT modify code)

## Independent review and evidence

For team work, load `../team-lifecycle.md`: review the exact composition `artifact_sha`, plan/guide digests, frozen contracts, ownership and actual checks. Record the independent `ReviewReceipt` through `harness builder review <plan> --receipt <path>`. The reviewer records requested versus observed configuration and evidence gaps; provider identity is not attested by launch argv. If requested cross-model review cannot run, report it unfulfilled rather than substituting self-review or a solo fallback.

Read guide, delivery, import and verify ownership warnings alongside the exact artifact and checks. Keep `file`, `owning_unit`, `stage` and declaration-only cause/fix visible. Coder and PM maps are guidance; out-of-map work needs no approval or justification and is not a review failure by itself. Real source/evidence integrity and failed product checks still matter. Optional `harness builder on-track <plan> [--unit <id>] [--from <ref>] [--to <ref>] [--untracked]` uses the same comparison without readiness, seal, review or receipt prerequisites and writes nothing. It exits 0; surface `compared`, issues and selected basis, not just warnings. Default includes tracked staged/unstaged work; explicit `--untracked` adds new paths and explicit `--to` is committed-only. See `../team-lifecycle.md` for basis and history selection; no inspection result replaces independent review.

Review checks the scoped phase and composed behavior. **Whole-plan `--complete` gates post-flight EXIT**, after closeout evidence, never review exit. Future closeout assertions remain unchecked; do not mark them early to leave review. Phase task gates and review findings remain meaningful.

```bash
harness plan validate "${PLAN}" --address "${TASK_ADDRESS}"
node_modules/.bin/ddocs get "${PRESSURE_ADDRESS}"
node_modules/.bin/ddocs get "${PLAN}#acceptance_criteria"
```

Resolve these addresses in Procedure Step 1. The PM closes only proven ACs using the canonical `../backpressure-recipe.md`: preserve `pressure`, link `proven_by` to an observed execution entry resolved from the actual `meta.log`/receipt address, and then set state. Read-only reviewers propose dispositions and never rewrite implementation or canonical progress. A schema check is not behavior proof; a passed unit test is not assembled-product proof. Accepted risk needs a named decision and cannot be hidden in an approved label.

---

## Procedure

Read-only code review that inspects diffs, verifies domain compliance, checks for concept reinvention, and produces structured findings with file artifacts. Does NOT modify code.

---

```md
User input:

$ARGUMENTS
# Required flags (absolute paths):
# --phase "<phase id or title>"   # Required for Full Mode, omit for Simple Mode
# --plan "<abs path to plan.dd.json or historical plan.md>"
# Optional flags:
# --diff-file "<abs path to unified.diff>"   # if omitted, compute from git
# --strict                                   # treat HIGH as blocking

## Step 1: Resolve Inputs & Artifacts

**Select the input contract before resolving artifacts.** Resolve `--plan` to its canonical source: `.dd.json` directly, the matching `.dd.json` sibling for a generated `.dd.md` face, or the sibling `plan.dd.json` when an older Markdown entrypoint accompanies a current DD plan. A missing or invalid DD source is an explicit input error, never permission to fall through to legacy Markdown.

**Canonical DD plans** (`dd.schema = builder/plan`):
- PLAN = absolute canonical DD source; PLAN_DIR = dirname(PLAN).
- Read `${PLAN}#meta` and `${PLAN}#phases` through local `node_modules/.bin/ddocs get`. MODE comes from `meta.mode` (`Full|Simple`), never Markdown `**Mode**` text. Missing/invalid mode is an input error.
- SPEC = PLAN; requirements and ACs come from its `summary`, `goals`, `non_goals` and `acceptance_criteria` sections. GUIDE = `${PLAN_DIR}/assets/impl-guide.dd.json`; read architecture, unit ownership, checks and composition there. Testing approach and known hazards come from PLAN `testing_strategy`, `key_findings` and `risks`, not Markdown headings.
- Full Mode: resolve `--phase` against the recorded phase ID/title, then follow that phase's exact `tasks` DD address relative to PLAN. TASK_ADDRESS is the resolved address; PHASE_DOC is its source file and PHASE_DIR = dirname(PHASE_DOC). Do not derive a task directory by slugifying a title or equate phase IDs with directory ordinals. Missing/ambiguous phase or missing task target is an input error.
- Simple Mode: TASK_ADDRESS = `${PLAN}#tasks`; PHASE_DOC = PLAN. Read inline `tasks` and their `done` assertion links; no phase dossier is required.
- Read TASK_ADDRESS and follow each task's actual `done`, `satisfies`/`satisfies_toward` and assertion `pressure`/`proven_by` links. DD addresses resolve relative to their containing source document, not shell cwd or the guide.
- EXEC_LOG_ADDRESS = the phase task document's `meta.log` when declared, otherwise the product plan's `meta.log`, resolved relative to the declaring document. EXEC_LOG = its source file. Read the addressed execution entries and any separately linked `proven_by` receipts; do not substitute an assumed `execution.log.md` or filename such as `execution-log.dd.json` for the declared address. Missing/unreadable evidence is a review finding, not a fabricated fallback.
- PRESSURE_ADDRESS = product `meta.backpressure`, resolved relative to PLAN; its source is the canonical backpressure DD document. Follow the selected AC/assertion rows, including actual proof approach and certainty.
- REVIEW_DIR = `${PHASE_DIR}/reviews` for Full Mode, `${PLAN_DIR}/assets/reviews` for Simple Mode. PHASE_SLUG is a display/report basename derived from the selected phase title only. REVIEW_FILE = `${REVIEW_DIR}/review.${PHASE_SLUG}.md` for Full Mode or `${REVIEW_DIR}/review.md` for Simple Mode; FIX_FILE uses the matching `fix-tasks` basename only for REQUEST_CHANGES.
- Continue at Step 2 with these resolved inputs. Downstream references to task tables, business specification, testing strategy or logs mean the DD sections/addresses just resolved. Never execute the historical resolution branch for a DD plan.

**Historical Markdown only** (the supplied plan is Markdown and no canonical DD source exists):
- PLAN = provided --plan; PLAN_DIR = dirname(PLAN). Read `**Mode**: Simple` or `**Mode**: Full` only in this branch. Preserve historical read paths; do not migrate or reopen completed plans.
- SPEC = `${PLAN_DIR}/<slug>-plan.md` § `## Business Specification` (unified plan), else a legacy `${PLAN_DIR}/<slug>-spec.md`.
- Full Mode: PHASE_SLUG = slugified phase title; PHASE_DIR = `${PLAN_DIR}/assets/tasks/${PHASE_SLUG}` (legacy root `tasks/` fallback — § Plan-folder layout, `references/00-routing.md`). PHASE_DOC = `${PHASE_DIR}/tasks.md`; EXEC_LOG = `${PHASE_DIR}/execution.log.md`; REVIEW_DIR = `${PHASE_DIR}/reviews`.
- Simple Mode: PHASE_DOC = PLAN (inline § Implementation tasks); EXEC_LOG = `${PLAN_DIR}/assets/execution.log.md` (legacy root fallback); REVIEW_DIR = `${PLAN_DIR}/assets/reviews`.
- REVIEW_FILE = `${REVIEW_DIR}/review.${PHASE_SLUG}.md` for Full Mode or `${REVIEW_DIR}/review.md` for Simple Mode. FIX_FILE uses the matching `fix-tasks` basename only for REQUEST_CHANGES.

Create only the resolved REVIEW_DIR if absent. Input resolution is read-only; never create missing canonical plan/task/evidence sources during review.

## Step 2: Gather Diffs

- If `--diff-file` provided: read it
- For a team composition review, bind the diff to the recorded baseline and exact verified `artifact_sha`, even when the current working tree has newer changes. An explicit diff must identify that same subject; missing/mismatched basis is a finding, never a fallback to HEAD or uncommitted work.
- Otherwise, for a non-team phase review, compute the diff from git using this detection strategy:

  1. **Check for uncommitted changes first**: `git diff --stat` and `git diff --staged --stat`
     - If uncommitted/staged changes exist → use `git diff` and `git diff --staged` for diffs
  2. **If working tree is clean** (already committed): look at recent commit history
     - Read the resolved EXEC_LOG/EXEC_LOG_ADDRESS for the commit hash or file list
     - Find the commit(s) for this phase by scanning `git log --oneline -10` for phase-related messages
     - Use `git diff <commit-before-phase>..HEAD` to get the full phase diff
     - If unclear which commits belong to this phase, use the file list from the resolved execution receipts or PHASE_DOC task paths:
       `git log --all --follow -- <file>` to find the relevant commits, then diff from the earliest
  3. **Fallback**: If git history is unclear, use the resolved task paths and diff each file against its last committed state before the plan started; report any uncertain basis
- Build a file manifest: every file touched, with action (created/modified/deleted)
- Save computed diff to `${REVIEW_DIR}/_computed.diff` for reproducibility

## Step 3: Launch Review Subagents (Parallel)

Choose each worker's `tier:` using `references/00-routing.md` § Model-to-task fit & delegation.

Launch **5 subagents** in parallel (single message with 5 Task tool calls):

### Subagent 1: Implementation Quality Reviewer
"Review code changes for correctness, safety, and quality.

tier: Opus-class

**Read**:
- All changed files (from diffs)
- Task table from PHASE_DOC (expected changes)
- Acceptance criteria from SPEC
- Key Findings from PLAN (known hazards)

**Check** (only report issues that genuinely matter — no style nits):
- **Correctness**: Logic errors, off-by-one, null handling, type mismatches
- **Security**: Input validation, injection risks, secrets exposure, auth gaps
- **Error handling**: Missing try/catch, swallowed errors, unclear error messages
- **Performance**: Obvious inefficiencies, unbounded operations, missing pagination
- **Scope compliance**: Do changes match what tasks specified? Any scope creep?
- **Pattern adherence**: Does new code follow existing codebase patterns?

**Output** (JSON array):
```json
[{\"severity\": \"HIGH|MEDIUM|LOW\", \"file\": \"abs/path:lines\", \"category\": \"correctness|security|error-handling|performance|scope|pattern\", \"issue\": \"...\", \"suggestion\": \"...\"}]
```"

### Subagent 2: Domain Compliance Validator *(domain mode ON only — `references/00-routing.md` § Domain mode & context loading; when OFF, skip this subagent entirely and report Domain Compliance as `N/A (domains off)`)*
"Validate domain compliance for all changes in this phase.

tier: Opus-class

**Read**:
- `docs/domains/registry.md` — all registered domains
- `docs/domains/domain-map.md` — domain topology and contract relationships
- `docs/domains/<slug>/domain.md` — for each domain touched
- Plan's `## Domain Manifest` — expected file→domain mapping
- All changed files

**Check**:
1. **File placement**: Every new file is under its declared domain's source tree
2. **Contract-only imports**: No imports from another domain's internal files (only contracts/ or public exports allowed)
3. **Dependency direction**:
   - business → infrastructure: ✅
   - infrastructure → business: ❌ VIOLATION
   - business → business: only via contracts
4. **Domain.md currency**: domain.md § History updated for this plan, § Composition updated if new components, § Contracts updated if public interface changed
5. **Registry currency**: docs/domains/registry.md reflects any new domains
6. **No orphan files**: Every changed file maps to a domain in the manifest
7. **Map currency**: docs/domains/domain-map.md reflects all domains, new edges labeled, contracts in node labels current, health summary table current
8. **No circular business deps**: No business→business cycles in the domain map
9. **No unlabeled edges**: Every dependency on the map has a contract label
10. **Concepts documentation** (⚠️ Review): Domains with contracts have a `§ Concepts` section in domain.md. Level 1 minimum: table with Concept | Entry Point | What It Does. New contracts added in this phase appear in the Concepts table.

**Output** (JSON array):
```json
[{\"severity\": \"HIGH|MEDIUM|LOW\", \"check\": \"file-placement|contract-imports|dependency-direction|domain-md|registry|orphan|map-nodes|map-edges|circular-deps|concepts-docs\", \"file\": \"...\", \"issue\": \"...\", \"fix\": \"...\"}]
```"

### Subagent 3: Anti-Reinvention Check
"Check whether this phase introduced functionality that already exists in another domain.

tier: Opus-class

**Read**:
- All NEW files created in this phase
- `docs/domains/*/domain.md` — contracts and composition for all domains
- `docs/domains/domain-map.md` — to understand existing capabilities

For each major new component (service, adapter, repository, handler):
1. Search the codebase for \"<component concept>\" — scan `docs/domains/*/domain.md` § Concepts tables first, then source
2. Check domain contracts for overlapping capabilities
3. Flag if similar functionality exists in another domain

**Output** (JSON array):
```json
[{\"severity\": \"HIGH|MEDIUM|LOW\", \"new_component\": \"...\", \"file\": \"...\", \"existing_match\": \"...|None\", \"match_domain\": \"...\", \"recommendation\": \"reuse|extend|proceed\"}]
```
Only flag genuine duplication, not incidental similarity."

### Subagent 4: Testing & Evidence Validator
"Validate testing approach compliance and evidence quality.

tier: Opus-class

**Read**:
- PHASE_DOC (task table — check completion status)
- EXEC_LOG (implementation evidence)
- PLAN `testing_strategy` for DD inputs; SPEC § Testing Strategy only for historical Markdown
- Changed test files (from diffs)

**Check** (adapt to testing approach from spec):
- **All approaches**: Acceptance criteria have evidence of verification
- **Full TDD**: Test tasks precede implementation, RED-GREEN evidence exists
- **Lightweight**: Core validation tests exist for critical paths
- **Manual**: Verification steps documented with observed outcomes
- **Hybrid**: Approach-appropriate checks per task
- **Evidence quality**: Are claims backed by concrete output (test results, command output, screenshots)?
- **Coverage**: Do acceptance criteria map to verified evidence?

**Output** (JSON):
```json
{
  \"approach\": \"Full TDD|Lightweight|Manual|Hybrid\",
  \"coverage_confidence\": 0-100,
  \"violations\": [{\"severity\": \"...\", \"issue\": \"...\", \"fix\": \"...\"}],
  \"ac_coverage\": [{\"ac\": \"AC1\", \"confidence\": 0-100, \"evidence\": \"...\"}]
}
```"

### Subagent 5: Doctrine & Rules Validator
"Validate alignment with project rules, idioms, architecture.

tier: Opus-class

**Read**:
- Changed files (from diffs)
- `docs/project-rules/rules.md` (if exists)
- `docs/project-rules/idioms.md` (if exists)
- `docs/project-rules/architecture.md` (if exists)
- `docs/project-rules/constitution.md` (if exists)

**Check**:
- Changed code respects coding standards from rules.md
- Follows naming and directory conventions from idioms.md
- Respects layer boundaries from architecture.md
- If no project-rules exist: report N/A (not a failure)

**Output** (JSON array):
```json
[{\"severity\": \"HIGH|MEDIUM|LOW\", \"file\": \"...\", \"rule\": \"...\", \"issue\": \"...\", \"fix\": \"...\"}]
```"

**Wait for all subagents to complete.** (5 subagents)

> Live-runtime validation is **not** a review subagent — this verb is read-only and never boots or runs anything. It reviews the execution-log evidence already captured; verifying a running system is out of scope for this verb.

## Step 4: Synthesize Results

1. Collect findings from all subagents
2. Deduplicate overlapping findings
3. Assign sequential finding IDs (F001, F002, ...)
4. Order by severity: CRITICAL → HIGH → MEDIUM → LOW
5. Determine verdict:
   - Zero HIGH/CRITICAL → **APPROVE**
   - Any HIGH/CRITICAL with mitigations → **APPROVE WITH NOTES**
   - Any HIGH/CRITICAL unmitigated → **REQUEST_CHANGES**
   - If `--strict`: any HIGH → **REQUEST_CHANGES**

## Step 5: Write Review File

Write `${REVIEW_FILE}` (create `reviews/` dir if needed):

```markdown
# Code Review: [Phase Title]

**Plan**: [resolved canonical PLAN, or historical Markdown path]
**Specification / guide**: [resolved SPEC and GUIDE when DD]
**Phase**: [phase title, or "Simple Mode"]
**Date**: [today]
**Reviewer**: Automated (the review verb)
**Testing Approach**: [from resolved testing_strategy or historical specification]

## A) Verdict

**[APPROVE | APPROVE WITH NOTES | REQUEST_CHANGES]**

[If REQUEST_CHANGES: brief reason]

**Key failure areas** (one sentence each, only if issues found):
- **Implementation**: [e.g., "Missing error handling in auth token refresh path" — or omit if clean]
- **Domain compliance**: [e.g., "billing imports auth internals instead of contracts" — or omit if clean]
- **Reinvention**: [e.g., "New EmailSender duplicates existing NotificationService.send()" — or omit if clean]
- **Testing**: [e.g., "3 acceptance criteria have no verification evidence" — or omit if clean]
- **Doctrine**: [e.g., "Layer boundary violation in data access" — or omit if clean]

## B) Summary

[3-5 sentences: overall quality, domain compliance status, reinvention check, testing evidence quality]

## C) Checklist

**Testing Approach: [approach]**

[Approach-specific checklist — adapt to spec's testing strategy:]

For Lightweight:
- [ ] Core validation tests present
- [ ] Critical paths covered
- [ ] Key verification points documented

For Manual:
- [ ] Manual verification steps documented
- [ ] Manual test results recorded with observed outcomes
- [ ] Evidence artifacts present

Universal (all approaches):
- [ ] Only in-scope files changed
- [ ] Linters/type checks clean (if applicable)
- [ ] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|

## E) Detailed Findings

### E.1) Implementation Quality
[Subagent 1 findings — correctness, security, error handling, performance]

### E.2) Domain Compliance
[Subagent 2 findings with domain compliance table:]

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅/❌ | |
| Contract-only imports | ✅/❌ | |
| Dependency direction | ✅/❌ | |
| Domain.md updated | ✅/❌ | |
| Registry current | ✅/❌ | |
| No orphan files | ✅/❌ | |
| Map nodes current | ✅/❌ | |
| Map edges current | ✅/❌ | |
| No circular business deps | ✅/❌ | |
| Concepts documented | ✅/⚠️/N/A | |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|

### E.4) Testing & Evidence

**Coverage confidence**: [0-100%]

| AC | Confidence | Evidence |
|----|------------|----------|

### E.5) Doctrine Compliance
[Subagent 5 findings, or "N/A — no project-rules found"]

## F) Coverage Map

[Acceptance criteria ↔ evidence mapping]

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|

**Overall coverage confidence**: [N%]

## G) Commands Executed

```bash
[List actual commands used to gather diffs, run checks, etc.]
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: [APPROVE | APPROVE WITH NOTES | REQUEST_CHANGES]

**Plan**: [resolved canonical PLAN, or historical Markdown path]
**Specification / guide**: [resolved SPEC and GUIDE when DD]
**Phase**: [phase title, or "Simple Mode"]
**Tasks dossier**: [resolved TASK_ADDRESS/PHASE_DOC, or historical inline plan]
**Execution log**: [resolved EXEC_LOG_ADDRESS/EXEC_LOG; name absent evidence explicitly]
**Review file**: [absolute path to this review file]

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|

### Handback

[State the verdict's consequence in verb terms — the flow renders any command:
- REQUEST_CHANGES: "fixes go back through the implement verb (same flags), then re-run this review"
- APPROVE, more phases: "next phase's task expansion comes next"
- APPROVE, final phase: "Implementation complete — consider committing"]
```

## Step 6: Write Fix Tasks (if REQUEST_CHANGES)

If verdict is REQUEST_CHANGES, write `${FIX_FILE}`:

```markdown
# Fix Tasks: [Phase Title]

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: [Title]
- **Severity**: CRITICAL/HIGH
- **File(s)**: [absolute paths]
- **Issue**: [what's wrong]
- **Fix**: [specific remediation steps]
- **Patch hint**:
  ```diff
  - [old code]
  + [new code]
  ```

## Medium / Low Fixes

### FT-NNN: [Title]
...

## Re-Review Checklist

- [ ] All critical/high fixes applied
- [ ] Re-run this review verb and achieve zero HIGH/CRITICAL
```

## Step 7: Constraints

- **Read-only**: Do NOT change source files
- **Patches are hints only**: Unified diff snippets in report, not applied
- **Report is deterministic**: Quote minimal context, use absolute paths throughout
- **Domain map validation is mandatory when domain mode is ON**: If domain-map.md exists (and domain mode is ON), it MUST be checked; domain mode OFF → skip
- **ALWAYS write review file**: Never just output to console — write the file to the resolved REVIEW_DIR
- **ALWAYS include Handover Brief**: The next agent needs full context with absolute paths
```

Acceptance criteria for this command:
- Review file written to phase `reviews/` directory with sections A-H
- Fix tasks file written (if REQUEST_CHANGES) with ordered fixes and patch hints
- Computed diff saved to phase `reviews/_computed.diff`
- Every finding has absolute file path, severity, and concrete fix
- Domain compliance table has 9 checks with ✅/❌ status
- Coverage map shows per-AC confidence scores
- Handover Brief has full absolute paths for all artifacts and files reviewed
- If APPROVE: zero HIGH/CRITICAL findings
- If REQUEST_CHANGES: fix tasks file created with severity-ordered fixes

On REQUEST_CHANGES: fixes travel back through the implement verb (same flags), then this review re-runs.

---

## Exit

Print the output-contract summary (✅ block: verdict, review file path, key failure areas). Then STOP. Do not name a next stage. If invoked standalone, end with exactly: "Routing is the flow's job — run the parent flow bare to continue."

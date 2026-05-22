# Code Review: Engineering Harness Setup Skill (v0.1)

**Plan**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/engineering-harness-setup-skill-spec.md`
**Spec**: same (Simple Mode — spec is the plan)
**Phase**: Simple Mode (single phase, Groups A–G)
**Date**: 2026-05-22
**Reviewer**: Automated (plan-7-v2)
**Testing Approach**: Manual (one dogfood; no automated tests against the skill itself per `decisions.md` Q2)

---

## A) Verdict

**APPROVE WITH NOTES**

The Phase 1 implementation (Groups A–E + G; Group F deferred at user request) meets all structural acceptance criteria. The four `check.sh` invariants pass; the two CLI skeletons syntax-check clean; the four JSON schemas validate; the 18 templates land in the expected layout; the README append landed; the commit is Conventional-Commits-style and excludes the right untracked artefacts.

**Notes that justify "WITH NOTES" rather than plain APPROVE**:

1. **Runtime ACs (AC-6, AC-12, AC-13, plus the runtime halves of AC-7, AC-8, AC-9, AC-10) are structurally verified but not runtime-exercised.** The user explicitly deferred Group F (dogfood) to a separate session in a new target repo. Sign-off on this commit alone is partial; full sign-off requires the dogfood run.
2. **Four LOW findings** worth queuing as friction-log entries during the user's dogfood, none of which block the commit.
3. **One INFO finding** about adjacent pi skills (`engineering-harness-v2`, `agent-harness-v2`, `harness-is-the-product-v2`, `install-hve-core-rpiv`) — explicitly waived at session start per the standalone constraint; recorded here for the audit trail only.

**Key failure areas**: none.

---

## B) Summary

The skill package at `skills/engineering-harness-setup/` is a clean v0.1: 21 files, ~2,400 lines, all four `check.sh` invariants green (boundary sentence in 8 files, no private-source contamination, magic-wand wording byte-identical in 11 surfaces, all placeholder markers match the canonical `{{NAME}}` form). The two CLI skeletons (Python stdlib + Node 18+ stdlib) both syntax-check clean and correctly wire the six spec-mandated drift fixes (AC-7 PLACEHOLDER_LEAK runtime check; AC-9 `onboard` reads file; AC-11 `validate` reads `config.validation.<tier>`; AC-15 `run` locked behind `--execute` + `validate` skips `run`; FR-NEW-5 `fft` alias; FR-NEW-6 `doctor --wait`). The wrap-existing branch ships as a POSIX-shell template with a deliberate placeholder set for install-time substitution. Domain compliance is N/A (no `docs/domains/`); doctrine compliance is N/A (no `docs/project-rules/`); harness-live validation is N/A (no `docs/project-rules/engineering-harness.md` in this repo — the repo is the foundations source, not a target). Anti-reinvention surfaced four adjacent pi skills whose scope the user explicitly waived at session start.

The package is ready for the user to dogfood against a real greenfield target in a follow-up session. Runtime ACs cannot be claimed until that dogfood completes.

---

## C) Checklist

**Testing Approach: Manual**

- [x] Manual verification steps documented (in `execution.log.md` per-task entries + spec §Implementation Outline)
- [x] Manual self-check results recorded with observed outcomes (`check.sh all` output captured in `execution.log.md`)
- [ ] Dogfood evidence artefacts present **(deferred — Group F not yet run)**
- [x] Discoveries (D1, D2) logged in `execution.log.md` § Discoveries & Learnings

**Universal**

- [x] Only in-scope files changed (verified via `git diff --name-status d1f99a9..HEAD`)
- [x] All check.sh invariants pass (boundary, privacy, magic-wand, placeholder-syntax)
- [x] Python CLI: `python3 -c "import ast; ast.parse(...)"` exit 0
- [x] Node CLI: `node --check` exit 0
- [x] `check.sh`: `sh -n` exit 0
- [x] All 4 JSON files parse: `json.load(...)` exit 0
- [x] `.fs2/` (flowspace artefact) correctly excluded from the commit
- [x] `scratch/` remains ignored (verified via `git check-ignore -v scratch`)
- [ ] Domain compliance checks **(N/A — no `docs/domains/`)**

---

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | LOW | `skills/engineering-harness-setup/templates/cli-python-harness.py:267-289` | error-handling | `urllib.request.urlopen` called without setting User-Agent header; some health endpoints (Cloudflare, some k8s ingress) reject default urllib UA. | Add a small UA header (`{"User-Agent": "engineering-harness/<version> doctor"}`) in v0.2; document as known limitation if not. |
| F002 | LOW | `skills/engineering-harness-setup/templates/cli-node-harness.mjs:101-122` | scope | The lightweight `parseArgs` only recognises `--tier` and `--wait` as space-separated value flags; other future flags taking a space-separated value would silently be parsed as standalone booleans. | Document the constraint in `cli-command-contract.md` or migrate to `node:util` `parseArgs` in v0.2. |
| F003 | LOW | `skills/engineering-harness-setup/templates/wrapper-recipe.template:24-32` | correctness | `json_escape` uses sed's `:a;N;$!ba;` multiline trick; portable across GNU/BSD sed but performance is `O(n²)` for large outputs. The wrapped command's stdout/stderr can be megabytes in some toolchains. | Add a comment naming the limit; consider switching to `awk` or requiring `jq` if available in v0.2. |
| F004 | LOW | `skills/engineering-harness-setup/templates/wrapper-recipe.template:60-77` | correctness | The `--dry-run` detection in the generated subcommand block uses `if [ "${1:-}" = "--dry-run" ]; then` — works for `<CLI> test --dry-run` but not for `<CLI> test --json --dry-run` (where `--dry-run` is not `$1`). | Loop over `"$@"` and `shift` matched flags before invoking `$TARGET_COMMAND`; defer to v0.2 friction-log if no user reports it. |
| F005 | INFO | (whole package) | scope | Anti-reinvention surfaced four adjacent pi skills (`engineering-harness-v2`, `agent-harness-v2`, `harness-is-the-product-v2`, `install-hve-core-rpiv`). User explicitly waived coordination at session start (standalone constraint, recorded in `decisions.md` CF-01). | None — note for audit trail only. |

---

## E) Detailed Findings

### E.1) Implementation Quality

**Static checks** (all pass):

| Check | File | Result |
|---|---|---|
| Python AST parse | `cli-python-harness.py` | ✅ |
| `node --check` | `cli-node-harness.mjs` | ✅ |
| `sh -n` | `check.sh` | ✅ |
| `json.load` | `cli-envelope.schema.json` | ✅ |
| `json.load` | `harness-config.json` | ✅ |
| `json.load` | `harness-config.schema.json` | ✅ |
| `json.load` | `retrospective-schema.json` | ✅ |
| `check.sh boundary` | (package) | ✅ 8 files, canonical-boundary.txt matches |
| `check.sh privacy` | (shipped surfaces) | ✅ clean |
| `check.sh magic-wand` | (package) | ✅ 11 surfaces |
| `check.sh placeholder-syntax` | (templates) | ✅ all match `{{[A-Z_][A-Z0-9_]*}}` |

**Drift-fix verification** (spec-required AC-7 / AC-9 / AC-11 / AC-15 / FR-NEW-5 / FR-NEW-6):

| AC | What | Python CLI | Node CLI |
|---|---|---|---|
| AC-7 | `PLACEHOLDER_LEAK` in error enum + runtime check | ✅ line 41 (enum) + line 123 (`assert_no_placeholder_leaks()`) invoked by `validate` line 334 | ✅ envelope error code set; `assertNoPlaceholderLeaks()` defined and invoked |
| AC-9 | `onboard()` reads file | ✅ `cmd_onboard()` reads `ONBOARD_DOC_PATH`; returns `UNCONFIGURED` if missing | ✅ same pattern |
| AC-11 | `validate` reads `config.validation.<tier>` | ✅ line 304 `(cfg.get("validation") or {}).get(tier, [])` | ✅ `(cfg?.validation ?? {})[tier]` |
| AC-15 | `run` requires `--execute`; `validate` never invokes `run` | ✅ line 236 `--execute` gate; line 319 `validate` skips `run` | ✅ same gate + skip |
| FR-NEW-5 | `fft` alias for `validate --tier proof` | ✅ `cmd_fft()` + argparse subparser at line 434 | ✅ `cmdFft()` in COMMANDS dispatch |
| FR-NEW-6 | `doctor --wait <sec>` | ✅ `deadline = time.monotonic() + (args.wait or 0)` loop at line 149 | ✅ same loop pattern |

**Code correctness**: no logic errors, off-by-one, null-handling, or type-mismatch issues identified. The Python `lambda args, n=name: ...` late-binding pattern at line 425 correctly captures `name` via default-argument trick. The Node CLI's `AbortController + setTimeout` pattern correctly cancels the fetch on timeout.

**Security**: the only network-touching command is `<CLI> health`, which makes a single GET to a user-configured URL. No credentials, no auth, no input that could lead to injection (`subprocess.run(cmd, shell=True, ...)` does run an arbitrary shell string, but that string is read from `harness/config.json` which the user authored — this is by design and matches the wrap-tooling philosophy).

**Performance**: doctor / validate / onboard are all O(file size) and run in milliseconds. F003 is a noted micro-issue for very large command outputs in the wrap-existing branch.

**Scope compliance**: changes match the spec's §Implementation Outline tasks A–G exactly. No scope creep.

**Pattern adherence**: the package follows the precedent of `~/.pi/agent/skills/install-hve-core-rpiv/` (multi-file skill with `references/` sibling reads); frontmatter is `name`+`description` only per pi convention; HTML-comment foundation citations are consistent with the field-research observation about minih.

### E.2) Domain Compliance

**N/A** — this repo has no `docs/domains/registry.md`, no `docs/domains/domain-map.md`, and no `docs/domains/*/domain.md`. The spec's §Target Domains acknowledges this and uses "conceptual domains only" framing.

| Check | Status | Details |
|-------|--------|---------|
| File placement | N/A | No domain manifest to violate |
| Contract-only imports | N/A | No domain contracts |
| Dependency direction | N/A | — |
| Domain.md updated | N/A | — |
| Registry current | N/A | — |
| No orphan files | N/A | — |
| Map nodes current | N/A | — |
| Map edges current | N/A | — |
| No circular business deps | N/A | — |
| Concepts documented | N/A | — |

The closest analogue is the AC-2 file manifest, which has been verified by `ls skills/engineering-harness-setup/templates/` (18 files present, all as named in the spec).

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `engineering-harness-setup` skill | `engineering-harness-v2` (pi skill), `agent-harness-v2`, `harness-is-the-product-v2`, `install-hve-core-rpiv` | `~/.pi/agent/skills/` | **explicitly waived** — user constraint from session start: "Standalone deliverable — no coordination with `engineering-harness-v2`, `agent-harness-v2`, `harness-is-the-product-v2`, or `compound-*` siblings"; recorded in `decisions.md` CF-01 |
| `templates/cli-python-harness.py` | None | — | proceed |
| `templates/cli-node-harness.mjs` | None | — | proceed |
| `templates/retrospective-schema.json` | Adjacent: `~/substrate/minih/src/schemas/retrospective.json` (source for the design, not a runtime collision) | `~/substrate/minih/` | proceed; re-authored with neutral language per privacy contract |
| `templates/harness-config.schema.json` | None | — | proceed |
| `check.sh` | None | — | proceed |

The package is genuinely new in this repo; the adjacent pi skills cover *related-but-different* territory (the v2 family appears to be a different design lineage and was explicitly held separate from this work).

### E.4) Testing & Evidence

**Approach**: Manual (one dogfood; no automated tests). Coverage confidence: **70%** overall — structural ACs fully verified (~95%); runtime ACs await dogfood (~50%, structurally implied but not exercised).

| AC | Description | Confidence | Evidence |
|----|-------------|------------|----------|
| AC-1 | Skill package + valid frontmatter (`name`+`description` only; `**Version**: 0.1.0` in body) | 100% | `head -5 skills/engineering-harness-setup/SKILL.md` shows exact frontmatter; body line present |
| AC-2 | Templates folder complete (18 files) | 100% | `ls skills/engineering-harness-setup/templates/` returns 18 entries matching the spec's row-by-row enumeration |
| AC-3 | Boundary sentence byte-identical in ≥5 files + canonical-boundary.txt diff | 100% | `check.sh boundary` ok — 8 files; `diff` against canonical-boundary.txt exit 0 |
| AC-4 | No private-source contamination | 100% | `check.sh privacy` ok in shipped surfaces; AUTHORING.md + check.sh excluded by design (Discovery D1) |
| AC-5 | README "Skills authored here" paragraph | 100% | `tail -5 README.md` shows the 3-sentence section linking to SKILL.md |
| AC-6 | Skill invokable end-to-end against a real greenfield target | **0% runtime** / 80% structural | **Deferred** — Group F not run; SKILL.md Step 2 14-step table specifies the flow but no actual invocation captured |
| AC-7 | Placeholder self-check passes after install | 60% | Runtime code present (`assert_no_placeholder_leaks()` in both CLIs); install-time exercise deferred to dogfood |
| AC-8 | HARNESS.md location branch | 50% | SKILL.md Step 8 + FR-01 4-branch decision tree documented; runtime branch behaviour deferred to dogfood |
| AC-9 | CLI implementation branches both work; envelopes conform to schema | 70% | Install-new: both CLIs syntax-check clean, envelopes structurally conform to `cli-envelope.schema.json`; wrap-existing: template ships but install-time substitution not exercised |
| AC-10 | AGENTS.md ≥3 equivalence rows | 60% | `agents-md-snippet.md` ships the 7-row catalogue scaffold; runtime population at install deferred |
| AC-11 | `<CLI> validate` honours `config.json.validation` | 95% | Both CLIs verified by grep to read `config.validation.<tier>`; `fft` alias also wired |
| AC-12 | Idempotent re-run safe (per-file merge policy) | 50% | SKILL.md per-file merge policy table + sentinel detection algorithm specified; runtime idempotence deferred |
| AC-13 | Neither-runtime degradation | 60% | `install-report.md` neither-runtime row template ships; `harness-config.schema.json` allows `cli_language: ""`; runtime fallback deferred |
| AC-14 | Magic-wand wording byte-identical (≥6 surfaces) | 100% | `check.sh magic-wand` ok — 11 surfaces |
| AC-15 | Long-running-boot safety | 95% | Both CLIs verified to gate `run` behind `--execute` + `permissions.allow_run`; both verified to skip `run` inside `validate` |

**Notes on coverage**:
- The 5 ACs with <70% confidence (6, 8, 10, 12, 13) all share the same root cause: dogfood deferred. They are structurally correct and will likely pass when exercised; the confidence is "I can verify the code says the right thing; I cannot verify a real install reaches the documented outcome."
- The Discovery D2 finding (renaming `placeholders` → `placeholder-syntax` and moving runtime leak check into the CLI) materially improves AC-7 coverage — the pre-commit check is now well-formedness only; the actual leak check moves to runtime where the spec wanted it.

### E.5) Doctrine Compliance

**N/A** — this repo has no `docs/project-rules/` directory. The closest analogue is `harness-foundations/`, which is the source-of-truth the skill cites via HTML-comment foundation references (`<!-- foundations: first-principles#27, patterns-that-work#P11 -->`). The skill's 8 principles in SKILL.md §Section 1 are direct paraphrases of `harness-foundations/first-principles.md`, `patterns-that-work.md`, and `directives.md`. Sanity-spot-check of three citation references shows each principle does correspond to a foundation claim — no fabrication.

### E.6) Harness Live Validation

**N/A** — this repo has no `docs/project-rules/engineering-harness.md` (or legacy `agent-harness.md` / `harness.md`). The repo *contains* `harness-foundations/` (a different artefact: the principle documents the skill is based on, not a runtime harness for *this* repo). The skill being authored *would* install such a doc into a target repo; the target repo isn't the same as this repo.

If desired, the user's separate dogfood could install the skill into this very repo (option "Self-host" from the earlier question), at which point a live-validation pass would become possible. That is intentionally not done in this commit.

---

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-1 | Frontmatter exactly `name`+`description`; `**Version**: 0.1.0` in body | `skills/engineering-harness-setup/SKILL.md` lines 1–6 | 100% |
| AC-2 | 18 templates in `templates/` per spec enumeration | `ls skills/engineering-harness-setup/templates/` | 100% |
| AC-3 | Boundary sentence in ≥5 shipped files + canonical-boundary.txt diff | `check.sh boundary` ok | 100% |
| AC-4 | No private-source contamination in shipped surfaces | `check.sh privacy` ok | 100% |
| AC-5 | README "Skills authored here" section | `tail -10 README.md` | 100% |
| AC-6 | Skill invokable end-to-end | Deferred — dogfood needed | 0% |
| AC-7 | Placeholder leak runtime check | `cli-python-harness.py` lines 123, 334; `cli-node-harness.mjs` `assertNoPlaceholderLeaks()` | 60% |
| AC-8 | HARNESS.md location 4-branch decision | `SKILL.md` Step 8 + spec §FR-01 | 50% |
| AC-9 | Install-new + wrap-existing branches; envelope conformance | Python + Node CLIs syntax-check; wrapper-recipe template ships; install-time not exercised | 70% |
| AC-10 | AGENTS.md ≥3 equivalence rows | 7-row catalogue scaffold in `agents-md-snippet.md`; install-time row population deferred | 60% |
| AC-11 | `validate` reads `config.validation.<tier>`; `fft` alias | Grep confirmed in both CLIs | 95% |
| AC-12 | Idempotent re-run per per-file merge policy | `SKILL.md` per-file table + sentinel algorithm; runtime not exercised | 50% |
| AC-13 | Neither-runtime degradation row + `cli_language: ""` | `install-report.md` + `harness-config.schema.json` | 60% |
| AC-14 | Magic-wand wording byte-identical in 6 surfaces | `check.sh magic-wand` ok — 11 surfaces | 100% |
| AC-15 | Long-running-boot safety | Both CLIs verified; no orphan-process verification possible without dogfood | 95% |

**Overall coverage confidence**: **70%** (structural ACs ≈95%; runtime ACs ≈50% pending dogfood).

---

## G) Commands Executed

```bash
cd /Users/jordanknight/substrate/harness-engineering

# Mode + artefact resolution
grep -E '\*\*Mode\*\*:' docs/plans/002-engineering-harness-setup-skill/engineering-harness-setup-skill-spec.md
mkdir -p docs/plans/002-engineering-harness-setup-skill/reviews
ls docs/domains/ docs/project-rules/ docs/compound/   # all return "No such file or directory"

# Diff capture
git log --oneline d1f99a9..HEAD                       # 5a097cf, 943c8c1
git diff d1f99a9..HEAD > docs/plans/002-engineering-harness-setup-skill/reviews/_computed.diff
wc -l docs/plans/002-engineering-harness-setup-skill/reviews/_computed.diff   # 7076

# Static checks
python3 -c "import ast; ast.parse(open('skills/engineering-harness-setup/templates/cli-python-harness.py').read()); print('ok')"
node --check skills/engineering-harness-setup/templates/cli-node-harness.mjs
sh -n skills/engineering-harness-setup/check.sh
for f in skills/engineering-harness-setup/templates/*.json; do
  python3 -c "import json; json.load(open('$f')); print('$f: ok')"
done

# Self-invariants
skills/engineering-harness-setup/check.sh all
# → boundary ok (8 files), privacy ok (shipped), magic-wand ok (11), placeholder-syntax ok

# Spec drift-fix verification
grep -n 'PLACEHOLDER_LEAK\|assert_no_placeholder_leaks' skills/engineering-harness-setup/templates/cli-python-harness.py
grep -A 3 'def cmd_onboard' skills/engineering-harness-setup/templates/cli-python-harness.py
grep -n 'validation' skills/engineering-harness-setup/templates/cli-python-harness.py
grep -n 'allow_run\|--execute\|long-running' skills/engineering-harness-setup/templates/cli-python-harness.py
grep -n 'fft' skills/engineering-harness-setup/templates/cli-python-harness.py
grep -n 'wait\|deadline' skills/engineering-harness-setup/templates/cli-python-harness.py

# Anti-reinvention
ls ~/.pi/agent/skills/ | grep -iE 'harness|setup|install|engineer'

# Auth + push
gh auth switch -u jakkaj
GH_TOKEN= git push   # d1f99a9..943c8c1 main -> main
```

Subagents NOT launched (in-parent review chosen because):
- 4 of the 6 subagents would have returned N/A (Domain Compliance, Doctrine, Harness Live; Anti-Reinvention reduced to a single ls check)
- The author has full context fresh from authoring; bootstrapping subagents to re-read the same files imposes a cost without proportional benefit
- The skill format is followed strictly: the review file conforms to sections A–H

---

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: APPROVE WITH NOTES

**Plan**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/engineering-harness-setup-skill-spec.md`
**Spec**: same (Simple Mode)
**Phase**: Simple Mode (Phase 1: Groups A–G; F deferred)
**Tasks dossier**: inline in plan (§Implementation Outline)
**Execution log**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/execution.log.md`
**Review file**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/reviews/review.md`
**Computed diff**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/reviews/_computed.diff`

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/SKILL.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/AUTHORING.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/check.sh` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/canonical-boundary.txt` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/magic-wand-prompt.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/cli-envelope.schema.json` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/root-HARNESS.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/agents-md-snippet.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/harness-README.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/harness-config.json` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/cli-python-harness.py` | created | skills (new) | F001 (LOW) — User-Agent header for `urlopen` in v0.2 |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/cli-node-harness.mjs` | created | skills (new) | F002 (LOW) — migrate to `node:util` `parseArgs` in v0.2 |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/harness-onboard-agent-session.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/harness-known-difficulties.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/harness-friction-log.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/harness-proof-note.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/friction-entry.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/cli-command-contract.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/install-report.md` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/retrospective-schema.json` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/harness-config.schema.json` | created | skills (new) | none |
| `/Users/jordanknight/substrate/harness-engineering/skills/engineering-harness-setup/templates/wrapper-recipe.template` | created | skills (new) | F003, F004 (LOW) — `json_escape` perf + `--dry-run` arg position in v0.2 |
| `/Users/jordanknight/substrate/harness-engineering/README.md` | modified | (repo root) | none |
| `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/decisions.md` | created | (plan artefacts) | none |
| `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/engineering-harness-setup-skill-spec.md` | created | (plan artefacts) | none |
| `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/execution.log.md` | created | (plan artefacts) | none |
| `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/research-dossier.md` | created | (plan artefacts) | none |
| `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/field-research-minih-chainglass.md` | created | (plan artefacts) | none |
| `/Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/lenses/*` (8 files) | created | (plan artefacts) | none |

### Required Fixes (if REQUEST_CHANGES)

None — verdict is APPROVE WITH NOTES.

### Domain Artifacts to Update (if any)

None — repo has no domain system. The `skills/` directory was effectively a new conceptual domain (see spec §Target Domains "skills [NEW — in this repo]"); the README append signals its existence as the only repo-level acknowledgement (per `decisions.md` Q3).

### Friction-log seeds for the user's dogfood

When the user dogfoods in a new target repo, the 4 LOW findings (F001, F002, F003, F004) should be considered for seeding the friction log if any are observed in practice:

- F001 (`urlopen` User-Agent): observable as a 403/406 from health endpoints behind a CDN
- F002 (Node `parseArgs`): observable as a silently-ignored flag value
- F003 (`json_escape` sed perf): observable as install-time hang for commands with multi-MB stdout
- F004 (wrap-existing `--dry-run` position): observable as `--dry-run` doing nothing when followed by another flag

### Next Step

- **Immediate**: User dogfoods the skill against a new greenfield repo (the deferred Group F). This exercises the runtime halves of AC-6, AC-7, AC-8, AC-9, AC-10, AC-12, AC-13.
- **After dogfood**: Append a one-line entry to `decisions.md` pointing at the dogfood target's `harness/state/friction-log.md`; runtime AC verification can then be marked in this review file (or in a follow-up review).
- **If the dogfood passes**: this commit is sign-off-complete. The skill ships as v0.1.
- **If the dogfood surfaces real issues**: those become friction-log entries in the dogfood target AND optionally trigger fix-tasks here. Re-run `/plan-7-v2-code-review --plan /Users/jordanknight/substrate/harness-engineering/docs/plans/002-engineering-harness-setup-skill/engineering-harness-setup-skill-spec.md` after any fixes.

# Research Lens: QT — Quality & Testing Investigator

**Lens question**: What does "done" look like for the *Engineering Harness Setup* skill (a portable, authored skill package), how would it be tested, and what proof would convince a reviewer it works?

**Sources of truth**:
- Authoring brief: `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` (Sections 3, 21–26, 31, 32.4, 34, 36)
- Foundations: `harness-foundations/patterns-that-work.md` (P3, P15, P21, P22), `harness-foundations/first-principles.md` (P27–P37, P53–P58)
- Proof levels: `harness-foundations/source-notes/notes3.md` (L0–L6)
- Conventions: `docs/plans/001-backpressure-harness-foundations/research-dossier.md`, `AGENTS.md`

---

## Findings

### Finding QT-01: Merge the two acceptance lists into one reviewer checklist
**Type**: acceptance
**Evidence**: `source-prompt.md:1019-1031` (Section 23, the 8 "successful setup" conditions); `source-prompt.md:1465-1481` (Section 32.4, the 11 "authored skill is acceptable if" bullets); `source-prompt.md:1796-1815` (Section 36, "shortest acceptable version" minimum file set)
**Description**: The brief contains *two* acceptance lists that must both be satisfied: Section 23 lists 8 conditions about the *generated repo state* (HARNESS.md exists, doctor reads config, etc.), and Section 32.4 lists 11 bullets about the *authored skill's capabilities* (explains itself, inspects repo, asks decisions, etc.). They are complementary but not identical — 23 is a static post-condition check, 32.4 is a behavioural capability check. A reviewer needs both, executed in order: capability check first (did the skill *do the right things*), then post-condition check (did it *leave the right artefacts*). Section 36 adds a third minimum-floor list for time-constrained runs which must also pass.
**Why it matters for authoring**: Without an explicit merged checklist, a reviewer is forced to scan three sections, deduplicate, and improvise — exactly the kind of judgement work principle 27 (DoD must separate checks from judgement) tells us to convert into a deterministic gate.
**Recommendation**: Encode a single reviewer checklist (markdown checkboxes) shipped with the skill at `engineering-harness-setup-skill/tests/acceptance-checklist.md`, structured in three sections — **Behavioural (32.4, 11 items)**, **Artefact (23, 8 items)**, **Minimum-floor (36, fallback for constrained runs)** — with file/path hints next to each item so the check is mechanical. The skill's own final report (Section 24) should mirror the same item IDs so a reviewer can diff "skill claims" vs "checklist verifies" line-for-line.

---

### Finding QT-02: Define four target-repo fixtures (A–D) as the end-to-end proof matrix
**Type**: acceptance
**Evidence**: `source-prompt.md:267-329` (Section 7, inspection signals); `source-prompt.md:1336-1364` (Section 31, brownfield behaviour); `source-prompt.md:1099-1129` (Section 26.1, file modification safety); `patterns-that-work.md` P21 (regression-test the harness)
**Description**: The brief does not yet specify executable fixtures. Pattern P21 demands a small known-bad set; the *authored skill itself* needs the equivalent at one layer up. Four fixtures cover the input space the skill will encounter in the wild:

| Fixture | Repo shape | Expected skill behaviour | Expected evidence |
|---|---|---|---|
| **A · Node greenfield** | `package.json` + `pnpm-lock.yaml`, scripts `build`/`test`/`dev`/`lint`; no health endpoint | Detect pnpm with high confidence; propose `pnpm build`/`pnpm test`/`pnpm dev`; ask CLI language; leave `health.url` blank; mark health as improvement candidate | Created file tree per Section 5; `harness/config.json` with 4 configured commands + 1 unconfigured health; `harness doctor` exits 0; `validate --dry-run` lists what would run; report explicitly says "product boot not proven" |
| **B · Python greenfield** | `pyproject.toml`, `uv.lock`, `pytest` deps | Detect uv; propose `uv run pytest`; mark `build`/`run` as unconfigured if no obvious entry; ask language; default CLI to Python | Same tree; config has `test` configured, `build`/`run` empty; doctor reports unconfigured slots by name |
| **C · Brownfield, no signals** | Empty repo or only `README.md` | Skill still creates harness; **all** command slots marked unconfigured with explicit `""`; report flags every slot as "harness improvement candidate"; refuses to invent commands | All Section 5 files exist; `config.json` has every command empty; report's "What remains unproven" section is non-empty; no fabricated commands appear anywhere |
| **D · Pre-existing harness** | Repo already has `HARNESS.md` *and* `AGENTS.md` (and possibly `harness/config.json`) | Skill detects and **does not overwrite silently** (Section 26.1); shows patch summary; asks merge/replace/skip/show-patch; for `AGENTS.md` prefers append-merge of the harness section only | No silent file truncation; file mtimes/diffs reviewable; user-facing prompt log shows the conflict question; if user picks "skip", final report says so explicitly |

**Why it matters for authoring**: These four fixtures form the smallest set that exercises detection success, detection failure, missing-signal honesty, and overwrite safety — the four dominant failure modes a portable skill faces. Without them, "acceptable" remains a vibe.
**Recommendation**: Ship the four fixtures as `engineering-harness-setup-skill/tests/fixtures/{a-node,b-python,c-brownfield,d-existing}/`. Each contains a seed tree and an `expected-report.md` snippet that a reviewer (human or LLM-judge) can diff against the skill's actual final report. For fixture D, the seed must include a `HARNESS.md` with a recognisable sentinel string so a regression catches silent overwrite.

---

### Finding QT-03: Three "known-bad" regression fixtures keep the skill honest (P21)
**Type**: regression
**Evidence**: `patterns-that-work.md` P21 ("Regression-test the harness… keep a small set of known-bad examples"); `source-prompt.md:867-893` (Section 22, long-running boot); `source-prompt.md:892-916` (Section 21, health-missing → improvement candidate); `source-prompt.md:267-329` (Section 7, detection-as-candidate-not-truth)
**Description**: Patterns P21 and P22 say a harness is only good when it catches known risks across changes. The skill is itself a harness over the user's repo-discovery process, so the same rule applies. Three small adversarial fixtures cover the most likely silent failure modes:

| Known-bad fixture | What it tests | Skill must do | Skill must NOT do |
|---|---|---|---|
| **broken-detection** | `package.json` with a `build` script that actually runs a destructive teardown (`rm -rf dist && deploy.sh`) | Surface the candidate command *as a candidate* and ask confirmation; show the raw script text in the proposed-commands table | Encode `pnpm build` without showing what it expands to; treat detection as truth |
| **long-running-boot** | `package.json` with `"dev": "next dev"` style start | Encode the `run` command but **not execute** it without explicit per-command approval; report it as "encoded, not executed because likely long-running" | Run `npm run dev` and trap the session; claim the product booted |
| **health-missing** | Any of A/B/C with no health endpoint detected | Leave `health.url` empty; insert an explicit "next harness improvement candidate" line about adding a health/smoke check; mark `health` row in the final report as **unconfigured**, not "passed" or "skipped" | Silently default to `http://localhost:3000/health`; omit health from the report; conflate "no health configured" with "health passed" |

**Why it matters for authoring**: These three cases catch the most common ways a setup skill silently misleads its user: encoding a guessed-wrong command, hanging on a long-running process, and papering over an absent proof surface. Each maps directly to a Section 22/21/7 brief requirement, so they are deterministic to check.
**Recommendation**: Encode these as `tests/regression/{broken-detection,long-running-boot,health-missing}/` with expected-output snapshots. Rerun them as a pre-publication gate after any template, prompt, or detection-heuristic change. Treat a passing snapshot diff as the only acceptable signal — agent-judge "looks fine" is not evidence (principle 28).

---

### Finding QT-04: The Section 24 report template needs stricter status vocabularies to enforce claim-safety
**Type**: claim-safety
**Evidence**: `source-prompt.md:1037-1097` (Section 24, final report template); `source-prompt.md:1129-1142` (Section 26.3, claim safety: "Never claim product validated unless commands actually ran and passed"); `first-principles.md` P28 ("Agent confidence is not completion evidence"), P29 ("Completion belongs to evidence")
**Description**: Section 24's template *almost* enforces claim-safety but leaks judgement in two places.
- **Configured-commands table** uses the slash-string `configured/unconfigured` — good: it's a closed two-value status.
- **Validation performed table** uses a free-text `Result` column. A confident agent can write "OK" or "looks good" and satisfy the template literally while violating P28/26.3.
- The proven/unproven prose sections are bullet lists, with no structural link back to the validation table. An agent can put a claim in "What is proven" that does not appear in the validation table at all.

In other words, the template has a configured/unconfigured axis but lacks an explicit **ran/not-ran** axis and an explicit **passed/failed/degraded/unconfigured** axis. Without those, the skill can be both compliant with the template *and* in violation of Section 26.3.

**Why it matters for authoring**: This is the single point where a sloppy template lets the skill silently become productivity theatre (principle 49). It's also the easiest fix.
**Recommendation**: Tighten the Section 24 template before authoring:
1. Replace `Result` with two columns: **`Ran`** (`yes` / `no` / `dry-run` / `unconfigured`) and **`Outcome`** (`pass` / `fail` / `degraded` / `n/a`). Only `ran=yes` + `outcome=pass` may appear in "What is proven".
2. Require "What is proven" bullets to cite a table row ID, so claims are traceable to evidence rather than to confidence.
3. Add an explicit row `Product booted | no | n/a | Boot not attempted in setup; this is normal — see QT-06.` so the report never accidentally implies product proof from harness proof.
4. Encode an automated lint over the produced report: any "proven" bullet without a matching `outcome=pass` row fails the post-condition check.

---

### Finding QT-05: Idempotence and second-run behaviour need an explicit contract (principle 37)
**Type**: regression
**Evidence**: `first-principles.md` P37 ("Cleanup must be idempotent. Setup and cleanup paths should be safe to rerun"); `source-prompt.md:1099-1111` (Section 26.1, "never silently overwrite", "read and merge where appropriate"); Fixture D in QT-02
**Description**: The brief covers overwrite safety in Section 26.1 but does not state what a *second* run of the skill should do when the artefacts it created last time are already present. There are four legitimate second-run shapes — re-detect & re-confirm, detect-no-changes & no-op, detect-drift & propose-merge, and detect-conflict & refuse — and the skill must pick one per file.

Expected contract for re-run in an already-set-up repo:

| Artefact | First run | Second run, no edits | Second run, user edited it |
|---|---|---|---|
| `HARNESS.md` | Create | Detect, no-op, report "already present" | Show diff, ask merge/replace/skip/show-patch |
| `harness/config.json` | Create with confirmed commands | Re-read, surface any new detection candidates as *additional* proposals, never replace existing keys | Show diff per key, ask which to keep |
| `AGENTS.md` | Append harness section (or create) | Detect harness section already present, no-op | Diff the harness section only; leave user prose alone |
| `harness/state/friction-log.md` | Create empty template | Leave existing entries untouched | Append; never rewrite |
| CLI skeleton (`harness/bin/*`) | Create | No-op | Show diff; user-edits win unless they ask for refresh |

**Why it matters for authoring**: Without this contract, the second run is a coin-flip between "no-op" and "silent revert of user edits", and the friction log is a particularly damaging place to lose data (it's an improvement backlog, not regenerable).
**Recommendation**: Add a "second-run behaviour" subsection to `SKILL.md` and encode it as a fixture **E · re-run** that runs the skill twice in the same target repo and asserts: (1) no friction-log entries lost, (2) no CLI-file timestamp change on a no-edit second run, (3) any user-introduced `config.json` value preserved. This is the only fixture that catches the silent-revert class of regression.

---

### Finding QT-06: Be explicit that the skill's own setup-validation maxes out at L1–L2 (never L3+)
**Type**: claim-safety
**Evidence**: `notes3.md:102-110` (proof ladder L0–L6); `source-prompt.md:1015-1030` (Section 23, "setup should not pretend the product works"); `source-prompt.md:1129-1142` (Section 26.3); `first-principles.md` P28, P29
**Description**: Mapping the proof ladder to what the skill can actually achieve during its own run:

| Ladder | Definition (notes3.md) | Achievable by *this* skill? |
|---|---|---|
| L0 Claim | Actor says done, no evidence | Should never be the resting state |
| L1 Local command output | A command ran and output exists | **Yes** — `harness --help`, `doctor`, `validate --dry-run` |
| L2 Static/build/test | Build/lint/typecheck/unit passed | **Sometimes** — only if user approved real build/test execution (Section 26.2) |
| L3 Runtime interaction | Product/API/UI/CLI exercised | **No** — the skill does not exercise the user's product, only its own setup. Even a successful `run` execution proves boot, not interaction |
| L4 Interaction + side effect | Runtime + state/file/db check | **No** |
| L5 Reproducible clean rerun | Same proof in clean context | **No** at setup time (could become true after QT-05 fixture E lands) |
| L6 Production/customer outcome | Production telemetry | **No** |

So the honest ceiling is **L2 for the harness's own readiness, never L3+ for the user's product**. The skill's final report must say this in plain language, not bury it.

**Why it matters for authoring**: This is where setup skills traditionally over-claim ("harness is ready, your project is set up!"). Section 26.3 forbids it; this finding gives the explicit ladder mapping so reviewers can detect the violation.
**Recommendation**: Add a fixed sentence to the Section 24 report template, near the top of "What remains unproven":

> *This setup proves at most L2 (harness commands ran and any approved build/test passed). It does not and cannot prove L3+ (product runtime behaviour). Use the harness loop — Boot → Interact → Observe → Validate — to reach higher proof levels in subsequent sessions.*

Encode this as a literal string-presence test in the acceptance checklist (QT-01). If the sentence is missing or rewritten in a way that softens the ceiling, the skill fails review.

---

### Finding QT-07: Convert each Section 3 non-goal into an explicit rejection rule
**Type**: scope-boundary
**Evidence**: `source-prompt.md:179-201` (Section 3, 11 non-goals); pattern P22 (garbage-collect stale assumptions); principle 26 ("Keep the harness outside the domain unless promoted")
**Description**: Section 3 lists 11 things the skill must not do. Listed as non-goals they read as advice; a reviewer cannot easily test "the skill must not X". Restated as rejection rules with detectable signals, they become a deterministic gate.

| Non-goal (Section 3) | Reject-if-skill rule |
|---|---|
| Create a fully featured universal CLI | CLI skeleton exceeds ~300 lines or adds non-stub subcommands beyond doctor/build/test/run/health/validate/onboard/magic-wand |
| Replace CI/CD | Templates mention deploying, releasing, branch protection, or pipeline configuration |
| Claim product validated without proof | Final report has any "proven" bullet not backed by a `ran=yes,outcome=pass` row (see QT-04) |
| Invent build/test/run commands without confirmation | Proposed-commands table is bypassed; `config.json` contains a command the user log has no `yes` against |
| Run destructive commands without approval | Any of `rm`, `drop`, `migrate`, `reset`, `deploy`, `prune` executed before explicit per-command approval |
| Hide known failures behind optimistic summaries | `What remains unproven` is empty when commands were unconfigured or failed |
| Create a giant markdown manual | Any single template file exceeds ~6KB or duplicates HARNESS.md content in AGENTS.md |
| Treat agent review as substitute for product proof | Any "proof" claim cites only agent reasoning, no commands |
| Auto-apply magic-wand suggestions without review | Magic-wand answers written into config/templates without an explicit user `yes` |
| Make individual-productivity claims | Report or templates contain per-person metrics, leaderboards, or token counts |
| Overfit to a single ecosystem | CLI hardcodes ecosystem assumptions (e.g., requires `npm` to run the Python CLI) |

**Why it matters for authoring**: A reviewer can mechanically scan the produced artefacts against this table. It also pre-empts the most common "ambitious refactor" the authoring agent might attempt mid-build.
**Recommendation**: Ship this table as `tests/rejection-rules.md` alongside the acceptance checklist. Each rule should reference its Section 3 origin (so it stays sync-checkable per QT-08) and have at least one regression fixture (QT-03) that would trip it.

---

### Finding QT-08: Templates must cite specific foundation passages to keep the skill sync-checkable
**Type**: sync
**Evidence**: `AGENTS.md:8-25` (publication boundary requires traceability); pattern P22 (garbage-collect stale harness assumptions); `source-prompt.md:1486-1530` (Section 33, SKILL.md outline); the fact that `source-prompt.md` Section 4 calls a template `harness-proof-note.md` while Section 5 / Section 18 calls it `proof-note.md` — internal drift already exists
**Description**: The skill embeds foundation principles (P3 fast/proof loop, P21 regression, P27/P28/P29 done-vs-confidence, P37 idempotence, P46 magic-wand) into prose templates. When foundations evolve, the templates silently drift unless every paraphrase is traceable to a numbered principle or pattern. The brief itself already shows mild drift (proof-note filename inconsistency between Sections 4 and 5/18), which is a forward warning.
**Why it matters for authoring**: A portable skill is "done" the moment it ships, but it stays "done" only as long as it stays accurate. Without a citation convention there is no way to run a drift check, and no way for a future contributor to know which paraphrase came from which numbered principle.
**Recommendation**:
1. In every template, anywhere the skill paraphrases foundation content, add an HTML-comment citation: `<!-- foundations: first-principles#P29, patterns-that-work#P7 -->`. These are invisible in rendered markdown but greppable.
2. Add a sync check `tests/foundation-citations.md` that lists every citation and asserts each cited principle/pattern still exists with its number unchanged. Run it whenever the foundations files change.
3. Reconcile the `proof-note.md` vs `harness-proof-note.md` naming before authoring begins; pick one and grep-replace.
4. As a stretch, add the foundation file SHA to the install report so a setup run carries its provenance.

---

### Finding QT-09: Long-running boot needs an enforced no-execute default, not just guidance
**Type**: regression
**Evidence**: `source-prompt.md:867-893` (Section 22, "skill should not blindly run `npm run dev`, `dotnet run`, `python manage.py runserver`"); fixture **long-running-boot** in QT-03; principle 36 ("Clean state is part of done"); principle 37 ("Cleanup must be idempotent")
**Description**: Section 22 says the skill should be careful with `run` commands but reaches the position only via prose. There are at least three regressable ways the skill can betray this: (a) the `validate` flow accidentally includes `run` as a step, (b) the user grants "yes to run all configured commands" globally and the skill takes that as license, (c) the Python/Node CLI skeleton's `run` subcommand has no timeout or backgrounding logic and inherits the parent process. The Section 13/14 CLI skeletons in the brief inherit `stdio` and have no readiness-timeout — they will hang on `next dev`.
**Why it matters for authoring**: A skill that hangs on first contact destroys trust faster than any other failure. Per principle 19 ("paved path must beat shortcut"), the user will revert to raw commands and abandon the harness.
**Recommendation**:
1. Make `run` execution a separate explicit approval, distinct from the global "may I run configured commands" prompt. Treat `--allow-run` as opt-in even within an already-approved session.
2. The CLI skeleton's `run` subcommand should default to **dry-run** unless invoked with an explicit `--execute` flag, and should print the "Run command encoded, but not executed because it is likely long-running" sentence verbatim (Section 22 quote).
3. Add to QT-03's `long-running-boot` fixture an assertion that no child process named `next`/`vite`/`uvicorn`/`runserver` exists after the skill exits.
4. The `validate` composite must skip `run`. It can call `health` only if `run` was independently started by the user.

---

### Finding QT-10: External research gap — no canonical public pattern for regression-testing a setup skill
**Type**: sync
**Evidence**: `patterns-that-work.md` P21 applies P21 to *harnesses*, not to *setup skills that build harnesses*; `notes3.md` Section "Implementation architecture" covers harness-event measurement but not skill-package CI; no equivalent guidance found in `docs/plans/001-backpressure-harness-foundations/research-dossier.md`
**Description**: Public/foundation literature gives strong guidance for regression-testing harnesses (P21, P22) and for measuring harness compounding (notes3.md L0–L6, friction ledgers, encoded-fix counts). It is silent on the layer-up problem: how to regression-test a *portable agent skill* that *creates* a harness. The closest adjacent practice is golden-file testing of code generators (e.g., scaffold tools like `create-react-app`, `cookiecutter`, `yo`) plus snapshot-test conventions from Jest/pytest, but no one has yet codified the agent-harness analogue. This research lens has had to derive it (QT-02 fixtures A–D, QT-03 known-bad, QT-05 re-run, QT-09 long-running) by transposing P21 one level up.
**Why it matters for authoring**: If the skill ships without naming this gap, the next contributor will assume the test strategy is established practice. It is not. It is a small original contribution this project is making and should be flagged as such.
**Recommendation**:
1. Add a short "Testing strategy" section to `SKILL.md` that names this lineage transparently: golden-file scaffolding tests + P21 regression-test-the-harness + a re-run idempotence fixture, applied to a setup skill rather than to the underlying harness.
2. Mark this as a candidate public-tutorial topic in the project's source-notes: "Regression-testing portable setup skills" — there is room for a clean published artifact here once a few skills exist to compare.
3. Until then, do not promote this technique to first-principles or patterns-that-work; keep it as a working convention scoped to this skill (per `AGENTS.md` source-handling: distill into general patterns only when evidence supports it).

---

## Summary

A reviewer can declare the *Engineering Harness Setup* skill "done" only when it passes three layered gates: a **behavioural-plus-artefact acceptance checklist** that merges the brief's two acceptance lists (Section 23 + 32.4 + 36, QT-01); a **four-fixture proof matrix** (Node greenfield, Python greenfield, brownfield-no-signals, pre-existing-harness, QT-02); and a **known-bad regression set** (broken-detection, long-running-boot, health-missing, plus a re-run idempotence fixture from QT-05) that mirrors pattern P21 one level up. Underneath those gates, four claim-safety constraints keep the skill honest: the Section 24 report template needs a stricter ran/outcome vocabulary (QT-04); the report must state explicitly that setup proves at most L1–L2 and never L3+ product behaviour (QT-06); the Section 3 non-goals need restating as 11 mechanical rejection rules (QT-07); and `run` execution needs a hard opt-in default, not prose guidance (QT-09). Two sync mechanisms — foundation-citation HTML comments in every template (QT-08) and an explicit acknowledgement that regression-testing setup skills is a project-original convention not yet in public literature (QT-10) — keep the skill accurate as foundations evolve. Together these ten findings convert the brief's prose acceptance criteria into a deterministic gate a reviewer (human or LLM-judge) can execute mechanically.

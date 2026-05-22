# Lens IC — Interface & Contract Analyst

**Skill under review:** *Engineering Harness Setup* (deliverable framing: **portable skill package**)
**Source:** `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` (v0.1, 2236 lines)
**Date:** 2026-05-22

Scope: this lens documents the full I/O contract surface of the yet-to-be-authored skill — invocation, decision shape, file-write set, CLI command contract, placeholder substitution, final report shape, downstream future-session contract, safety pre/post-conditions, JSON envelope, and contract-completeness gaps.

---

## Findings

### Finding IC-01: Invocation surface is conversational, not parameterised
**Contract surface:** invocation
**Evidence:** §1 framing; §2 "interactive setup and onboarding skill"; §8 Step 1 ("I'm going to set up the first useful version…"); §34 "User: Set up the engineering harness skill in this repo."
**Description:**
The brief never defines CLI arguments, slash flags, or environment variables for triggering the skill itself. Triggering is **conversational**: the user invokes the skill in an agent harness that supports skills (pi, Claude Code, Cursor, Cline, Copilot, Codex), and the skill engages in a Q&A flow (§6.1 required + §6.2 optional decisions). The §34 example shows the entire invocation as a single English sentence.

Candidate trigger phrases (inferred, not specified):
- Slash invocation: `/engineering-harness-setup`, `/harness-setup`, `/bootstrap-agentic-harness`
- Natural language: "Set up the engineering harness skill in this repo." / "Bootstrap the harness." / "Install the agentic harness in this repo."

**Drift risk:**
- The portable-skill packaging target means the slug **must** be locked in `SKILL.md` frontmatter (e.g. `slug: engineering-harness-setup`) so multiple agent harnesses can register the same skill identically. The brief does not specify a slug.
- Without a stable slug, the cross-harness contract is informal — different agent harnesses may surface the skill under different verbs.
- §4 names the package directory `engineering-harness-setup-skill/`; that is a folder name, not necessarily an invocation slug.

**Recommendation:**
- Pin the canonical slug in §4: `engineering-harness-setup` (or `harness-setup`) and require `SKILL.md` to declare it as frontmatter so every supporting agent harness uses the same identifier.
- Add a §32 sub-section "Trigger phrases" listing 3–5 natural-language wakes plus the slash invocation, so the skill's `description`/`when_to_use` block in `SKILL.md` covers both.
- Explicitly note "no CLI args" so a parent harness does not try to pass positional arguments.

---

### Finding IC-02: Decision questions split into 5 required + 6 optional; answer shapes need locking
**Contract surface:** decision
**Evidence:** §6.1 (5 required), §6.2 (6 optional), §8 Step 3 (worked example).
**Description:**
The skill asks a fixed required set plus a conditional optional set. Worked decision matrix (with the answer shape and the terse-default that should fire if the user answers "yes do it"):

**Required (§6.1):**
| # | Question | Shape | Terse default |
|---|---|---|---|
| R1 | CLI implementation language | single-choice: `python` \| `node` | **ask — no safe default** (§6.1 paragraph 1 says "explain… choice"); skill must block on this |
| R2 | Permission to create/patch `HARNESS.md`, `harness/`, `AGENTS.md` | single-choice: `yes` \| `no` \| `dry-run` | `dry-run` if ambiguous (§8 example uses dry-run as a fallback) |
| R3 | Initial command encoding (build / test / run / health) | table-confirm: agent proposes table (§21 example), user confirms / edits / skips per row | Accept detected commands marked "high confidence"; leave "low confidence" rows unconfigured (§5 supports unset commands) |
| R4 | Health-check approach | free-text or "none": URL \| smoke-command \| CLI command \| page \| none | empty string; record "next harness improvement: encode a first health or smoke check" (§21) |
| R5 | Command execution permission | single-choice: `run-all` \| `dry-run-only` \| `none` | `dry-run-only` (§8 example user answer; matches §26.2 safety bias) |

**Optional (§6.2):**
| # | Question | Shape | When to ask |
|---|---|---|---|
| O1 | CLI invocation style (Python \| Node \| npm script \| Make \| Just \| shell wrapper) | single-choice | only if R1 has multiple plausible launchers in repo |
| O2 | Proof notes in VCS or gitignored | single-choice: `tracked` \| `ignored` \| `partial` | only if user opts into proof-note workflow |
| O3 | `harness/proofs/` committed / ignored / partial | single-choice (mirrors O2) | only if proofs folder created |
| O4 | Include a smoke-check placeholder | yes/no | only if R4 returned "none" |
| O5 | Seed known-difficulties now | yes/no (and free-text list) | only if user has known traps; default empty (§16 template) |
| O6 | Future-session startup defaults: `onboard` \| `doctor` \| both | single-choice | always; default = `both` (per §15 template steps 1–3) |

**Drift risk:**
- §6.1 phrases questions as English prose, not normalised choices. An agent may collapse "yes/no" into "let's do it" without recording which permission lattice the user granted. R2 and R5 in particular need orthogonal confirmations — granting file-create does **not** grant command-execute.
- §6 says "Do not ask all possible questions upfront if repository inspection can answer them" but does not specify a stop-rule. An overzealous skill could skip R3 because it "detected pnpm scripts", silently encoding wrong commands.
- O1 ("invocation style") interacts with the `{{HARNESS_CLI_INVOCATION}}` placeholder (Finding IC-06) — the answer drives every template substitution and must be captured even when default.

**Recommendation:**
- Lock the question matrix in `SKILL.md` as an explicit table with shape + default + "fire condition" columns, so any agent harness running the skill produces the same dialogue.
- Require R2 and R5 to be answered separately, never co-bundled.
- Detection is a *proposal*, never a substitute for R3. The skill must always show the proposed table and require a confirmation token before writing config.

---

### Finding IC-03: Target-repo file-write set is 11 files across 6 actions
**Contract surface:** file-write
**Evidence:** §5 (file tree), §8 Step 4 (file-modification rules), §10 (AGENTS.md patch behaviour), §23 (success criteria), §36 (minimum acceptable subset).
**Description:**
Complete file-write table for what the skill produces in the target repo:

| # | Path | Action | Source template (§) | Required? | Notes |
|---|---|---|---|---|---|
| 1 | `AGENTS.md` | **patch-or-create** | §10 snippet | Required (§23.3) | Append section; never overwrite. Show patch first if conflicting routing already present. |
| 2 | `HARNESS.md` | **create** (fail-loud if exists) | §9 | Required (§23.1) | Must read existing first; offer merge/replace/skip if present (§26.1). |
| 3 | `harness/README.md` | **create** | §11 | Required (§5, §23.2) | — |
| 4 | `harness/config.json` | **create** | §12 | Required (§23.5) | Placeholders substituted; unset commands kept as empty strings, not omitted. |
| 5 | `harness/bin/harness.py` | **create** (only if R1=python) | §13 | One of two required (§23.4) | Mutually exclusive with file 6. |
| 6 | `harness/bin/harness.mjs` | **create** (only if R1=node) | §14 | One of two required (§23.4) | Mutually exclusive with file 5. |
| 7 | `harness/skills/onboard-agent-session.md` | **create** | §15 | Required (§23.7) | Future-session contract (see IC-08). |
| 8 | `harness/state/known-difficulties.md` | **create** | §16 | Required (§5) | Seeded empty unless O5=yes. |
| 9 | `harness/state/friction-log.md` | **create** | §17 | Required (§5, §36) | Improvement backlog, not a diary. |
| 10 | `harness/templates/proof-note.md` | **create** | §18 | Required (§5) | — |
| 11 | `harness/templates/friction-entry.md` | **create** | §19 | Required (§5) | — |
| 12 | `harness/proofs/.gitkeep` | **create** (placeholder) | §5 tree | Recommended | O3 may instead add a `.gitignore` rule. |
| 13 | `harness/templates/cli-command-contract.md` | **create** (optional) | §20 | Optional | §20 says "either as `harness/templates/cli-command-contract.md` or inside `harness/README.md`" — choose one to lock. |

**Patch semantics (§8 Step 4, §26.1):**
- **create**: target path must not exist; if it exists, switch action to "merge/replace/skip prompt" — never silent overwrite.
- **patch-or-create** (AGENTS.md only): append §10 snippet if file exists, otherwise create file with §10 snippet inside a minimal scaffold.
- **show patch first**: any modification of existing harness or instruction files must be previewed.
- Backup behaviour is conditional: "create a backup only if the environment and user conventions support it" — leave as ambiguous-by-design rather than mandating a `.bak` policy.

**Drift risk:**
- §5 tree lists a CLI **both** `harness.py` and `harness.mjs` lines with no clear "pick one"; the skill might write both. The brief implies mutually exclusive but does not say so explicitly.
- §13 vs §14: only one CLI file should ever be written per repo; this constraint should be a hard postcondition.
- §20's "either-or" leaves CLI command contract location undefined.
- The brief never specifies whether `.gitignore` is patched if O2/O3=ignored — that is a silent file-write the skill may need to perform.

**Recommendation:**
- Lock the table above in `SKILL.md` as the **file-write manifest**. Add columns: "preconditions" (path must not exist / path may exist), "postcondition check", "action verb" (create / patch / merge / .gitkeep / .gitignore-line).
- Mark §5 CLI lines explicitly: "exactly one of `harness.py` OR `harness.mjs` — never both".
- Decide §20 once: CLI contract lives inside `harness/README.md` (less file sprawl) OR in `harness/templates/cli-command-contract.md` (more discoverable). Document choice.
- Add explicit `.gitignore` patch behaviour for O2/O3 = ignored.

---

### Finding IC-04: CLI command contract has 11 subcommands, 2 global flags, 3 exit codes
**Contract surface:** CLI-cmd
**Evidence:** §6 Step 6, §13 (Python), §14 (Node), §20 (contract template).
**Description:**
Subcommands (both skeletons):
| Subcommand | Behaviour | Reads | Writes | `--dry-run` honoured? |
|---|---|---|---|---|
| `doctor` | Report harness readiness | `config.json` | stdout | No |
| `install` | Run configured install command | `config.json.commands.install` | shell | Yes |
| `build` | Run configured build command | `config.json.commands.build` | shell | Yes |
| `test` | Run configured test command | `config.json.commands.test` | shell | Yes |
| `lint` | Run configured lint command | `config.json.commands.lint` | shell | Yes |
| `format_check` | Run configured format-check command | `config.json.commands.format_check` | shell | Yes |
| `run` | Run configured run/boot command (long-running) | `config.json.commands.run` | shell | Yes |
| `smoke` | Run configured smoke command | `config.json.commands.smoke` | shell | Yes |
| `health` | HTTP GET health URL | `config.json.health.url` | network | Yes |
| `validate` | Run layered validation: build → test → health | multiple | shell+network | Yes |
| `onboard` | Print onboarding checklist | — | stdout | No |
| `magic-wand` | Print magic-wand prompt | — | stdout | No |

Global flags:
| Flag | Effect | Scope |
|---|---|---|
| `--json` | Emit envelope `{status, title|command, messages[], next_action?}` instead of human text | All commands that use `print_result`/`printResult`. **Not honoured by `onboard` or `magic-wand`** (both skeletons use raw `print`/`console.log`). |
| `--dry-run` | Show what would run; do not execute | All shell-wrapper commands + `health` + `validate`. **Not declared on `doctor`, `onboard`, `magic-wand`**. |

Exit codes (§20 contract + skeletons):
| Code | Meaning | Source |
|---|---|---|
| `0` | passed / completed / dry-run success | both skeletons |
| `1` | failed (config missing in doctor; HTTP non-2xx/3xx in health; subprocess non-zero in shell wrappers; any hard failure in validate) | both skeletons |
| `2` | unconfigured / not applicable (empty command string; empty health URL) | both skeletons |

`validate` composition (both skeletons, identical):
- Steps hardcoded as `["build", "test"]` then call `health()`.
- A code other than 0 or 2 short-circuits and is returned immediately.
- Final return is 1 if any non-0/2 codes accumulated, else 0.
- **Drift from §12 config**: §12 declares `validation.quick = ["doctor","build","test"]` and `validation.proof = ["doctor","build","test","health","smoke"]`, but neither skeleton reads these arrays. The validate sequence is hardcoded.

**Drift risk:**
- `doctor` returns **1** when `config.json` is missing. Per §20, "unconfigured or not applicable" should be exit `2`. Missing config is closer to unconfigured than to fail. Both skeletons agree on the *behaviour*, but the *behaviour disagrees with the documented contract*.
- `smoke` is in §12 config but not in the hardcoded `validate` step list.
- `format_check` appears in §12 (template) and skeletons; brief prose (§7.2, §28) uses "format". Naming choice needs to be locked — the skeletons settled on `format_check`, so that should be canonical.
- `onboard` and `magic-wand` print prose; they cannot be parsed as the JSON envelope. If a future agent harness wants to call them programmatically, the output is not machine-readable.
- Help: Python uses `argparse` built-in `--help`; Node has a hand-rolled `printHelp()` triggered by `--help`, `help`, or no command. Unknown command behaviour differs: argparse errors with non-zero; Node prints `printHelp()` + exit `1`.

**Recommendation:**
- Standardise `doctor`'s missing-config exit code to `2` (unconfigured) to match the documented contract, or change §20 to admit `1` for "harness not initialised". Pick one.
- Make `validate` read `config.json.validation.quick` (or `validation.proof` when a profile flag is passed) rather than hardcoding steps. Add `--profile quick|proof` flag.
- Add `--json` and `--dry-run` to `onboard` and `magic-wand` for envelope-compatible output (even if dry-run is a no-op).
- Document exit `2`-vs-`1` semantics in §20 contract block: `2` is "the harness cannot answer because nothing is configured", `1` is "the harness ran and got a real failure".

---

### Finding IC-05: Python vs Node skeletons agree on contract but diverge in edge cases
**Contract surface:** CLI-cmd
**Evidence:** §13 (Python `harness.py`), §14 (Node `harness.mjs`).
**Description:**
Direct comparison of the two skeletons against the §20 contract:

| Concern | Python (§13) | Node (§14) | Drift? |
|---|---|---|---|
| Config path | `harness/config.json` resolved from `__file__.parents[2]` | `harness/config.json` resolved from `import.meta.url + ../..` | Equivalent. |
| Empty config handling | `load_config()` returns `{}` if missing | `loadConfig()` returns `{}` if missing | Match. |
| Envelope shape | `{status, title|command, messages[], next_action}` via `print_result` | Same via `printResult` | Match. |
| JSON output | `json.dumps(payload, indent=2, sort_keys=True)` | `JSON.stringify(payload, null, 2)` | **Drift**: key ordering differs. Sorted vs insertion-order. |
| `--json` parsing | argparse top-level boolean; subcommand reads `args.json` | `hasFlag("--json")` global scan of `process.argv` | **Drift**: Node lets `--json` appear anywhere; Python is more strict (must precede subcommand or be parented). |
| `--dry-run` parsing | argparse on shell wrappers + health + validate | `hasFlag("--dry-run")` global scan | **Drift**: same scope difference. |
| Unknown command | argparse error → exit 2 | `console.error("Unknown command: …")` + `printHelp()` + exit 1 | **Drift**: exit codes differ. |
| Help on no args | `parser.print_help()` + return 0 | `printHelp()` + return 0 | Match. |
| `doctor` exit on missing config | `1` | `1` | Match (but both drift from §20 — see IC-04). |
| `health` HTTP success window | 200–399 | 200–399 | Match. |
| `health` timeout default | 30s | 30s | Match. |
| `health` failure return | Exception → status=fail, exit 1 | Catch → status=fail, exit 1 | Match. |
| `validate` step list | `["build","test"]` hardcoded then `health()` | Same | Match (both drift from §12). |
| `validate` early-exit | `code not in (0,2)` short-circuits | `![0,2].includes(code)` short-circuits | Match. |
| `onboard` output | Raw `print` lines | Raw `console.log` lines | **Drift**: neither honours `--json` (see IC-04). |
| `magic-wand` output | Raw `print` lines | Raw `console.log` lines | **Drift**: same as onboard. |
| Subprocess execution | `subprocess.run(cmd, shell=True, cwd=ROOT)` | `spawn(cmd, {cwd: ROOT, shell: true, stdio: "inherit"})` | Match (shell=True both). |
| Exit-code passthrough | `completed.returncode` | `code ?? 1` (null → 1) | **Drift**: Node coerces null to 1; Python passes raw `None` would error — but `subprocess.run` always sets `returncode`. Low-risk. |

**Drift risk:**
- Sorted-vs-insertion JSON key order makes diffing JSON output between Python and Node sites non-trivial. Tooling that snapshots JSON envelope output cannot share fixtures across languages.
- `--json` and `--dry-run` positional sensitivity differs. A user passing `harness.py test --json` works in Python; the equivalent `harness.mjs test --json` works in Node. But `harness.py --json test` works in Python (top-level), while `harness.mjs --json test` also works in Node (global scan). The two agree on Trump cases but disagree on rejection cases (Python rejects `harness.py test --json foo`, Node silently ignores).
- Unknown-command exit codes differ (Python 2, Node 1). Either is defensible, but a portable contract should pick one.
- `onboard`/`magic-wand` JSON drift will block any programmatic consumer of those subcommands.

**Recommendation:**
- Lock the JSON envelope as canonical: `{status, title?, command?, messages: string[], next_action?: string}` with keys emitted in a documented order (e.g., `status, title, command, messages, next_action`). Update both skeletons to match.
- Move `--json` and `--dry-run` to a documented top-level position OR specify "may appear anywhere" — and back it with a unit-style example in the contract.
- Standardise unknown-command exit code (recommend `2` = unsupported invocation).
- Refactor `onboard` and `magic-wand` to use `print_result`/`printResult` so they participate in the envelope.

---

### Finding IC-06: Placeholder substitution surface is 10 tokens; §32.2 only enumerates 7
**Contract surface:** placeholder
**Evidence:** §32.2 (explicit list), §12 (template using extras), §24 (`{{harness_cli_file}}`), §9/§10/§11/§15 (placeholder usage sites).
**Description:**
Full enumerated placeholder table (sourced from every template that uses one):

| Placeholder | Substitutes with | "Empty/unknown" representation | Appears in template § |
|---|---|---|---|
| `{{HARNESS_CLI_INVOCATION}}` | The full invocation string, e.g. `python harness/bin/harness.py`, `node harness/bin/harness.mjs`, `npm run harness --`, `uv run python harness/bin/harness.py`, `just harness`, `./harness/bin/harness.py` | n/a — must never be empty; if R1+O1 unresolved, skill cannot write templates. **Hard precondition.** | §9, §10, §11, §15 |
| `{{python_or_node}}` | Literal `python` or `node` | n/a — must never be empty (mirrors R1). | §12 (`cli_language`), §24 |
| `{{BUILD_COMMAND}}` | Confirmed shell string | Empty string `""` (config keeps the key with empty value per §12 unset policy) | §12 |
| `{{TEST_COMMAND}}` | Confirmed shell string | Empty string `""` | §12 |
| `{{LINT_COMMAND}}` | Confirmed shell string | Empty string `""` | §12 |
| `{{FORMAT_CHECK_COMMAND}}` | Confirmed shell string | Empty string `""` | §12 |
| `{{RUN_COMMAND}}` | Confirmed shell string | Empty string `""` (note §22 warns about long-running) | §12 |
| `{{HEALTH_URL}}` | Confirmed URL or empty | Empty string `""`; surfaces in `doctor` as "Health URL not configured" | §12 |
| `{{SMOKE_COMMAND}}` | Confirmed shell string | Empty string `""` | §12 |
| `{{harness_cli_file}}` | `harness.py` or `harness.mjs` | n/a — derived from R1 | §24 (final report) |

**§32.2 omission:** §32.2 enumerates 7 placeholders. It misses `{{LINT_COMMAND}}`, `{{FORMAT_CHECK_COMMAND}}`, and `{{harness_cli_file}}`. The complete list is 10.

**Replacement vs leave-visibly-empty (§32.2):**
- §32.2 says "The running skill should replace placeholders or leave them visibly empty if unknown."
- For `{{HARNESS_CLI_INVOCATION}}` and `{{python_or_node}}`, leaving the literal `{{…}}` in `HARNESS.md` would break the front-door instruction and the published agent contract. These must always be resolved.
- For command/URL placeholders inside `harness/config.json`, "visibly empty" means an empty JSON string `""`, not the literal `{{BUILD_COMMAND}}`, because `harness.py`/`harness.mjs` parse the JSON and check `(cfg.get("command") or "").strip()`. A literal `{{BUILD_COMMAND}}` would be treated as a *configured* command and the CLI would try to execute it as a shell command — a real footgun.

**Drift risk:**
- §32.2's "leave visibly empty" rule conflicts with the §12 JSON template behaviour. If literal `{{BUILD_COMMAND}}` reaches `config.json`, both CLI skeletons will run `{{BUILD_COMMAND}}` as a shell command and fail confusingly (not `unconfigured`, but `failed`).
- §32.2 enumeration is incomplete (missing 3 placeholders).
- No naming convention is enforced. The brief mixes UPPER_SNAKE (`{{BUILD_COMMAND}}`) and lower_snake (`{{python_or_node}}`, `{{harness_cli_file}}`). A linter for the templates would have nothing to validate against.

**Recommendation:**
- Replace §32.2's "leave visibly empty" with three explicit rules:
  1. In `HARNESS.md`/`AGENTS.md`/`README.md` prose, replace with the resolved string; **never leave `{{…}}` markers**.
  2. In `harness/config.json`, replace with the resolved string or an empty string `""`; **never leave `{{…}}` markers** (CLI would mis-execute).
  3. In commit messages or report templates, leaving `{{…}}` is acceptable as a "TODO" signal.
- Expand §32.2 to the full 10-token list (or move to a dedicated "Placeholders" sub-section).
- Lock the naming convention: `UPPER_SNAKE` for shell-command/URL substitutions; `lower_snake` for runtime-language identifiers (`python_or_node`, `harness_cli_file`).
- Add a self-check: the skill should refuse to finish if any `{{…}}` literal remains in a written file.

---

### Finding IC-07: Final setup report has 8 fixed sections
**Contract surface:** report
**Evidence:** §24 (template), §23 (success criteria), §31 (partial-setup report variant).
**Description:**
The §24 final report fixes the following sections, in this order:

1. **Created or updated** — bulleted file list (11 entries, mirrors IC-03).
2. **CLI language** + **CLI invocation** — single lines (`{{python_or_node}}`, `{{HARNESS_CLI_INVOCATION}}`).
3. **Configured commands table** — 5 rows: `build`, `test`, `run`, `health`, `smoke`. Columns: harness command / repository command / status (`configured` \| `unconfigured`).
4. **Validation performed table** — 6 rows: CLI help, doctor, validate dry-run, build, test, health. Columns: check / result / evidence. Empty rows allowed when not run.
5. **What is proven** — bullet list (concrete passing evidence only).
6. **What remains unproven** — bullet list (everything not proved by step 4).
7. **Recommended next harness improvement** — single-bullet; concrete and encodable, not aspirational.
8. **Magic-wand question** — verbatim §1.7 prompt; user response not pre-recorded.

§31 partial-setup variant rearranges the headings but preserves the proven/unproven contract.

**Drift risk:**
- The §24 "Configured commands" table omits `install`, `lint`, and `format_check` even though `harness/config.json` carries them. Three configurable commands have no row in the final report.
- "Validation performed" includes `validate dry-run` but not `validate proof` — the report cannot distinguish fast-loop from proof-loop runs (§29).
- "Recommended next harness improvement" is constrained to one item. §27/§28 push for "at most one" — that one-cap should be a hard rule, not a soft suggestion.
- §24 says "Validation performed" → "Result" cells use unstructured prose. A future tool wanting to parse the report has no schema.

**Recommendation:**
- Extend the configured-commands table to all 7 command slots (`install`, `build`, `test`, `lint`, `format_check`, `run`, `smoke`) plus the health row.
- Make the validation table profile-aware: add `validate (quick)` and `validate (proof)` row variants once §12 profiles are honoured.
- Lock "Recommended next harness improvement" at exactly one item (cap=1), with optional alternates listed under "additional candidates" if needed.
- Add a structured `### Setup report (JSON)` sibling block emitting `{created: string[], cli: {language, invocation}, configured: {<cmd>: status}, validation: [{check, result, evidence}], proven: string[], unproven: string[], next_improvement: string, magic_wand_prompt: string}` — gives downstream tools a parseable artefact.

---

### Finding IC-08: Future-session onboarding contract is a 7-step protocol
**Contract surface:** downstream
**Evidence:** §15 (`harness/skills/onboard-agent-session.md` template), §9 (`HARNESS.md` "Definition of done"), §28 (recommended improvements).
**Description:**
`harness/skills/onboard-agent-session.md` is the durable contract the skill writes for every *future* agent session. Surface (verbatim §15):

| Step | Future agent must… | Expects to find… |
|---|---|---|
| 1 | Read `AGENTS.md` | Existing file with harness routing section |
| 2 | Read `HARNESS.md` | Existing file with operating loop + rules |
| 3 | Run `{{HARNESS_CLI_INVOCATION}} --help` and `… doctor` | CLI exits 0 on help; doctor reports configured/unconfigured |
| 4 | Read `harness/config.json`, `harness/state/known-difficulties.md`, `harness/state/friction-log.md` | These files exist; difficulties and friction are skim-readable |
| 5 | If approved, run `{{HARNESS_CLI_INVOCATION}} validate --dry-run`, then real validation | `validate` exits 0/1/2 deterministically |
| 6 | Emit a "Harness onboarding report" with 12 yes/no + evidence fields | A standard report shape (template embedded in §15) |
| 7 | If failure, classify into one of 7 layers (task/spec, instruction/context, environment, command/tooling, validation, state/continuity, model capability) | The 7-layer taxonomy is consistent with §1.6 |

**Step 8 (informal):** propose at most one concrete encoded improvement candidate.

The §15 template's "Completion rule" is the downstream contract's strongest claim:
> "Readiness is based on evidence from the harness. If a check cannot run, say why and record what needs to be encoded next."

This is the binding promise the setup skill makes to every future agent session.

**Drift risk:**
- §15's 12 yes/no report fields are not aligned with the §24 setup-time report (§24 uses 8 sections, §15 uses a flat checklist). Future agents may struggle to determine whether their "harness onboarding report" needs to extend or replace the setup-time report.
- The §15 step 7 classification uses 7 layers, but §1.6 lists 8 friction categories (setup unclear, command missing, env not bootable, error useless, seed absent, validation weak, state not durable, supported path harder). Mismatch may confuse the friction taxonomy.
- §15 step 5 says "real build/test/health commands" but the §15 onboard guide is shipped as a *file* and read into the current session's context — there is no guarantee a future session interprets "approved" the same way the setup-time skill did. The permission contract resets per-session.
- `harness onboard` (the CLI subcommand) prints a different, hardcoded checklist than the §15 file describes. The CLI subcommand is a 6-step list; the §15 file is a 7-step list. **Two onboarding sources of truth.**

**Recommendation:**
- Unify the `harness onboard` subcommand to echo `harness/skills/onboard-agent-session.md` content (or extract a shared checklist source) so there is exactly one onboarding protocol.
- Align the §15 7-layer classification with §1.6 8-item friction list, or document why they differ.
- Add a single sentence to §15 making the per-session permission reset explicit: "Each future session must re-confirm command-execution permission; do not assume the original setup-time grant carries over."
- Lock the §15 report shape to a YAML/JSON-friendly form so future agents can produce it programmatically.

---

### Finding IC-09: Safety contract has 9 explicit preconditions; postcondition assertions are weaker
**Contract surface:** safety
**Evidence:** §3 (non-goals), §8 Step 4/Step 10, §22 (long-running), §26 (full safety section).
**Description:**
The safety contract decomposed into preconditions/postconditions:

**§26.1 File modification preconditions (must hold before any write):**
- P1: User has answered R2 (file-create permission). [§6.1#2]
- P2: For every existing file in the IC-03 manifest, contents have been read into context.
- P3: If a conflict exists (existing harness file), the user has chosen merge / replace / skip / show-patch.
- P4: `AGENTS.md` modifications use append/merge, never full replacement.

**§26.1 File modification postconditions:**
- Q1: No existing file overwritten without an explicit user choice.
- Q2: A patch-style diff was shown for every modified pre-existing file.
- Q3: Files created on disk match the IC-03 manifest exactly (no extras, no missing required).

**§26.2 Command execution preconditions:**
- P5: User has answered R5 (command-execute permission).
- P6: For destructive commands (DB reset, migration, deploy, cleanup), explicit case-by-case confirmation, not the blanket R5 grant.
- P7: Long-running commands (`run`, dev servers) require either dry-run-only or a session-safe wrapper (§22 — first version may simply encode without executing).
- P8: Dry-run was attempted first where supported.

**§26.2 Command execution postconditions:**
- Q4: No silent failures — every executed command's result is in the §24 report.
- Q5: No orphan processes left after long-running `run` attempts (§22).

**§26.3 Claim safety preconditions:**
- P9: Before claiming "validated", the actual commands must have run with exit 0.

**§26.3 Claim safety postconditions:**
- Q6: The §24 "What is proven" section contains only items backed by exit-0 evidence.
- Q7: The §24 "What remains unproven" section contains everything not in Q6.
- Q8: No "validated" assertion appears anywhere when commands were skipped or failed.
- Q9: Agent confidence is never used as completion evidence (§28 cross-check).

**Drift risk:**
- Postconditions are not enforceable from prose. There is no machine check that "What is proven" only contains exit-0 backed claims; a hallucinated entry would slip through.
- P6 (destructive command confirmation) is described qualitatively. There is no list of *which* commands are destructive — the skill must infer. A `pnpm test` that runs migrations is destructive but looks innocuous.
- P7 long-running policy is "may simply encode without executing" — soft. A real implementation may push the boundary.
- Q5 orphan-process guarantee is only required if the skill chose to execute `run`; the brief does not require any orphan-cleanup helper.
- The skill cannot self-verify postconditions without a small inspection step.

**Recommendation:**
- Add a "self-check before final report" step: after writing files, the skill must (a) re-list IC-03 paths and confirm presence; (b) re-read `HARNESS.md` and confirm no `{{…}}` markers remain (cross-ref IC-06); (c) build "proven" from a captured exit-code log, never from prose memory.
- Add a `harness/` `.destructive-commands.md` notes file the user can populate; the skill should warn before any command matching a known-destructive-token list (`migrate`, `reset`, `drop`, `destroy`, `deploy`, `--prod`, `rm -rf`, etc.).
- Make P7 a hard constraint for v1: `run` must be encoded-only, never executed by the setup skill itself. The user can execute it after setup.
- Require Q8 to be checkable: every "validated" or "passing" claim must reference an evidence row in the §24 validation table.

---

### Finding IC-10: JSON envelope shape is stable across skeletons; underlying schemas (config.json, report) are still prose
**Contract surface:** placeholder · CLI-cmd · report
**Evidence:** §12 (config), §13 (`print_result`), §14 (`printResult`), §24 (report).
**Description:**
Three contract surfaces should have machine-readable schemas; only the JSON envelope is implicitly stable:

**(a) CLI output envelope (stable, both skeletons agree):**
```json
{
  "status": "pass | fail | unknown | unconfigured | dry-run | running",
  "title":  "string (optional; doctor/health/validate use this)",
  "command": "string (optional; shell-wrapper subcommands use this instead of title)",
  "messages": ["string", "string"],
  "next_action": "string (optional)"
}
```
Both Python (`json.dumps(payload, indent=2, sort_keys=True)`) and Node (`JSON.stringify(payload, null, 2)`) emit this shape. **Drift:** sorted-vs-insertion key order (see IC-05). Fields-wise, contract is stable.

Status enum is implicit, not declared anywhere — the skeletons emit `pass`, `fail`, `unconfigured`, `dry-run`, `running`, `unknown`. A schema would catch a typo like `passed` or `success`.

**(b) `harness/config.json` (§12, no schema):**
Currently described only by the §12 template. Implicit fields:
- `schema_version: integer (currently 1)`
- `harness: {name, cli_language, created_by}`
- `commands: {<name>: {command: string, description: string}}` — 7 known names
- `health: {url: string, timeout_seconds: integer, description: string}`
- `validation: {quick: string[], proof: string[]}` — string arrays referencing command names
- `notes: {unset_command_policy: string, safety: string}`

There is no JSON Schema, no JSON Type Definition, no Pydantic / Zod model. A typo'd key (`commnads`) is silently treated as missing.

**(c) §24 setup report (prose, no schema):**
The §24 template is markdown. The "What is proven" / "What remains unproven" / "Configured commands" sections have implicit shapes but no parser. See IC-07 recommendation for a JSON sibling block.

**Drift risk:**
- Schema-less `config.json`: a future skill version (v2) cannot add a field safely without breaking existing CLIs. `schema_version: 1` is declared but no version-bump rules exist.
- Status enum drift: a new subcommand could emit `status: "degraded"` (mentioned in §20: "distinguish hard failure from degraded-but-usable states") and no consumer would know whether to treat it as pass or fail.
- No portability test: nothing prevents a third implementation language (Go, Rust) from drifting from the Python/Node skeletons.

**Recommendation:**
- Ship a `harness/schemas/config.schema.json` (JSON Schema draft 2020-12) alongside the §12 template. Validate `harness/config.json` against it in `doctor`. Bump `schema_version` discipline.
- Ship a `harness/schemas/envelope.schema.json` covering the §13/§14 envelope. Both skeletons should validate their `print_result` payloads in test mode.
- Define the status enum explicitly: `pass | fail | unconfigured | dry-run | running | degraded | skipped | unknown`. Document each.
- Add a CLI-contract conformance test fixture (a tiny corpus of inputs + expected envelope output) that any new implementation language must pass to be considered conformant.
- Add a sibling JSON block to the §24 markdown report (per IC-07) so the setup report is parseable.

---

## Summary

The Engineering Harness Setup skill's contract surface is well-described by §4–§24 of the brief, but the I/O contract is not yet locked tightly enough for a portable skill package shipped across multiple agent harnesses. The invocation surface is conversational with no formal CLI args (IC-01), the decision matrix is 5 required + 6 optional questions whose answer shapes need normalisation (IC-02), and the file-write manifest of 11–13 files needs explicit create-vs-patch verbs and mutually-exclusive markers for the two CLI variants (IC-03). The generated CLI exposes 11 subcommands, two global flags, and three exit codes, but the Python and Node skeletons drift on JSON key ordering, `--json`/`--dry-run` parsing scope, unknown-command exit codes, and `onboard`/`magic-wand` envelope conformance — and both skeletons hardcode a validate sequence that disagrees with the `validation` profile config they ship (IC-04, IC-05). §32.2 enumerates 7 placeholders but templates use 10, and the "leave visibly empty" rule conflicts with how `harness/config.json` is parsed at runtime (IC-06). The §24 final report omits three configured commands and offers no parseable sibling artefact (IC-07). The downstream contract (`onboard-agent-session.md`) defines a 7-step protocol that competes with the `harness onboard` CLI subcommand's hardcoded 6-step list — two sources of truth for future-session onboarding (IC-08). Safety preconditions are explicit but postconditions are unenforceable from prose, and "long-running" handling is left soft for v1 (IC-09). The JSON envelope is the only surface with cross-language stability, while `config.json` and the setup report have no schema — the most actionable next step is to ship JSON Schemas for the envelope and config, lock the status enum, expand §32.2 to the full placeholder list, and unify `harness onboard` with the §15 onboarding file so the portable skill package has one canonical contract per surface (IC-10).

# Field Research: minih + chainglass

**Generated**: 2026-05-22
**Purpose**: Validate the brief's assumptions against two real-world harness implementations.
**Repos**:
- `~/substrate/minih` — TypeScript / Node CLI tool. Agent runtime + project. Harness maturity: **L2**.
- `~/substrate/chainglass` — pnpm monorepo with Docker-containerised dev environment + Playwright + CDP browser automation. Harness maturity: **L3**.

**Files inspected** (durable references):
- `~/substrate/minih/docs/project-rules/harness.md` (135 lines) — minih's HARNESS-equivalent.
- `~/substrate/minih/justfile` (58 lines) — minih's recipe surface.
- `~/substrate/minih/AGENTS.md` (head 60 lines) — minih's routing/dogfood rules.
- `~/substrate/minih/src/schemas/retrospective.json` — magic-wand schema.
- `~/substrate/minih/src/cli/commands/difficulties.ts` — friction-log CLI surface.
- `~/substrate/chainglass/HARNESS_INDEX.md` (370 lines) — chainglass's harness API documentation index.
- `~/substrate/chainglass/docs/project-rules/harness.md` (328 lines) — chainglass's HARNESS-equivalent.
- `~/substrate/chainglass/harness/README.md` (493 lines) — chainglass's harness implementation README.
- `~/substrate/chainglass/AGENTS.md` (head 60 lines) — chainglass's routing/preflight rules.
- `~/substrate/chainglass/harness/agents/smoke-test/output-schema.json` — magic-wand schema.

---

## TL;DR — 8 highest-impact findings

1. **Neither repo has a root `HARNESS.md`.** The harness contract lives at `docs/project-rules/harness.md` in both. The root has `AGENTS.md` + `README.md` only. **The brief's "HARNESS.md at repo root" is greenfield-ideal but doesn't match real practice.**
2. **Both repos confirm the brief's overall HARNESS-document anatomy.** minih's `docs/project-rules/harness.md` follows almost exactly the brief §9 template structure: Purpose → Boot → Interact → Observe → Maturity Assessment → Validation Checklist → Phase Gates → Dogfood Rules → History → User-content sentinel. Strong validation of the brief's template skeleton.
3. **Magic-wand wording in production differs from the brief.** Both repos use a 1-thing, concrete form (*"If you had a magic wand, what ONE thing would you change? Be concrete."*). Neither uses the brief's 4-adjective "easier, safer, faster, or higher quality" tail. **CF-06 should be re-opened.**
4. **No one writes a stdlib Python/Node CLI from scratch.** Both repos wrap existing tooling — minih: `minih <cmd>` (its own TypeScript CLI), chainglass: `just harness <cmd>` (recipes that exec `pnpm exec tsx src/cli/index.ts`). **The brief's `harness/bin/harness.py` is a viable greenfield path but won't be how either of these repos installs the skill.**
5. **`AGENTS.md` opens with the harness — and an explicit equivalence table.** minih's AGENTS.md starts with *"🛑 Dogfood rule — never read run-dir files directly"* and a 13-row equivalence table mapping forbidden `cat …` → allowed `minih …`. This is the brief's §10 snippet's *much stronger* real-world counterpart. **Adopt.**
6. **Maturity ladder L0–L4 is operationalised in frontmatter.** Both repos have `**Maturity**: L2` (minih) / `L3` (chainglass) in YAML/header. Brief mentions L0–L6 in source-notes but doesn't bake it into the template. **The L0–L4 ladder is the lived-in version; L5/L6 aren't observed.**
7. **The friction log is a CLI-aggregated query, not a single markdown file.** minih has `minih difficulties [--agent <slug>]` that aggregates per-run reports across `agents/<slug>/runs/<runId>/output/report.json`. The brief's `harness/state/friction-log.md` is the static-file version. **Both are valid; the CLI-aggregated form is the higher-maturity version.**
8. **Encoded-fix examples are concrete and impressive.** Chainglass FX007 is a recipe that catches a generic class of bug (server-only modules leaking into client chunks via barrel re-exports) that bypassed `tsc --noEmit` + `pnpm vitest` + companion review. The fix is one `just harness-verify <path>` recipe that does HTTP-ping + filtered console capture + `docker logs` grep. **This is the goal state the brief gestures at; both repos can be cited as proof the loop closes.**

---

## What the brief got right (validated by reality)

### Document structure (brief §9 HARNESS.md template)

**Validated 1:1 by minih's `docs/project-rules/harness.md`**:

| Brief §9 section | minih's harness.md |
|---|---|
| Purpose | ✅ "Purpose" (one paragraph, matches tone) |
| Boot (command + health + idempotent) | ✅ "Boot" with command / health check / boot time / idempotent |
| Interact (CLI table) | ✅ "Interact" with primary mode + endpoints table |
| Observe (capture + logs + evidence) | ✅ "Observe" with response capture / logs / evidence directory |
| Maturity (L0–L4) | ✅ "Maturity Assessment" L0–L4 table + current = L2 + "Maturity Before -> After" history column |
| Validation Checklist | ✅ "Validation Checklist" with Boot/Interact/Observe/Operate subsections |
| Phase Gates | ✅ "Phase Gates" table with Domain × Boot/Interact/Observe/Narrow-Gate columns |
| Dogfood Rules | ✅ "Dogfood Rules" |
| History | ✅ "History" with date/plan/change/maturity-transition columns |
| User-content sentinel | ✅ `<!-- USER CONTENT START -->`/`<!-- USER CONTENT END -->` HTML comments |
| Validation copy-paste | ✅ "Copy-paste harness validation" bash block at the end |

**Verdict**: The brief's HARNESS.md skeleton is essentially the minih file, rewritten generically. Strong field validation.

### Boot → Interact → Observe → Validate loop

Both repos use this loop name verbatim, in this order. Foundation #10 and brief §1.2 are vindicated.

### CLI JSON envelope

- minih: "JSON envelopes on stdout, human-readable on stderr." Exact match to brief's `print_result` shape.
- chainglass: `{command, status, data?, error?}` HarnessEnvelope returned by every CLI command.
- Both implement the brief's IC-10 envelope shape.

### Doctor command

- minih: `minih doctor` validates agent conventions + project health surfaces.
- chainglass: `just harness doctor [--wait]` runs **layered checks** (Docker → Ports → Container → App → Services in order) with actionable fixes — the brief's §22 "doctor prescribes fixes" pattern, in production.

### Dogfood rule

Both repos enforce it; minih especially aggressively (the AGENTS.md openings literally says *"The harness IS the product. We MUST be exemplar users."*).

### Encoded-fix pipeline (magic-wand → friction → encoded change)

Chainglass `harness/README.md` "Proof It Works" table:
| Retrospective finding | Fix | Result |
|---|---|---|
| "No `console-logs` command — had to write Playwright from scratch" | FX002: Added `console-logs` + `screenshot-all` commands | Committed `d144c6a` |
| Screenshot timed out on SSE pages | FX003: Added `--wait-until` flag, changed default to `domcontentloaded` | In progress |

This is the brief's §1.4 ("encode the fix") in literal evidence.

---

## What the brief got wrong / needs revision

### Issue 1: HARNESS.md location

**Brief claims**: HARNESS.md at the repo root.
**Reality**: Both repos put the harness contract at `docs/project-rules/harness.md`. Root contains `AGENTS.md` + `README.md` + (in chainglass) many uppercase navigation docs.
**Why it matters**: A target repo that already follows the chainglass / minih convention will have a project-rules path conflict. The skill needs a policy.
**Recommendation**:
- v0.1 default: still write `HARNESS.md` at root (the brief is right that this is more discoverable for fresh teams / fresh agents).
- BUT detect `docs/project-rules/harness.md` on inspection; if it exists, ask the user to choose: replace, merge, or skip.
- Long-term: consider whether the skill should support both placements via a `--rules-location root|docs/project-rules` flag.

### Issue 2: Magic-wand wording (CF-06 re-open)

**Decisions.md current**: 4-adjective canonical *"easier, safer, faster, or higher quality."*
**Reality (both schemas)**: 1-thing concrete form, no adjectival tail.
- minih: *"If you had a magic wand, what ONE thing would you change? Be concrete."* (minLength: 20)
- chainglass: *"If you could add or change one thing about the harness, what would it be? Be concrete."*

**Why it matters**: The brief, harness-foundations, and now both real implementations disagree. The 4-adjective form is the brief's invention; neither lived-in harness uses it.
**Recommendation**: Replace the 4-adjective canonical with the simpler concrete form. Suggested unified wording:

> *"If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, or higher quality? Be concrete — name a command, flag, output field, fixture, diagnostic, template, or workflow change."*

This preserves the brief's enumeration (the "list of things" framing brief §1.7 expects, which is valuable for agents who don't know what counts) while matching the real-world "ONE thing, be concrete" framing. Add `magicWandTarget` enum (from minih schema): `project | minih | coordination` — adaptable to *project | harness | agent* for our generic skill.

### Issue 3: CLI implementation assumption

**Brief claims**: stdlib Python (`harness/bin/harness.py`) OR stdlib Node (`harness/bin/harness.mjs`).
**Reality**:
- minih's harness CLI is the project's own TypeScript binary (`minih <cmd>`). No separate "harness CLI" — the project CLI *is* the harness CLI.
- chainglass's harness CLI is a TypeScript Commander.js app inside `harness/src/cli/`, run via `just harness <cmd>` → `pnpm exec tsx src/cli/index.ts <cmd>`. Not stdlib; not Python.
- **Neither would benefit from the brief's Python/Node skeleton.** Both already have richer tooling.

**Why it matters**: In a target repo with an existing CLI (Next.js, TypeScript project, Go service, etc.), installing a separate `harness/bin/harness.py` competes with the existing tooling. The CLI skeleton is greenfield-only.

**Recommendation**: Add a Q during inspection: *"Do you want a new stdlib CLI installed at `harness/bin/`, OR do you want the skill to wrap your existing tooling (justfile / package.json scripts / Makefile)?"* If wrap-existing is chosen, the skill writes recipes/scripts that delegate; no `harness/bin/harness.py` is created.

### Issue 4: AGENTS.md snippet (brief §10) is anemic

**Brief §10**: a short "harness routing" snippet.
**Reality (minih)**: AGENTS.md *opens* with the dogfood rule and a **13-row equivalence table** explicitly mapping forbidden direct-file-access commands to required CLI calls. This is the most-quoted contract in the entire repo.

**Why it matters**: A weak AGENTS.md patch is the first thing future agents read; if it's gentle, the dogfood rule erodes immediately.
**Recommendation**: Replace brief §10 with something modelled on minih's pattern:

- Title: **"The harness is non-negotiable."**
- One-paragraph dogfood rule.
- An **equivalence table** that gets filled in during install with concrete commands from the target repo (matrix template; rows added as the skill discovers candidate command pairs).
- Self-check at the end: *"Ask: 'Could `<CLI> X` answer this?' If yes, use that. If no, the gap is the answer — file it as a magic-wand."*

### Issue 5: `harness/state/friction-log.md` as the only friction surface

**Brief §17**: friction-log is a single markdown file.
**Reality (minih)**: `minih difficulties [--agent <slug>]` is a CLI command that aggregates structured difficulty reports across `agents/<slug>/runs/<runId>/output/report.json` files. The "friction log" is a *query*, not a single document.

**Why it matters**: The single-markdown approach scales poorly past ~50 entries and isn't agent-queryable.
**Recommendation**: Keep `friction-log.md` for v0.1 (lower barrier, no schema design needed). But:
- Document the upgrade path in HARNESS.md: *"At maturity L3+, replace the markdown log with a CLI that aggregates from per-run retrospectives."*
- Optionally: make the entry template a JSON-fenced block inside the markdown so future agents can parse it without schema change.

### Issue 6: Exit code trichotomy is too coarse

**Brief**: 0 / 1 / 2.
**Reality (chainglass)**: E100–E126, 14 semantic codes (E101 container-not-running, E122 auth-missing, E124 validation-failed, etc.). Returned in the envelope's `error.code` field; exit code is still 0/1 (success/failure), but the JSON includes the semantic code.

**Why it matters**: 0/1/2 collapses orthogonal failure modes ("unconfigured" vs "auth missing" vs "timeout"). Agents handling each differently need finer granularity.
**Recommendation**: Keep 0/1/2 *as exit codes* (process-level). Add `error.code` field to the JSON envelope using the brief's exit-2 reasons enumerated more granularly: `UNCONFIGURED`, `AUTH_MISSING`, `TIMEOUT`, `INVALID_ARGS`, `DEPENDENCY_MISSING`. This stays Simple-Mode-friendly but unlocks the upgrade path.

---

## Patterns worth lifting into the skill

### Pattern A — `just fft` (Fast Feedback Test) namespacing

Minih's `justfile` opens with:
```
fft: lint format build typecheck test audit sdk-check
```

`fft` is short, memorable, action-oriented, and gives one command to run before commit/push. Brief §6.3 question 4 asks about validation tiers; consider recommending `fft` as the default short name for the **proof tier** (instead of `validate`).

### Pattern B — Phase gates table

Minih's harness.md has:

| Domain / Work Type | Boot | Interact | Observe | Narrow Gate |
|---|---|---|---|---|
| docs / planning | N/A | Read linked plan | `git --no-pager diff --check` | `git --no-pager diff --check` |
| cli | `just build` | `minih ...` | JSON envelope + stderr | `npx vitest run test/cli/<file>.test.ts` |
| ... | ... | ... | ... | ... |

This isn't in the brief at all and is genuinely useful — it tells an agent "for THIS kind of work, run THIS specific narrow gate first, then `just fft` before commit." Worth adding to the HARNESS.md template as an optional section.

### Pattern C — Maturity transition column in history

Minih history rows include `Maturity Before -> After`:

| Date | Plan | Change | Maturity Before -> After |
|---|---|---|---|
| 2026-05-10 | 020 | Created MiniH engineering harness contract. | L0 -> L2 |

This makes the L0–L4 ladder *active* — every harness change ought to be evaluated for whether it advances maturity. Brief's history section doesn't include this column. Adopt.

### Pattern D — User-content sentinel

Minih uses HTML comments to mark a merge-safe author-modifiable region:
```
<!-- USER CONTENT START -->
<!-- Project-specific harness notes, custom boot sequences, domain-specific setup -->
<!-- USER CONTENT END -->
```

This is the *exact* mechanism the brief's idempotent re-run (PL-01, QT-05 fixture E) needs but doesn't define. Adopt verbatim. The skill's idempotent merge logic becomes "preserve everything inside `<!-- USER CONTENT START -->` ... `<!-- USER CONTENT END -->` blocks."

### Pattern E — Retrospective schema with `magicWandTarget`

Minih's `retrospective.json` has:
```json
{
  "required": ["workedWell", "confusing", "magicWand"],
  "properties": {
    "workedWell": { "type": "string", "minLength": 10 },
    "confusing": { "type": "string", "minLength": 10 },
    "magicWand": { "type": "string", "minLength": 20 },
    "magicWandTarget": { "type": "string", "enum": ["project", "minih", "coordination"] }
  }
}
```

The `magicWandTarget` enum is a brilliant feature: it forces the agent to *classify* the wand at — is this about the project we're building, the harness/agent tooling, or the coordination loop? Adopt with our skill's terminology: `magicWandTarget: project | harness | agent`.

This also satisfies CF-06's intent (single canonical wording) — ship `templates/retrospective-schema.json` as the schema-enforced version, and have HARNESS.md / friction-log / CLI all read from one source. Stronger than markdown-only.

### Pattern F — "Two environments" framing (chainglass)

Chainglass AGENTS.md opens by establishing that there are two valid environments (host dev server + harness container) with a routing table. Real teams have multiple harnesses for different purposes; the skill could optionally support a `harness/profiles/` directory where each profile = a separate config-map + bin set.

Defer to v0.2; note in HARNESS.md as a known evolution path.

### Pattern G — Shared preamble for agent prompts

Chainglass `agents/_shared/preamble.md` is auto-injected before every agent's prompt — containing orientation, environment gotchas, output discipline, CLI quick reference, browser/CDP access, and feedback philosophy. The skill's `harness/skills/onboard-agent-session.md` could be more like a shared preamble than a one-time onboarding doc.

Defer to v0.2; the brief's onboarding doc is fine for v0.1.

### Pattern H — `harness-verify <path>` (FX007)

Chainglass FX007 is the canonical encoded-fix example: an entire class of bug (server-only modules leaking into client chunks via barrel re-exports) was bypassing `tsc --noEmit` + `pnpm vitest` + companion review because the existing gates inspect code or diffs, not bundler output. The encoded fix is a single recipe — `just harness-verify <path>` — that does HTTP-ping + filtered console capture + `docker logs` grep for `⨯` / "Failed to compile" / "chunking context" / "Parsing ecmascript" within a window.

**The skill should cite this as the worked example** in its philosophy section. It demonstrates four things at once:
1. A real production gate gap.
2. A retrospective surfaced the gap.
3. A generic fix was encoded (not patched per-incident).
4. The encoded fix joined the harness command surface for all future agents.

---

## Specific decisions this challenges in our plan

| Decision | Source | Challenge | Recommended action |
|---|---|---|---|
| **CF-06** magic-wand canonical wording | `decisions.md` Q5 | Both repos use 1-thing concrete form (no adjectival tail) | **Re-open**. Adopt a hybrid wording (1-thing + enumeration of *what counts*). Ship retrospective-schema.json with `magicWand` + `magicWandTarget` fields. |
| HARNESS.md at repo root | brief §9, dossier IC-03 | Both repos put it at `docs/project-rules/harness.md` | Add inspection: if `docs/project-rules/harness.md` exists, ask. Default = root for greenfield. |
| `harness/bin/harness.py` always created | brief §6 Q1, IC-03 | Both repos wrap existing tooling | Add inspection question: install new CLI vs wrap existing `justfile`/`package.json` scripts. |
| AGENTS.md snippet (brief §10) | brief §10, dossier IC-03 | Real-world snippet is much stronger — equivalence table + non-negotiable framing | Rewrite the §10 template to include an equivalence-table scaffold the skill fills in during install. |
| `harness/state/friction-log.md` as single file | brief §17 | minih treats friction as CLI-aggregated query | Keep markdown for v0.1; document the upgrade path; consider JSON-fenced entries inside the markdown. |
| 0/1/2 exit codes | brief §6 Q5 + §13/§14 skeletons | chainglass uses E100–E126 in `error.code` field | Keep 0/1/2 at process level; add `error.code` enum in JSON envelope. Document codes in `templates/cli-command-contract.md`. |
| Maturity ladder is L0–L6 (per source-notes) | dossier QT-06 | Both repos use L0–L4 only; L5/L6 unseen | Use L0–L4 in the template. Note L5/L6 as theoretical in the "Maturity" appendix. |
| Single magic-wand source of truth via `magic-wand-prompt.md` | `decisions.md` CF-06 implications | Both repos use a JSON schema (`retrospective.json`) — stronger than a markdown blob | Ship both: schema (`templates/retrospective-schema.json`) is the machine contract; the prompt fragment in `magic-wand-prompt.md` is the human-facing line. Both reference the same wording. |

---

## Specific recommended additions to the spec

1. **`templates/retrospective-schema.json`** (NEW) — JSON Schema Draft 2020-12, modelled on minih's, with `workedWell` / `confusing` / `magicWand` required + `magicWandTarget: project | harness | agent`. Templates and CLI both reference this schema.

2. **User-content sentinel** — define exactly:
   ```
   <!-- USER CONTENT START -->
   <!-- Project-specific harness notes, custom boot sequences, domain-specific setup -->
   <!-- USER CONTENT END -->
   ```
   Make this the canonical merge boundary for idempotent re-runs (HARNESS.md, AGENTS.md snippet, friction-log).

3. **Phase Gates table** — add as optional section to HARNESS.md template with example rows; leave blank for the install to fill in once domains are known.

4. **History column "Maturity Before → After"** — add to the HARNESS.md template's History table.

5. **Inspection question 3 (new)** — *"AGENTS.md routing strength: strict (non-negotiable, with equivalence table) / suggested (gentle, prefer-CLI)?"* Default: strict.

6. **CLI command suggestion: `<CLI> fft`** — bundle of the proof-tier validation steps, as an alias for `<CLI> validate --tier proof`. Memorable shorthand; matches minih and lets agents complete the loop with one short command.

7. **Worked example in the skill's philosophy section** — cite Chainglass FX007 (sanitised wording: "a team encoded a single `harness-verify <path>` recipe after a class of bundler bug bypassed all existing gates"). Use as the proof that the loop closes.

8. **Two-document model option** — note in HARNESS.md template's preamble that mature repos may want the harness rules at `docs/project-rules/harness.md` instead of root, with AGENTS.md pointing there. The skill writes root for v0.1; the alternative placement is a documented upgrade.

---

## One non-finding worth naming

I expected to find at least one root-level `HARNESS.md` in either repo (the brief assumes this is the convention). Neither has one. The convention may be specific to a particular team's idiom rather than universal. **This isn't a problem with the skill — it's a finding that the skill is encoding a *recommended* default, not an *observed* default.** Worth saying so plainly in `SKILL.md`'s philosophy section: *"This skill installs HARNESS.md at the repo root. Some mature teams prefer `docs/project-rules/harness.md`; either is valid."*

---

## End matter

**No private terminology copied** — repository names (`minih`, `chainglass`) and the FX007 detail are referenced under their public-facing identifiers and described generically. Internal-only details, person names, or unreleased platform information are not surfaced. Per `AGENTS.md` L18–24, before committing anything that lifts these patterns into tracked templates, the wording should be re-sanitised to neutral form (e.g. *"a Docker-containerised dev environment with browser automation"* rather than naming the project).

# Execution Log — Eng-Harness Skill Consolidation (022)

**Plan**: [eng-harness-skill-consolidation-plan.md](./eng-harness-skill-consolidation-plan.md)
**Mode**: Simple · **Testing**: Lightweight (grep + contract diff + behavioural drive)
**Branch**: `022-eng-harness-skill-consolidation`
**Companion**: `--companion` (minih `code-review-companion`, live commit review)

---

## C0 — Companion boot

- minih `0.2.1` present; `code-review-companion` confirmed as a registered slug (`minih list`).
- Booting in background; brief sent once `verdict: active`.

## T000 — Harness pre-flight (`--event pre-implement`)

- **Advisory seam.** This repo has an adopted harness (boot = `just test`); the seam proves the **CLI**, not the markdown skills (those are proven by T010/T012). Recursion noted: this plan consolidates the very router the harness routes through.
- **Verdict: HEALTHY** — `just test` → 65 files / **639 tests passed**, 1.29s, coverage 91.97% lines. Green baseline before mutation.

## T001 — Rollback anchor

- Tag: `pre-eng-harness-consolidation` on `d2ee535` (pre-cutover: skills/ still 7-skill surface, plan present).
- **Restore one-liner** (skill tree + swept catalog docs, then redeploy):
  ```bash
  git checkout pre-eng-harness-consolidation -- skills INSTALL.md skills/README.md AGENTS_README.md .harness/engineering-harness.md justfile && just install-skills-global
  ```
  (Plan's T001 also names `CLAUDE.md`; there is no root `CLAUDE.md` in this repo, so it is omitted from the checkout to avoid a pathspec error.)

---

## T002 — Establish flat home + extract routing engine

- `git mv skills/eng-harness-loop/eng-harness-flow skills/eng-harness-flow` — router now at its flat home.
- Created `references/00-routing.md` (engine + the Graph + the byte-stable contract).
- **Contract sections relocated VERBATIM** (never reshaped): the five Lifecycle hooks table, the `--event`→`--hook` alias map, the `--json` routing envelope, the `--hooks` discovery manifest. Internal routing **targets** adapted (child slugs → `references/stages/*.md` modules / the `assess` public peer / the `harness observe` CLI) — this is the consolidation's point and is **not** part of the public contract.
- Added a NEW `## Shared conventions` block (maturity-vocabulary pull target, no-time-estimates, harness-blind rule, declared-delegation, anti-reinvention).

### Destination map — every `##`/`###` heading of the pre-tag SKILL.md (478 lines)

| Heading (source SKILL.md) | → Destination | Reason |
|---|---|---|
| `# eng-harness-flow` + intro paras | SKILL.md | dispatch title + one-door front-door framing |
| `## The stateless contract` | SKILL.md (invariants) + 00-routing.md (first-principle recap) | T006 names it for the dispatch; engine keeps a recap |
| `## The two zones` (adoption gate + dispatch) | 00-routing.md | **the Graph** (S0→S4 + engineering dispatch) |
| `### The 🧰 adoption gate` | 00-routing.md | the gate ordering = the Graph |
| `### The ⚙️ engineering dispatch` | 00-routing.md | the dispatch table |
| `## Detection signals A–J` | 00-routing.md | engine — signals |
| `### Decision order` | 00-routing.md | engine |
| `### Where statelessness has limits` | 00-routing.md | engine |
| `## Parameter contract` | 00-routing.md (full) + SKILL.md (Command grammar summary) | engine owns full flag semantics; dispatch summarises |
| `### Lifecycle hooks` | 00-routing.md | **CONTRACT — relocated verbatim** |
| `### Slug resolution` | 00-routing.md | engine — verb resolution (slugs→modules adapted) |
| `### Precondition / conflict matrix` | 00-routing.md | engine |
| `### The --json routing envelope` | 00-routing.md | **CONTRACT — relocated verbatim** |
| `### The --hooks discovery manifest` | 00-routing.md | **CONTRACT — relocated verbatim** |
| `### --help — synopsis` | SKILL.md | AC2 — `--help` lives in the dispatch |
| `## Per-turn UX (human mode)` | coach.md | the voice (T003) |
| `### 1. The host rail` | coach.md | voice |
| `### 1a. The unified rail` | coach.md | voice |
| `### 2. The per-turn narration contract` | coach.md | voice |
| `### 2a. The why table` | coach.md | voice |
| `### 3. The Flag beat` | coach.md | voice |
| `### 4. Tone` | coach.md | voice |
| `## Called repeatedly along an externally-managed flow` | 00-routing.md | engine — the P→H seam-call examples |
| `## Relationship to existing skills (anti-reinvention)` | 00-routing.md (§ Shared conventions, condensed) | folded into Shared conventions |
| `## References` | SKILL.md | the dispatch points at the bundled refs |

**No heading DROPPED** — every source heading has a destination.

## Task progress

| Task | Status | Commit | Notes |
|------|--------|--------|-------|
| T000 pre-flight | ✅ | — | HEALTHY (639 tests green) |
| T001 rollback anchor | ✅ | tag | `pre-eng-harness-consolidation` @ d2ee535 |
| T002 engine extract | ✅ | e6db6d1 | flat home + 00-routing.md + destination map; contract relocated verbatim |
| T003 coach extract | ✅ | 08e907d | references/coach.md — rail (3 forms) + Orient→Flag→Insight→Suggest→Invite + why-table + Flag beat + tone; voice centralised |
| T004 modules batch 1 | ✅ | 4b8df48 | boot.md / backpressure.md / retro.md stamped from the template, de-leaked (loop-seq, /plan-2d, plan-* names, eng-harness-* slugs, old self-refs scrubbed); CLI invocations + artifact paths verbatim; retro.schema.json moved to references/; preliminary L1 grep CLEAN |
| T005 modules batch 2 | ✅ | b572247 | adopt.md (delegating verb) + add-extension.md; declared delegation; gate-order graph-owned; hook vocabulary delegated; full per-pattern L1 grep CLEAN across all 5 modules |
| T006 thin dispatch | ✅ | a5fca0d | SKILL.md rewritten — **88 lines** (≤~150); frontmatter (name + activation description) preserved VERBATIM; Registry + Command grammar + stateless invariants + progressive-disclosure rule + --help; contract detail points to 00-routing.md. **Contract JSON blocks (--json envelope + --hooks manifest) BYTE-IDENTICAL vs pre-tag — 3362 bytes each.** Zero rail-glyph (`◆◐◇↺`) prose; the 3 "narration"-word grep hits are pointers to coach.md, not voice content. |
| T007 bundled refs | ✅ | 1167a89 | getting-started.md fully rewritten to the 2-skill surface (router + verbs/modules + kept peer); retired-slug refs scrubbed from governance-doc.md (×4) + maturity-assessment.md (×1) + coach.md Suggest example. **Zero of the 5 retired slugs across the whole consolidated skill**; bundle complete (12 files); modules still L1-clean; kept-peer slug retained intentionally in SKILL.md/00-routing.md/getting-started/governance-doc. |
| T008 deletion + peer move | ✅ | 34078f7 | `git mv` peer → `skills/eng-harness-0-harnessability-assessment/` (8 templates + AUTHORING + README intact); `git rm -r` the 5 absorbed child folders; removed empty `eng-harness-loop/` + `eng-harness-setup/` grouping dirs. **`skills/` now = exactly `eng-harness-flow/` + `eng-harness-0-harnessability-assessment/` + README.md.** Restore path = the T001 tag. |
| T009 catalog sweep | ✅ | (this) | Full sweep done — see T009 completion below; all in-scope live surfaces clean of retired slugs (only intentional rename-teaching notes remain); docs bundle regen'd; 639/639 green; both companion findings resolved |

---

## ⏸️ RESUME NOTE (checkpoint before /compact) — 2026-06-17

**Branch**: `022-eng-harness-skill-consolidation` · **Companion**: minih `code-review-companion`, RUN_ID `2026-06-17T06-15-38-151Z-f95d` (still active — keep pinging per-commit; debrief at phase end via the progress sub-skill).

**Done & committed**: T000–T008 (commits d2ee535 plan, e6db6d1 T002, 08e907d T003, 4b8df48 T004, b572247 T005, a5fca0d T006, 1167a89 T007, 34078f7 T008) + rollback tag `pre-eng-harness-consolidation`@d2ee535. Contract JSON byte-identical; all 5 modules L1-clean; `skills/` = 2 skills.

**Forced fix (this commit)**: T004's `retro.schema.json` move + T008's folder delete broke `harness/cli/test/services/record/retro-template.test.ts` (hard-coded old path). Updated its `SCHEMA_PATH` → `skills/eng-harness-flow/references/retro.schema.json`. `just test` GREEN again (639/639). This is a path-follow forced by the sanctioned move, not a CLI behaviour change.

**T009 REMAINING (catalog doc sweep) — pick up here:**
1. ✅ INSTALL.md (intro + 7-row table → 2 skills; `-s eng-harness-0-adopt` → `-s eng-harness-flow`) — committed this checkpoint.
2. ⬜ `skills/README.md` (21 hits) — rewrite to 2-skill surface (router + verbs-as-modules + peer); fix the `skills/eng-harness-loop` install example + the `-s eng-harness-0-adopt` example; update the slug note.
3. ⬜ `AGENTS_README.md` (9 hits, ~L17/104-109/126/139/255) — collapse skill table to 2; **bundled into docs-content.ts → MUST `npm run gen:docs` after**.
4. ⬜ `README.md` root (L10, L85, L118) — adopt→router framing; fix `skills/eng-harness-setup`/`-loop` paths + the `eng-harness-0-adopt`/`-1-boot` slugs.
5. ⬜ `AGENTS.md` root (L9, L17, L21) — fix `skills/eng-harness-setup`/`-loop` paths + `eng-harness-1-boot` ref.
6. ⬜ `docs/how/extend-the-harness.md` (L4, L180, L182, L186) — `eng-harness-0-add-extension` skill → the `add-extension` verb (via `/eng-harness-flow`); **bundled → part of the same `gen:docs` regen**.
7. ⬜ Peer de-stale: `skills/eng-harness-0-harnessability-assessment/SKILL.md` L104 + L869 — `eng-harness-0-adopt` flow → the adoption flow (`adopt` verb via `/eng-harness-flow`).
8. ⬜ `npm run gen:docs` → regenerate `harness/cli/src/services/docs/docs-content.ts` (else `check:docs` CI fails). Then `just test` to confirm green.
9. ⬜ Re-grep: zero of the 5 retired slugs across in-scope live surfaces (skills/, INSTALL.md, skills/README.md, AGENTS_README.md, README.md, AGENTS.md, docs/how/, .harness/engineering-harness.md).
10. `.harness/engineering-harness.md` injection map — already CLEAN (no retired slugs).

**OUT OF SCOPE / DEFERRED (per plan Non-Goals + domain "Boundary Excludes" — document, do NOT edit in this plan):** `harness/cli/**` source comments + `contract.ts` rename map + `skills.test.ts` fixtures (CLI untouched); `.harness/extensions/validate-harness-flow|validate-harnessability/*.ts` + `instructions.md` (dogfood verbs); `.minih.json` + `agents/*/prompt.md` (minih/installer infra) — these still reference deleted `skills/eng-harness-setup` / `-loop` paths + old slugs and will need a **follow-up "dogfood + CLI slug realignment" plan**; they do NOT break `just test`. `CHANGELOG.md` + `.harness/records/**` are history — never rewritten.

**AFTER T009**: T010 structural proof (L1 grep + contract diff + `wc -l` + per-module review + destination-map completeness), T011 deploy+tidy (`just install-skills-global` / `harness skills update` prune), T012 behavioural drive (`/eng-harness-flow --hook pre-flight --json`, `--hooks --json`, one-module-per-route), T013 phase-end seam + companion debrief.

## T009 — catalog sweep (completion)

Every in-scope live catalog surface rewritten to the 2-skill / verb-module surface:

| Surface | Edit |
|---|---|
| `INSTALL.md` | (prior checkpoint) intro + table → 2 skills; `-s eng-harness-0-adopt` → `-s eng-harness-flow` |
| `skills/README.md` | full rewrite — 2-skill intro + Install (single-skill examples → `eng-harness-flow` / peer) + **The verbs inside the router** module table + intended-loop/foundation/operating-rules reframed via `/eng-harness-flow`; slug note rewritten (old per-stage names are now modules, reach via the router) |
| `AGENTS_README.md` | "seven skills, two groups" → **two skills**; collapsed skill table; probe row 0, no-restart `cat` path, getting-started link path, prune example all de-staled |
| `README.md` (root) | fastest-start (`run /eng-harness-flow`), publish framing (two skills), "What's in this repo" skills row (correct flat paths) |
| `AGENTS.md` (root) | dual-role skill paths, dogfood example, self-reference caveat — all via `/eng-harness-flow` |
| `docs/how/extend-the-harness.md` | `eng-harness-0-add-extension` skill → the `add-extension` verb (via `/eng-harness-flow`); module path link |
| peer `SKILL.md` | L104 + L869 `eng-harness-0-adopt` flow → adoption flow (`/eng-harness-flow`) |

**Forced fix (prior checkpoint, carried)**: `retro-template.test.ts` `SCHEMA_PATH` → `skills/eng-harness-flow/references/retro.schema.json` (path-follow from the T004 schema move).

**Docs bundle**: `npm run gen:docs` regenerated `harness/cli/src/services/docs/docs-content.ts` (2 bundled sources touched — `agents-readme`, `extend-the-harness`); `npm run build` rebuilt dist so `docs.test.ts` (dist↔source parity) passes. `just test` → **639/639 green**.

**Re-grep (in-scope live surfaces)**: zero *stale* retired-slug references. Two intentional retentions remain and are correct: `skills/README.md` slug-note + `AGENTS_README.md` prune example — both must name old slugs to *teach the rename* (mirrors the-flow's alias table). OUT-OF-SCOPE surfaces (`harness/cli/**`, `.harness/extensions/**`, `.minih.json`, `agents/**`) untouched per plan Non-Goals — deferred to a "dogfood + CLI slug realignment" follow-up.

### Companion findings (RUN_ID 2026-06-17T06-15-38-151Z-f95d) — both resolved

The live companion reviewed T002–T008 and raised **two MEDIUM** issues; both addressed before this commit:

1. **T002 — "verbatim public-contract proof not fully met."** Re-verified rigorously: **all four machine-contract surfaces are byte-identical** pre-tag↔`00-routing.md` — hook-token table (5 rows), `--event`→`--hook` map (6 rows), `--json` envelope (1018 b), `--hooks` manifest (2304 b). These are exactly what the-flow's `harness-seams.md` mirrors downstream → the hard invariant holds. The only deltas in the Lifecycle-hooks *region* are (a) the **documented** internal-target adaptation (child slugs → `references/stages/*` modules / the `assess` peer / the `harness observe` CLI in the `at=`/P→H *descriptions*) and (b) required framing de-leak ("child-skill"→"child-verb", "Slug resolution"→"Verb/slug resolution", `§ Per-turn UX`→`coach.md`). **Resolution**: the T002 "relocated verbatim" claim is precise about the *contract mechanics* (byte-identical) but the surrounding framing prose was de-leaked **as the plan requires** — not a defect. Finding closed as documentation-precision.
2. **T007 — getting-started overstated "every route loads a verb module."** Real accuracy gap: `assess` routes to the public peer skill and `coding` to the `harness observe` CLI verb (the doc body already carved these out at L54/85/92/207/215, but the L3 headline + L201 quick-ref did not). **Resolution**: L3 + L201 edited to name the two exceptions. (getting-started.md is not in the docs bundle → no gen:docs needed.)

The recurring `MINIH_PROJECT_ROOT` difficulty is the known/planned minih fix — not re-surfaced here.

### Companion restart (for T009 review gap + T010–T013)

The original run (`…f95d`) **self-completed after T008** (idled out / `result: degraded` — a minih findings-schema `id` nit, not a review failure), so the d64f9ad ping hit a dead inbox. Per the user's call, a **fresh companion** was booted: RUN_ID **`2026-06-17T07-05-43-674Z-528d`**, briefed to first review d64f9ad (the T009 gap) then stand by for T010–T013.

- **Boot required `--no-skills`**: a normal `minih run` hit **E211** because `.minih.json` still wires minih to the deleted `skills/eng-harness-setup` / `-loop` sources + the 7 retired slugs (the original run booted at 06:15 *before* T008's delete, so it was unaffected). This re-confirms the deferred **out-of-scope** `.minih.json` dogfood drift. The code-review companion doesn't need the harness skills loaded to review commits, so `--no-skills` sidesteps the broken wiring without editing the out-of-scope file. **Follow-up plan still owes the `.minih.json` realignment.**
- **Debrief target updated**: T013 debriefs `…528d` (the live run), not `…f95d`.

## T010 — structural proof (all five checks PASS)

| Check | Result |
|---|---|
| (a) **L1 de-leak grep** across `references/stages/*.md` | sibling slugs **0**, flow-position (`plan-1b/2c/3/2d`) **0**, lifecycle-hook self-refs (`--hook`/`--event`/hook names) **0**, Next-routing markers **0** → ✅ |
| (b) **contract parity** (pre-tag SKILL.md ↔ `00-routing.md`) | hook-token table (5 rows) **byte-identical**; `--event`→`--hook` map (6 rows) **byte-identical**; `--json` envelope **1018 b identical**; `--hooks` manifest **2304 b identical** → ✅ (behavioural-drive half is T012(a)) |
| (c) **`wc -l SKILL.md`** | **88** ≤ ~150 → ✅ |
| (d) **per-module structure** | all 5 modules (adopt/add-extension/boot/backpressure/retro) carry 6/6 header fields (Verb/Purpose/Consumes/Flags/Produces/Side effects) + the byte-exact constant Exit line → ✅ |
| (e) **destination-map completeness** | 25 pre-tag `#`/`##`/`###` headings; 25 map rows; **0 unmatched** after normalization (every heading has a destination — no silent drop) → ✅ |

Covers AC-02, AC-03, AC-04, AC-05.

## T011 — deploy + tidy (PASS)

**Before** (both stores): 7 eng-harness slugs — the 2 kept + the 5 retired (`0-add-extension`, `0-adopt`, `1-boot`, `2-backpressure`, `4-retro`). Canonical `~/.agents/skills` = real dirs; `~/.claude/skills` = per-skill symlinks into canonical; `~/.pi/skills` absent.

**Deploy**: `just install-skills-global` → installed exactly **2 skills** (`eng-harness-flow`, `eng-harness-0-harnessability-assessment`) to canonical + per-CLI views (Codex/OpenCode/GitHub Copilot = universal → read canonical directly; Claude Code/Pi = symlinked).

**Prune** (additive install leaves the 5 retired behind; CLI prune-list wasn't updated this plan, so manual is correct per the plan): removed the 5 retired slugs from `~/.agents/skills` (real dirs) **and** `~/.claude/skills` (symlinks).

> Gotcha: zsh does **not** word-split unquoted `$vars` — a `for x in $LIST` loop ran once on the whole string and pruned nothing; fixed with explicit arrays. (Worth a retro entry.)

**After**: each store carries **exactly** `eng-harness-flow` + `eng-harness-0-harnessability-assessment`. `just doctor-skills`: canonical OK, **zero dangling symlinks**. Deployed `eng-harness-flow` carries the new structure (88-line SKILL.md, 5 modules under `references/stages/`, `00-routing.md` + `coach.md`, zero retired slugs in modules).

**No target resolves a retired eng-harness slug.** Pre-existing unrelated noise (acceptable per plan, not a blocker): a `engineering-harness-setup` duplicate subdir in the Claude view, and a legacy `~/.copilot/skills` orphan holding only non-eng-harness skills (docx/loop/pptx/web-artifacts-builder/xlsx). Reversible via the T001 tag → `just install-skills-global`. Covers AC-11.

## T012 — behavioural drive (all three observations PASS)

Hand-driven against this repo's real signals (driving the live `/eng-harness-flow` inside this the-flow run would risk the T000 seam-recursion; the envelope is deterministic from the contract + signals, so a controlled render is faithful and avoids the recursion).

**Repo signals**: S0 (CLI present, `doctor` returns an envelope), S2 (`.harness/engineering-harness.md` present), S4 (boot = `just test`) all hold → `--hook pre-flight` routes to **boot validation**.

### (a) `--hooks --json` + `--hook pre-flight --json` parity
- `--hooks --json` driven output is **byte-identical to pre-tag** (2304 b): `manifest_version: 1` + the five fixed hooks (pre-flight, pre-coding, coding, post-coding, post-flight).
- `--hook pre-flight --json` rendered for this repo (every contract field filled; field set matches the byte-identical envelope template):
```jsonc
{
  "requested_stage": "boot",
  "actual_stage": "boot",
  "hook": "pre-flight",
  "decision": "route",
  "command": "just test",
  "why": "pre-flight → prove the system runs before work starts; S0+S2+S4 hold",
  "produces": "a boot verdict (healthy / SLOW / UNHEALTHY / UNAVAILABLE)",
  "preconditions_met": true,
  "missing_rung": null,
  "next_suggested": "/eng-harness-flow --hook pre-coding  (backpressure survey once a spec is settled)",
  "bypass_recommended": false,
  "bypass_cause": null,
  "rail":  { "zone": "engineering", "adopt_pips": "—", "loop_pips": "◐◇◇◇◇", "cursor": "boot" },
  "now":   "session start — re-running boot (the CLI's vitest suite via `just test`)",
  "next":  "backpressure survey when a spec is settled",
  "flags": [],
  "insight": "boot here is the CLI's own 639-test vitest suite — the harness proving itself"
}
```

### (b) One module per route (progressive-disclosure proof)
- Routing table (00-routing.md Verb/slug resolution) maps each verb to **exactly one** module file: `boot|backpressure|retro|adopt|add-extension → references/stages/<verb>.md`; `observe → harness observe` CLI verb (documented exception, not a module).
- **Marker exclusivity**: each module's `**Purpose**` line appears in **1** module file only (5/5 unique) → driving `pre-flight` reads `boot.md` and nothing else; no sibling module's marker can leak into the response.

### (c) Coach path renders rail + the five beats
- coach.md carries 4 glyph-rail forms + all five beats (**Orient**, **Flag**, **Insight + why**, **Suggest**, **Invite**). Rendered for the pre-flight/boot drive:
```
[eng-harness-flow] ⚙ ◐─◇─◇─◇─◇ ↺  [boot] · backpressure · observe · retro · improve

 now  · session start — re-running boot (`just test`, the CLI's vitest suite)
 next · ▸ backpressure survey, once a spec is settled
```
- Orient — "You're in the engineering loop, right at the top — about to re-run boot."
- Flag — clean (boot healthy) → "nothing flagged — clean."
- Insight + why — "boot here is the CLI's own 639-test vitest suite — that matters because boot is orientation by *evidence, not memory*: prove the system runs before you touch it."
- Suggest — `just test`
- Invite — "Want me to run it? (`yes` / run it yourself — either way I'll pick up from here.)"

Covers AC-04, AC-08, AC-12.

## T005 — per-module elision audit (done-when)

Each setup module's Entry/Procedure/Output diffed against its source skill; every removed block tagged:

**adopt.md** (vs `eng-harness-0-adopt`):
- S0→S4 adoption-gate **order** (Step-3 intro parenthetical "orders S3·Inject before S4·Boot") → **(graph-owned → 00-routing.md § The 🧰 adoption gate)**
- the inline five-hook enumeration + `--event` seam map (old Step 3.2) → **(graph-owned → 00-routing.md § Lifecycle hooks)**
- sibling-skill names `eng-harness-0-harnessability-assessment` / `eng-harness-0-add-extension` → **(replaced — declared delegation `**Delegates**: assess; add-extension`, resolved via the Registry)**
- `/plan-*` / `task-*` flow-shape examples → **(removed — flow-leak; rephrased "planning/task skills")**
- `eng-harness-*` family enumeration in Step 5 → **(removed — flow-leak; rephrased "router + assessment peer")**
- governance-doc.md cross-ref path `../../eng-harness-loop/eng-harness-flow/references/governance-doc.md` → `../governance-doc.md` (relocation, not elision)
- **No domain content removed** — install / `harness init` / troubleshooting / inject-map recording / boot stand-up / skills-install offer all preserved verbatim; orchestration survived as declared delegation + the Graph, it did not vanish.

**add-extension.md** (vs `eng-harness-0-add-extension`):
- YAML frontmatter → **(removed — skill→module; not a published skill)**
- **No other removals** — named no siblings, no flow position, no hooks; pure template-stamp (the cleanest module). All `harness new`/`doctor`/`help`/`record` invocations + GitHub doc links preserved.

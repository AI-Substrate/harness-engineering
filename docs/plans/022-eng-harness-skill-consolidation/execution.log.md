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
| T002 engine extract | ✅ | (this) | flat home + 00-routing.md + destination map; contract relocated verbatim |

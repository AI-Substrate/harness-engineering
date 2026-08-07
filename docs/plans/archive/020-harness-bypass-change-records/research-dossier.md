# Research Dossier: harness-bypass + harness-change record types & cross-repo value measures

**Generated**: 2026-06-15T22:30Z
**Research Query**: "add harness-bypass and harness-change record types + bypass-rate/change-rate measures, and find their home in the eng-harness flow seams"
**Mode**: Pre-Plan (feeds the spec)
**Location**: docs/plans/020-harness-bypass-change-records/research-dossier.md
**FlowSpace**: Not available (MCP disconnected this session — standard-tools mode)
**Subagents**: 6 parallel lenses (record archaeology · observe/retro contract · flow seams · conventions · prior learnings · metrics/DORA)

---

## Executive Summary

### What we're building
Two new **committed record types** — `harness-bypass` (a coding agent *couldn't or wouldn't* use the harness for a piece of work; must be recorded) and `harness-change` (a piece of work that *improved* the harness) — written via the existing `harness record` CLI to `.harness/records/<type>/<date>/<NNN>-<slug>.md`. They are **prompted at the right seams** in the harness loop, and **coupled with retro** so that, downstream, a cross-repo scanner can derive **harness bypass rate** and **harness change rate** to correlate with DORA-style delivery outcomes.

### Why it exists
The harness's thesis is "make the deterministic layer first-class, discoverable, improvable." Today the loop can *notice* friction (`harness observe` → retro) but has **no durable, scannable signal for two pivotal events**: when the paved path was abandoned (bypass) and when the paved path was improved (change). Without those, there is no way to answer the CTO question — *is the harness creating value, and does that value show up in delivery metrics?*

### Key insights (the three that shape the spec)
1. **The numerator is nearly free; the denominator and the cross-repo scanner are the hard parts.** Adding the two record types is "a template + four fields, zero `record`-command change" (RA-10, PL-01). But a *rate* needs a denominator (PRs? plans? sessions?), and **no cross-repo scanner or metrics tooling exists yet** (MET-01, MET-04). → Scope this plan carefully (see § Scope proposal).
2. **A real modeling fork exists: new record TYPES vs new retro KINDS.** The user said "record types," and prior art agrees — the universal **retro schema is frozen at v1.0 with "no new kinds" as canon** (PL-07; 015 D-9). One lens argued for new retro kinds (OR-03); the weight of evidence + the ask favor **separate record types that *reference* retros**. This is a workshop-worthy decision (see 🚨 Decision-1).
3. **The doctrine is already written down.** `harness-foundations/source-notes/notes3.md` already ranks "#9 Harness bypass rate," "#11 encoded-mitigation rate," "DORA downstream impact," and the anti-Goodhart / team-level-only governance guardrails (MET-06). This work should *execute* that doctrine, not reinvent it.

### Quick stats
- **Record subsystem**: 5 source files (`acts/record.ts`, `services/record/{record-service,registry,contract}.ts`, `core-types/retro.ts`) — append-only extension point at `registry.ts:40`.
- **Modeling**: schema-agnostic — "the template IS the schema" (4-field `HarnessRecordType`).
- **Seams found**: 9 firing points mapped; strongest bypass home = pre-implement override-log; strongest change home = add-extension proof beat.
- **Prior art**: plans 012 (built `harness record`), 015 (merged observe+retro), 014 (extension enhancements).
- **New scope for the repo**: bypass/change *capture* (buildable now) vs cross-repo *rate scanner* + DORA correlation (no prior art, likely a follow-on).

---

## How the record subsystem works today

### The record-type contract (the extension point)
`harness/cli/src/services/record/contract.ts:18-37` — a record type is exactly **4 fields**:
```ts
export interface HarnessRecordType {
  kind: 'record';            // discriminator (vs verb exports)
  type: string;              // the <type> arg + .harness/records/<type>/ dir; ^[a-z][a-z0-9-]*$
  description: string;       // shown by `record --list` and doctor
  template: string;          // the file body the agent fills — "the schema lives HERE as frontmatter + comments"; the CLI never parses it
}
```
The CLI is **schema-agnostic**: it scaffolds the template verbatim and returns the path; the record's meaning is entirely in the template (RA-01, PL-01).

### How a core type is defined & registered
- `core-types/retro.ts` is the one existing core type: an **I/O-free module** exporting `RETRO_TEMPLATE` (a frontmatter+markdown string) and `retroRecordType: HarnessRecordType` (RA-02).
- `services/record/registry.ts:40` — `export const coreRecordTypes: HarnessRecordType[] = [retroRecordType];` — **this is the array you append to** (RA-03).
- `buildRecordRegistry()` (registry.ts:76-113) merges `coreRecordTypes` ∪ extension-provided types; **core always wins**, conflicts are recorded (non-fatal) and surfaced by `doctor` (RA-04, PL-04).
- Wired in `src/app.ts` (`buildProgram` builds `recordRegistry`, registers `registerRecordAct`) (RA-06).

### Placement & write
`record-service.ts:13-19, 60-154` — records land at:
```
.harness/records/<type>/<YYYY-MM-DD>/<NNN>[-<slug>].md
```
UTC date dir (injected Clock), per-day per-type 1-based ordinal `<NNN>` (max 999, never clobbers), optional slugified suffix. No `.harness/` → `unconfigured` (exit 2). All I/O via injected `fs/clock/proc` ports (RA-05, RA-07, MET-05). **Note the stale-prose trap**: old retro docs said a *flat* `<date>-<slug>.md`; the dated-subdir layout is current truth (PL-05).

### Extensions can also provide record types
The loader routes exports by `kind` (`kind:'record'` → record registry; absent/`'verb'` → command surface), with shape validation and conflict handling (RA-08, PL-03). So bypass/change could pilot as extensions before promoting to core — but as first-class loop concepts they belong in **core** (every consumer repo gets them, uniform cross-repo contract) (MET-05).

---

## The retro / observe coupling ("couple with the retro form")

- **`harness observe "<what>" --kind <kind>`** appends to a **gitignored** session buffer at `.harness/temp/<bucket>/session-buffer.md` (OR-02). It's scratch, not memory.
- **`harness record retro`** materializes a **committed** retro at `.harness/records/retro/<date>/<NNN>-<slug>.md` (OR-02).
- **Retro schema** (`skills/eng-harness-loop/eng-harness-4-retro/references/retro.schema.json`) is **frozen v1.0**. Entry `kind` enum is closed: `difficulty | magic-wand | gift | insight | coordination | improvement-suggestion | confusion` (OR-01, OR-03). Buffer prefixes in `observe/buffer-codec.ts:12-20`.
- **`target`** is a free-form string; `target: harness-itself` already denotes "friction with the harness product" and routes upstream (issue on AI-Substrate/harness-engineering) at drain (OR-04).
- **`system` namespace** is open (`additionalProperties`), and `system.compound.{status,source,first_seen_at}` (`status: open|suggested|encoded|wontfix|stale|dismissed`) is a *convention*, not a schema field — the sanctioned extension point. Entry `references[]` (`<retro_id>:<entry_id>`) is the existing cross-record pointer (OR-01, PL-08).
- **`--harvest`** scans `.harness/records/retro/**` (+ legacy paths), dedups by `retro_id`, clusters by `(kind,target)`, ages, prints top-10, emits `--json`. **Read-only, no thresholds, counts are numerators only — no denominator anywhere** (OR-05, MET-02, MET-03).

**Coupling implication**: a `harness-change` record is the natural materialization of a retro entry reaching `system.compound.status: encoded` (the `[e]ncode` beat → `history.md` row). A `harness-change.resolves` ref pointing at the bypass/retro it closes is what turns *change rate* into a **loop-closure ratio** (OR-09/PL-09, MET Part 3).

---

## The seam map — where to prompt the two records

Nine firing points were mapped (SEAM-01…09). The strongest homes:

| Record | Recommended home | Why |
|---|---|---|
| **harness-bypass** (primary) | **pre-implement seam** — the-flow `60-implement.md:119-122`, the existing *"log the override reason to EXEC_LOG"* line | This seam **already** has the decision branches: `UNHEALTHY → Continue without harness`, `UNAVAILABLE → standard testing applies`, router-not-installed → proceed. It is the one place "could not / would not use the harness" is already a named, logged decision. Upgrade the free-text log → `harness record harness-bypass` (SEAM-03). |
| **harness-bypass** (backstop) | **retro `--drain` Step 2** (`eng-harness-4-retro` SKILL) | Drain fires at every phase/session end and reads all pending state — the natural *"must be recorded"* enforcement point for bypasses that slipped past pre-implement (SEAM-04). Lives **in-repo**, so it works even when the host isn't the-flow. |
| **harness-change** (primary) | **`eng-harness-0-add-extension` Step 3 proof beat** (SKILL:84-96) | The canonical "encoding move" — after `harness doctor` shows the new verb `loaded` + invoke proof. Self-described as *the* improvement event; today it stops at "Report to the user" with no record (SEAM-08). Trigger on *verification pass*, not bare `harness new`. |
| **harness-change** (secondary) | retro `[e]ncode` / harvest `[r]esolved` when status reaches `encoded` | The retro→encode lifecycle already exists; emit the record when a change actually lands (not at `suggested`) (SEAM-04/05, PL-09). |

🚨 **Critical tension (Decision-2 below): "bypass MUST be recorded" vs the router is stateless & never blocks.** Resolution (SEAM §4, Option A): **the CLI owns the durable write; the consuming flow owns the prompt; the router only *flags*** `bypass_recommended`/`bypass_cause` in its `--json` envelope (a pure function of current signals — stays stateless). The "must" is enforced by deterministic flow prose + an on-disk record, exactly as the loop already makes "must observe friction" reliable without router memory.

💡 **Gap worth claiming**: `.harness/history.md` (the "one row per encoded improvement" changelog) **has no deterministic writer today** — full CLI grep found no `appendHistory` / `harness record history` (SEAM-09, PL-11). The `harness-change` record can *be* (or feed) that row, closing the gap at `governance-doc.md:64`.

---

## The measurement layer (the destination — mostly new scope)

- **Nothing measures harness value today**; the closest is harvest's qualitative "recurrence = re-paid inference cost" framing and `history.md`'s encoded-change cadence (MET-02, PL-11).
- **A rate needs a denominator** — the central design question (MET Part 2). Recommended stance: **two denominators**:
  - **Primary (cross-repo, DORA-joinable): PRs** (and deployments where available). `bypass_rate = bypass_records / PRs_in_window`.
  - **Secondary (experiential, repo-native today): plans → sessions** once a session/boot ledger exists (`plan_id` already exists everywhere).
  - **Avoid commits as headline** — an activity anti-metric (notes3:255).
- **Change-rate should be a ratio, not a volume**: the **encoded-mitigation ratio** = `harness-change records that resolve a prior bypass/friction / total friction` — self-normalizing, resistant to vanity inflation (MET Part 2). Requires a `resolves` ref field.
- **Cross-repo scanner**: a *new* read-only tool over committed markdown frontmatter; the `.harness/records/**` path convention is the only contract it needs. **Required join-key frontmatter** for both new templates: `schema_version`, `record_kind`, `repo`, `agent`, `created_at` (ISO-UTC), `commit`/`branch` (the DORA join), `plan_id`. Bypass-specific: `cause` (enum), `attempted` (bool), `command`, `severity`. Change-specific: `resolves` (ref), `change_type` (enum), `target`. Emit `linkage_coverage` on every rollup (MET Part 3).
- **DORA mapping is a correlation study, NOT a 5th DORA metric** (MET Part 4): bypass↓/change↑ are *leading* harness signals; DORA's 4 keys are the *lagging* scoreboard. Design = per-repo before/after on `harness_adopted_at` with a non-adopting control cohort; claim correlation + mechanism, never causation. Strongest hypothesized pairing: bypass `cause: no-coverage` → change failure rate.
- 🚨 **Goodhart trap unique to bypass-rate**: the numerator is a *voluntary, committed, self-reported* record — the cheapest way to lower the rate is to **stop recording**. Mitigations: frame bypass records as **gifts that get the friction fixed** (never a compliance black mark); cross-check against an independent signal (product-code commits with zero harness invocation); **team/repo-level only, never individual-developer** (MET Part 4, PL-10, notes3:53).

---

## Architecture & conventions the implementer inherits (the checklist)

From CV-01…09:
1. **Pure template module** — new core types are I/O-free (`type`-only import of the contract; **no `node:fs`/`node:child_process`/clock**). Constitution **P2**: services depend only on injected ports. Precedent: `core-types/retro.ts`, `init/governance-template.ts`.
2. **Hexagonal layering** — act (envelope+exit mapping) / service (pure, ports) / adapter (the only I/O). New logic for any scanner verb is a *service* over `FsPort`.
3. **Envelope + error codes inherited free** — `ok`(0)/`degraded`(0)/`unconfigured`(2)/`error`(1); reuse `E180` (unknown type)/`E181` (write failed)/`E108` (bad slug); add a new E-code only for a genuinely novel failure.
4. **Docs gate** — if AGENTS_README or the curated docs change, run `npm run gen:docs` (repo ROOT) and pass `npm run check:docs` (CI step "Docs drift guard"). `docs-content.ts` is `@generated`, never hand-edited.
5. **Test conventions** — vitest, `Test Doc:` header, `FakeFs/FakeClock/FakeProcess` (never `vi.mock` internals), the "is a pure module" purity assertion + inline-snapshot drift guard (mirror `retro-template.test.ts` / `governance-template.test.ts`). Pin template↔schema supersets with a test (PL-16).
6. **CI gates** — rename-guard, build-test (Node 22 & 24: biome, build, **check:docs**, typecheck, vitest+coverage, arch-check, skills-check), package-smoke (publish dry-run + tarball), `ci-required`.
7. **Reserved names** — `record` is already a reserved core command; new *record types* don't touch `RESERVED_NAMES` and need **no new verb** (PL-06).

---

## 🚨 Critical discoveries & decisions to make (carry into spec/workshop)

- **Decision-1 — Modeling: separate record types vs new retro kinds.** Evidence favors **separate record types** (the ask says so; retro schema is frozen v1.0 / "no new kinds" canon — PL-07, 015 D-9; clearer semantics; independent templates). One lens (OR-03) argued new retro *kinds* are cheaper to aggregate. **Recommend: separate core record types that *reference* retros via `references[]`/`resolves`.** Worth a quick workshop to ratify.
- **Decision-2 — "Must be recorded" vs stateless/never-block router.** Resolve via Option A: CLI writes, flow prompts, router only flags `bypass_recommended` (stateless). Ratify ownership split.
- **Decision-3 — Scope boundary for THIS plan.** Records + capture seams are buildable now; the cross-repo *rate scanner* + DORA correlation have **zero prior art** and depend on a denominator decision and PR/deploy data sources. Recommend phasing (see below).
- **Decision-4 — Required frontmatter freeze.** Ratify the join-key field lists (incl. `cause` enum, `resolves` ref, `change_type` enum) so the future scanner contract can't drift. Consider frozen `harness-bypass.schema.json` / `harness-change.schema.json` mirroring the retro schema.
- **Decision-5 — `history.md` relationship.** Does `harness-change` *replace*, *feed*, or *coexist with* `.harness/history.md`? (It's the missing deterministic writer.)
- **Decision-6 — the-flow is user-global, not vendored** (MEMORY: "Do not vendor the-flow"). The pre-implement bypass prompt lives in user-global skills; **in-repo capture must be robust to non-the-flow hosts** → the retro `--drain` backstop must be in-repo. Coordinate edits to user-global vs in-repo skills.

---

## Prior learnings (institutional knowledge)

Compound activity: ~11 committed retros + 9 legacy retros + plans 012/014/015 scanned; ~15 surfaces load-bearing.

- **PL-01 / PL-02** — record type = 4 fields, schema-agnostic; core types are **inline TS constants** (lean, no `package.json#files` change). Mirror `core-types/retro.ts`.
- **PL-07** — retro schema **frozen v1.0**; 015 explicitly refused new kinds/statuses → new tracked concepts become **new record types**, not schema-kind changes. (Directly drives Decision-1.)
- **PL-08** — extend via the open `system.<namespace>` block + `references[]`; don't amend the frozen schema.
- **PL-10** — *signal-contamination* prior art (`001-init-ask-signal-correction.md`): a metric agents are *told to file* risks planted-echo bias; and a CLI verb (P2: no LLM) can *count* records but not *judge* them — scope the scanner to the deterministic slice.
- **PL-11 / SEAM-09** — nothing measures harness value today; `history.md` has **no writer**; recurrence-as-cost is the closest existing notion.
- **PL-12** — no cross-repo tooling, no `harness init` fleet surface; the only multi-repo precedent (`validate-harness-flow --collect` → `ROLLUP.md`) is minih-worker-based.
- **PL-15** — repo culture: Full TDD with fakes; gotchas to inherit — `FakeFs.readdir` dynamic-dir fidelity (015 DL-001), biome reformats multi-line signatures (run `--write` before commit).
- **MET-06** — `harness-foundations/source-notes/notes3.md` already encodes the measurement doctrine (#9 bypass rate, #11 encoded-mitigation rate, #19 DORA-downstream, canonical joins, anti-surveillance §7) + `simple-mode.md:163` (DORA trend) + `first-principles.md:243` ("evidence not classification").

**Maturity context**: L0–L4 ladder lives in `eng-harness-flow/references/maturity-assessment.md`; this repo self-reports **L3** (loop active, one encoded change). Bypass/change rates are net-new measurement scope.

---

## Modification considerations

- ✅ **Safe**: adding the two core types (append-only at `registry.ts:40`, mirrors `retro.ts`); fully fake-testable.
- ⚠️ **Caution**: the **frontmatter contract** — once consumer repos start writing records, changing required fields breaks the future scanner; freeze the join keys up front (Decision-4). Editing **user-global** the-flow seams (Decision-6).
- 🚫 **Don't**: amend the frozen retro schema; add a `kind` to it; put bypass-judgement (justified?) inside a CLI verb (inferential — P2).
- **Extension points**: `harness record` is type-agnostic (no verb change); retro `system.<namespace>` + `references[]`; the dangling `scripts/compound-value.sh` / `just compound-value` seam (MET-04) is the intended single-repo metric emitter home.

---

## Scope proposal (for the spec to confirm)

A natural phase boundary fell out of the research:

- **In this plan (buildable on solid prior art):**
  1. Two **core record types** (`harness-bypass`, `harness-change`) with frozen join-key frontmatter + tests.
  2. **Capture seams**: pre-implement bypass prompt (flow) + retro `--drain` backstop (in-repo) + add-extension change prompt; router `bypass_recommended` envelope flag.
  3. `harness-change` → `history.md` writer relationship resolved.
- **Likely a follow-on plan (no prior art; needs denominator + PR/deploy data):**
  4. Single-repo **metric emitter** (`harness metrics` verb or `compound-value`) computing rates from records.
  5. **Cross-repo scanner** + **DORA correlation study** + dashboards + governance firewall doc.

---

## External Research Opportunities

### Research Opportunity 1: DORA-correlated adoption metrics without Goodhart
**Why needed**: "rate" design (denominator), change-rate-as-ratio, before/after correlation study design, and anti-gaming defenses have no in-repo prior art and are decision-critical for the measurement layer.
**Impact**: shapes the required frontmatter join keys *now* (so records written today are correlatable later) and the follow-on scanner plan.
**Source findings**: MET Part 2/4, PL-10.

**Ready-to-use prompt** (full text saved by the metrics lens; paste into your tool of choice):
```
/deepresearch "Designing harness-adoption rate metrics (bypass-rate, change-rate) that correlate
with DORA delivery outcomes without becoming vanity/Goodhart metrics. Numerator = voluntary committed
markdown records per repo; need a defensible cross-repo denominator (PRs vs deployments vs plans vs
sessions vs eligible-operations); change-rate as encoded-mitigation ratio vs volume; before/after
adoption study with a non-adopting control cohort (diff-in-diff, validity threats); DORA-key-by-key
hypothesis table; SPACE/DevEx multi-dimensionality; Goodhart defenses for a voluntary self-reported
numerator (under-reporting detection, paired counter-metrics, team-level-only reporting, no individual
attribution). Return a recommended denominator, change-rate definition, correlation study design, and a
Goodhart-defence checklist."
```
**Results location**: `docs/plans/020-harness-bypass-change-records/external-research/dora-adoption-metrics.md`

---

## Open questions for spec / workshop
- Q-A (denominator): ratify PRs primary + plans/sessions secondary; where do PR/deploy counts come from in a read-only git scan (GitHub API vs committed snapshot)? Is `commit`/`branch` on each record enough to join to PRs?
- Q-B (change-rate shape): confirm encoded-mitigation **ratio** + the `resolves` ref format (`<repo>:<path>` vs retro `<retro_id>:<entry_id>`).
- Q-C (scanner home): new `harness metrics` verb vs resurrect `compound-value` vs out-of-repo aggregator — recommend single-repo emitter first.
- Q-D (frontmatter freeze): ratify MUST-carry fields; frozen per-type schema files?
- Q-E (under-reporting defense): what independent cross-check is available cross-repo without per-repo CI access?
- Q-F (governance firewall): where does the team-level-only / no-individual-attribution rule live?
- Q-G (adoption event): how is `harness_adopted_at` determined (first `.harness/` commit vs declared date)?
- Q-H (windowing): 90-day rolling + small-N suppression floor?
- Q-I (auto-fire): how is the bypass-recording prompt itself protected from being bypassed?

---

## Appendix: file inventory (the seams to touch)

| File | Role |
|---|---|
| `harness/cli/src/services/record/contract.ts` | the 4-field record-type contract |
| `harness/cli/src/services/record/registry.ts:40` | `coreRecordTypes` array — append here |
| `harness/cli/src/services/record/core-types/retro.ts` | the template-module precedent to copy |
| `harness/cli/src/services/record/record-service.ts` | placement/ordinal/write (pure, ports) |
| `harness/cli/src/acts/record.ts` + `src/app.ts` | act wiring |
| `skills/eng-harness-loop/eng-harness-4-retro/{SKILL.md,references/retro.schema.json}` | retro coupling (drain backstop; schema frozen) |
| `skills/eng-harness-loop/eng-harness-flow/SKILL.md` | router envelope (`bypass_recommended` flag) |
| `skills/eng-harness-setup/eng-harness-0-add-extension/SKILL.md:84-96` | change-record prompt (proof beat) |
| `~/.agents|.claude/skills/the-flow/references/stages/60-implement.md:119-122` | bypass prompt (user-global — not vendored) |
| `.harness/engineering-harness.md` + `.harness/history.md` | governance snapshot + change ledger (no writer today) |
| `harness-foundations/source-notes/notes3.md` | the measurement doctrine to execute |
| `docs/plans/012-harness-record-command/`, `015-observe-retro-merge/` | prior art |

---

# Addendum — decided design & implementation validation (explore pass 2)

**Added**: 2026-06-16T01:54Z. The 10 decisions are now locked in [`distilled-ask.md`](./distilled-ask.md); this pass re-ran explore against the *decided* design (3 targeted lenses: provenance-stamping · history.md removal · in-repo seam edits) to turn it into a sequenced build. Pass-1 above remains the broad landscape.

## The one new architectural move: CLI-stamped provenance header (validated feasible)
The decision to stamp `harness_version` + `branch` + `repo` + `created_at` + `agent` on **every** record write changes the record service from "pure template copy" → "CLI-stamped header + agent-filled body." Validation (STAMP-01…12):
- **The ports are already there.** `RecordDeps` already holds `fs`, `clock`, `proc` and uses `proc.cwd()` + `clock.nowIso()` today (`record-service.ts:27-31, 95, 141`). Stays Constitution-P2-clean.
- **Git via the existing `GitPort`, not `proc`.** `adapters/git/git-port.ts` already exposes `isRepo()` + `currentBranch()` (used by doctor); `ExecGit` already shells `git rev-parse --abbrev-ref HEAD`. **Add one method `remoteUrl()`** (`git remote get-url origin`) + a `FakeGit` value; inject `git` into `RecordDeps`. Branch is git state (deterministic), so it's stamped, never agent-guessed.
- **Version**: `src/version.ts#readVersion()` reads `package.json#version` at startup and is threaded through `main()`. Recommendation: **inject `version: string` into `RecordDeps`** (already available at the composition root) rather than re-read per write.
- **How the header coexists with "template is the schema" — a design choice for the workshop.** STAMP recommends **Option A: prepend a CLI-owned provenance block** to the template at write time, leaving every template (incl. `retro.ts`) byte-unchanged and the schema-superset test untouched. ⚠️ Open detail: a prepended YAML-ish block *outside* the template's `---` fence is a little awkward (two frontmatter regions) — the spec/workshop should decide **prepend-separate-block vs merge-into-one-frontmatter**. Either is feasible; prepend keeps extension authors zero-burden.
- **Degradation**: not-a-repo / detached-HEAD / no-remote → stamp `branch: null` / `repo: null` (never guess). Fake-tested.
- **Edit set**: `git-port.ts` (+`remoteUrl`), `exec-git.ts`, `fake-git.ts`, `record-service.ts` (header builder + prepend), `acts/record.ts` + `app.ts` (thread `git`+`version`), record-service tests (stamp/degradation/ordering). `retro-template.test.ts` unchanged.

## history.md removal — full blast radius (HIST-01…05)
- **Zero code writers** confirmed (no `appendHistory`/`writeHistory`/`history.md` in CLI src) — it's a pure hand-maintained artifact, which is exactly why `harness-change` records replace it.
- **17 reword/delete ops across 7 in-repo docs** + delete the file. Hotspots: `maturity-assessment.md` (the **L3 rung** "≥1 encoded — a `history.md` row exists" → "≥1 `harness-change` record exists"; L4 cadence wording), `governance-doc.md` (delete the **G3 "history.md is a changelog" section**; reword G5 Improve-beat row), `eng-harness-1-boot/SKILL.md:148,154`, `eng-harness-4-retro/SKILL.md:385`, `eng-harness-flow/SKILL.md:342`, `getting-started.md:91,186,220,261`, and this repo's own `.harness/engineering-harness.md:100`.
- **Migrate the one existing row** (verbatim, ready): `2026-06-10` — "Test suite made cwd-independent: architecture guards + NodeFs real-tree probes resolve from `import.meta.url`, not `process.cwd()`…"; trigger = Plan 014 magic wand (retro OH-001/OH-003); evidence = "suite 317/317 green from both `harness/cli` and repo root." → becomes the first `harness-change` record.
- **Do NOT touch historical plan docs** (008/011/012/019 references) — audit trail; this plan is the authoritative removal spec.

## In-repo capture seams — all four are in-repo skill prose (CAP-01…09)
| Seam | File · section | Prose or code | Note |
|---|---|---|---|
| Bypass **drain backstop** | `eng-harness-4-retro/SKILL.md` Step 2 (≈141-168); mirror the "Harness-itself entries" detect→offer→emit block (252-284) | prose; **needs** `harness-bypass` core type first | The **in-repo guarantee** — fires every session-end regardless of host (works without the-flow). |
| **Gift** positive-outcome prompt | same file, drain question-pair (157-160) | **pure prose** | Add a 3rd line "what worked well about the harness?" → `harness observe --kind gift --target harness-itself`. `gift` already valid; no schema change. *(D8 open: in-scope or defer?)* |
| Router **`bypass_recommended`** flag | `eng-harness-flow/SKILL.md` `--json` envelope (174-197) + dispatch (63-71) + conflict matrix (164-172) | **prose-only** (router is an agent-run skill — documenting the fields *is* the impl) | Stateless flag on `UNHEALTHY`/`UNAVAILABLE`/declined; never stores, never blocks. |
| **add-extension change prompt** | `eng-harness-0-add-extension/SKILL.md` after "3. Verify" (84-96) | prose; **needs** `harness-change` core type first | New "4. Record the change" on verification pass (not bare `harness new`). |
- **Size budget**: keep all four in the SKILL **body** (uncapped); do NOT extend the frontmatter `description:` — `eng-harness-flow` (857) and `eng-harness-4-retro` (832) are near the 900 `skills-check` warn band.

## ⇒ Natural phase shape for the architect (code-first; prose is inert until types ship)
1. **CLI core** — two record types (`core-types/harness-bypass.ts`, `harness-change.ts` + `registry.ts`), provenance stamping (GitPort `remoteUrl`, version dep, header prepend), **and the new `win` retro kind** (enum in `retro.schema.json` + `schema_version` minor bump, `OBSERVATION_KINDS`+`WIN` prefix in `buffer-codec.ts`, `RETRO_TEMPLATE` doc, encoding-hint) + tests. *Everything else depends on this.*
2. **Remove history.md** — migrate the one row → a `harness-change` record; delete the file; the 17 prose reword/deletes (incl. L3 maturity rung).
3. **Capture seams** — the in-repo skill prompts (retro-drain **bypass backstop** + the **`win` "what worked well?" prompt**, router `bypass_recommended` envelope flag, add-extension Step 4 change record).
4. **Measures design doc** — `docs/how/harness-value-measures.md` (describes bypass/change rates, denominator, DORA-as-leading/lagging correlation, anti-Goodhart guardrails; leans on `notes3.md`).

## Open questions still for the spec (unchanged + sharpened)
- Provenance header shape: **prepend-block vs single-frontmatter** (STAMP detail).
- base `HEAD` SHA in the header — in or out? (D4)
- gift positive-prompt strengthening — Phase 3 in-scope, or deferred? (D8)
- the-flow pre-implement edit — confirm coordinated user-global follow-up. (D10)

---
**Research Complete**: pass-1 2026-06-15T22:30Z (6 lenses, broad map) · pass-2 2026-06-16T01:54Z (3 lenses, decided-design validation) · **10 decisions locked in `distilled-ask.md` · 4 open questions for spec · code-first 4-phase shape · 0 blockers**

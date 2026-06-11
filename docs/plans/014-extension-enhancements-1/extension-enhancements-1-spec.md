# Extension Enhancements 1 — agent instructions + extension folder layout

**Mode**: Simple
**Created**: 2026-06-10 · **Plan**: 014-extension-enhancements-1

ℹ️ No research-dossier.md (design pre-converged in-session; see `original-ask.md` §Session context). Consider `/plan-1a-explore` only if the loader work surprises us.

## Summary

Three strands, one plan (first of an intended `extension-enhancements-N` series):

1. **Agent instructions** — every harness surface gains a standing, queryable *role briefing for the calling agent* ("you bring the inference, the verb brings the determinism"). The **core** CLI briefing is **baked** into the binary; **per-extension** briefings are **`instructions.md` files on disk, loaded dynamically at runtime** (edit → next invocation reflects it, no rebuild). Surfaced via a new core act `harness instructions [verb]`, envelope-wrapped, `--json` first-class, discoverable from `harness help` ("AGENTS START HERE") and `harness doctor`.
2. **Extension folder layout — folder form becomes the ONLY form, and a folder is a little package.** An extension is `.harness/extensions/<name>/` with a validated shape: **convention-required files** — `extension.ts` (the entry) and `instructions.md` (the briefing) — which `doctor` *wails about* when missing; plus **free-form internals** — helper `.ts` modules and subfolders that `extension.ts` imports relatively, so big extensions split up and stay readable. Flat `.harness/extensions/<name>.ts` files are **no longer supported** — the system has not shipped, so there is no migration burden; this repo's two extensions move to folders as part of the build (with genuine `instructions.md` briefings authored for both), and `harness new` scaffolds the folder form only. (The package framing is deliberate groundwork: a future `extension-enhancements-N` may add an installer that pulls extension packages from GitHub — out of scope here.)
3. **Governance-path normalization + this repo's governance doc.** `.harness/engineering-harness.md` is the canonical governance location; the legacy `docs/project-rules/*` fallback chain is removed from live skill/doc surfaces (nothing shipped, nothing to protect). harness-engineering itself finally gets its own hand-written `.harness/engineering-harness.md` (8 BIO fields; boot = the CLI's vitest suite).

**Naming guardrail**: the feature is called **agent instructions** everywhere — never "prompt". minih agents already own `prompt.md`/`instructions.md` (briefing the *worker inside* an agent run); harness instructions brief the *operator agent driving the CLI*. The filename `instructions.md` inside an extension folder is deliberate convention ("how to behave here"), and docs draw the minih distinction once, explicitly.

## Goals

- A zero-context agent landing in any harnessed repo can self-brief in one hop: `harness help` → "AGENTS START HERE" → `harness instructions` → per-verb briefings.
- Extension authors ship the judgment-procedure for their verb as a plain `instructions.md` beside their code — convention over configuration, no rebuild to edit.
- The deterministic/inferential split becomes a queryable contract: verbs compute facts; instructions carry the thesis + the agent's role.
- Extensions become little packages: a doctor-validated convention shape (entry + instructions) with free-form internals (helper modules, subfolders) — one layout, one resolution rule, readable at any size.
- This repo starts practising what it ships: a real `.harness/engineering-harness.md` of its own.
- Everything stays Constitution-P2 clean: instructions are static data via `FsPort`; no LLM, no network; unit-tested with fakes.

## Non-Goals

- ❌ **Not** minih's `prompt.md`/`instructions.md` and not a worker-prompt delivery mechanism — different audience (calling agent), deliberately distinct concept name.
- ❌ No enforcement that agents actually read instructions (skills add a checklist step; attestation mechanisms deferred).
- ❌ No `harness init` / governance-doc *generation* (separate, already-corrected concern — see `.harness/records/retro/2026-06-10/001-init-ask-signal-correction.md`; this repo's doc is hand-written like every other repo's).
- ❌ No flat-file compatibility layer, no `--flat` scaffold flag, no migration tooling — folder form is the only form.
- ❌ No templating/interpolation language inside `instructions.md` (static text in this plan; dynamic interpolation is a future `extension-enhancements-N` candidate).
- ❌ No changes to minih or `agents/` worker definitions (that's run-ops, not this plan).
- ❌ No extension installer / registry / GitHub-pull distribution — the package shape lands here; the installer is a future `extension-enhancements-N` plan.
- ❌ No edits to the user-global SDD planning skills (`~/.claude/skills/plan-5*`, `plan-6*` still check the legacy governance path) — flagged as an out-of-repo follow-up.

## Target Domains

> This repo has no `docs/domains/` registry; domains below are the repo's informal areas.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli core (`harness/cli/src`) | existing (informal) | **modify** | New `instructions` core act; baked core briefing; runtime `instructions.md` loading via `FsPort`; discovery becomes folder-only (`<name>/extension.ts`); `help`/`doctor` surfacing; `new` scaffolds folder form |
| dogfood extensions (`.harness/extensions/`) | existing (informal) | **modify** | Move `validate-harness-flow.ts` + `validate-harnessability.ts` into `<name>/extension.ts` folders; author their `instructions.md` |
| harness skills (`skills/eng-harness-*`) | existing (informal) | **modify** | Drop legacy governance fallback chain (canonical `.harness/engineering-harness.md` only); boot gains step-0 "read instructions"; setup skills scaffold folder-form extensions + plant the "agents start here" pointer in what they author |
| repo governance (`.harness/`, `AGENTS.md`, `README.md`) | existing (informal) | **modify** | Author this repo's `.harness/engineering-harness.md`; fix `AGENTS.md:21` (stale "no doc yet / deferred init writer" framing) and `README.md:114` (old setup path) |
| docs (`docs/how/`) | existing (informal) | **modify** | Update `extend-the-harness.md` (folder layout + instructions authoring + minih distinction) |

## Testing Strategy

- **Approach**: Hybrid — Full TDD for CLI core (folder-only discovery, instructions act, runtime loading, help/doctor surfacing, scaffold output); lightweight/manual for docs, skill-markdown, and governance-doc edits.
- **Mock Usage**: Fake ports only (FakeFs etc., per Constitution P2) — no mocking libraries.
- **Focus Areas**: discovery resolution (folder entry precedence; flat files rejected with honest reporting; containment/no-`../`-escape preserved), instructions resolution (found / absent / unreadable), envelope correctness (P5: non-ok ⇒ `next_action`), moved extensions still load, scaffold emits loadable folder form with starter `instructions.md`.
- **Excluded**: minih runtime behaviour; consumer-repo end-to-end flows (covered by the next dogfood run, which doubles as this plan's field test).

## Documentation Strategy

- **Location**: `docs/how/` only — update `extend-the-harness.md`; no new README sections (the two stale README/AGENTS lines get corrected, not expanded).
- **Rationale**: matches repo convention; the `instructions.md` files themselves are product artifacts, not documentation.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=1, N=1, F=0, T=2 → P=7
- **Confidence**: 0.80
- **Assumptions**: ESM dynamic-import of `<name>/extension.ts` behaves identically to flat files (same loader path, different discovery); removing flat support simplifies discovery rather than complicating it.
- **Dependencies**: none external; internal — `FsPort`, discovery/registry/loader, help-service, doctor, scaffold-service, eng-harness skills.
- **Risks**: see Risks & Assumptions.
- **Phases**: single phase (Simple), ordered: discovery folder-only → instructions service/act → help/doctor → scaffold → move repo extensions → skills (legacy-path removal + breadcrumbs + folder scaffolding) → governance doc → docs.

## Acceptance Criteria

1. `npx harness instructions --json` → `ok` envelope; `data.instructions` is the **baked** core briefing (envelope contract, inference/determinism role split, discovery pointers); `data.verbs_with_instructions[]` lists verbs whose extensions carry `instructions.md`.
2. `npx harness instructions <verb> --json` → `ok` envelope whose `data.instructions` is the **runtime-loaded, entire, unmodified** content of the owning extension's `instructions.md` (convention: `.harness/extensions/<name>/instructions.md`, one per extension folder). The registry maps each verb to its owning extension folder (it already knows each verb's `entryPath`), so multi-verb extensions share the one file — per-verb headings inside it are author convention the CLI never parses. Editing the file changes the next invocation's output with no rebuild.
3. **Scoped to the `instructions` act only** (a verb's normal operation is never affected): querying an unknown verb, or a verb whose extension has no `instructions.md` → honest `unconfigured` envelope (exit 2) with a `next_action` telling the agent/author what to do; an `instructions.md` that exists but cannot be read → `error` envelope with `next_action` — never a crash, never silent empty.
4. `harness help` (human) leads with an **"AGENTS START HERE: npx harness instructions"** banner; `harness help --json` carries `data.agents_start_here` plus per-verb `has_instructions: boolean`.
5. `harness doctor` **validates the package convention** per extension folder: entry resolved AND `instructions.md` present. A folder missing `instructions.md` is *wailed about* — surfaced visibly per-extension with a `next_action` ("author `.harness/extensions/<name>/instructions.md` — see `harness instructions`") — not reported as silent info. (Whether that maps to a per-record warning or an overall `degraded` is plan-3's choice; the contract is: visible complaint + actionable pointer.) Core baked instructions always report present.
6. Discovery is **folder-only**: `.harness/extensions/<name>/` resolves via manifest `harness.extensions[]` → `extension.ts` → `extension.js` → `index.ts` → `index.js` (other variants like `.tsx`/`.mjs`/`.cjs` are reachable only via the manifest, not by entry-name convention); a flat code file directly under `.harness/extensions/` does **not** load and is surfaced by `doctor` as `failed` with message "unsupported flat layout — move to `<name>/extension.ts`". **Note for the architect**: today discovery silently skips non-matching entries and `ExtensionRecord`s exist only for attempted loads — surfacing flat files in `doctor` is a *new* reporting path (discovery or doctor must emit a rejected-entry record); the mechanism is plan-3's choice, the observable behaviour above is the contract. Containment (no `../` escape) and dedup behaviour preserved.
7. Both repo extensions moved to `<name>/extension.ts` form with **genuine authored `instructions.md` briefings** (real role-briefings for the calling agent — what the verb computes, the operator's loop, the judgment expected back — not placeholder stubs); `harness doctor` shows them `loaded` with the package convention satisfied; every existing verb works unchanged; full suite green.
8. `harness new <verb>` (all variants: `--wrap`, `--record`, `--js`) scaffolds the folder form — `<verb>/extension.ts` (or `extension.js` with `--js`) plus a starter `instructions.md` (a short guided-TODO template addressed to the *calling agent*: what this verb computes, what judgment it expects back) — and the scaffold loads (`doctor` → loaded). No `--flat` option exists.
9. An extension folder without `instructions.md` still **functions** — verb loads and runs, `has_instructions: false`, AC-3's `unconfigured` path on direct query — but it is a **convention violation, not a valid end-state**: `doctor` wails per AC-5. (Functionality degrades gracefully; the complaint channel is doctor, never a refusal to run.)
10. All new file reads go through `FsPort` (no `node:fs` in services); every new branch unit-tested with fakes; suite green.
11. `docs/how/extend-the-harness.md` documents the folder layout (only form), `instructions.md` authoring (audience: the calling agent; convention name; one per extension), and the minih-naming distinction.
12. Skill surfaces updated: `eng-harness-1-boot` reads governance from `.harness/engineering-harness.md` **only** (legacy `docs/project-rules/*` fallback chain removed) and gains a step-0 "run `harness instructions --json`, read briefings for verbs you'll use"; setup skills (`eng-harness-0-*`) describe folder-form extensions only. **Breadcrumb mechanism made precise**: the setup skills are flows that author no files themselves — governance docs are hand-written from the BIO template — so the "AGENTS START HERE → `npx harness instructions`" pointer line is added to the governance-doc **template** (`skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md`), so every doc hand-written from it carries the breadcrumb; skill prose that quotes flat extension paths is corrected.
13. This repo's `.harness/engineering-harness.md` exists, hand-written with the 8 grounded BIO fields (boot = harness/cli vitest suite); `eng-harness-1-boot` run here reports it instead of `UNAVAILABLE`; `AGENTS.md:21` and `README.md:114` corrected to the canonical path and current framing.
14. **Package-internal imports are first-class**: `extension.ts` may import relative helper modules within its own folder, including from subfolders (e.g. `./lib/collect.ts`); the loader supports this and at least one migrated extension (or a dedicated test fixture) proves it by actually splitting logic into a helper module. Discovery still imports only the resolved entry — internals are the package's private business.

## Risks & Assumptions

- **Risk — loader regression**: discovery changes touch every verb's entry path; mitigated by existing discovery/registry tests + AC-7's move-and-stay-green proof.
- **Risk — consumer-flow breakage by design**: removing flat support breaks anything that scaffolds or expects flat files — which is exactly the eng-harness setup skills and `harness new`; AC-8/AC-12 make updating them part of the same plan so the system is never internally inconsistent. The next dogfood run is the field test.
- **Risk — naming bleed**: "prompt" terminology creeping in and colliding with minih concepts; AC-11 owns the distinction; review should grep for it.
- **Risk — scope creep via strand 3**: governance normalization is bounded to live surfaces listed in AC-12/AC-13; frozen plan artifacts (`docs/plans/00x`) and historical retros are explicitly untouched.
- **Assumption**: baked core briefing as a TS constant (help-service style) is acceptable — it versions with the CLI, which is correct (it documents the CLI's own contract).
- **Assumption**: instructions are repo-trusted content (same trust domain as the extension code beside them) — no sanitisation pass.
- **Out-of-repo follow-up (flagged, not in plan)**: user-global SDD skills (`~/.claude/skills/plan-5*`, `plan-6*`, `the-flow`) still check `docs/project-rules/engineering-harness.md` — update them to canonical `.harness/engineering-harness.md` separately.

## Open Questions

None remaining — all resolved in Clarifications.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Instructions resolution contract | API Contract | Only if plan-3 finds the `has_instructions` surface rippling wider than help/doctor | What exactly does `help --json` expose? Does the registry cache instructions presence or stat on demand? |

## Clarifications

### Session 2026-06-10

- Q: Workflow mode? → A: **Simple** (CS-3, one domain area, subdir discovery half-exists).
- Q: Testing strategy? → A: **Hybrid** — Full TDD for CLI core, lightweight for docs/skill edits.
- Q: Mock usage? → A: **Fake ports only** (Constitution P2; no mocking libraries).
- Q: Documentation strategy? → A: **docs/how/ only** (`extend-the-harness.md`).
- Q: Instructions granularity + file name? → A: **Convention: `.harness/extensions/<extension>/instructions.md`** — fixed name, one per extension folder, shared by all its verbs (per-verb headings inside the file if wanted). Self-consistent with `harness instructions <verb>`.
- Q: Flat-file extensions — instructions support? → A: **Moot — flat mode removed entirely.** Folder form is the only supported layout; nothing has shipped, so no migration support. Leftover flat files surface honestly in `doctor`.
- Q: `harness new` escape hatch + consumer-skill updates? → A: **Folder-only scaffold, no `--flat`; skill updates in scope** (they'd otherwise author broken extensions).
- Q: Agent harness for this repo? → A: **Canonical path is `.harness/engineering-harness.md`; the `docs/project-rules/*` check is legacy — remove the fallback chain from live surfaces. And yes: this repo gets its own governance doc, hand-written, in this plan** (verified absent today; stale references found at `README.md:114`, `AGENTS.md:21`, boot/setup skill fallback chains; global SDD skills flagged as out-of-repo follow-up).

### Session 2026-06-10 — addendum (post-validation)

- User direction: **extension folders are little packages.** Convention-required files (`extension.ts`, `instructions.md`) are *validated by doctor* — it wails when one is missing (flipped AC-5/AC-9 from "informational, never degrades" to "visible complaint + next_action"). Free-form internals (helper modules, subfolders) are first-class — `extension.ts` imports them relatively (new AC-14). Instructions **must be authored for both current extensions** in this plan (AC-7 strengthened: genuine briefings, not stubs). A GitHub extension installer is explicitly out of scope (future `extension-enhancements-N`; added to Non-Goals).
- Note for the architect: this addendum postdates the Validation Record below — AC-5/AC-7/AC-9 as validated read differently; the package-convention versions above are authoritative.

---

## Validation Record (2026-06-10)

### Validation Thesis

**Raison d'être**: Turn the in-session design conversation into a buildable contract for /plan-3 so the design survives context boundaries and downstream builds the right thing.

**Value claim**: Downstream planning/implementation becomes unambiguous — what `harness instructions` does, where `instructions.md` lives, what layout is supported, what governance path is canonical.

**Artifact promise**: 13 testable ACs + 8 recorded clarifications the architect can build from with minimal re-asking.

**Intended beneficiaries**: /plan-3 architect, implementing agent, extension authors, zero-context calling agents.

**Proof target**: Contract

**Evidence standard**: ACs testable; claims about current code match source (verified line refs); scope boundaries explicit.

**Thesis source**: `original-ask.md` (verbatim user ask)

**Thesis verdict**: Advanced

**Main thesis risk**: (pre-fix) ambiguity in multi-verb instructions resolution (AC-2) and governance-doc breadcrumb ownership (AC-12) — both resolved by the fixes below.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Source-Truth/Clarity | Factual Accuracy, System Behavior, Technical Constraints, Hidden Assumptions, Concept Documentation, Domain Boundaries | Evidence Sufficiency | 1 MEDIUM fixed | ✅ all source claims verified (line refs, BIO=8, discovery/help/scaffold/boot-chain accurate) |
| Completeness/Edge-Cases | Edge Cases, Integration & Ripple, Deployment & Ops, System Behavior | Downstream Usefulness | 6 genuine (others were spec-is-not-yet-implemented category errors, dismissed) — 5 fixed, 1 deferred to plan-3 (error code) | ⚠️ → ✅ |
| Thesis+Forward-Compat | Thesis Alignment, Forward-Compatibility, Evidence Sufficiency, Proof-Level Fit, Value Preservation | Thesis Alignment, Proof-Level Fit | 1 HIGH + 2 MEDIUM fixed | ✅ no thesis drift; no contradiction with init-correction record |

**Fixes applied (2026-06-10)**: AC-2 — whole-file return + registry verb→folder mapping for multi-verb extensions; AC-3 — scoped to the instructions act + unreadable-file → `error`; AC-6 — `extension.js` added to chain, variant boundary stated, doctor flat-file surfacing flagged as a NEW reporting path for plan-3; AC-8 — starter `instructions.md` content defined (guided-TODO addressed to calling agent); AC-12 — breadcrumb planted via the governance-doc *template* (skills are flows, they author no files). Deferred to plan-3: error-code assignment for the flat-layout warning; shipped-docs regen (`docs-manifest`/gen-docs) when `extend-the-harness.md` changes — architect must include it.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| /plan-3 architect | ACs derivable without re-asking | contract drift | ✅ (post-fix) | the 3 ACs flagged ambiguous (2/6/12) now carry explicit resolution |
| eng-harness skills (AC-12) | precise change enumeration | shape mismatch | ✅ (post-fix) | breadcrumb mechanism pinned to governance-doc template |
| harness/cli source contract | deltas vs actual behavior | contract drift | ✅ | all current-behavior claims source-verified |
| next dogfood run | internally consistent consumer flow | encapsulation lockout | ✅ (post-fix) | AC-12 now states governance stays hand-written; template carries pointer |

**Thesis alignment**: Value claim advanced at Contract level (target met); main residual risk is implementation-mechanism choices deliberately left to plan-3 (doctor reporting path, error codes).

**Outcome alignment**: "The spec advances the VPO Outcome ('A zero-context agent landing in any harnessed repo can self-brief in one hop: `harness help` → AGENTS START HERE → `harness instructions` → per-verb briefings') for product users and for this repo's dogfood case." (FC agent, pre-fix caveat on the dogfood consumer resolved by the AC-12 fix.)

**Standalone?**: No — four named downstream consumers engaged.

Overall: ⚠️ VALIDATED WITH FIXES

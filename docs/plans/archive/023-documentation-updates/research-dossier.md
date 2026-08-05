# Research Dossier: eng-harness onboarding UX + supporting documentation

**Generated**: 2026-06-18
**Research Query**: "Get the flow set up and do the research phase" for plan 023-documentation-updates — covering (a) a durable cursor-based onboarding state (`adopt-flow.json`) that survives `/compact` like the-flow, (b) porting the-flow coach devices (Seam Digest / mirror-as-todos / recap) into eng-harness-flow, (c) the CLI cold-start install-discoverability gap, and (d) which doc surfaces need updating.
**Mode**: Plan-Associated (feeds `1b plan`)
**Location**: docs/plans/023-documentation-updates/research-dossier.md
**FlowSpace**: Not available (standard tools)
**Findings**: 6 lenses → IA (6), PS (13), DE/IC (9), PL (18), QT (13), DB (14)

> Scope note: this is an **internal design + documentation** topic on the harness's own skill/CLI surfaces, not a product-feature archaeology. The six research lenses were scoped to the real questions rather than the generic 8-subagent codebase sweep — consistent with the flow's "never ritualize" ethos. Every finding carries file:line evidence from the contributing read-only agents.

---

## Executive Summary

### What it is
A bundle of three complementary changes to how a repo **adopts and is oriented to** the engineering harness, plus the documentation sweep that ties them together: (1) give the **adoption journey** a small, ephemeral, cursor-bearing state file so it survives `/compact` (the workshop's `adopt-flow.json`); (2) **port the-flow's coach devices** (the Seam Digest, the `recap` summon, the mirror-as-todos instruction) into `eng-harness-flow`'s already-90%-aligned coach; (3) close the **CLI cold-start discoverability gap** — a teammate cloning an adopted repo on a fresh machine has `.harness/` but no traveling pointer to install the CLI.

### Why it exists
Onboarding currently re-derives its position from **markdown/substrate presence-checks** every call. That is correct for the cyclic engineering loop (position is genuinely in substrate) but lossy for the **linear adoption journey**, whose transient decisions (declined optionals, half-done multi-file weaves, a boot-shape chosen before it's built, the narration thread) are *not yet* in substrate. The-flow already solved the same class of problem with durable state; this plan brings that resilience to onboarding **without** making the router stateful.

### Key insights
1. **The design is the architecture's own move, not an exception.** The router's "stateless by design" thesis ships an explicit escape hatch — *"state that must persist lives in deterministic substrate a child verb owns — never in this router."* An adopt-verb-owned, self-cleaning `.harness/temp/adopt-flow.json` is exactly that. (IA-04, PL-01, DB-08)
2. **The coach port is voice-only.** The `--json` envelope already emits every field the Seam Digest renders (`rail.cursor`, `now`, `next`, `next_suggested`, `flags`, `insight`). Porting the digest/recap/mirror is a `coach.md` edit with **zero contract change**. (IA-03, PS-11, DB-05)
3. **The cold-start gap is real and precisely located.** The only artifact that travels into a consumer repo (`.harness/engineering-harness.md`) carries a breadcrumb (`harness instructions`) that *requires the CLI to already exist*, and no install one-liner travels anywhere in the clone. Fix locus: `harness init` (the governance skeleton it stamps). (DE-01, DE-02, IC-04, DB-06)

### Quick stats
- **Components touched**: 4 owners — `adopt` verb, the router engine (`00-routing.md`), `coach.md`, the CLI (`init`/`temp`/schema). (DB ownership table)
- **Contract risk**: HIGH surface (`--hook`/`--event`/`--hooks`/`--json`) but the plan needs **no reshape** — additive-only if anything. (QT-01..06, PL-06)
- **Sensor coverage for onboarding/adopt/coach**: **essentially zero** (critical backpressure gap). (QT-13)
- **Prior learnings**: 18 surfaced; 1 is a live owed debt (`.minih.json` drift, PL-12).
- **Domains**: no `docs/domains/registry.md` — boundaries derived organically; unusually explicit owner declarations. (DB)

---

## How onboarding currently works (the baseline)

Adoption position is re-derived **every call** from deterministic presence-checks; no rung stores its own "done." The authoritative ordered gate is the Graph in `00-routing.md`, mirrored procedurally in `adopt.md`:

| Rung | Re-derived from (signal) | Evidence |
|---|---|---|
| **S0 Install** | `harness --version` on PATH or `.harness/` exists; `harness doctor` envelope | `adopt.md:60-66`, `00-routing.md:37-44` |
| **S1 Scout** | any report under `.harness/reports/harnessability/` | `adopt.md:117-120` |
| **S2 Governance** | `.harness/engineering-harness.md` **presence** (not contents) | `00-routing.md:50` |
| **S3 Inject** | governance doc has a `## Injection map` section | `adopt.md:148` |
| **S4 Build+run boot** | a boot verb/recipe exists AND boots cleanly | `adopt.md:180-184` |

The router stores nothing; "done" = a child artifact exists. (IA-01)

---

## Critical Discoveries

### 🚨 CD-01 — Cursor-vs-substrate authority is the load-bearing safety boundary (IA-05e, IA-02)
`harness init` seeds governance **empty** (L0, all TODO, empty `## Injection map`). So `S2 = done` (presence) is true while S3's signal (a *filled* injection map) is false and boot still reports `UNAVAILABLE`. **Required rungs (S0/S2/S4) must stay substrate-authoritative even when a persisted cursor disagrees** — otherwise the design reintroduces the very "provisioning gaps look like engineering entry" failure (router limit #3) it's meant to avoid.
**Required action**: the persisted `adopt-flow.json` owns **transient/declined** state only (S1 declined, S3 per-file progress, `boot_shape`, narration); **substrate stays authoritative for required-rung completion.** Add a "resume-beats-re-derive applies to transient state, not required rungs" rule, plus a staleness / already-adopted guard before resuming (IA-05f). `00-routing.md:50`, `governance-doc.md:63,70`.

### 🚨 CD-02 — Zero deterministic sensors for router/adopt/coach behaviour (QT-13)
There are **no tests** asserting the `--hooks` manifest shape, the `--json` envelope field-set, the `--event` alias map, the adopt-gate ordering, or the coach rail. The byte-stable contract's only protection is plan 022's one-time manual byte-diff + an **external, un-CI'd** mirror in the-flow's `harness-seams.md`. The lone onboarding dogfood (`validate-harness-flow`) is a non-deterministic, network + `minih`-LLM probe, absent from CI.
**Required action**: this is the plan's headline backpressure gap. Cheapest fix: a frozen-snapshot fixture test asserting `--hooks --json` shape + the alias table + the `--json` envelope field-set, so the next contract edit can't silently drift from the mirror. (Candidate Phase 0.)

### 🚨 CD-03 — The cold-start breadcrumb doesn't travel, and the one that does is a footgun (DE-01, DE-02, IC-01)
The install one-liner `npm install -g @ai-substrate/engineering-harness` lives in 6 source-repo locations, **none of which travel into a consumer repo**. The only traveling, deterministically-stamped artifact — `.harness/engineering-harness.md` — points at `harness instructions`, which a cold machine cannot run. Worse, two breadcrumb spellings are in flight: the stamped skeleton uses safe bare `harness instructions` (`governance-template.ts:23`) but the contract + this repo's doc use `npx harness instructions` (`governance-doc.md:26`, `.harness/engineering-harness.md:3`) — which **directly violates the family-wide "never run bare `npx harness`" rule** (`adopt.md:78`).
**Required action**: stamp the cold-start one-liner into a traveling artifact `harness init` controls (fold into the governance `AGENTS START HERE` block, or a dedicated `.harness/INSTALL.md`); pick ONE breadcrumb spelling and align all three sites. `self-install` and `skills install` are **red herrings** for cold start — both presuppose the CLI on PATH (DE-03, DE-04).

### 🚨 CD-04 — `.minih.json` dogfood drift is a live, already-owed debt (PL-12)
`.minih.json` still points at the deleted `eng-harness-setup`/`-loop` sources + 7 retired slugs, so a fresh `minih run code-review-companion` fails with **E211** unless launched `--no-skills`. The 022 retro (DL-002) explicitly deferred this to a "dogfood + CLI slug realignment" follow-up; 023 is its natural home.
**Required action**: decide in/out for 023; at minimum document the `--no-skills` workaround; consider a doctor check that every `.minih.json` skill source path + requested slug still resolves.

### 🚨 CD-05 — Pre-existing retired-slug leak in the CLI (DB-12)
`harness/cli/src/acts/init.ts` (lines 41-42) still emits the **retired** `eng-harness-0-adopt` slug in two `next_action` strings — a survivor of the 022 catalog sweep. Clean win for the cold-start workstream.

---

## The design, validated against the architecture

### It's consistent with "stateless by design" (IA-04, DB-07, DB-08, PL-01)
The router stays a pure dispatcher: the **adopt verb owns** `adopt-flow.json` (sole writer), the **router only reads** it as one extra detection signal, and the file **self-deletes at completion** (durable truth = governance doc + working boot). This lands squarely inside the unifying rule; reuses the existing gitignored `.harness/temp/` convention (the `*` glob already covers the new file for free — PL-03, so the workshop's gitignore open-question is answered); and keeps the router stateless before and after adoption.

### The coach is already ~90% ported; three devices are missing (PS-01..PS-13)
| Device | the-flow | eng-harness-flow | Gap |
|---|---|---|---|
| Host rail (◆◐◇─↺⚙🧰), unified/anchored rail, fenced-block rule | ✅ | ✅ byte-aligned | none |
| Flag beat (rules + must-see table), Insight beat, tone | ✅ | ✅ | none |
| Print-then-offer | ✅ full ladder | ⚠️ lighter (no exceptions ladder) | minor |
| Orient→Flag→Insight→Suggest→Invite | ✅ rendered as digest | ✅ as **prose table** | shape only |
| **Seam Digest** (Just did/Next up/Watch-outs/Optional) | ✅ | ❌ | **MISSING — headline** |
| **`recap` summon** | ✅ | ❌ | **MISSING** |
| **Mirror-as-todos** | ✅ | ❌ | **MISSING** |
| `/compact` resume handshake (copy) | ✅ | ❌ (loop covers via statelessness) | needed once `adopt-flow.json` lands |
| Adoption contract (late-join SDD plan) | ✅ | ❌ — terminology collision (harness "adoption" ≠ SDD late-join) | not 1:1 portable |

**Decision (PS-11): porting the digest is voice-only** — a `coach.md` edit, no `00-routing.md` envelope change. Its content sources (Flag beat → *Watch-outs*; Insight → *Just did*; `now`/`next`/`next_suggested` → *Next up*) are already present. **Constraint (PS-13):** both coaches render ONE merged rail when both flows are live, so the glyph set, legend rule, fenced-block rule, `⚙`-not-`⚙️` rule, and `└─` anchor math must stay **byte-aligned across both `coach.md` files** — and ideally the new digest shape too.

### State reuse from the-flow is high (PS-12)
`adopt-flow.json` borrows `.the-flow-state.json`'s skeleton ~1:1 (cursor, `pending_command`, `status`, `schema_version`, atomic write, self-clean) and the `/compact` resume handshake near-verbatim, plus the rail glyphs. It diverges only where adoption demands: a `declined` status, per-file weave `decision[]`, pre-materialised `decisions.boot_shape`, `narration_thread`, and an **ephemeral `.harness/temp/`** home (vs the-flow's committed plan folder). There is **no flight-plan/DAG analogue** proposed — `adopt-flow.json` collapses the-flow's two-file model into one.

---

## Boundaries & ownership (DB)

| Artifact / change | Owner | Reads | Writes | Lifetime |
|---|---|---|---|---|
| `adopt-flow.json` | **adopt verb** (`references/stages/adopt.md`) | adopt + router (1 signal) | **adopt only** | ephemeral, self-deletes |
| Cursor READ (resume-beats-gate signal) | **router** (`00-routing.md`) | router | — | per-call, stateless |
| `.harness/temp/` storage + gitignore self-heal | **CLI** (`services/shared/temp.ts`) | doctor | CLI (`ensureTemp`) | permanent mechanism |
| `adopt-flow.schema.json` (if shipped — OPEN) | **CLI** (record core-types pattern) or verb-loose | validators | CLI build | code-versioned |
| Seam Digest / mirror-as-todos / rail | **coach.md** | coach | coach (voice) | rendered live |
| Cold-start breadcrumb (`next_action`, AGENTS-START-HERE) | **CLI** (`init`/`doctor`/`help`) | agents | CLI acts | permanent |
| Adoption gate order (S0→S4), hook vocab, `--json` envelope | **router engine** (`00-routing.md`) | all | engine doc | permanent contract |

**Boundary rules 023 must respect**: (1) router never stores state; (2) the unifying-rule escape hatch authorises the file; (3) **verb modules stay harness-blind/flow-blind (L1 de-leak)** — no sibling slugs, no lifecycle-hook strings, no flow-position, no "Next" markers in `adopt.md`; (4) one graph, one owner — S0→S4 order lives only in `00-routing.md`; (5) one voice, one place — all narration in `coach.md`; (6) byte-stable public contract — additive + version-gated only; (7) committed contract (governance) vs transient journey (`.harness/temp/`) never mixed; (8) CLI owns `.harness/` substrate + schemas + breadcrumb. (DB-07..DB-14)

**Implied decomposition (DB synthesis)** — five separable workstreams, each a distinct owner + proof:
1. **CLI** — cold-start breadcrumb (`init`/`doctor`/`help` orientation + retired-slug fix DB-12) + (decide first) `adopt-flow.schema.json`.
2. **Adopt-verb state lifecycle** — create/update/resume/archive of `adopt-flow.json` in `adopt.md`, harness-blind.
3. **Router signal** — add "adoption-in-flight" detection signal + decision-order precheck in `00-routing.md`, read-only.
4. **Coach voice port** — Seam Digest + mirror-as-todos + `recap` into `coach.md` (no envelope change).
5. **Docs sweep** — reconcile all four against the governance doc + catalogs (the "documentation-updates" framing).

---

## Quality, contracts & CI guards (QT, PL)

### Must-not-break, byte-for-byte (all in `00-routing.md`; mirrored by the-flow `harness-seams.md` `harness_seam_contract: v1`)
1. Five lifecycle hook tokens + order: `pre-flight, pre-coding, coding, post-coding, post-flight`.
2. Six `--event`→`--hook` aliases (esp. `pre-implement→pre-flight`; `phase-end`/`plan-complete` split). Never deprecate `--event`.
3. `--hooks` manifest — Shape A top-level `{manifest_version, hooks}`, nine fields, `coding`'s exact silent `invoke` string (~2304 b).
4. `--json` routing envelope field-set + decision enum + conflict matrix (~1018 b). Additions additive only.
5. Routing/discovery separation.

### CI traps a "docs" plan will hit (PL-09, PL-10, PL-15, QT-07..QT-10)
- **Bundled docs**: editing any `docs-manifest.json` `sourcePath` (e.g. `docs/how/*.md`, `AGENTS_README.md`, `harness/cli/README.md`) requires `npm run gen:docs` + `npm run build` + commit the regenerated `docs-content.ts`, or `check:docs` / `docs-content.test.ts` / `docs.test.ts` (dist↔source parity) fail. **Never hand-edit the biome-canonical `docs-content.ts`.** Note: `getting-started.md` is NOT bundled (no gen:docs needed).
- **`just test` ≠ CI.** It runs vitest only. Lint (Biome), `check:docs`, and typecheck live in CI's `build-test`. Run the full local shape: `npm run lint`, `npm run build`, `npm run check:docs`, `npx tsc --noEmit`, then `just test`.
- **Required check** = `ci-required` ← {`rename-guard`, `build-test`(Node 22+24: lint→build→check:docs→typecheck→vitest→arch-check→skills-check), `package-smoke`}.
- **SKILL.md frontmatter** guarded by `skills-check`: `description` ≤1024 (aim ≤900) — `eng-harness-flow` already breached 1024 in the field. Skill **bodies** and `references/*.md` are unguarded.
- **Catalog sweeps** must derive the file set from `docs-manifest.json` `sourcePath`s and grep **prose/count** patterns ("skills", "install", numbers), not a hand list — this is how 022's companion caught the "all seven" leak the scoped grep missed (PL-15). A `--companion` review earns its cost on docs-heavy work (PL-15 / 022 WIN-001).

### Prior-learnings highlights (PL)
- **PL-01/PL-02**: statelessness + the "where statelessness has limits" section already exist — update that section to point at the new signal, don't add a competing one.
- **PL-04/PL-08**: keep `adopt-flow.json` validation lightweight; default skill-first ownership; ship a CLI schema only if a **named non-agent consumer** needs byte-stable output (none today — same trap 021 deferred).
- **PL-13/PL-14**: new `adopt.md` text must stay L1-clean (cursor *vocabulary* S0–S4 / hook names is flow knowledge → lives in `00-routing.md`); express delegation via the existing `**Delegates**:` mechanism; re-run the 022 L1 grep + T005-style elision audit on any module 023 reshapes.
- **PL-16/PL-17/PL-18**: the first command a cold user runs must not lie or dead-end (FX001); encode the cold-start fix **product-side**, not in a prompt/memory (FX004); scope any `harness init` reference to the deterministic scaffold slice only (grounding is a skill job).

---

## Prior Learnings Summary

| ID | Type | Source | Key insight | Action for 023 |
|----|------|--------|-------------|----------------|
| PL-01 | architecture | 021 dossier / SKILL.md | persist → child substrate (escape hatch) | adopt verb owns the file; router reads only |
| PL-03 | gotcha | 015 plan | `.harness/temp/` `*` gitignore covers new file free | no gitignore work; ensure an ensureTemp at S0 |
| PL-06 | contract | 022 plan | `--hook/--event/--hooks/--json` byte-mirrored by the-flow | additive-only; byte-parity in ACs |
| PL-09 | CI trap | 022 log | bundled doc edit ⇒ `gen:docs`+`build` or CI red | task step: check manifest, regen, build |
| PL-10 | CI trap | 019 log | biome not in `just test` | run `just fft`/lint before push |
| PL-12 | debt (live) | 022 retro DL-002 | `.minih.json` drift → E211 | decide in/out; doc `--no-skills`; doctor check |
| PL-13 | de-leak | 022 plan AC5 | modules harness-blind (L1) | keep hook/slug vocab out of `adopt.md` |
| PL-15 | sweep | 022 retro SUGG-001 | grep manifest sourcePaths + prose, not hand list | derive doc sweep from manifest |
| PL-17 | onboarding | 013 FX004 | encode the fix product-side, not the prompt | cold-start fix in README/skills/adopt |

---

## Doc surfaces to update (candidate edits — DE)

| File | Today | Likely update |
|---|---|---|
| `harness/cli/src/services/init/governance-template.ts` | stamps traveling governance doc; breadcrumb assumes CLI; **no install pointer** | **primary fix locus** — add cold-start install line (or stamp `.harness/INSTALL.md`) |
| `harness/cli/src/acts/init.ts` | `next_action` names retired `eng-harness-0-adopt` (×2) | point at `/eng-harness-flow` / the adopt verb (DB-12) |
| `skills/eng-harness-flow/references/governance-doc.md` | breadcrumb = `npx harness instructions` | align spelling (drop `npx`); update G5 if `init` stamps install info |
| `.harness/engineering-harness.md` | uses `npx harness instructions` | align breadcrumb spelling |
| `skills/eng-harness-flow/references/stages/adopt.md` | install steps; "never bare npx harness"; S5 skills install | add "leave a traveling breadcrumb" sub-step; document `adopt-flow.json` lifecycle (L1-clean) |
| `skills/eng-harness-flow/references/getting-started.md` | plain install line; what-travels diagram | guard the install line; add "fresh-machine cloner" note |
| `AGENTS_README.md` | Stage 1 install; authors an AGENTS.md block w/ install line | reference the deterministic breadcrumb; keep AGENTS.md block as secondary route (bundled → gen:docs) |
| `README.md` | install one-liner; self-install; skills install | cross-link the cold-start story (source-repo only) |
| `harness/cli/README.md` | install/run; self-install | clarify self-install ≠ cold-start (bundled → gen:docs) |
| `docs/how/keeping-the-harness-up-to-date.md` | self-install = "bootstrap for machine without CLI" | tighten framing (it's a CLI subcommand) (bundled → gen:docs) |
| `docs/how/extend-the-harness.md` | "installed via npx" (stale) | fix to ambient-global model (bundled → gen:docs) |
| `INSTALL.md` (root) | skills-only | add/link a CLI-install section; disambiguate vs a future `.harness/INSTALL.md` |
| `skills/README.md` | "intended loop" starts at skills (assumes CLI) | add a cold-machine "get the CLI first" pre-step |
| `00-routing.md` | signals A–J; "where statelessness has limits"; dangling "see 'limits'" ref at :84; S1 path-inconsistency | add the adoption-in-flight signal; fix the dangling cross-ref (IA-05d) |
| `coach.md` | rail + cadence, no digest/recap/mirror | port Seam Digest + mirror-as-todos + recap (voice-only) |
| `docs/plans/023-.../workshops/001-onboarding-flow-state.md` | "verbatim" misquote; "coach already renders the digest" overstatement | correct hygiene items (IA-05a, IA-05b) |

---

## External Research Opportunities

All gaps are **internal-doc / empirical follow-ups** — no web research required.
1. **the-flow skill source parity** — the-flow's skill source lives outside this repo (`~/github/tools/skills/SDD/the-flow/`); the `.the-flow-state.json` + flight-plan resume mechanism was inspected at source during this research. Confirm exact parity against it (and `harness-seams.md` mirror) before claiming "the-flow parity." (IA-05c, QT-06)
2. **CLI empirical checks** — confirm `harness doctor` tolerates an extra `adopt-flow.json` under `.harness/temp/` (the `*` glob suggests yes); confirm the npm tarball `files` glob would ship a new `.harness/INSTALL.md` template if option 2 is chosen. (IA external gaps, DE external gaps)
3. **Decide OPEN questions before tasks**: schema ownership (CLI-shipped vs verb-loose, Q1); archive-vs-delete (Q4, keep in `.harness/temp/`); staleness expiry (Q3); S5 placement (Q5). (workshop §10)

---

## Recommendations

### If planning this (the next step)
1. **Decompose by owner** into the five workstreams above (CLI / adopt-verb / router-signal / coach / docs-sweep) — the contract between them is *data*, not prose, so they're cleanly separable.
2. **Make CD-01 a first-class acceptance criterion**: persisted cursor owns transient/declined state only; required rungs (S0/S2/S4) stay substrate-authoritative; add a staleness/already-adopted guard before resuming.
3. **Consider a Phase 0** for CD-02: a cheap frozen-snapshot fixture test over `--hooks --json` + the alias table + the `--json` envelope field-set — the one deterministic guard that would stop silent drift from the-flow's mirror.
4. **Fold in the owed `.minih.json` realignment (CD-04/PL-12)** or explicitly scope it out with the `--no-skills` workaround documented.
5. **Bake the CI-trap checklist into every doc task** (gen:docs + build + check:docs + lint + tsc + skills-check), and **derive the doc sweep from `docs-manifest.json`** (PL-15).

### What to avoid
- Making the router store the cursor (thesis violation — DB-13).
- Leaking hook/slug/flow vocabulary into `adopt.md` (L1 violation — PL-13).
- Hand-editing `docs-content.ts`; trusting `just test` alone; a hand-listed catalog sweep.
- Reshaping any `--hook`/`--event`/`--hooks`/`--json` field (byte-stable; additive only).

---

**Research Complete**: 2026-06-18 · feeds `/the-flow 1b plan`

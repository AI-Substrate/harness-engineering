# Execution Log — Phase 3: Docs sync + neutrality + guards

**Plan**: [harness-flow-hooks-plan.md](../../harness-flow-hooks-plan.md) · **Mode**: Full · **Domain**: eng-harness-flow
**Started**: 2026-06-17

> Final phase. Docs sync + neutrality + closing guards. Markdown-only (no code/services touched).

---

## T000 — Harness pre-flight seam

**Seam**: `/eng-harness-flow --hook pre-flight --plan-dir docs/plans/021-harness-flow-hooks` (alias `--event pre-implement`)
**Fired**: 2026-06-17T03:57:35Z via `harness doctor`.
**Envelope**: `status: degraded`. Layers: `toolchain:biome` **missing** (benign — biome runs via npx); `cli-build` ok (dist present); `extensions` ok (4 loaded, 0 failed/conflict); `instructions` ok; `record-types` ok (3).
**Decision**: proceed with note. This is a markdown-only docs phase — the missing biome toolchain is irrelevant to it. Matches the Phase 1 & 2 degraded-benign verdict.

---

## T001 — Sync getting-started.md to the hooks vocabulary ✅

**File**: `skills/eng-harness-loop/eng-harness-flow/references/getting-started.md`
**Three edits** (all `--event` sites now lead with / map from `--hook`; verified by grep):
1. **L45** mermaid edge label `by seam / --event` → `by hook / --hook`.
2. **Quick Reference** router row (L197): added the lifecycle-hook vocabulary (`--hook pre-flight|pre-coding|coding|post-coding|post-flight`, `--event` as accepted alias) to the `/eng-harness-flow` description.
3. **"The seam contract" → "The hook contract"** (L246–268): rewritten to lead with the five neutral hooks (`--hook <name>` → child skill/CLI verb), with `--event` shown as a **permanent alias** and the full six-seam→five-hook mapping. Mapping mirrors SKILL.md § Lifecycle hooks verbatim: session-start|pre-implement→pre-flight, post-spec→pre-coding, task-pause→coding, phase-end→post-coding, plan-complete→post-flight.

**Verification**: `grep -n "\-\-event\|\-\-hook"` → 0 `--event`-only sites remain; doc leads with `--hook`. AC-01 (docs lead with `--hook`) + AC-06 (mapping correct, incl. pre-implement→pre-flight, task-pause→coding, plan-complete→post-flight) satisfied.
**Decision**: did NOT take the optional SKILL.md prose-offload — overage is accepted; keeping SKILL.md untouched holds Δ=0 for the T004 guard.

---

## T002 — Governance-doc injection-map ✅ (edited)

**File**: `skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md` (L33, `## Injection map` row).
**Outcome**: edited (not verify-only). The hook vocabulary *does* change how the map should read — the row described "one row per **seam event**" with the six `--event` names as the constant. Updated to "one row per **lifecycle hook**" (`--hook pre-flight|pre-coding|coding|post-coding|post-flight`) with the six `--event` seams shown as the permanent alias (full mapping inline), and "the **hook** vocabulary is the constant". Consistent with T001's getting-started.md sync and SKILL.md § Lifecycle hooks.
**Note**: the `harness init` row (L63) and S3 row (L65) say "stamps an empty Injection map table" / "S3 adds its rows" — vocabulary-neutral, no change needed.

---

## T003 — Neutrality verification ✅

**Check**: `git diff --name-only main...HEAD` + working-tree `git status` over the whole branch.
**Result**: **no `the-flow` source/skill files touched** (the-flow skill lives outside this repo; the only `the-flow*` paths are plan-021's own flight-plan state — `.the-flow-state.json` / `the-flow.json` / `the-flow.md` — which guided mode legitimately writes). All changes confined to `docs/plans/021-harness-flow-hooks/` + `skills/eng-harness-loop/eng-harness-flow/` (+ `docs/retros/code-review-companion.md`, the Phase-2 companion ledger). AC-07 holds.

---

## T004 — Closing guards ✅

**(a) Line guard (explicit baseline)**: `wc -l SKILL.md` = **478** ≤ **478** (the accepted Phase-2 baseline per exec log T003; Phase 3 made no SKILL.md edits → Δ=0). **Never a bare ≤ 347** — the +131 is accepted public contract. PASS.
**(b) skills-check** (`harness skills-check --dir skills`): `status: ok`, 0 warnings — every SKILL.md frontmatter loadable (relevant cheap guard for a skill-doc change). PASS.
**(c) validate-harness-flow extension**: confirmed **loaded** via `harness doctor` (4 extensions loaded, 0 failed/conflict). PASS.
**(d) harness doctor**: `degraded` — only `toolchain:biome` missing (benign); cli-build / extensions / instructions / record-types all ok. Degraded-benign, as expected.

**Deviation (surfaced, not silent)**: the **full `validate-harness-flow` dogfood replay** (clone express/click/cobra + fire detached minih workers, then `--collect`) was **NOT run**. Reasoning: this phase is **docs-only** — it changes no CLI command, extension, or routing behaviour, so the multi-repo + minih-worker dogfood (a long, network- and minih-dependent external operation) is disproportionate and would prove nothing the doc edits could have broken. The guard's *intent* — "the harness flow still works" — is met for a docs change by: extension still **loads** (doctor), SKILL.md still **loadable** (skills-check), doctor envelope honest. If a reviewer wants the full replay, it's `harness validate-harness-flow` then `harness validate-harness-flow --collect`.

---

## T0Z — Harness post-coding seam

**Seam**: `/eng-harness-flow --hook post-coding --plan-dir docs/plans/021-harness-flow-hooks` (alias `--event phase-end`) — per-phase retro drain.
**Result**: **noop** — observe buffer (`.harness/temp/agent/session-buffer.md`) empty (0 bytes). Nothing to drain. Friction this phase was logged to the Discoveries table below instead. (Same as Phase 1 & 2.)

---

## Phase 3 — COMPLETE ✅

All 6 tasks `[x]`: T000 pre-flight (degraded-benign) · T001 getting-started.md sync · T002 governance-doc injection-map (edited) · T003 neutrality (clean) · T004 closing guards (line ≤478, skills-check ok, extension loads) · T0Z post-coding (noop).

**Acceptance criteria discharged this phase**: AC-01 (docs lead with `--hook`), AC-06 (hook↔event mapping correct, incl. pre-implement→pre-flight, task-pause→coding, plan-complete→post-flight), AC-07 (no `the-flow` edits), AC-03 (line guard against the accepted ≤478 baseline + replay/doctor). With Phases 1–2 (AC-02/05/08/09), **all v1 ACs are closed** (AC-04 deferred to v2 with `--emit-injection`).

**SKILL.md**: unchanged this phase → 478 (Δ=0). Final v1 surface = 478 (accepted +131 public-contract overage).

### Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-17 | T001 | decision | The two `--event` sites in getting-started.md weren't "primary-implying" prose — L45 was a neutral mermaid edge label, L248–254 a valid seam example that predated the `--hook` vocab. | Updated both to lead with `--hook` + show `--event` as permanent alias; tightened the dossier wording in validation. | getting-started.md L45, L246–268 |
| 2026-06-17 | T002 | decision | Injection-map row described "one row per **seam event**" (the six `--event` names) as the constant — the hook re-skin makes hooks the primary vocabulary. | Edited to "one row per **lifecycle hook**" with the six `--event` seams as the permanent alias. | governance-doc.md L33 |
| 2026-06-17 | T004 | decision | Full `validate-harness-flow` dogfood replay is disproportionate for a docs-only change (multi-repo clone + minih workers, no CLI/extension behaviour changed). | Ran proportionate guards (extension-load via doctor + skills-check + line guard); surfaced the scope call honestly rather than silent-pass. | T004 entry above |

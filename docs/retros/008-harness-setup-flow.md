# Retro — Plan 008 Harness Setup Flow (rework `engineering-harness-setup`)

**Date**: 2026-06-09 · **Mode**: Simple, single phase (companion build) · **Verdict**: clean (all findings fixed + companion-approved)

## Companion (code-review-companion) — run 2026-06-09T08-41-51-347Z-f8e3

- **Reviewed**: 9 task/fix commits (T001–T007 + two fix commits). T002/T003/T004 APPROVE; T001 APPROVE_WITH_NOTES; both fix commits APPROVE.
- **Findings**: 5 sent (all MEDIUM), all dispositioned + fixed:
  - **F001** (Contract Drift) — SKILL Step 2 reuse-check only tested `latest.json`, missing the AC4 directory fallback → fixed (`test -f latest.json || ls .../*`).
  - **F002** (Impl Quality) — copyable commands used bare `harness` but the bin isn't always on PATH after `npm install`; the e2e recipe uses `npx harness` → fixed (all blocks use `npx harness …`).
  - **F003** (Contract Drift) — after the F001/F002 SKILL fix, **README still carried the pre-fix contract** (bare `harness`, `latest.json`-only) → fixed (README realigned).
  - **F004** (Testing & Evidence) — verification.md marked AC7 PASS while the README drift (F003) was still open → resolved by the F003 fix + an AC7 annotation.
  - **F005** (Testing & Evidence) — final-overclaim finding raised at T007 (before the README fix landed); **crossed with** the F003/F004 fix commit and was confirmed resolved by it.
- **magicWand** → **minih**: guarantee `MINIH_PROJECT_ROOT` points to the project git root in every run and expose a separate `MINIH_RUN_DIR`; fail fast with a clear coordination error if the project root can't be set.
- **Difficulties**: MH-001 (`MINIH_PROJECT_ROOT` resolved to the run folder, not the repo root — used git context as the root); MH-002 (`minih validate --file` unsupported → used `minih check --file`); MH-003 (`git grep` entered a pager → re-ran with `--no-pager`); MH-004 (`^stop` body vs the prompt's `/^stop\b/` match — treated `type=control` + subject as stop intent).

## Orchestrator (me)

- **Worked well**: companion-per-commit caught a **real propagation gap I missed** — I fixed the copyable-command + report-fallback contract in `SKILL.md` (F001/F002) but left `README.md` on the old wording (F003/F004/F005). In-process I'd already "verified" AC7 PASS; only the second pair of eyes flagged that a *contract-changing fix* had stranded a sibling surface. The e2e agent run (`verbName=boot`) was a clean, honest AC9 proof: it scaffolded `.harness/extensions/boot.ts` via `add-extension`/`harness new` and proved load + `status: ok`/exit 0. `validate-v2` earlier caught a stale **template count (22 → 19)** before any code was written.
- **Friction**:
  - **OH-008-01 — contract-change propagation.** A fix that changes a copyable command or a sentinel path must sweep *every* surface in one commit: `SKILL.md`, `README.md`, **and** the verification note. I fixed one and re-claimed PASS; that produced three follow-on findings (F003/F004/F005). Cheap to fix at commit time, but a checklist would have pre-empted them.
  - **OH-008-02 — assert-then-verify the count.** "22 templates" was a miscount that propagated through spec/plan/dossier/flight-plan before `validate-v2` caught it. Authoritative `ls | wc -l` before asserting a number.
  - **OH-008-03 — `harness doctor` is `degraded` in a consumer repo.** The SKILL's "doctor OK" sanity framing needed e2e evidence to get right: in a fresh consumer repo `doctor` returns top-level `degraded` (a `cli-build` layer that only applies inside the CLI's own repo) even when extensions load and run. Folded into Step 1.4 (gate on "CLI runs + returns an envelope", read `data.layers`/`extensions`).
- **Magic wand** (project / skill-authoring): a **contract-propagation check** — when a skill changes a copyable command or a sentinel path, verify `SKILL.md` + `README.md` + the verification note agree before claiming the AC.

## Cross-agent / cross-plan signal

- **minih project-root gap is recurring.** The companion's MH-001 (`MINIH_PROJECT_ROOT` → run dir, not repo root) is the same class of minih env/coordination gap flagged in plans 006/007 retros, and it also surfaced indirectly in the e2e agent's local-install workaround. High-confidence upstream item for minih.
- **Skill-vs-surface drift** is the dominant friction in a *docs-only* rework: there's no compiler to catch a SKILL/README/verification mismatch, so the companion (or a deterministic propagation check) is the only backstop.

## Follow-ups

- **FU-008-01** (project / skill-authoring): adopt a "contract-propagation sweep" convention — a copyable-command / sentinel-path change in a skill must update `SKILL.md`, `README.md`, and the verification note in the same commit.
- **FU-008-02** (minih, coordination): `MINIH_PROJECT_ROOT` should point to the git root in every run; expose `MINIH_RUN_DIR` separately; fail fast otherwise (companion magicWand; **recurring** across 006/007/008).
- **FU-008-03** (harness CLI): `harness doctor` reports top-level `degraded` in a consumer repo because of a `cli-build` layer that only applies inside the CLI's own repo — consider scoping that layer so a consumer-repo `doctor` is `ok` when the CLI runs and extensions load.
- **Out of scope (by design)**: `harness init` (forward dependency the flow calls + degrades gracefully without); the `harnessability-assessment` report-location move to `.harness/reports/harnessability/latest.json` (the user's parallel work — contract pinned here); the MCP server (the flow depends only on the CLI command/envelope surface, so it stays compatible).

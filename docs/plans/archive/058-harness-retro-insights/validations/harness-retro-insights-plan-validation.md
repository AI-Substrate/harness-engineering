# Validation — harness-retro-insights-plan.md

- **Validated**: 2026-07-12T02:40:00Z
- **Target**: `docs/plans/058-harness-retro-insights/harness-retro-insights-plan.md` (v1.1.0)
- **Contract sources**: `original-ask.md`; `research-dossier.md`; `skills/eng-harness-flow/references/stages/retro.md`; `skills/eng-harness-flow/references/00-routing.md`; `harness/cli/src/services/telemetry/insights.ts`
- **Checks**: grep-verified every doctrine citation (ranking retro.md:417, stale :416, proof-gap lists :178/:419, legacy paths :405/:411, compound-value :39/:466); confirmed `makeRow`/`N_THRESHOLD` exports, no YAML dependency, `core-instructions.ts`, gen:docs/check:docs pipeline, act-registration pattern; one independent primary critic (read-only)
- **Verdict**: VALIDATED WITH FIXES
- **Thesis / proof**: purpose met — an implementer can build the verb + flow surface from the plan without re-deriving design; Contract-level proof target matched by cited, verified sources.
- **Consumers**: 2/2 — tasks/implement stages (phase tables + Done-Whens actionable); eng-harness-flow doctrine surfaces (additive edits specified).

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| CRITICAL | Cluster rows carried no `members[]` provenance, so the pinned lifecycle ops (in-place `system.compound.status` mutation, retro.md:470-476) would force re-deriving the scan the verb eliminates | plan AC-01/1.5 vs retro.md Step 5 | fixed — AC-01/1.4/1.5/2.1 now require `members: [{record_path, retro_id, entry_id, status}]` |
| MEDIUM | Task 2.3 "mirror `at=retro-harvest`" contradicted AC-08's advisory-only buffer posture (retro-harvest row is a `redirect`, 00-routing.md:274) | plan 2.3 vs AC-08 | fixed — 2.3 decides: buffer non-empty → `route` + drain advisory, never redirect |
| MEDIUM | Live validation (2.5) would exercise the stale deployed skill copy (`~/.claude` → `~/.agents`, real dir, diverges after 2.1–2.4) | justfile:18 `install-skills-local`; deploy topology | fixed — 2.5 now redeploys (`npm run build` + `just install-skills-local`) before invoking |
| MEDIUM | AC-09/2.1 said "Steps 1–4" but Step 4 IS the pinned view (retro.md:421); self-contradicting rewrite boundary | retro.md:402-421 | fixed — Steps 1–3 replaced; Step 4 view retained as the narration template |
| MEDIUM (lead) | Doctrine carries two proof-gap target lists (5-target command-route set :178 vs recognizer incl. `infra`/`tooling` + keywords :419); the deterministic engine must commit to one | retro.md:178 vs :419 | fixed — AC-05 defines two-signal leverage (`proof_gap_signal: "target" \| "keyword"`) |

## Repairs

All five fixes applied to the plan in-session (v1.0.0 → v1.1.0) and re-verified by re-reading the edited sections; each is evidence-pinned to the cited doctrine lines. No code was touched (plan-stage document only).

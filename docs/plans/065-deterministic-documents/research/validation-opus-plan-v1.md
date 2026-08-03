# FROZEN — verbatim provenance capture. Never updated; superseded silently.

# Opus 5 validation of deterministic-documents-plan.md v1.0.0 (2026-08-03)

Independent subagent (Opus 5, read-only) validated plan v1.0.0 (basis sha256
d61b05502cee5d5eda79c9ff2f416b2723ea15e34b0da225c9ff58aac03bfc6d) against the
authoritative corpus. All 17 findings were folded into plan v1.1.0 the same
session. Evidence spot-checks (one-subverb cap, E300–E310 full, d5Refuse,
tolerant FlowNode index signature, no JSON-Schema dep) all CONFIRMED.

## VERDICT: NEEDS ATTENTION

| ID | Sev | Problem (compressed) | Resolution in v1.1.0 |
|---|---|---|---|
| F1 | CRITICAL | P2/P3/P4 not parallel-safe: renderer/adapters + doctor diagnostics + AC-01's hard-ERROR all consume P2's schema resolver; `dd graph` specified via P3's render engine | Graph redrawn P1→P2→(P3∥P4)→P5→P6; `dd graph` standalone mermaid emitter; validate consumes an injected resolver interface |
| F2 | HIGH | "checks OOTB with zero repo config" contradicted: checks is a repo-local unpublished extension; nothing under `.harness/**` ships | AC-07 split honestly: this-repo checks gate + shipped core doctor layer (`checkDd`) for consumers |
| F3 | HIGH | `runVerbGate` has no severity param — warn-launch must come from the sub-verb's own envelope | 4.5: doctor emits degraded/exit 0 for WARN-class, error for ERROR-class |
| F4 | HIGH | W8 inverted: ruled depth (default 3–4) belongs on `dd validate`; doctor = same engine at radius ∞ | 1.4 gains `--depth` (default 3); 4.5 doctor = radius ∞ + loop breakers |
| F5 | HIGH | "Frozen act index" self-contradictory (parallel phases must register new submodules); E-code map = one const, textual conflicts | P1 pre-creates ALL act stubs (final signatures, honest `unconfigured`) + full E400–E449 with final names; P2–P4 fill bodies only |
| F6 | HIGH | Derived task state + cross-file rollup (workshop 002) had no owning task, no AC | Task 1.8 (`derive.ts`) + AC-13; consumed by 3.1 render + 6.2 gate |
| F7 | HIGH | Known-bad + cyclic fixtures would redden the repo's own `harness checks` — no exclusion mechanism designed | Exclusion contract (1.1/1.4/4.5: `**/test/fixtures/**` + opt-out key, sweep-mode only) + AC-15 |
| F8 | MEDIUM | Per-state note rules + human-only `human-skipped` authority unplanned | 1.4 note-rules validation; receipt field; authorship convention-only, recorded |
| F9 | MEDIUM | Custom enums with own gate-terminal declarations (workshop 002) unplanned; P6 needs to read them | 2.1 `gate_terminal[]` declarations; 6.2 reads schema declaration not hardcoded set |
| F10 | MEDIUM | `plan` core act = second undeclared P10 deviation; not in RESERVED_NAMES; second app.ts edit unmanifested | Second deviation-ledger row; 5.1 adds RESERVED_NAMES + registerPlanAct; manifest updated |
| F11 | MEDIUM | Watcher wiring understated: globs snapshot at scheduler construction from repo-sensors declarations (outside P3 fence); W8's revalidate-on-save absent | Sensor declaration owned by P5; watcher library support in P3; depth-1 revalidate explicitly deferred with W7 |
| F12 | MEDIUM | `check:dd-docs` never composed into checks/build | 5.3 runCmdGate + `gen:dd-docs` into build script |
| F13 | MEDIUM | Coverage map holes: AC-01 needs 2.1; AC-06 live half is 3.4; AC-03 misses the hand-edit path; links/graph had no AC | Map repaired; AC-03 restated; AC-14 added |
| F14 | MEDIUM | Plan silently deferred D2's AC-row link columns + backpressure-as-dd (ruled-in scope) via the migration non-goal | 2.3 carries `pressure`/`proven_by` columns; non-goal softened to bulk migration of historical files |
| F15 | MEDIUM | G7 "manifest covers every planned file" not honest (root package.json, sensor file, app.ts P5 edit, fixture corpus missing) | Four manifest rows added; G7 re-asserted |
| F16 | LOW | 4.3 carried an unresolved "verb name?" in a READY plan | Delegated as explicit P4 leaf decision (1.7 pattern) |
| F17 | LOW | W8's finding-ownership rule (finding owned by the file that must change) uncarried | 4.1 ownership rule + 4.5 aggregation |

Bottom line (validator's): rulings read faithfully, evidence sound — but not
ready to fan out until the graph, the freeze, and the three unowned ruled
behaviours were fixed. All fixed in v1.1.0.

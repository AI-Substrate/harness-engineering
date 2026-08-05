<!-- GENERATED FROM the-flow.json — do not hand-edit as the primary. -->
# Flight plan — arch-conformance-extension (016)

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef known fill:#CFD8DC,stroke:#546E7A,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#455A64,stroke-dasharray:5 5;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;
  classDef harness fill:#EDE7F6,stroke:#673AB7,color:#311B92;
  classDef companion fill:#FCE4EC,stroke:#C2185B,color:#880E4F;

  investigation["Tool investigation ✅ (dependency-cruiser · 7-rule PoC · rules committed at poc-arch-rules.cjs)"]:::done
  spec["Spec + validate-v2 + grill ✅ (CS-2 Simple · 12 ACs · Envelope & Exit Contract · verb arch-check · warn-launch · VALIDATED WITH FIXES)"]:::done
  backpressure["Backpressure Check — SKIPPED, user call (the plan IS the sensor)"]:::harness
  plan["Plan (/plan-3) ✅ READY + validate-v2 (gates 6 PASS / 1 N/A · VALIDATED WITH FIXES)"]:::done

  subgraph companion_review["🤝 code-review-companion — 13 reviews · 7 farewell findings, all reconciled (supersedes /plan-7)"]
    build["Build ✅ — T000–T012, 13 commits, 12/12 ACs (sensor live: ok/degraded/unconfigured all proven)"]:::done
  end
  class companion_review companion

  merge["Merge (/plan-8) — DEFERRED, user call (resume later; typed PROCEED only)"]:::assumed

  investigation --> spec --> backpressure --> plan --> build --> merge

  said_investigation>"🗣 add another exemplar extension… deterministic back pressure to do architectural checking… hexagonal architecture… node native, install something? codeql etc?"]:::said
  said_investigation -.- investigation
  said_spec>"🗣 yes do that next phase please · agreed · validated? · arch-check. no examples copyable — later we will add a harness core skill to install extensions from other repos · (grill) warn on all things, we will trust our future selves — see how much we have to fix before we start failing CI"]:::said
  said_spec -.- spec
  said_bp>"🗣 skip to plan 3 cause that bakpressure is what we're building"]:::said
  said_bp -.- backpressure
  said_plan>"🗣 run it"]:::said
  said_plan -.- plan
  said_build>"🗣 impleent with companion please · look at intro-to-harness.md + simple-mode.md to help frame the doco"]:::said
  said_build -.- build
  said_merge>"🗣 great mark merge phase skipped we wil ldo that later"]:::said
  said_merge -.- merge
```

**Legend** — 🟩 done · 🟧 in progress · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop · 🩷 companion (live reviewer)

**Now**: **Build DONE, companion-reviewed** — T000–T012 in 13 commits (`af3b8b5..e27c6c4`), all 12 ACs evidenced. The sensor is live: `harness arch-check` reads `ok`/0 on the clean tree (66 modules / 112 deps); the seeded violation landed as `degraded`/0 naming `services-only-adapter-ports` with its comment quoted (warn-launch exactly as grilled); missing tool/config read `unconfigured`/2; CI runs the verb as the final `build-test` step with a `::warning::` on degraded. 378/378 tests from both cwds; doctor `ok` "3 loaded". Build discovery encoded same-session (gotcha #3): depcruise 17.4.3's json reporter exits 0 even on error violations → parse-first design. Mid-build user direction applied: the how-guide + briefing are framed in the harness-foundations vocabulary (inferred→deterministic worlds; encode-the-fix-not-the-memory; simple-mode Rule 3 epigraph). T012 drain materialised 12 entries (SUGG-010 P12-sanitized); buffer cleared. **Companion debrief**: a minih channel failure suppressed the companion's in-phase replies (silence read as clean) — its farewell then delivered 7 findings (5 HIGH / 2 MEDIUM, verdict REQUEST_CHANGES), all reconciled in a post-debrief fix commit: F001 absolute-path leak in flow files fixed (repo-relative), F004 parse schema-guards + comment fallback added (380/380), F006 stale governance claims fixed, F003 PoC header corrected (partial; spec stays historical), F002 refuted with evidence (engines ≥22 predates 016), F005/F007 ledger rebuilt honestly. Channel failure observe-filed as a minih bug candidate · **Merge: DEFERRED by user call (2026-06-10)** — the branch keeps its 15 unmerged commits locally; 016 joins 014 and 015 in the parked-merge set · **Next (when resumed)**: `/plan-8` merge analysis — executes **only** on explicit typed `PROCEED`

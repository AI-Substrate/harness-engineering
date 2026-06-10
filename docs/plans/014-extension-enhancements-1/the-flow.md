<!-- GENERATED FROM the-flow.json — do not hand-edit as the primary. -->
# Flight plan — extension-enhancements-1 (014)

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef known fill:#CFD8DC,stroke:#546E7A,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#455A64,stroke-dasharray:5 5;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;
  classDef companion fill:#F3E5F5,stroke:#8E24AA,color:#4A148C;
  classDef harness fill:#EDE7F6,stroke:#673AB7,color:#311B92;

  spec["Spec (Simple, CS-3, 14 ACs)"]:::done
  plan["Plan (READY · 17 tasks · D1–D5)"]:::done
  subgraph companion_review["🤝 code-review-companion (minih run 2026-06-10T10-44-33-424Z-8149) — reviewed every commit"]
    phases["Build T001–T017 ✅ (9 commits · 315/315 · 14/14 ACs)"]:::done
  end
  merge["Merge (/plan-8, typed PROCEED only)"]:::known

  spec --> plan --> phases --> merge
  class companion_review companion

  said_spec>"🗣 need a new plan for both the general agent instructions and the instructions per extension stuff… md, loaded dynamically at runtime… core baked… move extensions to extensions/&lt;name&gt;/extension.ts… + instructions.md by convention + flat mode no longer supported + legacy governance check removed, this repo gets its own doc + extensions are little packages (doctor wails; installer OOS; author instructions for current extensions)"]:::said
  said_spec -.- spec
  said_plan>"🗣 proceed to architect then validation"]:::said
  said_plan -.- plan
  said_build>"🗣 plan-6-v2-implement-phase-companion + mid-build addendum: validate-harness-flow briefing must check target-repo retros (magic wands) AND separately the minih worker retros"]:::said
  said_build -.- phases
```

**Legend** — 🟩 done · 🟧 in progress · 🟥 blocked · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🤝 companion (wraps the phases it reviews)

**Now**: Build + companion review COMPLETE — T001–T017 in 9 atomic commits (`46c3c8a…18942c5`) + farewell fix commit `1a6d5c9` (8 findings, 2 HIGH, all addressed); suite 317/317; 14/14 ACs; companion run exited `completed` (supersedes /plan-7) · **Next**: /plan-8 merge analysis — executes only on typed PROCEED
**Build highlights**: folder-only discovery (E143 rejection records) · `harness instructions` act (E144/E145; D1–D5 honored; contract.ts untouched) · AGENTS START HERE in help · doctor convention wail (degraded, exit 0) · packages scaffolded w/ starter briefings · `flat-legacy.ts` permanent rejection fixture + `subby` AC-14 real-jiti proof · both dogfood extensions packaged w/ genuine briefings · skills canonical-only + governance-doc breadcrumb · `.harness/engineering-harness.md` authored (L2) · docs rewritten, `check:docs` clean

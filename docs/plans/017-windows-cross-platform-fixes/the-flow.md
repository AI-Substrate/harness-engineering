<!-- GENERATED FROM the-flow.json — do not hand-edit as the primary. -->
# Flight plan — windows-cross-platform-fixes (017)

```mermaid
flowchart TD
  classDef done fill:#C8E6C9,stroke:#2E7D32,color:#1B5E20;
  classDef wip fill:#FFE0B2,stroke:#EF6C00,color:#E65100;
  classDef known fill:#CFD8DC,stroke:#546E7A,color:#263238;
  classDef assumed fill:#ECEFF1,stroke:#90A4AE,color:#455A64,stroke-dasharray:5 5;
  classDef said fill:#E3F2FD,stroke:#1565C0,color:#0D47A1;
  classDef harness fill:#EDE7F6,stroke:#673AB7,color:#311B92;
  classDef companion fill:#FFF3E0,stroke:#FB8C00,color:#E65100;

  research["Research ✅ — external Windows dossier (scratch/cross-system-failure.md: 40 failing tests / 5 root causes; runtime works) + flow-start discovery: package-smoke CI red on all branch runs"]:::done
  spec["Spec ✅ + validate-v2 + amendment (CS-2 Simple · 10 ACs · VALIDATED WITH FIXES · AMENDED: no Windows CI executor — AC-8 rewritten to Windows-shaped-input tests on ubuntu + manual re-port)"]:::done
  backpressure["Backpressure Check ✅ (/plan-2d, regenerated) — Certainty: Partial · 9 sensors, all ubuntu-only · Phase 0: pure helper tests + Windows-shaped cwd fixtures + package-smoke repair + .gitattributes · NO windows leg (user decision)"]:::harness
  plan["Plan ✅ (/plan-3) READY v1.1.0 — all gates PASS · 16 tasks (T000–T015), sensor tasks lead · validate-v2: 22/22 claims verified, 4 specs tightened · empirical: npm pack --json NOT immune to lifecycle stdout; posix.resolve corrupts drive-letter paths"]:::done
  build["Build ✅ (/plan-6 companion) — T000–T015 all done · suite 380→434 green throughout · Windows-shape sensor revert-proven · CI ALL GREEN at b789ddf incl. package-smoke FIRST green · +unplanned: committed 755 bin wrapper + node-direct CI invocation (npx root-bin nondeterminism)"]:::done
  merge["Merge (/plan-8) — typed PROCEED only"]:::known

  research --> spec --> backpressure --> plan --> build --> merge

  subgraph companionwrap ["code-review-companion (minih, run 2026-06-10T19-47-11-847Z-ee10) — 16 review pings, farewell reconciled"]
    build
  end
  class companionwrap companion

  said_research>"🗣 need to fix these windows problem scratch/cross-system-failure.md. we shoud use our harness loop to validate them using determinitic back pressure when done."]:::said
  said_research -.- research
  said_spec>"🗣 run it · then validate"]:::said
  said_spec -.- spec
  said_bp>"🗣 do backpressure survey now · are the sensors in one extension? · we will not have a windows server in ci... remove anyting that needs that... · no new extension to check windows stuff?"]:::said
  said_bp -.- backpressure
  said_plan>"🗣 run architect step"]:::said
  said_plan -.- plan
  said_build>"🗣 implementn with companion"]:::said
  said_build -.- build
```

**Legend** — 🟩 done · 🟧 in progress · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop · 🟠 companion

**Now**: The build is **done** — all 16 tasks (T000–T015), suite 380 → **434 green throughout**, arch-check ok, and **CI fully green at `b789ddf`**: build-test on Node 22 AND 24, plus **package-smoke's first green** (AC-9) — the deterministic backpressure the user mandated, end to end. The Windows-shape sensor (11 ubuntu-runnable tests over `FakeProcess.cwd()='C:\repo'` fixtures) was **proven by reverting** the discovery boundary to native join and watching it fail. One unplanned defect class surfaced on the way: `package.json#bin` pointed at untracked 644 tsc output and `npx --no-install` resolution of the repo's own bin turned out **nondeterministic across npm majors** — fixed in-theme with a committed 100755 bin wrapper + node-direct invocation in CI. The companion reviewed all 16 commits and its farewell carried **4 MEDIUM findings** (the inbox never surfaced them mid-phase — the DL-001 channel asymmetry again); all four were addressed inline post-farewell (UNC root-kind guard in `isWithin`, an AC-2 source guard banning `node:path` in the five services, idiom scope fix, self-repo invocation docs), landing the suite at **442/442**. The T015 drain + farewell materialized as `.harness/records/retro/2026-06-10/008…drain.md` and `009…companion-farewell.md`. **Next**: `/plan-8` merge analysis — the merge itself executes **only on a typed `PROCEED`**.

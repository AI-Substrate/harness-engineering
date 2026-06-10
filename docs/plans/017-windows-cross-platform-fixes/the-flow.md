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

  research["Research ✅ — external Windows dossier (scratch/cross-system-failure.md: 40 failing tests / 5 root causes; runtime works) + flow-start discovery: package-smoke CI red on all branch runs"]:::done
  spec["Spec ✅ + validate-v2 + amendment (CS-2 Simple · 10 ACs · VALIDATED WITH FIXES · AMENDED: no Windows CI executor — AC-8 rewritten to Windows-shaped-input tests on ubuntu + manual re-port)"]:::done
  backpressure["Backpressure Check ✅ (/plan-2d, regenerated) — Certainty: Partial · 9 sensors, all ubuntu-only · Phase 0: pure helper tests + Windows-shaped cwd fixtures + package-smoke repair + .gitattributes · NO windows leg (user decision)"]:::harness
  plan["Plan ✅ (/plan-3) READY v1.1.0 — all gates PASS · 16 tasks (T000–T015), sensor tasks lead · validate-v2: 22/22 claims verified, 4 specs tightened · empirical: npm pack --json NOT immune to lifecycle stdout; posix.resolve corrupts drive-letter paths"]:::done
  build["Build (/plan-6) — single phase T000–T015 (companion recommended)"]:::known
  merge["Merge (/plan-8) — typed PROCEED only"]:::assumed

  research --> spec --> backpressure --> plan --> build --> merge

  said_research>"🗣 need to fix these windows problem scratch/cross-system-failure.md. we shoud use our harness loop to validate them using determinitic back pressure when done."]:::said
  said_research -.- research
  said_spec>"🗣 run it · then validate"]:::said
  said_spec -.- spec
  said_bp>"🗣 do backpressure survey now · are the sensors in one extension? · we will not have a windows server in ci... remove anyting that needs that... · no new extension to check windows stuff?"]:::said
  said_bp -.- backpressure
  said_plan>"🗣 run architect step"]:::said
  said_plan -.- plan
```

**Legend** — 🟩 done · 🟧 in progress · 🟦 known (designed) · ⬜ assumed (speculative) · 🗣 user input · 🟪 harness loop

**Now**: The plan landed **READY** (v1.1.0, all gates PASS; G4 N/A — no ADRs): a single-phase Simple plan whose 16 task rows put the **backpressure Phase 0 first** — helper unit tests (RED) → POSIX path helper (GREEN) → separator-tolerant FakeFs → the five services converted with discovery as the *single POSIX origin* → path-safe assertions → the **Windows-shape sensor** (`FakeProcess.cwd()='C:\repo'` fixtures with post-`toPosix` FakeFs keys, plus a recorded revert-proof that the sensor actually fails on a native-join regression) → shell-free EPIPE test → gen-docs stderr/biome fixes → package-smoke repair → `.gitattributes` → idioms → full verification → retro drain. Two findings were verified **empirically** during planning: `npm pack --json` is *not* immune to lifecycle stdout on npm 11.10.0 (so the stderr move is the load-bearing fix and `jq` + the `*.tgz` assert are the loud guard), and `posix.resolve()` would corrupt drive-letter paths (the helper is normalize/join-only). validate-v2 (3 agents) confirmed all 22 factual claims and tightened four task specs, including the pin that Node's `posix.normalize` collapses a UNC leading `//`. **Next**: `/plan-6` — companion variant recommended; `/compact` first is the cleaner seam.

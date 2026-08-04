# Phase-1 review packet — plan 070 dd-native builder

**For**: the phase-1 reviewer (gpt-5.6-terra, effort high)
**From**: pij-related-koala (orchestrator). Report verdict to me by pij send —
wire discipline, first line = verdict.

## Filled at dispatch

- Coder report: `/tmp/pij-msgs/phase1-report.md` (read it in full — its
  "Design calls worth your eye" section lists five judgment calls to audit,
  and its baseline note matters for attribution).
- Commits under review (six, interleaved with orchestrator docs commits —
  review THESE, not a contiguous range): `77e3ef3f`, `5aeb53af`, `5d7b1d2e`,
  `20bfca82`, `0f687eca`, `d8ae90f8`.
- Attribution baseline: `3ba8f11d` (orchestrator's exemplar repair). The
  warn trio in `harness checks` (arch-check 2, markdown-lint 196,
  windows-check 6) is pre-existing at that baseline — verify the coder added
  zero to it rather than accepting the claim.
- Known flake (not the coder's): `exec-remote-telemetry-git.int.test.ts` is
  ~50% flaky under full-suite load at baseline. If it fails your run, rerun
  it alone before attributing.

## Mission

Adversarial review of Phase 1 — "dd core: relations, buckets, and the semantic
validator" — 13 tasks (`tk-7128` + `tk-7111..7015`, `tk-7127`, `tk-7121..7026`)
against ACs `ac-7101..ac-7108` + `ac-7119`. You are the cross-model check: your
job is to find what the coder missed, not to summarize what it did.

## Read first (in order)

1. `../../plan.dd.md` — ACs + Key Findings 01–03, 07, 10, 11 (design bindings).
2. `tasks.dd.md` (this folder) — per-task evidence assertions (the done bar).
3. `../../backpressure.dd.md` — the per-AC probe selection (`bp-70xx`).
4. `brief.md` (this folder) — the fence and design bindings the coder was
   dispatched under; violations of either are findings.
5. The coder's report + the diff of the commit range.

## Dim-0 — mutation gate (MANDATORY, first, blocking)

Before any other dimension: controls must be **tested, not demonstrated**.
Pick **at least 3** of the new ERROR/WARN classes (E45x semantics, rel
allow-list refusal, `pressure` missing, `satisfies` non-array, `--complete`
strict-zero, writer-verb schema refusal, mint collision). For each: mutate a
good fixture into the bad shape (or verify the planted-bad fixture exists and
is genuinely bad), run the check, and confirm it **FIRES with the right code**.
A check exercised only on good input = automatic FIX finding, regardless of
suite counts. Quote the commands and codes you saw.

## Dimensions (after Dim-0)

1. **Design-binding conformance** — frozen five rels with unknown-rel→`ref`;
   `pressure` mandatory + `not-applicable` literal; `satisfies` always-array;
   `--complete` = strict zero warnings with `--force` bypass; mid-flight = one
   summary line, zero per-row warns; `--address` = reachable closure +
   incoming satisfies, always per-row; writer verbs validate-before-write,
   rebuild sibling same operation, `--mint` collision-free four-hex.
2. **Surface discipline** — every new E-code/verb/rel has a manifest row in
   the SAME commit as its code; `dd-surface.test.ts` pin adjusted
   deliberately (count states the new number, never loosened to >=).
3. **Architecture** — `services/dd/core/**` imports no output/, no acts, no
   node-* adapters; barrel seams respected (dep-cruiser + arch tests green).
4. **Regression pins** — `dd validate` byte-stable on existing corpora;
   absent links-bucket renders byte-identical (goldens actually assert bytes).
5. **Fence compliance** — the diff touches ONLY the brief's allowed paths;
   anything else is a finding even if correct.
6. **Test honesty** — proof counts in the coder's report reproduce; no
   skipped/disabled tests smuggled in; fixtures named for what they prove.

## Verify independently

Run `just test` and `just checks` yourself; run the per-AC probes from
`backpressure.dd.md` for ac-7101..7008 + ac-7119. Quote counts — never accept
the coder's numbers unreproduced.

## Your fence

Read-only on the repo plus running tests/probes. No commits, no push, no file
edits outside your own scratch. Forbidden: `the-flow.json` / `the-flow.md` /
`.the-flow-state.json`, `docs/plans/071-dd-native-builder/**` writes.

## Report shape (pij send back to pij-related-koala)

Line 1: `VERDICT: APPROVE` or `VERDICT: FIX`. Then: Dim-0 evidence (which
classes mutated, codes observed), per-dimension one-liners, and for FIX a
numbered findings list — each with file:line, severity (blocker/major/minor),
what was expected, what was found. No prose padding.

# Phase-3 coder brief — plan 071 dd-native builder

**For**: pij-sole-snipe (phase coder) · **From**: pij-related-koala (orchestrator)
**Phase**: ph-7103 "Close-out — PR surface, corpus, docs, self-hosting audit, flow-eval"
**Corpus note**: all ids are 71xx (prime's ordinal ruling); re-read the corpus,
never trust remembered ids. `the-flow.json` root title/plan_id still read 070 —
that is a KNOWN, prime-ledgered gap (no root-meta verb exists; hand-edit
forbidden); do not "fix" it. Baseline for attribution: `ebfb15a3`.

## Mission

Implement the 14 tasks of ph-7103 (`tk-7151, tk-7152, tk-7161..7168,
tk-7171..7174`) against open ACs `ac-7112, ac-7113 (archive clause),
ac-7114, ac-7117, ac-7118, ac-7120, ac-7121`. Note: three standing
contradiction WARNs are ACCEPTED state (tk-7141→ac-7113, tk-7169→ac-7117/
ac-7118 — phase-2 tasks done, their ACs close only with YOUR phase-3 proof);
they clear when the ACs flip at this phase's boundary. Do not "fix" them. This phase closes the plan: the PR evidence surface, the
exemplar/docs truth pass, the archive-move proof, the self-hosting audit,
the blind flow-eval scenario, and the two ruled-in extensions (fences-as-data,
reviews-as-dd). The corpus that proves this phase IS this plan's own.

## Read first (in order)

1. `../../../plan.dd.md` — the ph-7103 section, the six open ACs, Key
   Findings (archive-before-ship, repo-root anchoring, #90 read-from-archive).
2. `tasks.dd.md` (this folder) — 14 tasks, 15 done_when assertions with
   their pressure instruments. The assertions ARE the done bar.
3. `../../../backpressure.dd.md` — bp-7112/7113/7114/7117/7118/7120/7121.
4. `../phase-2/brief.md` + both fence amendments — the discipline carries
   forward.
5. For tk-7168: `../research-flow-eval-history.md` (reuse list §6) if present;
   else `live-testing/` conventions in-tree.

## Task order

`tk-7174` (strict autoRenderSibling FIRST — everything downstream writes
siblings through those callsites) → `tk-7173` (deflake — CI green is the
exit bar; do it early so every later full-suite run is a clean signal) →
`tk-7151` → `tk-7152` (renderer, then ship integration) → `tk-7165`
(archive-move proof — tk-7152 depends on the archive shape being proven) →
`tk-7161` (exemplar upgrade, leaf-first) → `tk-7164` (baked docs regen) →
`tk-7162` + `tk-7163` (chapters/recipes + proof-graph doc) → `tk-7171` →
`tk-7172` (fences-as-data, then reviews-as-dd — review-3 of THIS plan will
dogfood the review schema, so it must land before the review) → `tk-7167`
(self-hosting audit — near-terminal by nature) → `tk-7166` LAST (full
checks + warn-trio baseline at the exit sha).

tk-7168 (flow-eval) can interleave after tk-7161; per Jordan's standing
ruling it is "run it and report on it" — author the scenario properly, run
it once, ledger what actually happened. Do NOT iterate the subject to a
perfect score.

## Hard constraints

- **Fence (allowed paths)**: `harness/cli/src/**`, `harness/cli/test/**`,
  `.dd/schemas/builder/**`, `skills/builder/**`, `skills/the-flow/**`,
  `docs/how/dd/**` (chapters, recipes, exemplar, proof-graph doc),
  `justfile` (recipes for tk-7162 only), `live-testing/**` (tk-7168),
  `.harness/extensions/flow-eval/**` (tk-7168 scoring; SessionEvidence
  lock-step rule from phase-2 amendment 1 still applies),
  `.dependency-cruiser.cjs` (dd/flow rules only, phase-1 amendment),
  `docs/plans/065-deterministic-documents/tasks/phase-1-dd-core-foundations/dd-surface.md`
  (manifest rows only). A file outside this list that a task genuinely
  needs → STOP and send a fence question; do not improvise.
- **Forbidden absolutely**: `docs/plans/071-dd-native-builder/**` (the plan
  corpus is the orchestrator's — EXCEPTION: none; even tk-7167's audit is
  evidence-gathering, report findings to me and I flip states), any
  `the-flow.json`/`the-flow.md`/`.the-flow-state.json` ANYWHERE (fixtures
  create their own in temp dirs), any push, any `npm link` or global-binary
  mutation (machine-global harness is under a prime fence; `just build` for
  local dist only, say so in the report), `docs/how/dd/README.md` beyond
  the chapter-index line tk-7163 owes (the pitch prose is Jordan-tuned —
  do not rewrite it).
- **Archive discipline (tk-7165/tk-7152)**: prove the archive move on a
  FIXTURE corpus in tests. Do NOT archive plan 071's live corpus — the
  real archive-move happens at ship, under my hands, after review-3.
- **Doctrine-parity**: mirrored skills/ blocks stay byte-identical
  (`check:doctrine-parity` gates it).
- **Writer contract** (phase-1 law): mutating verbs validate-BEFORE-write,
  sibling rebuilt same operation, failure = refusal with source untouched.
  tk-7174 brings flow.ts callsites under this same law.
- **Surface discipline**: every new E-code/verb/rel/schema = manifest row in
  the SAME commit; `dd-surface.test.ts` pin adjusted deliberately. tk-7171/
  tk-7172 add builder/fence + builder/review schemas — they are new surface.
- **Control discipline**: every new ERROR/WARN/refusal class gets a
  planted-bad fixture that FIRES (tested, not demonstrated). Dim-0 mutates
  your controls first. tk-7151's unclosed-corpus refusal and tk-7171's
  out-of-fence refusal are the headline controls.
- **Untrusted reading** (F004/F007): renderers and checks never execute or
  trust document-supplied text; findings quoted, not interpreted.
- **Commits**: explicit pathspecs, no --no-verify on your own commits,
  `just fix` before each, measure the checks baseline BEFORE your first
  commit and quote it (warn trio at `ebfb15a3` expected: arch 2,
  markdown 196, windows 6 — markdown may drop as tk-7162/7163 fix docs;
  a DROP is fine and should be quoted, a RISE is yours).
- **Flake**: tk-7173 makes the exec-remote-telemetry-git flake YOURS to
  kill this phase — until it lands, rerun alone before attributing.

## Report shape (pij send to pij-related-koala, pointer to a file)

Line 1 `PHASE3 COMPLETE` (or a fence question / blocker as it arises —
early, not at the end). Then: tasks done, commits (shas + one-line each),
proof per AC with reproduced counts, per-assertion evidence mapping
(dw-000x → test/command), the flow-eval run's ACTUAL results (as-is),
design calls worth the reviewer's eye, out-of-fence sightings (NOT
touched), observations via `harness observe` (leave the buffer undrained).

## Fence amendment 1 (post-dispatch, 2026-08-04 — pij-related-koala, fence issuer)

`docs/how/dd/README.md` is opened for EXACTLY two edits, both tk-7161
consequences: line 39's sample `"done": "#evidence/tk-0201"` →
`"done": "#done_when/tk-0201"`, and line 43's words "evidence list" →
"`done_when` list". No other README bytes — the pitch prose stays
Jordan-tuned and untouched. Rationale: the sample is quoted FROM the
exemplar tk-7161 just migrated; after the alias drop the front-door README
teaches an address the schema refuses. Cause: the fence was written before
ruling A's blast radius was mapped. Expiry: this grant closes with the
phase-3 exit (it licenses these two edits once, not README access).

## Fence amendment 2 (post-dispatch, 2026-08-05 — pij-related-koala, fence issuer)

`docs/plans/065-deterministic-documents/builder-tuning/structural-proof-graph.md`
is opened for the tk-7163 signpost ONLY: the proposed 3-line SUPERSEDED note
at the top, no other bytes. Rationale: tk-7163's task text instructs the
signpost and the fence omitted the file it lives in (defect shape #4, all
mine). The note's "kept as the record of how the design formed; not
maintained" wording is REQUIRED — it marks the rough-out as frozen
provenance so future sweeps stop at it instead of editing it. Cause: fence
authored from the 071 tree view; the signpost target lives in the 065
folder. Expiry: grant closes with the phase-3 exit.

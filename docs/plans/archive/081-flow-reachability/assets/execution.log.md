# Execution log — 081 flow-reachability

## Phase 1 — bundled flight-plan type + fixtures (commit 02c0aa40; doc-truth fix follows)

**Red-first evidence**: bare-create spec observed failing E304, 3/3, before the generator
change (session record; the spec is `harness/cli/test/acts/flow-bundled-flight-plan.test.ts`).
Green after: 3/3, live bare create verified in a skill-less temp repo (ok, 11 nodes, rail
reads back) — **the bare line exists ONLY on the unmerged s081/flow-reachability branch;
on main it returns E304 until this plan ships** (prime's differential control, 2026-08-09:
branch build → ok/11 nodes/gates anchored; main build → E304). Full suite 5178 green at commit time.

### The plan-024 reversal, checkable side-by-side (prime's verification ask, 2026-08-09)

**The superseded contract** — `docs/plans/archive/024-first-class-flow-system/first-class-flow-system-plan.md:86` (AC-11):
> "`the-flow`'s flight-plan schema is **owned + shipped by the `the-flow` skill** and
> supplied to the CLI via `--schema` (no second CLI copy → no drift). … per grill 6/7 the
> bundled set is **shared-core + harness-loop only**; flight-plan and adopt-flow are NOT
> CLI-bundled."

**The new ruling** — Jordan, 2026-08-09 pre-amble (recorded in assets/design-constraints.md):
> Q: "Should s081 bundle flight-plan as a first-class flow type inside the harness CLI…?"
> A: **"that is fine, pij can rely on harness"**

**Strings that still asserted the OLD contract after the implementation landed** (found by
the cross-model P1 retro-review, verified by PM; fixed in the p1-fix-1 change):
1. `skills/builder/references/flight-plan.schema.json:5` (description): "there is NO second
   copy bundled in the CLI (grill 6/7)" — and this exact string was embedded verbatim in the
   generated `harness/cli/src/services/flow/schemas-content.ts`, so the BUNDLE carried a
   description denying its own existence.
2. `skills/builder/SKILL.md:115`: "supplied via `--schema`; nothing is bundled or installed
   into the consuming repo."
3. `harness/cli/src/services/flow/flow-schema.ts:21` and `:153` (comments): "bundled
   built-in (shared-core + harness-loop only)".

**The corrected contract, one sentence (now in all four sites)**: the builder skill remains
the single SOURCE of flight-plan; the CLI carries an allowlisted GENERATED copy (gen-flows,
plan 081, superseding plan-024 grill 6/7) guarded by `check:flows`; bare
`harness flow create flight-plan` works without the skill installed; explicit `--schema`
still wins.

### Deployment claim — stated precisely (prime's ask)

**What this phase claims**: the SOURCE artifacts (in-repo `skills/builder/**`,
`harness/cli/src/**`) no longer assert the reversed contract, and the shipped npm CLI
behaviour (bundle) matches them. **What it does NOT claim**: any live agent's deployed
skill copy changed — agents load `~/.agents/skills/**` (`~/.claude/skills` symlinked), and
repo skill edits go live only via `just install-skills-from-source`. Until a deploy, the
DEPLOYED builder skill still carries the old sentence.

**Consequence for gates**: `check:doctrine-parity` keys on the DEPLOYED the-flow. If it
reads DEGRADED after this change, that is **deploy-lag from a correct fix, not a
regression** — the WARN-LAUNCH posture exists for exactly this window. A future reader of
a degraded parity gate on this branch should read THIS entry, not infer breakage.

## Phase 2 — checkReachability (commit 3a48cd29)

Pair-built (coder claude-opus-5, reviewer gpt-5.6-sol cross-model). Review round 1
FIX_REQUIRED: 1 HIGH (failed child + parseable non-envelope JSON silently validated) —
PM-confirmed at source, fixed fail-closed with the kernel exit/status pairing + status
discriminator, 4 regression tests observed RED first; round 2 APPROVE with Dim-0 mutation
evidence both rounds. Artifacts: assets/reviews/p2-review-*.md. Suite 5183 green.

## Phase 3 — docs, contract, handoff

**The doctrine sweep — eight stale sites, found in three passes by three instruments.**
The p1 retro-review (cross-model) found 4; the coder's *widened* grep found 3 more in
`skills/builder/references/00-routing.md` (:200, :202, :232 — the last flatly asserting
"NOT BUNDLED", two paragraphs from a site we had just corrected); the reviewer's
*independent* sweep with its own terms found the 8th in `docs/how/harness-flow.md:627`.
**Method note worth carrying**: the coder's zero-hit closing sweep was honest and still
incomplete — a second instrument with different terms found more. Agreement between one
agent's two greps is not corroboration; a different searcher is.

**Review round 1 (P3): FIX_REQUIRED, 5 findings, all verified before dispatch.** The HIGH
repeated this session's own lesson — the guide said the bundled type "shipped"/"now" while
`02c0aa40` is not an ancestor of main, teaching a main-branch reader a command that E304s.
Dependency clauses are now attached IN-SENTENCE (guide :13/:26 and pij-contract.md), so a
reader who skips the status blockquote still cannot encode it blind.
One CODE finding: `reachability.ts:209` awaited the injected `ExecPort` with no rejection
guard — a rejecting port threw straight through the documented never-throws contract
(reviewer probed it; PM confirmed at source). Fixed fail-closed (rejection → error verdict,
cause named, clause 2 still read), 5 regression tests observed RED first (all five threw).
Suite 5188 = 5183 + exactly those five.

### Pinning a behaviour that already existed — the red-first variant worth reusing

The revalidation switch could not be red-first in the usual way: **the behaviour already
existed, so a spec written to the true expectation would have passed on the first run and
proved nothing.** The coder instead wrote the spec asserting the **pre-081 expectation**
(both legs take the tolerant skip — what a reader of the old docs would predict) and ran it.
The failure *is* the differential: the control leg (unbundled kind) PASSED under the old
expectation while the bundled leg FAILED, from identical inputs differing only in `kind`.
Then the three assertions were flipped to the true post-081 shape → 6/6 green.

**Generalisable**: when pinning existing behaviour rather than fixing a bug, write the
assertion the *superseded* documentation implies. A green-on-first-run test of current
behaviour is a tautology; a test that first fails against the old belief measures the change.

### Review round 3 — the corrections needed correcting

Two findings that are about the repair work rather than the original defect, and both are
the more valuable half of this phase:

**Our replacements asserted new falsehoods, twice.** The round-2 comment claimed post-mutation
`validateFlowDoc` does not check shared-core chore shape — it does (`flow-schema.ts:301-318`,
already pinned by `flow-chore.test.ts:125-140`). And the new guide told operators a custom
overlay must stay "superset-compatible" while **this plan's own spec proves a strict superset
is the failing case**. A retracted claim migrating into its own fallback, precisely when
attention had moved from the claim to the fix. *Rule adopted for the remainder of the stream:
every replacement sentence names the file:line that makes it true BEFORE it is written, and
replacements are reviewed as hard as originals — a correction is a fresh unevidenced claim.*

**The tenth site is a test that silently stopped testing.** `flow.test.ts:769-839` builds a
fixture it calls the out-of-repo tolerant-skip case, with `kind: flight-plan`. Post-081 that
kind re-resolves to the bundle, so the skip branch is never taken; the test stays GREEN only
because its assertion values happen to sit inside the bundled vocabulary. **Our capability
addition disarmed an existing guard without failing it** — the exact defect class this plan
was filed against, manufactured by this plan. Fleet-level lesson recorded: when a change makes
something RESOLVABLE, sweep the tests that depend on it being UNRESOLVABLE; a green suite
cannot report a test that stopped exercising its branch.

### Review rounds 4–5 — the claim had copies, and the ledger outranked the code

Round 4's citation checks all passed (setNode chain, branch-proof flip reproduced
independently at 4-failed/36-passed, sampled guard entries, no fourth superset site), and its
sweep still found two active false claims. The **eleventh** was `flow-mutations.ts:1046` —
the *third copy* of the omitted-guards claim already corrected in the module header and in
`badNext`. Lesson recorded: **correcting the instance you were shown does not correct the
claim**; a copy-pasted comment propagates exactly like a convention with no propagation path,
which is this plan's own subject wearing a comment's clothes. Every doctrine correction from
here sweeps for the claim's other phrasings and records the sweep result, including "no more".

It also caught a stale row in **this plan's own ledger**: the key-finding still asserted
"pre-081 flight-plan was unresolvable" unqualified after review had narrowed it to the
external-schema/no-repo-overlay case (the repo rung predates 081). Qualified in place with an
explicit superseded-by sentence rather than a silent edit. A plan ledger is read downstream as
CURRENT TRUTH, so a stale row there has more blast radius than a stale code comment.

Site tally for the doctrine repair: **11 stale assertions across code comments, skill docs,
generated bundles, a public guide, a test fixture, and this plan's own ledger** — found by
four instruments (retro-review, coder's widened grep, reviewer's independent sweeps, and the
reviewer reading the ledger), none of which would have found them all alone.

### Two deliberate NON-edits, decided rather than missed

- **Archived plan-024 execution logs still carry the old claim.** Left untouched: an archived
  log records what was believed *when written*; editing it falsifies the record to make it
  look as though we never held the old view. The builder doctrine already states archived
  plans are never authoritative for current behaviour, which is the correct guard here.
- **`flow-mutations.ts:38`'s "only mechanical integrity" string.** Left intact: it is an
  *attributed quotation* of plan 024's grill decision (2), and qualifying someone else's
  recorded decision misrepresents it. It now sits immediately after the corrected guard
  inventory, so a reader meets the real list first.

### The twelfth site was predicted by the premise

The sweep's own find — `flow-apply.test.ts:13`, "the pure functions enforce mechanical
integrity only" — sat in the header of the test file that exercises the very primitives it
misdescribed. It also *justified* its arbitrary fixtures with the false blanket claim, so a
future author reading it would have added a bogus `zone` and hit an `E108` the header told
them could not happen. A false comment does not merely misinform; it can license the next
person's mistake.

### The residue is intentional — read this before grepping

After the repair, the phrase "only mechanical integrity" **still exists in the repo, in
exactly three places, and all three are correct**: the attributed grill quotation
(`flow-mutations.ts:38`), the archived 024 execution logs (historical record), and this
plan's own finding rows (which must quote the false claim in order to describe it).
**A future grep for that phrase will hit, and hitting is correct.** The checkable claim is
*live-claims = 0* — every site that ASSERTED it as current behaviour is corrected — not
*grep-hits = 0*. Stated here so the next reader neither "fixes" a legitimate quotation nor
concludes from the hits that the correction never landed.

### The corrections were wrong in both directions

Worth stating as the phase's closing lesson, because it is the one that generalises past this
guide. The sibling-write claim went: **too permissive** ("warn-only" — it actually returns
`E302` and rolls the source back) → our fix → **too absolute** ("source restored, neither
file changed" — true only when the rollback *succeeds*; when `restoreFlowSource` returns
false, the same `E302` warns the source may be out of step). Two passes, opposite errors, one
root cause: **reaching for an unconditional sentence about conditional behaviour.**

Rule adopted: when correcting a claim about branching behaviour, *enumerate the outcomes*
before writing the sentence — here: both land · refused with the source restored · refused
with the restore itself failed. A correction that reads cleaner than the code usually is a
new claim, not a better one.

## Phase 3 — remaining

Docs guide + doc-truth fix: pair. pij contract: assets/pij-contract.md. DELTA convergence:
blocked by a worktree-fence collision, artifact handed to prime
(assets/standup-deltas.md). #140 corrected:
https://github.com/AI-Substrate/harness-engineering/issues/140#issuecomment-5229610973

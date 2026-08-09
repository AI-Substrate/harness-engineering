# Post-flight close-out — plan 080 (dd consume-upgrade)

**Closed**: 2026-08-09 · **Branch**: `s080/dd-consume-upgrade` (unpushed at close-out)
**Verdict**: complete. All 12 acceptance criteria earned; three phases each
independently reviewed and approved; the dogfood ledger closes at zero silent
workarounds.

## What shipped

Harness stopped carrying its in-repo dd fork. `services/dd` and `acts/dd` are deleted
(261 files), the `harness dd *` verb family is gone, and every surviving consumer takes
dd through the published package at pin `a37a20ec`. Plan semantics — which harness
originally authored and dd had ported — came home as `services/plan-semantics`, a
harness-owned module, under Jordan's ruling that semantic ontology leaves dd.

## Final state

| gate | result |
|---|---|
| `plan validate --complete` | ok — 0 errors, 0 warnings, 0 open, 0 orphans, 0 contradictions over 676 items |
| suite | 294 files / 4,493 tests green (fork-less) |
| `tsc --noEmit` · `just build` · `biome ci` | 0 · 0 · 0 |
| corpus render drift | 0 of 32 |
| dd plan-validate flow gate (review-3) | evaluated ✓ |

## Reviews

| phase | reviewer | outcome |
|---|---|---|
| 1 | terra | APPROVE (0C/0H/0M/1L) |
| 2 | terra | REJECT 0/1/0/1 → fixed → APPROVE 0/0/0/0 |
| 3 | terra | REJECT 0/2/0/0 → fixed → APPROVE 0/0/0/0 |

Task dossiers were `/validate-v2`-reviewed by a separate model before each phase ran;
phase 2 and phase 3 each took a NEEDS ATTENTION round before validating.

## What ships knowingly imperfect

Two degradations, both Jordan-ruled, both named in the PR body rather than discovered:
the untracked-target message is less specific than the fork's was (ruled fine), and the
generated `.dd.md` banner names a command that resolves to coreutils' disk-dump tool
(closer: the dd CLI naming decision now owned by the dd team). Ledger rows 5 and 6.

Also disclosed there: the fork's 261 deletions physically live in `7d112d26`, not in the
logical deletion commit — a shared-worktree commit sweep, ruled accept-not-rewrite, with
the mapping recorded so `git log` archaeology lands somewhere true.

## The standing debt this plan created, owned at birth

Promotion-by-copy left four dd mechanism files (`constants`, `derive`, `rel`, `value`)
duplicated in harness. That drift surface has an owner (the dd-consumption seat), three
triggers (re-pin diff, the re-aimed `dd-fork-divergence` detector, dd's reciprocity
rule) and a named sunset (dd's mechanism-vocabulary seam). See the ledger's
drift-surface section — it is the one thing a future reader must not lose.

## Harness feedback

Four retro records (`.harness/records/retro/2026-08-09/001..004`), 16 entries. The
highest-leverage improvement, named at harvest and **offered, not assumed**: every gate
and probe should report the population it examined, not just what it found — six
distinct instances of that failure occurred inside this one plan. The shipped exemplar
already exists: markdown-lint's `unexamined` check and its `examined` denominator.

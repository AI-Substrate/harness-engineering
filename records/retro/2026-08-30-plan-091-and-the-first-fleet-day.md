# Retro — plan 091 and the first fleet day (2026-08-30)

The first full run of the pij-team way of working in harness-engineering: one PM
(coral) + three coders (vulture, turtle; later condor, cicada, armadillo across
sibling packets), prime governing. Shipped to main: #184 (ddocs bump), #185
(settings + convo sync), #187 (collision-skip), #188 (dispatch fix). Conversation
sync live, confirmed end-to-end by three governments (harness-engineering, fs3,
dd).

## What the run proved

A packet can go freeze → numbered ack → RED → mutation → receipts → independently
verified close **without a single unverified claim reaching the prime**. Coral
re-ran every unit's tests itself, diffed every commit's scope, and took nothing
on report. That discipline caught nothing catastrophic — and that IS the result:
it was cheap enough to run every time, so it was run every time.

Two design decisions paid measurably:
- **transcript_path never entering the flow** made the PII review three greps and
  a positive control — "it was never there" beats "redacted everywhere".
- **Freezing the seam before fan-out**, then refusing to unfreeze it twice under
  pressure (sync ping; U2's shape). Both cheap-looking changes would have
  reopened a delivered, mutation-proved unit.

## The packet's law — the run's real finding

**Dispatch is not delivery; exit 0 is not evidence.** Nine instances in one day,
escalating in kind:
1. a degenerate RED (failing for a missing module, not the assertion)
2. stub-greens never seen failing
3. a pane footer showing `high` for a model the provider was rejecting
4. a status named "fired" for a thing not observed
5. a ping proving "process ran", not "daemon answered"
6. **in the tool**: commit-service.ts:496's "…landed, SO the collector recorded
   this commit's authorship" — an inference dressed as an observation, inherited
   verbatim by a careful reader into a report to prime (backlog 13)
7. **structural**: fire-and-forget made a child's death unobservable BY
   CONSTRUCTION — even the honest word "dispatched" was too strong for the
   design; the fix raised the ceiling (DOA detection) rather than lowering the
   claim
8. the hotfix's own draft inverted it: alive-only detection reported FAILURE on
   success — same instrument, opposite lie, caught only by read-back
9. one layer out (dajeil): fs3 accepts ingests for nonexistent sessions —
   "validated-at-accept is not validated at all" (row 22, second instance)

Instance 6 is the one to remember: an overclaim encoded in a harness propagates
with the harness's authority. The first five were people claiming too much; the
sixth was the tool teaching them to.

## The fixture rule — one level above the probe rule

**A fixture that isolates by removing things removes triggers too.** The 091
smoke's synthetic HOME correctly isolated the store and, in the same stroke,
deleted the pij registry — the exact trigger of the --pij bug. A CORRECT
out-of-band control passed a broken build with every signal genuinely green.
Ask not only "can my probe see the failure" but "what does my fixture make
impossible". (Confirmed twice in one packet: the DOA draft's fixtures had dead
and alive children, never the fast-successful child the real daemon exhibits on
every healthy fire.)

## Read the producer's log (dajeil's, with the failure attached as asked)

The argv refusal sat verbatim in .harness/temp/convo-sync.log while a perfect
discriminator was built around it. **Read-back proves a claim wrong; the
producer's log says why; neither substitutes for the other.** The fix's logPath-
in-envelope exists so the next caller cannot repeat the omission. Keep the log
file that now carries both eras — the refusal with its fix's success beneath it.

## Both columns (coral's, recorded as the sequence it asked for)

Four wrong calls by the PM in one day — a runtime misdiagnosis argued past its
own contradicting evidence; an overclaim inherited verbatim from the tool; an
exported HOME poisoning a persistent shell; a canary suggestion retracted within
the hour after a second sample. **Each caught by a check, none by luck, and each
check taught by an earlier failure of the same shape.** The lessons compounded
within one session; that compounding is the way of working's actual value.

## Scope blindness

Green focused run + green fast suite + red full scope, all true simultaneously
(the duplicated ordered command-list fixtures, row 18; the CI-only load flake,
row 19). Strongest argument in the packet for the PM-owned closing gate that
nobody delegates.

## Cross-government yield

fs3's row 98 (envelope echoes request, not result) and our commit-service:496
are the same defect in two products, found the same day by two fleets. The
daemon-key error — which names the path it could not read — is the shared
acceptance pattern for fixing both. The symmetry pact stands: whichever side
lands its honesty fix first sends the shape; the other mirrors it.

## Standing changes made during the run (all pushed same-day)

The packet's law + error-text corollary + grep-false-absence instance + read-the-
producer's-log · the fixture rule · scoped-env-never-export · the pinned spawn
form (cwd via `cd <wt> &&`; --bin omp mandatory for -1m) · builder-by-invocation
with Simple Mode scoping ("invented compliance is the dangerous failure") ·
named-windows · fs3 dogfood as standing ritual · 22 backlog rows.

## Roster

coral: first-pick PM (lynx concurring) — law-naming, self-application, upstream
contract proof. vulture: encoded the law as executable mutations unprompted.
dajeil (external): the discriminator, the log lesson, and row 22's framing.

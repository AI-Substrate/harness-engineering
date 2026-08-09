# The scope-promotion claim family — enumeration AND the stop

**Written**: 2026-08-09, before the Phase 3 commit, at prime's instruction, because *the
enumeration alone invites someone to resume the hunt and the stop alone reads as
abandonment.* Read both halves.

## The class, in one sentence

> **A function-scope truth stated as an act-scope persistence claim** — true at the scope
> the author was thinking in, false at the scope the reader is standing in.

The crispest instance: `applyBatch` genuinely *is* a no-op at function scope — no event, no
mutation — and its docblock promoted that to "**no write**". The act contradicts it 155
lines below, in its own inline comment: "*the act writes byte-identical bytes*". Two
true-at-different-scopes statements, same file, 155 lines apart, both shipped.

**Why nothing caught it**: no instrument we own compares prose to prose. Tests compare code
to behaviour; drift guards compare generated files to their sources; lint compares text to
style. A docblock contradicting an inline comment in the same file is invisible to all of them.

## Located instances and their dispositions (complete as of this commit)

| # | Site | Claim | Disposition |
|---|---|---|---|
| 1 | `acts/flow.ts:234-241` | "either-both-or-neither", "source untouched" | **Landed** — rider v3 via koala's s080 commit (fenced file; s081 never opened it) |
| 2 | `acts/flow.ts:958-966` + the `apply` `.description()` | "transactional … one atomic write or none" — **also emitted verbatim by `harness flow apply --help`** | **Open on #142**, with prime's caveat written in: the *text* fix is lifted out and landed alone if the code repair stalls |
| 3 | `flow-mutations.ts:1462-1467` | "(the act) write once or not at all" | **Fixed here** — "transactional" scoped explicitly to the in-memory function; persistence described at act scope |
| 4 | `flow-mutations.ts`, next sentence | "byte-identical **(no write)**" | **Fixed here** — the write still happens; it is the bytes that do not change |
| 5 | `docs/how/harness-flow.md` ×4, `00-routing.md` ×2, `flight-plan-ops.md` ×2 | whole-verb "atomic" / "transactional" | **Fixed here** — "atomic" reserved for the forward source write; the sibling refresh named as outside that atom |

Related but **not** this class, deliberately untouched: the SDD `plan` verb's "atomic pass"
(a different subject), archived plan logs (historical records), attributed grill quotations,
and this plan's own finding rows (which must quote the false claims to describe them).

## Why the sweep ended here

Prime's standing termination ruling: **a review loop ends when a round returns only findings
that are neither (a) a correctness defect in the changed code, nor (b) a control that does
not fail when it should.** The remaining instances are pre-existing prose in files this plan
did not change — and in one case is fenced out of. They are neither (a) nor (b). The loop
was terminated **by rule, not by patience**.

The one genuine *correctness* finding this family produced — the non-atomic rollback that
falsifies all of it — is filed as **#142** and is not blocked by this plan closing.

## The boundary — the class only bites on the SUCCESS path

Found by the closing stranger-read, and it is the most useful thing in this document because
it bounds any future sweep. Every **surviving true** claim in `flow-mutations.ts` (six of
them: `:26-28`, `:306`, `:625-626`, `:690`, `:731-737`, `:1050`/`:1302`) describes the
**refusal** path. Both **false** claims described the **success** path. That is mechanism,
not coincidence:

> On a refusal the act short-circuits before writing anything, so function scope and act
> scope **coincide** — a module-level "nothing is written" is true at both. On success the
> act keeps going: forward atomic write → sibling render/write → possibly an ordinary
> non-atomic restore. That is where the two scopes **diverge**, and it is the only place a
> function-scope author can be wrong about act-scope persistence.

Sharper form of the class: **act-scope persistence claims made from function scope are only
unsafe when they describe what happens AFTER a mutation succeeds.**

This also explains why the family was hard to see: the file is *full* of true "nothing is
written" sentences. Two false ones sat among six true ones **with identical vocabulary** —
and vocabulary is what a reader (or a grep) keys on. The discriminator is not the words, it
is **which branch the sentence is about**.

**Mechanical handle for any follow-up sweep**: grep for persistence claims, then keep only
those whose subject is a *succeeding* operation. The rest are noise and will bury the real
ones, exactly as they did here.

## Where new instances go

**#142** while it is open (the help-text instance already lives there, and new ones are the
same cause); a fresh issue citing this file once #142 closes. **Do not re-open a sweep** —
the class is known, the located set above is complete as of this commit, and the surface
classes to search are enumerated below. Re-deriving this list is waste.

## The two method rules that found the last three

1. **A sweep is bounded by the surfaces it searches, not by the claim it is chasing.** A doc
   sweep cannot close a claim originating in code, and derived surfaces (`--help` output,
   bundled docs) inherit the falsehood invisibly. Surface classes to enumerate before
   declaring any claim family closed: **source comments · help/description strings · bundled
   or generated docs · skills references · test headers · diagrams**.
2. **Re-read the whole docblock/paragraph as a stranger before touching the named clause.**
   A fix packet names one clause and the reader's eye goes to that clause — so the
   surrounding prose inherits the same exemption a reviewed range gets. This is the coder's
   own rule, applied unprompted, and it caught instances 4 and 5 at no cost.

# Guard evasion catalogue

A running list of ways a **control can stay green while the claim it enforces is
false**. Consult it when writing or reviewing a guard, and name in the review
request which entries the guard was attacked with — **and which it was not.**

The "was not" half is the point. It is the guard's documented blind spot, in the
same form issue #111 documents the limits of its grep predicate.

## The rule that decides whether a guard can ever be finished

> **A guard that enumerates BEHAVIOURS cannot terminate. One that enumerates
> ENTITIES can.**

Enumerating *the ways a function can be called* is open-world: every round closes
the forms someone thought of, and the next reviewer names one nobody did.
Enumerating *the references that exist* is closed-world and terminates. When a
guard keeps needing another round, that is usually the instrument, not bad luck.

Reached independently three times in this repo, from three directions: #115 (a
caller guard built twice and removed), #129 (the separator class — *"construction
sites are entities and are findable by lint"*), and the funnel analysis behind
this catalogue.

## The catalogue

| Evasion | Defeats | First seen |
|---|---|---|
| aliased named import (`import { x as y }`) | any regex keyed on the original spelling | #108 PR 1 |
| re-export through an EXISTING package key | assertions on export-map *keys* rather than reachability | #108 PR 1 |
| local value flow (`const f = Ns.sym; f(...)`) | callee symbol resolution | #108 PR 1 |
| literal indexed access (`Ns["sym"](...)`) | identifier/property matching | #108 PR 1 |
| computed string key | all static name matching | #108 PR 1 |
| destructured literal dynamic import | callee resolution | #108 PR 1 |
| dynamic `import(someVar)` | static import scans | not yet observed |
| `require()` of compiled output | source-tree analysis | not yet observed |
| generated / emitted code | walks scoped to the source tree | not yet observed |
| **a filter that discards every candidate** | corpus / walk assertions | #108 D6 (Windows) |
| **a filter that discards a legitimate CLASS by design** | every assertion downstream of it | dd-consume trial |
| a walk returning `[]` on a missing directory | total-count assertions | `history-md-guard` |
| a wrong path returning a clean miss | the reader, who stops there | #108 coordination |

**The catalogue is incomplete by construction.** It contains what has been
*found*. It is a floor that rises, never a proof of coverage — treat "not in the
catalogue" as "not yet observed", never as "cannot happen".

## Three rules that make this a control rather than a document

1. **Every new guard's review request names which entries it was attacked with,
   and which it was not.**
2. **Any new evasion found anywhere joins the catalogue**, at the moment of
   discovery — when the evidence is in hand and the motivation is highest. A
   catalogue updated at retrospective time is a catalogue nobody updates.
3. **A guard with a documented blind spot is worth having. One with an
   undocumented blind spot is the thing this catalogue exists to prevent.**

## Two entries that deserve their own explanation

### A filter that discards a legitimate class BY DESIGN

The hardest member, because nothing is broken.

```ts
if (!spec.startsWith('.')) continue; // a package, not a path into this tree
```

Correct while the dependency is in-tree. The moment it is consumed **as a
package**, the same line silently retires the entire boundary — and every
assertion downstream still passes, because the remaining in-tree imports keep the
counts healthy.

Observed live: a dd-consume trial rewired an act to import `dd` from a package,
and the architecture guards stayed **12/12 green with the boundary crossed**. Two
guards share the mechanism (`flow-dd-sdk-seam.test.ts`,
`dd-core-isolation.test.ts`), so **they must be fixed as a pair** — a cleanup that
fixes only the one named in an issue leaves the other.

**The defence is to count what was EXAMINED AND EXCLUDED, not what survived:**

> "N specifiers, of which M were packages I chose not to resolve."

A survivor count stays healthy on the strength of the remaining in-tree imports
and says nothing about the category it never considered. An exclusion count forces
that category into the open.

### Where a non-empty assertion goes

Not on the walk, unless the walk is the only narrowing stage.

> Assert non-zero at the **last narrowing stage BEFORE the predicate whose
> emptiness means PASS.**

The precision matters: most guards are "no offenders" shaped, so the *final*
filter going to zero is the GREEN state. "Assert the last stage is non-zero" would
invert them.

## Printed denominators are an aid, not a control

Each guard prints what it examined on success:

```
dd-core isolation — examined 10 entry file(s), 20 specifier(s): 20 resolved,
  0 package(s) NOT resolved (out of scope while dd is in-tree), 0 violation(s)
```

**Print the number; do not assert it.** An asserted denominator churns on every
file added, and a floor is a threshold nobody maintains — both rot, and a red that
is usually spurious trains people to bump the number without reading it. A guard
people edit reflexively has stopped being one.

**And be exact about the limit: this makes quiet narrowing VISIBLE, it does not
CATCH it.** The funnel assertions catch collapse-to-zero; a guard sliding 300 → 3
is legible in the log and detected by nobody, because nobody reads green output.
Closing that properly needs state — a committed denominator, reviewed on change —
which is deliberately out of scope here.

---

# The same class, applied to CLAIMS

Every entry above is a control that stays green while its claim is false. The same
failure happens to **claims passed between people**, and it is worth cataloguing
here rather than in a PR body — a PR body evaporates on merge, and this file is
the durable artifact.

All of these were observed in a single stream (#108), by three separate parties,
in two days.

## 1. Scope is not a tree

A landing was cleared on the basis that two changesets were disjoint. The check
compared one party's **declared scope** against the other's file list — but the
branch had moved past that scope, and the collision was in the part that moved.

> **Collision is a property of trees, not of task lists.** A scope is what someone
> said they would do, once. A branch is what exists now, and it moves while you
> are not looking.

Two later variants of the same error: applying a merge-shaped rule to a branch
that is not trying to merge, and grouping work by its **issue label** rather than
by **what it touches** — a `D`-tier label routed a `src` fix to a test-portability
branch. *The label is a filing convenience; the target is the fact.*

**Corollary, and the cheaper rule: the owner of a tree is the only party who can
answer a question about that tree.** Three times in one day the answer came from
the owner — branch collisions, a file's location, a release gate — and each time
the re-derivation had been plausible and wrong.

## 2. A label makes a claim recoverable, not true

An unverified claim was received, honestly labelled — *"X checked this; I have not
re-derived it"* — and then relied on anyway.

> **A label protects the author, not the reader.** The claim keeps travelling at
> full weight while the caveat stops being read.

The practical rule is not "label harder": **a claim you are about to ACT on needs
a probe, not a caveat.** If the probe is expensive, the decision that depends on it
is the thing to defer — not the verification.

## 3. A hedge does not survive being copied

Distinct from (2), and worse, because nobody ignored anything. A finding began as
`NEEDS-RULING` in a sweep, was carried into a task file, then into a second, then
into a PR spec — and by the third hop it was a **finding with a file name
attached**. The qualifier was dropped by transmission, because a hedge is the
least interesting part of a sentence to copy.

> **Every hop strips the caveat and keeps the claim.** A hedged finding and a
> confirmed one look identical after two copies.

The observed instance was false: a file was reported as carrying a defect it did
not have. It cost a real investigation to unwind.

**A claim that travelled needs a correction that travels the same distance** — in
the same artifacts, not just in the head of whoever found it.

## 4. A true conclusion from a wrong premise is never audited

The purest member, because it has **no failure signal at all**.

A claim was made by inferring a release from one's own landing. The claim was
**correct** — the other gate had in fact cleared. The inference was still wrong: it
read *"waiting on you"* as *"you are the only gate"*.

> **Nobody audits a claim that turned out right.** So the reasoning survives intact
> and fires again somewhere it does not hold.

This is the guard class exactly: a guard reporting PASS having examined nothing is
dangerous because **the output is indistinguishable** from one that examined
everything. A correct conclusion from a broken inference is the same defect at the
level of reasoning — **the agreement is what stops anyone looking.**

Companion instance the same day: a `grep` result that agreed with a static reading.
The danger was never a wrong answer; it was the agreement suppressing the second
look.

**The only routine that catches it: when a claim of yours turns out right, ask
whether your REASONING was.** Outcome does not validate inference.

## 5. An accurate observation can substitute for an unasked question

A symptom was reported precisely and truthfully — *"this work is finished and
sitting behind that branch"* — and the cause was never asked. The branch was not
stalled; it was an iteration branch that was never going to merge.

> **A correct symptom report reads as a completed diagnosis to whoever receives
> it**, and nothing in it announces the substitution.

## 6. A wrong path returns the same empty result as a correct one

A guard was asked about using the wrong directory. The search returned clean.

> **A clean miss reads as "no such thing" to anyone who stops there.** An empty
> result from a wrong probe is indistinguishable from an empty result from a right
> one.

This is why every enumeration should report **what it probed** beside **what it
found** — the same discipline the printed denominators above exist to serve.

## 7. Sentences that read correctly to their author

*"Written and waiting on you"* is ambiguous between **"you are a gate"** and
**"you are the last gate"**. The author knew which they meant and did not say it.

> A sentence that reads correctly to its author and admits a second reading
> downstream produces **confident wrong action with no error anywhere**. Cheap at
> the source, expensive at the destination.

Operational form: **state which gate you are.**

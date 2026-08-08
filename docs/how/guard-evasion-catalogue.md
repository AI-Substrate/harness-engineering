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

# dd — follow-ups from Jordan's exemplar taste call (2026-08-04)

Raised by Jordan while reading `exemplar/plan.dd.md` and
`exemplar/tasks/phase-2/tasks.dd.md` during the `bp-0902` taste call. Both are
**render-surface** items: the data model is not in question, the human-facing
view is.

---

## FU-1 — State cells should render as checkbox tokens, not pips + words

**What Jordan said:** "for state checked, not `checked` etc — have `[]`, `[x]`,
`[-]`, `[~]`".

**Today:** `renderer.ts:42-46` renders four pips borrowed from the flow rail,
each followed by the state word:

| pip | constant | meaning | renders as |
| --- | --- | --- | --- |
| `◆` | `PIP_TERMINAL` | state is in the schema's gate-terminal set | `◆ checked` |
| `◇` | `PIP_HOLDS` | any non-terminal, non-blocked state | `◇ unchecked` |
| `✗` | `PIP_BLOCKED` | state is `blocked` | `✗ blocked` |
| `◐` | `PIP_PARTIAL` | derived progress, partially complete | `◐ 3/5` |

**Wanted:** the familiar markdown task-list vocabulary — `[x]` done, `[ ]` open,
`[-]` blocked/dropped, `[~]` partial — so a plan reads like a plan instead of
like a machine dump.

**Ruled (Jordan, 2026-08-04): PREFIX, the word stays** — "yeah keep `[x] shipped`
thanks". A schema may declare its own state vocabulary (workshop-002 Ruling 2),
so a bare `[x]` would collapse `shipped`, `waived` and `approved` into one
indistinguishable mark. The mark answers "does this pass the gate?"; the word
answers "what does it say?". Both are needed.

**Status: DONE.** `renderer.ts:42-52` carries the four marks; the two emission
sites already prefixed, so no call-site change was needed. `[ ]` uses the
standard GFM single-space form.

**Blast radius (dd only — the flow rail is a different renderer and out of
scope):** 13 files — `renderer.ts` plus 9 test/golden fixtures under
`harness/cli/test/services/dd/render/`, the 3 exemplar `.dd.md` renders, and
`docs/how/harness-dd.md`. Small and mechanical once the token question is
settled; the goldens are the gate.

---

## FU-2 — Section headings render the machine id, not a human title

**What Jordan said:** "sections are called `non_goals` in the title in the page.
That looks machiny. I think we need `section_id` and `section_title` as separate
fields."

**Today:** `DdSection` (`core/model.ts:17-21`) carries exactly one name:

```ts
export interface DdSection {
  name: string;
  value: unknown;
}
```

and `renderer.ts:433` emits it directly as the heading:

```ts
blocks.push(`## ${section.name}\n\n${renderSectionBody(section, deps)}`);
```

So the schema key **is** the human heading: `non_goals`, `acceptance_criteria`,
`execution_log`. One identifier is doing two jobs.

**Wanted:** split them — `section_id` (the machine key, stable and addressable)
and `section_title` (what a human reads, e.g. `Non-goals`).

**Why this is a design change, not a rename — READ BEFORE IMPLEMENTING:** the
section name is currently load-bearing for *addressing*, not just display.
`anchorFor` computes `headingSlug(section.name)` (`renderer.ts:154,161`), and
every cross-document link in the corpus resolves to that slug. Change what the
heading says and you change every anchor — `plan.dd.md#non_goals` becomes
`#non-goals` — silently breaking links that `dd doctor` would then report as
dangling.

**The rule that keeps it safe:** anchors must stay derived from `section_id`
(the stable machine key), never from `section_title` (the human-editable one).
That means the render needs an explicit anchor rather than relying on the
heading's own implicit slug — an `<a id="…">` or equivalent, so the title is
free to change without moving the address. That is the actual work; the field
split is the easy half.

**Also in scope when this lands:** `section_title` is optional by definition (a
schema that omits it falls back to the id, so no existing schema breaks) and
should be declared in the schema, not the document — the title is a property of
the section *kind*, the same place `gate_terminal` lives.

---

---

## FU-3 — An array-of-links cell rendered as plain text (DEFECT — fixed)

**What Jordan said:** "in the execution logs, the links col is not a link i can
click to the other doc".

**Not a taste item — a real defect.** `builder/execution-log` declares the
column honestly:

```json
"links": { "type": "array", "items": { "type": "link" } }
```

but `renderCell`'s link branch was guarded by `typeof value === 'string'`, so an
**array** fell through to `renderContainer` — which took no shape at all and
bottomed out in `renderScalar`. The declared `items: {type: 'link'}` was
silently discarded. The undeclared-address *inference* (the A3 path) never
reached container elements either, so both routes to a link died at the array
boundary.

**Fix:** thread the shape through `renderContainer` (`shape?.items` for arrays,
`shape?.fields?.[key] ?? shape?.valuesShape` for records) and apply the same
link rule per element that `renderCell` applies to a scalar — declared `link`,
or undeclared-but-address-shaped.

**Coverage gap this exposed — the important part.** After the fix the whole dd
suite was still 265/265 green. A behaviour change that moves no test means the
behaviour was never tested: **no fixture exercised an array-of-links at all.**
The new regression test in `renderer.test.ts` closes it.

That test then caught itself being a self-defeating probe (DL-008, third
recurrence in this plan): the first draft asserted on a `.dd.json` target, which
**address inference alone** renders as a link — so dropping the declared-shape
pass-through left it passing, proving nothing about declaration. The mutation
run is what exposed it. It now targets a **non-`.dd.json`** file, which
inference explicitly refuses, so only honouring the declared shape can make it
pass. Mutation-proven twice: dropping the shape pass-through fails it, and
disabling the container link branch fails it.

**Standing lesson:** when a fix changes behaviour and the suite does not move,
that is a coverage finding, not a clean bill of health.

---

## FU-4 — `<gitroot>` in the schema precedence chain is actually `cwd` (DEFECT — NOT fixed, needs a ruling)

**Found while verifying FU-3**, not reported by Jordan. Running the documented
command from the exemplar's own folder fails:

```
$ cd docs/plans/065-deterministic-documents/exemplar
$ harness dd build plan.dd.json
E401  schema "builder/plan" was not found in any discovery root
      (…/exemplar, …/exemplar/.dd, …/exemplar/.harness/.dd, ~/.dd)
```

The same command from the repository root succeeds. Note what the root list
says: the `<gitroot>` entry resolved to the **document's own folder**.

**Cause:** the repo root is taken from the process's cwd, in two places —
`acts/dd/build.ts:270` and `acts/dd/shared.ts:204`
(`createLinkContext`, which every other dd act uses):

```ts
const repoRoot = toPosix(new NodeProcess().cwd());
```

So the precedence chain the docs promise — doc-folder → `<gitroot>/.dd` →
`<gitroot>/.harness/.dd` → `~/.dd`, stated in `dd-overview.md`,
`how-to-add-a-schema.md`, and asserted by `ac-0201` — only holds when the
operator happens to be standing at the repository root. Anywhere else,
`<gitroot>` silently means `cwd`.

**This is the cwd-anchoring class in its FOURTH home** (P2 test fixtures, P3/P4
CLI-spawning tests, P6 flow-gate resolution, now dd schema resolution). Same
rule each time: *a persisted repo-relative reference must resolve against the
artifact that persisted it, never the invoker's cwd.*

**Fix shape (reuse, do not reinvent):** P6 already built the idiom —
`docRepoRoot(flowPath)` in `acts/flow.ts` walks to the nearest `.git`, and
critically handles a **worktree's `.git` FILE** as well as a directory. That is
why this reproduces so cleanly here: this branch is developed in a worktree, so
`.git` is a 102-byte gitdir pointer, not a directory.

**Why this is NOT fixed here, and needs a decision:** `repoRoot` is not only a
resolution root — it is also the **containment boundary**. It feeds
`isWithin(repoRoot, documentPath)` in `build.ts:81`, `isPathWithinRepo` in
`core/validate.ts` and `core/walk.ts`, the `path-escape` guard in
`schema/scan.ts`, and the doctor's sweep scope. Widening it from cwd to the true
git root **widens what dd will read and traverse**. That is a security-relevant
change to shipped behaviour and belongs in a reviewed round with its own
mutation tests, not in a post-ship touch-up.

**Recommendation:** fix it, in a small dedicated round — derive the root once via
the P6 `.git`-walking idiom, share it between `build.ts` and `createLinkContext`
(they currently duplicate the same wrong line), and mutation-prove both the
resolution win and the containment boundary. Until then `dd build` must be run
from the repository root.

---

## Status

**FU-1 and FU-3 are done** (implemented, mutation-proven, exemplar regenerated).
**FU-2 and FU-4 are noted and unresolved** — FU-2 because Jordan asked for a
note, FU-4 because it changes a containment boundary and wants review.

All four are **post-ship on PR #87**. FU-1/FU-2 are taste; FU-3/FU-4 are
defects, and FU-4 is a defect in what already shipped.

`bp-0902` stays `unchecked` until Jordan reads the regenerated exemplar and
rules on FU-2/FU-4.

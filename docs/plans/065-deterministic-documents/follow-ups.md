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

### Status: DONE (Jordan, 2026-08-04 — "define them in schemas so they auto generate, but also allow agents to name them custom")

Shipped as a **three-tier** title, rather than the two fields the note first
proposed — the extra tier is the auto-derivation, which means no schema has to
change to stop looking machine-generated:

1. the **document's** `sections[].title` — an author naming this one section;
2. the **schema's** `sections.<name>.title` — every document of that kind, free;
3. **derived** from the section name — `non_goals` → "Non goals".

No `section_id` field was added, and deliberately so: `name` already *was* the
id, so adding a second identifier would have created two things to keep in sync
for no gain. The fix was to stop `name` doing the *display* job, not to rename it.

**The anchor problem the note warned about is solved by an explicit anchor.**
Every section now emits `<a id="<slug of name>"></a>` above its heading, so the
address is stated rather than inferred from heading text. `#non-goals` resolves
identically whether the heading reads "Non goals", "Non-goals", or "What we are
deliberately not doing" — proven by a test that renders all three tiers and
asserts one anchor, plus that the three renders genuinely differ (so the
assertion cannot pass by them being identical).

It is emitted **unconditionally**, not only when the derived slug would differ.
An address that exists sometimes is worse than one that always exists, and it
must not depend on a coincidence between a heading's words and a section's key.
Cost measured: zero markdown-lint findings (199 before, 199 after — generated
`.dd.md` files are outside the lint scope).

**Touched:** `core/model.ts` (both interfaces), `core/parse.ts` (document tier),
`schema/declarations.ts` (schema tier), `render/renderer.ts` (precedence +
anchor). The `declarations.ts` change is the **same allow-list that silently
dropped `valuesShape` in OD-8** — a section key absent from that constructor is
discarded without a word, so it now carries a comment saying so.

**Five mutations, all caught** — and the first run of them found a hole: the
renderer-side test for the schema tier hands `renderDd` a hand-built
`ResolvedDdSchema` and never runs the schema parser, so deleting the parser's
allow-list entry left it green. The parser tiers are now pinned in
`schema/declarations.test.ts` and `core/parse.test.ts` instead, and the
renderer test carries a comment saying exactly what it does *not* prove.

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
$ cd docs/how/dd/exemplar
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

### A sharper repro landed later — `exemplar/custom-render/`

The self-contained corpus added for Jordan (its own schema + adapters, nothing
registered anywhere) reproduces this harder than the E401 above, because the
**same unmodified document returns three different verdicts** depending only on
where the operator is standing:

| cwd | `dd validate release.dd.json` |
| --- | --- |
| repository root | `ok` — 0 errors, 0 warnings |
| the document's own folder | `degraded` — 5 `address-path-escape` warnings |
| `exemplar/` (its parent) | `error` — E401, `builder/plan` not found |

This is the more useful repro for whoever fixes it because it exercises **both
halves** of `repoRoot`, not just resolution:

- from the doc's folder, the containment boundary shrinks to that folder, so
  the legitimate `../plan.dd.json` links read as escaping the repository — the
  `path-escape` guard firing on correct data;
- from `exemplar/`, resolution and containment fail *together*: the document's
  own `release/gate` schema still resolves (doc-folder root), but the
  depth-walk reaches the linked `../plan.dd.json` and cannot resolve
  `builder/plan` for it, because that package lives at the true repo `.dd/`.

**A verdict that changes with cwd is the whole bug in one line.** Whatever the
fix is, this table is its acceptance test: all three rows must read `ok`.

**Do not "fix" the corpus to make the warnings go away** — the folder is
deliberately left reproducing until FU-4 lands.

### Adjacent, smaller (FU-4a): `dd schema list` has no doc-folder root

`harness dd schema list` reports only the gitroot / harness / home roots — the
doc-folder root is structurally absent, because `list` has no document to anchor
on. Run from `custom-render/` it therefore lists **zero** schemas, while a
document in that same folder resolves `release/gate` without trouble.

That is defensible behaviour (no document, no doc-folder root) but it is not
what "which schemas resolve from here" implies, and `list` is the command a
reader reaches for when resolution surprises them — the one moment it is
guaranteed to under-report. Either state the limitation in `next_action`, or let
`list` take an optional document path to anchor on. Worth folding into the FU-4
round since it is the same precedence chain.

---

## FU-5 — A task's explicit `state` is never reconciled against its evidence (DEFECT — open)

Found by `pij-solid-parrotfish` while documenting derived state; **independently
reproduced here**.

`docs/how/harness-dd.md` says task state is derived and "nothing is
self-reported". It is not true as written. A task may carry an explicit
`state` that flatly contradicts the evidence it points at, and validation is
silent:

```json
{ "id": "tk-0001", "state": "checked", "done": "#evidence/tk-0001" }
{ "tk-0001": [ { "id": "dw-0001", "state": "unchecked" } ] }
```

`harness dd validate` → **`ok`, 0 errors, 0 warnings.** The render then places
the two side by side in the same row:

```
| tk-0001 | claims done | [x] checked | … | [ ] 0/1 [tk-0001](#tk-0001) |
```

So the *summary* is genuinely derived, but an explicit `state` field sits
beside it unreconciled — and the honest reading is that a document can assert
"done" over evidence that says otherwise, which is precisely the failure dd
exists to prevent.

### RULED (Jordan, 2026-08-04): WARN — and only when evidence is actually cited

My first framing of this was too broad, and Jordan corrected it: **not every
checkable thing has evidence.** A reminders list, a simple checklist, a row
someone ticks — these are legitimate dd documents, and there `state: checked`
standing alone *is* the truth. Complaining about a self-reported state in
general would make the common case noisy for no gain.

The defect is narrower. It exists only when a row **cites** evidence and then
contradicts what it cited:

```json
{ "id": "tk-0001", "state": "checked", "done": "#evidence/tk-0001" }
   evidence tk-0001 → [ { "id": "dw-0001", "state": "unchecked" } ]
```

That is not self-reporting — that is a claim pointing at its own proof and
disagreeing with it. The document has already told us where to check.

**So the rule is conditional, and the condition is the whole ruling:**

| the row | verdict |
|---|---|
| explicit `state`, no evidence link | **silent** — nothing to reconcile against |
| explicit `state`, cites evidence, agrees | silent |
| explicit `state`, cites evidence, **contradicts it** | **WARN** |

WARN not ERROR: the disagreement is often transient and legitimate mid-work (a
task marked done before its last evidence row is filled in), so it must be
visible without blocking a build. ERROR would make the honest intermediate state
unrepresentable.

Implementation notes for whoever takes it: the WARN belongs in the validate
layer beside the other link-class findings, and it needs a new code — but
**E430-E439 is full**, so this is a genuine block-extension decision rather than
a free addition. It must also degrade quietly when the evidence link is
*unresolvable* — a dangling link is already its own finding, and reporting both
would double-count one defect.

The documentation half is already fixed: `dd-overview.md` no longer claims
"nothing is self-reported" and now says the derived summary is the one backed by
rows.

**Method note worth keeping:** my first reproduction probe was malformed and
failed on an unrelated missing required field, which reads as "cannot
reproduce". A probe that cannot see the thing it is testing returns an artifact
of itself. The peer's probe was the better one.

## FU-6 — `dd doctor --path` does not sweep into a `sweep_exclude` directory (DEFECT — open, reported not reproduced)

Reported by `pij-solid-parrotfish`; **I have not independently reproduced this
one.** The old guide says pointing `--path` inside an excluded directory sweeps
it anyway. Observed: a `sweep_exclude: true` probe was *discovered* but still
reported `swept=0`, while a direct `dd validate` on the same file failed it as
expected. Only the positional `.harness/temp` scan skip appears to yield to an
inside path.

The documented contract — "the sweep's exclusion is never honoured by a direct
invocation" — holds for `validate` but not for `doctor --path`.

## FU-7 — `verify-basis` addresses are repo-root-anchored, not relative to `--update` (DOC DEFECT — open, reported not reproduced)

Reported by `pij-solid-parrotfish`; **not independently reproduced here.** The
guide's example, `verify-basis "log.dd.json#entries" --update plan.dd.json`,
reads as though the address resolves relative to the document being updated.
Source and live command both anchor CLI addresses at the repository root, so a
nested document needs its full repo-relative address. The example works only
because both files happen to sit at the root.

Same family as FU-4: an address whose anchor is not where the reader assumes.

## FU-8 — `dd doctor` sweeps gitignored directories (minor — open)

Noticed while verifying FU-2: a peer's throwaway probe under `scratch/` (which
is gitignored at `.gitignore:151`) turned the repo-wide `dd doctor` from
`ok 0/0` into `degraded 0/1`. The probe was a deliberate missing-adapter case,
so the finding itself was correct — but it is not part of the repository.

`dd doctor` backs a gate in `just checks`, so anything a developer leaves in an
ignored scratch directory changes their local gate result. CI is unaffected (a
fresh checkout has no scratch), which makes it worse rather than better: it is a
local-only discrepancy, the kind that gets diagnosed twice before someone
realises the tree is the difference.

Fix shape: have the sweep honour `.gitignore`, or at minimum skip the same way
it already skips `node_modules` / `.git` / `dist` / `coverage`
(`schema/model.ts` `SCAN_SKIP_DIRS`). Low priority, one line, but it costs
someone an afternoon exactly once.

---

## Status

| id | what | kind | state |
| --- | --- | --- | --- |
| FU-1 | checkbox state marks `[x] [ ] [-] [~]` | taste | **done** — mutation-proven |
| FU-2 | section titles, three-tier, anchor pinned to name | taste | **done** — 5 mutations |
| FU-3 | array-of-link cells rendered as plain text | defect | **done** — mutation-proven |
| FU-4 | `repoRoot` is `cwd`, so `<gitroot>` is wrong | defect | **open, unowned** |
| FU-4a | `dd schema list` has no doc-folder root | defect | open, same round as FU-4 |
| FU-5 | explicit task `state` never reconciled with evidence | defect | open — needs a ruling |
| FU-6 | `doctor --path` inside an excluded directory | defect | open — not reproduced here |
| FU-7 | `verify-basis` address anchoring vs docs | doc defect | open — not reproduced here |

All of these are **post-ship on PR #87**. FU-4 was assigned to
`pij-straight-araminta`, which was then closed before writing anything, so it is
**unowned**; I am stood off `acts/dd/build.ts` and `acts/dd/shared.ts` until the
prime lifts that in writing.

`bp-0902` stays `unchecked` pending Jordan's read of the regenerated exemplar.
FU-5 is the one that most deserves his attention — it is the only open item that
touches whether dd's central claim ("nothing is self-reported") is true.

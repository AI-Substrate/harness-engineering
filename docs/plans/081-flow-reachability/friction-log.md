# s081 friction log — the flow fighting its own dogfood

Findings about our tooling making the correct thing hard, each with a repro.
Per the stream brief: friction is a finding, not an obstacle.

## F1 — the command #140 proposes for stream briefs fails as written (MEASURED)

#140's target table proposes adding this literal line to pij's stream-brief template:

```
harness flow create flight-plan --slug <s> --plan-dir docs/plans/<ORD>-<SLUG>
```

Run verbatim on this repo at `ee8f37fb` (worktree dist, freshly built):

```
$ node harness/cli/bin/harness.js flow create flight-plan --slug flow-reachability --plan-dir docs/plans/081-flow-reachability
E304: No schema found for flow type "flight-plan".
```

`flight-plan` is **not a bundled flow type** (only `harness-loop` is). The working
invocation needs four more flags, discoverable only inside the builder skill
(`skills/builder/references/flight-plan-ops.md` §3):

```
harness flow create flight-plan --slug <s> --path <plan-dir>/the-flow.json \
  --schema skills/builder/references/flight-plan.schema.json \
  --template skills/builder/references/flight-plan.template.json \
  --agent the-flow --plan-dir <plan-dir>
```

**Why it matters for the fix**: any pij workteam verb that mints the flow at allocate
time must either carry this full skill-relative invocation (coupling pij to builder's
skill layout) or the harness must bundle `flight-plan` as a first-class flow type.
This is a design input for the s081 verb/contract work, and a correction owed to
#140's proposed template line — the entry-point command we want briefs to carry
does not currently run without the builder skill resolved.

## F2 — dd mode cannot add a schema-declared section to an existing document (MEASURED)

The builder plan module mandates: fill the plan ONLY through `harness dd set/add`, never
hand-edit `plan.dd.json`. But `harness plan new` scaffolds only 6 sections (meta, summary,
goals, non_goals, acceptance_criteria, phases) of the ~20 `builder/plan` declares, and both
writer verbs refuse a declared-but-absent section:

```
$ harness dd set  "<plan>#research_context" "text"   → E450 "the document has no section \"research_context\""
$ harness dd add  …                                  → same refusal (locate.ts:36; mutate.ts:162)
```

`dd rm` can REMOVE a section (write.ts:315-316) but nothing can CREATE one — the mutation
surface is asymmetric. s080's plan.dd.json carries all 20 sections (file is untracked, so the
mechanism is unverifiable from history — presumably hand-assembled, i.e. the same workaround).

**Workaround used here, recorded for honesty**: a one-time script inserted EMPTY declared
sections into plan.dd.json (structure only, no values); every value was then written through
`dd set/add`, and `harness plan validate` + `dd build --check` prove the result. The doctrine
("the CLI is the only writer") is currently unsatisfiable to the letter for optional sections.

**Fix candidate**: `dd set`/`dd add` should create a schema-DECLARED section on first write
(the schema already arbitrates legality; refusing only undeclared names keeps safety).

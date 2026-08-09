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

## F3 — the pij pair route's engine is not installed (MEASURED)

`/pij pair` (the coder+reviewer fleet wrapper) shells to `<flow-pair skill root>/lib/cli.ts`
and reads templates/ledger schemas from that skill root. On this machine `~/.claude/skills/`
contains no `flow-pair` directory (checked 2026-08-09), so the documented route cannot run:
the route module exists, the engine it drives does not. Workaround: manual pair via the
peer route (spawn coder + cross-model reviewer, body-file packets, orchestrator-held
verdicts). **Relevant to the workteam formalization**: a pij workteam feature must either
carry its engine with the pij skill install or degrade to the manual shape deterministically.

## F4 — the exemplar seat itself skipped the workteam until human backpressure (OBSERVED, self-report)

This stream's PM (the seat writing this) implemented phase 1 in-seat with subagent critics
despite the stream being the explicit workteam dogfood. The convention was PRESENT in
context (Jordan's ask, ermine's stand-up doc, the exemplar framing) and still lost to local
optimization ("this phase is small"). Jordan caught it in review of process, not any gate.
Two lessons for the workteam feature, both self-demonstrating:
1. A convention that is reachable but optional still loses to a hurried/optimizing seat —
   stronger evidence than pij#227's briefs (those seats were never asked; this one was).
   The workteam mandate needs a mechanical carrier (a brief line + a deterministic check),
   not context.
2. The paved path lost partly because it was BROKEN (F3: flow-pair engine absent) — a
   documented route whose engine doesn't install is worse than no route: it teaches the
   detour. Repair: pij skill install must carry or verify its engine.
Remediation in-stream: phase 2+ runs through a real pair (coder pij-missing-leopard live,
cross-model reviewer at first REVIEW); PM stays out of the code.

### F4 addendum — attribution corrected by prime (2026-08-09)

Half the F4 miss is the governance layer's, per prime's own self-report: Jordan's instruction
was to brief the PM on firing up a FLEET TEAM; prime forwarded the stand-up doc as reading
material and briefed the stream, but never made the workteam shape a requirement with a check
behind it — the same named-the-artifact-omitted-the-obligation shape as ermine's nine briefs.
This STRENGTHENS the finding: the propagation gap reproduced at the governance layer even
while both parties were actively studying it. The mechanical-carrier remedy is unchanged and
now has two independent instances behind it (seat-side F4, governance-side prime).

## F5 — a worktree's existence is not evidence of its occupancy (ermine + prime, on my wrong stop-reason)

I stopped at /private/tmp/wt-cons calling it "another seat's worktree". The stop was correct
(it is another fleet's repo — propose-never-edit); the stated reason was UNCHECKABLE FROM
WHERE I STOOD: nothing in a worktree path says whether a seat lives in it. I inferred
occupancy from existence — the absence-as-evidence move, applied to a directory. The registry
answers occupancy (`pij list --json` filtered on folder); the filesystem cannot.
Why it earns an F-row: this time the wrong rule produced the right stop, but pointed at an
UNOCCUPIED directory inside a fence the same inference waves you straight through — an
outcome-correct stop built on a wrong rule fails silently later, in the permissive direction.

Corollary recorded for the convergence section: ermine declined a cross-repo PR because a PR
puts a foreign seat in the commit graph for a docs convergence — the inline-DELTA convention
exists precisely so provenance travels in the TEXT, not the graph. Pointer-and-land is the
shape; produce paste-ready blocks.

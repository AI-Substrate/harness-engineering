# Original ask — plan 069

Distilled from the Jordan ↔ koala design session of 2026-08-04 (the full
ruling ledger is `docs/plans/065-deterministic-documents/builder-tuning/notes.md`;
the design doc is `structural-proof-graph.md` beside it).

Jordan's operative directives, in his words where short enough:

- The dd gate shipped in 065 P6 but nothing drives it: "we made it so we can
  link to sections of plans etc… other things (not dd docs) can use them to
  gate things like the-flow (builder skill) navigation gates."
- Phases gate on their task files; "even better: last phase gated on plan
  validate showing green."
- "yep, agents may close off acs. we want fully autonomous journeys. Humans
  assist with PR stage, they can then review the ACs, linked evidence etc."
- Backpressure "is a utility toolbelt… they themselves are not gates in any
  way"; every done_when assertion must carry `pressure` or validation fails;
  `pressure: not-applicable` is the explicit out.
- Built-in link relations: "yeah go with your leaning" — frozen core of five
  (`pressure` `proven_by` `satisfies` `derives` `ref`) + open namespace.
- `satisfies` on the task row, always an array; orphan ACs warn under
  `--complete` only; `--complete` green = strict zero warnings, bypassable
  via the defended `--force`.
- Builder goes "fully native 100%" — plans and task files authored as
  `.dd.json`; rebase first (builder scripts updated in main, #90).
- PR surface (AC table with resolved evidence links in the ship PR): "now."
- "also include the link buckets on list items in the plan please."
- New numbered plan, drafted by koala, worked in the s065 branch/worktree.

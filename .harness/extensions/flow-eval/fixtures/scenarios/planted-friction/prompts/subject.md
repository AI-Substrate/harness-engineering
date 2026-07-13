# Your task

Add a small, self-contained feature to this repo using the SDD flow (`/the-flow`):
explore → plan → implement → review, then drain the retro at phase end.

Pick any small, honest feature the repo can support (a helper function + its test
is fine). Drive it through the flow normally.

## While you work

The repo ships a `broken-check.sh` you're expected to run as part of verifying
your work. **The environment is a target of work, not something to apologise for
and route around.** If it fails or misleads you:

- Fix it if the fix is small and reversible.
- Otherwise capture it the moment it bites: `harness observe "<what>" --kind difficulty|confusion`.
- Own your own mistakes silently; it's the environment's hard walls and misleading
  errors you pay forward, so the next person doesn't re-hit them.

## At phase end — drain the retro

Drain conversationally (recommendation-led): walk each observation, name the
highest-value one and why, default to save-all. **Record a `disposition` for every
observation you present** — the closed set `fixed-now | task | plan | diffs |
command | kept | declined | deferred`. Some you'll act on; some you'll consciously
**decline**; some you'll **defer**. Write them all to the retro record — declines
and deferrals included (that's the whole point). Then finish.

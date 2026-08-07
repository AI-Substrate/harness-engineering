# Harness-core — install flow

**Status**: Draft skeleton — none of this is built yet. Stages captured for expansion.

This is the end-to-end flow for getting a repo onto harness-core, from a clean machine
to running harness loops.

Every stage is **skill-driven** — each step is its own skill.

---

## Stage 1 — Install core on the machine (skill)

A **skill** that installs the harness-core tooling on the developer's (or agent's) machine.

- _What gets installed_: TBD (CLI binary / package / skills).
- _How_: driven by a skill (which may itself shell out to npx / package manager / installer).
- _Outcome_: harness-core commands are available on `PATH`.

## Stage 2 — Dope the repo with harness scaffolding

Run a skill against the target repo to seed it with the harness substrate — the prompting
and conventions that enable harness loops.

- Inject harness guidance into `AGENTS.md` (and equivalent) so agents know the harness exists
  and how to drive it.
- Scaffold the harness substrate (commands, recipes, conventions) needed for the loops.
- _Outcome_: the repo is "harness-aware" — agents and humans have the prompting + entry points
  to run harness loops.

## Stage 3 — Run the harnessability skill

Assess the repo's current harnessability to find what exists vs. what's missing.

- Inventory existing affordances (build / test / run / seed / observe).
- Score Operate-Today and Adaptability; surface gaps and remediation ranking.
- _Outcome_: an assessment that tells us which harness extensions are worth creating first.

## Stage 4 — Create initial harness extensions

Based on the assessment, create the first-pass harness extensions that wrap (not rebuild)
the repo's real commands.

- **build** — wrap the existing build command.
- **test** — wrap the existing test command(s).
- **run** _(maybe)_ — wrap the run/serve command if one exists.
- _(more to come — expand later)_
- _Outcome_: a minimal, working set of harness loops over the repo's real tooling.

---

## Notes / open questions

_Expand here. To be detailed later._

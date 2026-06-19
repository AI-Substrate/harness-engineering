---
description: "Dogfood onboarding probe: dropped into a freshly-cloned repo with no harness, figure the harness product out from its own README, docs, and installed skills; set up a working engineering harness; prove it; report PASS|FAIL|ABANDONED plus a dual-layer retrospective."
tags: [test, dogfood, harness, onboarding]
model: gpt-5.5
timeout: 1800
permissions:
  preset: read-only
  overrides:
    shell: allow
    write: allow
    network: allow
  allowedRoots:
    mode: extend
    roots: ["/tmp", "/private/tmp", "/var/folders"]
---

# Get this repo's engineering harness going

You are a **single-shot onboarding probe**. Imagine the harness product has just
landed on a new machine: you've been handed a freshly cloned repo and asked to
get an engineering harness working in it. Nothing below is a recipe — the
product's own documentation and skills are your map, and how well they guide
you is exactly what this test measures.

## Your goal

This freshly cloned repo has no harness. Using the harness product's own
documentation and installed skills — start from the product repo's README —
set up a working engineering harness, prove it works, and record your
experience using the harness's own mechanisms as you discover them. Then
write your report.

## First: resolve the product root (test plumbing)

`$MINIH_PROJECT_ROOT` *should* point at the harness product checkout, but in
some minih runtimes it is empty and your session starts in this run's folder.
Resolve it defensively and **fail clearly** if you cannot:

```bash
PROJECT_ROOT="${MINIH_PROJECT_ROOT:-}"
if [ -z "$PROJECT_ROOT" ] || [ ! -e "$PROJECT_ROOT/harness/cli" ]; then
  PROJECT_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"
fi
[ -n "$PROJECT_ROOT" ] && [ -e "$PROJECT_ROOT/harness/cli" ] || {
  echo "FATAL: cannot resolve the harness product root."; exit 1; }
```

`$PROJECT_ROOT` is the product checkout — its `README.md` is your starting
point.

## Parameters (input)

- `targetRepo` (**required**): absolute path to the freshly-cloned repo to
  harness. Work **inside** this clone.
- `harnessSource` (default `local`): where the product (CLI **and** skills) is
  installed from — `local` = the checkout at `$PROJECT_ROOT`; `github` = the
  public repo `github:AI-Substrate/harness-engineering`; `global` = the product
  is **already installed on this machine** (the `harness` CLI is on `PATH` and
  the `eng-harness-*` skills are available) — **skip the install step entirely**:
  confirm `harness --version` works, then go straight to the setup flow
  (assess → adopt → boot → prove → retro). For `local`/`github` this is source
  configuration only — *how* to install is yours to discover.
- `keepTarget` (default `false`): the orchestrator owns the clone's lifecycle;
  honour this only for extra scratch you create yourself.

## Rules of the test (plumbing, not hints)

- **The clone is throwaway.** All writes happen inside `targetRepo`. Never
  modify `$PROJECT_ROOT`.
- **Abandonment is a valid outcome.** If your assessment of the repo concludes
  it is not worth harnessing, stop and report `verdict: "ABANDONED"` with a
  reason grounded in that assessment's own output. Do not pick a replacement
  repo yourself.
- **Don't drive an interactive router headless.** A skill that is a
  print-then-offer conversation for a human cannot be "run" by you — use the
  skills that do the work directly.
- **Two systems improve from your run** — the product (CLI, skills, docs) and
  minih (the runner, skill passing, permissions). Capture friction on both
  layers, at the moment you hit it.

## Plan 032 — also drive + verify the ADOPT FLOW (a first-class CLI flight plan)

Adoption is no longer ad-hoc: `eng-harness-flow` drives it as a **real `harness flow`
flight plan** (the `harness-adopt` overlay) — the dogfood. As you onboard the clone,
follow `eng-harness-flow`'s `references/flight-plan-ops.md` guidance to **author and
advance an adopt flight plan with real `harness flow` commands** (never hand-edit the
JSON), writing it inside the clone (gitignored scratch is fine). Then **independently
verify** it from the artifact (parse the global `--json` placed BEFORE `flow`):

```bash
node "$PROJECT_ROOT"/harness/cli/bin/harness.js --json flow rail     --path <adopt.json>  # rail starts "[adopt]"?
node "$PROJECT_ROOT"/harness/cli/bin/harness.js --json flow nav show --path <adopt.json>  # .data.nav.now resolves?
node "$PROJECT_ROOT"/harness/cli/bin/harness.js flow render          --path <adopt.json>  # exit 0?
```

Confirm and report (in the `adoptFlow` object): the spine is `install → governance →
build-boot → bridge`; `build-boot` is the **last** build rung (boot LAST); the terminal
`bridge` is a `decision` node; position was advanced via `harness flow nav set` (not a
hand-edited JSON); the rail title is `[adopt]`. If the skill's prescribed command
errors, that is a finding — record it (`VF-NNN`) and report `adoptFlow.authored:false`.

## Output (the report)

Write your JSON report to the literal path minih shows you
(`$MINIH_OUTPUT_PATH`). It must satisfy `output-schema.json` — including the
`retrospective` (workedWell / confusing / magicWand / magicWandTarget /
difficulties). Make the magic wand **specific and in your own words** — name
the single step that cost you the most and what would have removed that cost;
don't reach for a pre-named feature or a solution someone else put in your
head. Number difficulties `VF-001`, `VF-002`, … and tag each `layer`
(`project` or `minih`).

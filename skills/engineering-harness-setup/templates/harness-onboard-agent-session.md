<!-- foundations: directives#D1, first-principles#27 -->

# Onboard Agent Session With Engineering Harness

The agent harness drives. The engineering harness proves.

Use this guide at the start of a fresh agent session in this repository.

## Goal

Orient through the repo-local engineering harness before doing feature work.

The agent harness drives the model. The engineering harness proves the product.

## Steps

1. Read `AGENTS.md`.
2. Read `HARNESS.md`.
3. Run or inspect:

   ```txt
   {{HARNESS_CLI_INVOCATION}} --help
   {{HARNESS_CLI_INVOCATION}} doctor
   ```

4. Read:

   ```txt
   harness/config.json
   harness/state/known-difficulties.md
   harness/state/friction-log.md
   ```

5. If the user approves command execution, run:

   ```txt
   {{HARNESS_CLI_INVOCATION}} validate --dry-run
   ```

   Then run real build/test/health commands only if approved and configured.

6. Report session readiness:

   ```md
   ## Harness onboarding report

   - Harness CLI found: yes/no
   - Config found: yes/no
   - Build command configured: yes/no
   - Test command configured: yes/no
   - Run/boot command configured: yes/no
   - Health or smoke check configured: yes/no
   - Known difficulties reviewed: yes/no
   - Commands run:
   - Passing evidence:
   - Failing evidence:
   - Unproven items:
   - Recommended next safe action:
   ```

7. If something fails, classify the failure **before blaming the model**. Pick the closest friction layer:

   - task/spec failure;
   - instruction/context failure;
   - environment failure;
   - command/tooling failure;
   - validation failure;
   - state/continuity failure;
   - possible model capability gap.

   The first six are harness-layer failures and become friction-log entries. The seventh is rare; do not jump to it.

8. If the failure is likely harness friction, propose one concrete encoded improvement. Use the magic-wand prompt from `harness/templates/magic-wand-prompt.md` (also available via `{{HARNESS_CLI_INVOCATION}} magic-wand`) to frame the proposal:

   > If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, higher quality, or better proven? Be concrete — name a command, flag, output field, fixture, diagnostic, template, sensor, check, or workflow change.

## Completion rule

Do not claim the repository is ready just because the instructions were read.

Readiness is based on evidence from the harness.

If a check cannot run, say why and record what needs to be encoded next.

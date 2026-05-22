<!-- foundations: directives#D2, first-principles#10 -->

# Harness

This folder contains the repository-local engineering harness.

The harness is not the agent runtime. It is the project-side surface that helps humans and agents boot, run, observe, validate, diagnose, and improve the product.

## Files

- `../HARNESS.md` — root harness rules and operating loop.
- `config.json` — build/test/run/health command configuration.
- `bin/` — minimal harness CLI.
- `skills/onboard-agent-session.md` — onboarding guide for future agent sessions.
- `state/known-difficulties.md` — recurring traps and known setup issues.
- `state/friction-log.md` — improvement backlog for harness friction.
- `proofs/` — optional location for proof notes or validation artefacts.
- `templates/` — reusable proof, friction, retrospective, and command-contract templates.

## First commands

```txt
{{HARNESS_CLI_INVOCATION}} --help
{{HARNESS_CLI_INVOCATION}} doctor
{{HARNESS_CLI_INVOCATION}} validate --dry-run
```

## Improvement rule

When the harness causes friction, improve the harness.

Prefer encoded fixes over remembered workarounds. Markdown explains the trap; code prevents you falling in it.

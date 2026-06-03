<!-- foundations: directives#D2, first-principles#10 -->

# Harness

This folder contains the repository-local engineering harness.

The harness is not the agent runtime. It is the project-side surface that helps humans and agents boot, run, observe, validate, diagnose, and improve the product.

## Files

- `../docs/project-rules/engineering-harness.md` — harness rules and operating loop.
- `cli/commands.json` — build/test/run/health/sensor command configuration.
- `cli/` — minimal harness CLI.
- `skills/onboard-agent-session.md` — onboarding guide for future agent sessions.
- `../docs/harness/` — canonical buffers, retros, and curated harness-improvement records.
- `state/known-difficulties.md` — optional compatibility summary pointing to `docs/harness`.
- `state/friction-log.md` — optional compatibility summary pointing to `docs/harness`.
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

Backpressure Check is an advisory tools-skill activity over scoped work and the deterministic sensors exposed here. Do not add a core `backpressure` harness command; add or improve the sensor that would prove the risk.

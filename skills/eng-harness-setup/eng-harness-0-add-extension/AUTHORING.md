# Authoring notes — add-extension skill

Guidance for maintaining this skill (not for end users).

## Design intent

- **Thin by deliberate choice.** The skill must not grow an elaborate
  context-ranking engine. The rule is binary: if the wanted extension is obvious
  from gathered context, build it; if not, ask one short question. Resist adding
  a ranked source hierarchy or conflict-resolution logic — that was an explicit
  scope decision (plan 006).
- **Deterministic work lives in the CLI, not here.** All scaffolding (templates,
  paths, name validation, error codes) is owned by `harness new`
  (`harness/cli/src/services/scaffold/`). This skill must call `harness new`
  rather than hand-writing extension files, so there is a single source of truth
  for the starter content.
- **Verification is mandatory.** The skill always finishes by running
  `harness doctor`/`harness help` and surfacing the result. Never report success
  on the skill's say-so alone.

## When the CLI changes

If `harness new` gains flags or the verb contract changes, update:
- the `harness new` invocation examples in `SKILL.md`,
- the contract references (`ctx` helpers) in `SKILL.md` step 2,
- the cross-links to `authoring-verbs.md` / `docs/how/extend-the-harness.md`.

## Testing

The skill itself is prose (no unit tests). It is exercised end-to-end by the
`install-and-validate-test-extension` minih agent
(`agents/install-and-validate-test-extension/`), which installs the core into a
throwaway repo, drives this skill, and validates the result. Collect that agent's
retrospective + magic wand after every run (see `AGENTS.md`).

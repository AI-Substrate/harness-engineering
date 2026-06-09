# Engineering Harness Contract

## Boot command

`uv run --locked --no-default-groups --group tests pytest -q`

This boots the Click library harness by resolving the locked test dependency
environment and running the local pytest suite. For this library/CLI toolkit,
passing tests are the healthy, observable state.

## Health check

`uv run --locked --no-default-groups --group tests pytest -q` exits `0`.

For focused smoke checks, a representative Click command can be exercised through
`click.testing.CliRunner` in pytest and validated by exit code and captured
output.

## Interact method

Agents interact with the system through Python tests that invoke Click commands
with `click.testing.CliRunner.invoke(...)`, and through example CLIs under
`examples/` when broader command behavior is needed.

## Observe method

Agents observe behavior through pytest/tox exit codes, stdout/stderr captured by
`CliRunner`, exception and exit-code assertions, pre-commit output, type-checker
output, and any coverage artifacts produced by the configured coverage tooling.

## Deterministic signal inventory

- `uv run --locked --no-default-groups --group tests pytest -q` - fast local
  pytest lane.
- `uv run --locked --no-default-groups --group dev tox run` - CI-equivalent tox
  test lane, with `TOX_ENV` selecting matrix environments.
- `uv run --locked --no-default-groups --group dev tox run -e typing` - mypy and
  pyright type checks.
- `uv run --locked --no-default-groups --group pre-commit pre-commit run
  --all-files` - ruff, formatting, lockfile, spellcheck, and repository hygiene
  hooks.
- GitHub Actions workflows for tests, typing, pre-commit, and nightly race
  tests.

## Evidence paths

- Terminal output and exit code from `harness boot` / pytest.
- `.harness/reports/harnessability/latest.json` and `latest.md` for the current
  harnessability assessment.
- `.harness/reports/harnessability/001-click/` for this assessment run's
  history, summary, and evidence log.
- `.harness/records/retro/` for setup retrospectives once recorded.
- Optional coverage data from the coverage configuration when coverage is run.

## Back-pressure gaps

- The fastest official proof lane is inferred from `pyproject.toml` and CI until
  it is exposed as `harness boot`.
- Local proof evidence is mostly terminal text; harness envelopes should capture
  command, status, output summary, and next action.
- Typing and style gates are deterministic but not yet harness-native verbs.
- No pre-existing compounding retro loop was present before this setup run.

## Current maturity snapshot

L2 - Static/build/test proof is available through pytest, tox, typing, and
pre-commit, but the harness front door and durable evidence loop are only being
introduced in this run.

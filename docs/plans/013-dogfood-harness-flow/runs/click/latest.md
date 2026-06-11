# Harnessability Assessment - click

Run metadata
- Timestamp: 20260609T125450Z
- Repo root: /private/tmp/harness-flow-selftest-2026-06-09T12-48-22-100Z/click
- Branch / commit: main / 8a1b1a33d739be05b7e91251e3c0dde77c5e152f
- Mode: static
- Commands executed: minih skills doctor; npm install ~/substrate/harness-engineering --no-audit --no-fund; npx harness doctor --json; npx harness help; static file inspection of pyproject.toml, README.md, docs/contributing.md, CI workflows, pre-commit config, devcontainer, and tests
- Commands skipped: Service boot skipped during static assessment; Dependency installation beyond required harness core install skipped during assessment; Deep git-history mining skipped
- Safety notes: Did not read secret values; Did not call external services; Did not run migrations, seeds, or destructive cleanup

## Verdict

- Operate-Today: B (80%)
- Adaptability: B (77%)
- Harnessability Index: 78.5% (B)
- Final grade: B
- Readiness: H2
- Highest proof level detected: L2
- Target next proof level: L3
- Confidence: high

The Click clone is a strong candidate for the full harness setup flow. It has a clear Python package topology, uv/tox/pytest local and CI paths, typing/style gates, low external-dependency pressure, and a reusable CLI interaction seam through CliRunner. The main gap is harness explicitness: before this run, the repo had no canonical .harness governance contract, boot verb, or retro loop.

## Top blockers

1. No pre-existing canonical harness governance/front door.
2. Local proof evidence is mostly terminal text rather than a durable harness artifact.
3. No compounding retro/difficulty loop before setup.

## Highest-leverage improvements

1. Encode harness boot as: uv run --locked --no-default-groups --group tests pytest -q
2. Keep the BIO governance doc as the canonical description of boot, health, interaction, observation, signals, evidence paths, gaps, and maturity.
3. Later add typed/style proof verbs that wrap existing tox/pre-commit lanes.

## First safe agent session plan

1. Install harness core if absent and run npx harness doctor --json.
2. Run the quick pytest lane through the boot wrapper once created.
3. For behavior changes, start with focused pytest tests using CliRunner, then run typing/style as needed.
4. Record friction with harness record retro rather than leaving it in chat.

## Axis A - Operate-Today scorecard

| Dimension | Band | Points | Evidence | Notes |
|---|---|---:|---|---|
| A1 Cold-start orientation and repo map | Strong | 3 | README describes Click; docs/contributing.md lists development notes; docs/ contains user and contributor documentation. | The project purpose and broad layout are easy to identify. |
| A2 Setup and environment contract | Strong | 3 | pyproject.toml declares Python >=3.10, dependency groups, tox envs, uv.lock; .devcontainer/on-create-command.sh creates .venv and installs development dependencies. | Runtime and dependency contract is explicit through uv/tox and devcontainer. |
| A3 Locality of infrastructure and external dependency exposure | Strong | 3 | No database, queue, cache, object store, auth provider, payment, or remote service required by pyproject/test configuration. | Proof is mostly local Python execution. |
| A4 Harness front door and command discoverability | Partial | 2 | pyproject.toml exposes tox envs and pytest configuration; CI runs uv/tox; no .harness front door existed before this run. | Commands are discoverable but diffuse across pyproject, docs, and CI rather than one canonical harness verb. |
| A5 Boot and health/readiness path | Partial | 2 | tox env_run_base runs pytest; CI invokes uv run --locked --no-default-groups --group dev tox run. | Tests are a practical health check for a library, but no dedicated boot/doctor command existed before harness setup. |
| A6 Seed, fixture, reset, and cleanup state | Partial | 2 | tests/conftest.py provides CliRunner; tests use runner.invoke and isolated filesystem/tmp mechanisms. | State needs are light and test-local; there is no separate seed/reset command, mostly because persistent state is not central. |
| A7 Supported interaction surfaces | Strong | 3 | Click is itself a CLI toolkit; tests exercise commands with CliRunner.invoke; examples/ contains example CLIs. | Agents can exercise real CLI behavior through the same public surfaces tests use. |
| A8 Existing deterministic back-pressure sensors | Strong | 3 | pytest, tox, ruff, pre-commit, mypy, pyright, coverage configuration, GitHub Actions test/pre-commit/typing workflows. | Multiple deterministic sensors exist locally and in CI. |
| A9 Observability and evidence artifacts | Partial | 2 | pytest output, exit codes, coverage config, stdout/stderr assertions in tests. | Evidence is mostly terminal output and test assertions; no first-class JSON run report/artifact path is documented for local runs. |
| A10 Compounding harness loop | Weak | 1 | No pre-existing .harness governance, retrospectives, or difficulty ledger in the clone. | The repo had strong engineering checks but no explicit harness-retro improvement loop before this flow. |

## Axis B - Adaptability scorecard

| Dimension | Band | Points | Evidence | Notes |
|---|---|---:|---|---|
| B1 Structural coupling and blast radius | Strong | 3 | src/click/ is a compact library package with focused modules such as core.py, types.py, parser.py, testing.py. | Single package topology keeps blast radius understandable. |
| B2 Temporal/change coupling | Weak | 1 | Deep git co-change mining was skipped in static mode. | Temporal coupling was not proven; defaulted weak rather than inferred strong. |
| B3 Cohesion and locality of change | Strong | 3 | Tests are grouped by behavior area under tests/test_*.py near the src/click package. | Feature behavior and tests are navigable by topic. |
| B4 Seams, substitution, and dependency inversion | Strong | 3 | click.testing.CliRunner and pytest fixture in tests/conftest.py provide a reusable command invocation seam. | The test harness exposes a strong seam for CLI behavior. |
| B5 Hermetic, offline, and isolated testability | Strong | 3 | pytest tests operate on local Python code and use CliRunner/tmp isolation; no remote service dependency was detected. | Useful proof can run offline after dependencies are available. |
| B6 Side-effect isolation and external-effect sinks | Partial | 2 | CLI tests capture stdout/stderr and use isolated filesystem patterns; no risky external side effects detected. | Side effects are mostly local process/file/terminal effects and are capturable. |
| B7 State evolution and consequence verification | Partial | 2 | Tests assert outputs, exceptions, exit codes, and local file interactions for CLI behavior. | State consequence verification exists for CLI/file outcomes, but no broader fixture lifecycle is needed or encoded as a harness command. |
| B8 Architecture boundary enforceability | Partial | 2 | ruff, mypy, pyright, and import convention linting are configured. | Static checks exist, but explicit architecture boundary rules are not visible. |
| B9 Complexity, size, and navigability thresholds | Partial | 2 | ruff and type checkers are configured; package is relatively compact. | General static quality gates exist; complexity-specific thresholds were not found. |
| B10 Inner-loop speed and repeatability | Partial | 2 | pytest/tox lanes are local and repeatable; uv.lock pins dependencies. | The loop is repeatable, but first-run dependency environment setup can dominate time. |

## Back-pressure surface inventory

- static: pytest via tox (configured_unverified) - pyproject.toml tox env_run_base and .github/workflows/tests.yaml
- static: pre-commit style gate (configured_unverified) - .pre-commit-config.yaml and .github/workflows/pre-commit.yaml
- static: typing gate (configured_unverified) - pyproject.toml tox typing env and .github/workflows/tests.yaml
- runtime: CliRunner interaction seam (configured_unverified) - tests/conftest.py and tests/test_testing.py
- consequence: stdout/stderr/exit-code assertions (configured_unverified) - tests assert result.output, exceptions, and exit codes

## Scenario probes

### CLI behavior loop
- Highest plausible proof level: L4
- Interaction: runner.invoke(command, input=...)
- Verdict: pytest
- Missing sensor: harness boot/quick wrapper around uv pytest

### Typing/API contract loop
- Highest plausible proof level: L2
- Interaction: tox -e typing
- Verdict: mypy and pyright exit codes
- Missing sensor: contract/example smoke harness for public CLI API

### Documentation build loop
- Highest plausible proof level: L2
- Interaction: sphinx-build via tox -e docs
- Verdict: sphinx-build -W exit code
- Missing sensor: harness docs-check wrapper

## Command tiers

| Tier | Command or check | Status | Proof | Notes |
|---|---|---|---|---|
| quick | uv run --locked --no-default-groups --group tests pytest -q | candidate_unverified | L2 | pyproject.toml pytest configuration |
| ci_equivalent | uv run --locked --no-default-groups --group dev tox run | configured_unverified | L2 | .github/workflows/tests.yaml |
| proof | uv run --locked --no-default-groups --group dev tox run -e typing | configured_unverified | L2 | pyproject.toml and .github/workflows/tests.yaml |
| proof | uv run --locked --no-default-groups --group pre-commit pre-commit run --all-files | configured_unverified | L2 | .pre-commit-config.yaml |

## Services, environment, and remote dependency exposure

No remote database, queue, cache, auth, payment, email, object-store, model-provider, or internal service dependency was detected for local proof. First dependency sync may need package index/cache access; uv.lock makes it repeatable.

## State, fixtures, reset, and cleanup

Persistent application state is not central for this library. Tests use CliRunner, local process isolation, tmp paths, and output/exception assertions as the repeatable state/consequence loop.

## Observability and evidence

Primary evidence is pytest/tox/pre-commit/type-check output, exit codes, stdout/stderr assertions, and optional coverage data. A harness boot envelope should make the main proof output more portable.

## Harness-only recommendations

- Create .harness/engineering-harness.md from the BIO template.
- Create .harness/extensions/boot.ts using eng-harness-0-add-extension / harness new.
- Record a retro under .harness/records/retro/.

## Evidence and inference log

| Source | Provenance | Claim |
|---|---|---|
| pyproject.toml | evidence | Python >=3.10, uv dependency groups, pytest configuration, tox envs, ruff/mypy/pyright settings are declared. |
| .github/workflows/tests.yaml | evidence | CI runs uv/tox across Python versions and a typing job. |
| .github/workflows/pre-commit.yaml and .pre-commit-config.yaml | evidence | pre-commit style/format/lockfile/spellcheck hooks are CI-enforced. |
| tests/conftest.py and tests/test_testing.py | evidence | CliRunner is the core reusable test interaction seam for CLI behavior. |
| static scan | evidence | No remote database, queue, cache, auth, or external service is required for local proof. |

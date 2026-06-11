# Starter harness CLI core — verbatim ask

**Captured**: 2026-06-08T06:42:31Z  ·  **By**: /the-flow

> We're going to be working on a physical part of our engineering harness and it's going to take the form of a node CLI. This is the start of the CLI that will grow later. The idea is that they use NPX to install the core of the CLI and then using an extension system that we'll add later they go and actually create the concept of the harness. Review the harness in ~/substrate/chainglass. See how it has doctor commands, it is able to run the app in docker and provide a way for the agent to debug the live running app with playwright etc… These things are extensions.

## Intent

Create the required agent-friendly CLI that acts as the harness front door.

## Detail

This means providing the required command surface for agents and developers to discover how the repo wants to be worked with. It should start with simple commands like help, doctor, run, and validate, support JSON and human output, and treat empty command slots as something to improve rather than pretending they work. In our case, the harness will be pretty simple as our app cannot do much yet, but we should use it to do our engineering work. The harness is the focal point of our engineering system. Run, validate etc will be replaced by extensions when we add the extension system. The idea is they install the NPX on their dev machine to get the core of the harness, then they add extensions in the local repo which are loaded at runtime and become the customisable part of the harness. I have a method for this extension system that we will add in a later step.

This feature also establishes the first engineering backpressure for the nucleus repo itself: repeatable local commands, GitHub Actions CI, and test coverage reporting. `main` should be branch-protected so the CI path must pass before changes land. As part of this work we also need to actually establish engineering fundamentals in this repo, like linting, builds, etc. You can also see in ~/substrate/{chainglass,minih} similar concepts, and we should take them for here. "Just fft", biome etc. basic npm vulnerability scanning and stuff. Get that all going here too. We should also have CI with gh actions, semver and "release please".

## Minimum command surface

| Command | Initial behaviour | Growth path |
|---------|-------------------|-------------|
| `help` / `--help` | Explains harness purpose, command slots, output modes, and safe first actions. | Adds repo-specific examples over time. |
| `doctor` | Reports configured and unconfigured harness layers with next actions. | Adds dependency, auth, service, and environment checks. |
| `run <name> --dry-run` | Shows the configured command without executing it. | Becomes a safe wrapper around target repo commands. |
| `validate --dry-run` | Shows the validation sequence and missing gates. | Becomes the layered proof path for acceptance. |
| `build`, `lint`, `test`, `smoke`, `health`, `observe` | Return `unconfigured` until target repo commands are mapped. | Wrap existing project commands and write evidence. |

## Output and evidence contract

| Concern | Requirement |
|---------|-------------|
| JSON mode | Status/reporting commands can emit a stable envelope such as `command`, `status`, `data`, `error`, `evidence`, and `next_action`. |
| Human mode | Commands remain readable for humans and explain the same status without requiring JSON parsing. |
| Exit codes | Passing checks exit `0`; failed checks and unconfigured required slots exit non-zero unless a command explicitly documents a degraded non-fail state. |
| Unconfigured slots | Missing mapped commands return `status: unconfigured` with the next action. They never pretend success. |
| Dry run | Discovery and dry-run modes are safe at session start and do not run long or destructive operations. |
| Evidence paths | Commands that produce proof report where evidence was written, or explicitly say no durable evidence was produced. |

## CLI quality bar

The starter CLI must be agent-friendly from the first version. It should not rely on tribal knowledge or terminal-only explanations.

| Capability | Requirement |
|------------|-------------|
| `--help` | Every command exposes concise help that explains purpose, inputs, safe usage, and next steps. |
| Actionable errors | Failures explain what failed, why it matters, and what the agent or human should try next. |
| JSON output | Commands that report status or evidence support structured output for agents. |
| Human output | Commands remain readable for humans running the harness locally. |
| Empty slots | Missing commands are reported as known gaps, not fake success. |
| Safe discovery | `help`, `doctor`, and command listing are safe to run at session start. |

## Clean architecture shape

The CLI should be small, testable, and easy to extend. Command parsing should not become the place where harness behaviour accumulates. You can see this shape in chainglass and minih. Their repos' constitutions have detailed architecture guidance we should pull across.

| Layer | Responsibility |
|-------|----------------|
| CLI entrypoints | Parse arguments, choose an act, render human or JSON output, and translate results into exit codes. |
| Acts | Composition layer for a command or workflow. Acts wire the required services and adapters together. |
| Services | Business-oriented harness logic such as command discovery, validation planning, evidence reporting, setup checks, and unconfigured-slot handling. Services receive adapters through injection. |
| Adapters | Wrap external resources such as the file system, process execution, git, HTTP/server calls, telemetry submission, clocks, and environment variables. |

External side effects should sit behind adapters so services can be tested without touching the real file system, shell, network, or server processes. Services should express the harness business rules; adapters should express how the outside world is reached.

## CLI engineering checks

The CLI source should carry its own quality gates rather than relying on review alone.

| Check | Requirement |
|-------|-------------|
| Biome | CLI source has Biome formatting and linting checks. |
| Formatter | A repeatable format command exists for CLI code. |
| Linter | A repeatable lint command exists and is part of local/CI validation where available. |
| Tests | Services and acts can be tested with fake adapters. |
| Type/config validation | Config parsing and command maps are validated before use. |
| Coverage | Test coverage is reported by the local/CI test path. |

## Local and CI backpressure

The nucleus repo should have one obvious local command path for agents before they commit, plus a CI path that enforces the same basic expectations on pull requests.

| Surface | Requirement |
|---------|-------------|
| `just fix` | Applies safe automatic fixes for the CLI codebase where available. |
| `just format` | Formats the CLI codebase repeatably. |
| `just test` | Runs the CLI tests and reports coverage. |
| `just fft` | Runs fix, format, and test as one composite pre-commit command for agents. |
| GitHub Actions | CI runs the required checks for pull requests and `main`. |
| Branch protection | `main` is protected so required CI must pass before merge. |
| Coverage reporting | CI reports test coverage so reviewers can see whether the CLI proof path is healthy. |

## KISS stories

1. CLI help orients the agent. Given a fresh session, running the CLI help shows the available harness commands and how to proceed safely.
2. CLI errors give next actions. Given a missing command, dependency, or configuration, the CLI returns an actionable error instead of a stack trace or silent failure.
3. CLI supports agents and humans. Given the same command, a human can read the default output and an agent can request structured output.
4. CLI keeps business logic out of adapters. Given the CLI needs file system, process, server, or telemetry access, those calls are wrapped in adapters and injected into services rather than embedded in command handlers. We should use deterministic back pressure to check this... OOS for now, it will be one of our first extensions we build to help us validate the extension system.
5. CLI quality checks are runnable. Given a developer changes CLI code, they can run the documented Biome, format, lint, and test checks before shipping.
6. Agents have one pre-commit command. Given an agent is ready to commit CLI work, it can run `just fft` to apply fixes, format, and run tests with coverage before committing.
7. CI protects main. Given a pull request targets `main`, GitHub Actions runs the required checks and branch protection requires them to pass before merge.

Get us on a branch before we start work.

## Acceptance criteria

- A required CLI exists under `harness/cli/`.
- The CLI exposes the starter command slots for help, doctor, run, validate, build, lint, test, smoke, health, and observe.
- The CLI has agent-friendly `--help`.
- CLI failures include actionable next steps.
- Status/reporting commands can emit structured output and human-readable output.
- CLI commands have documented exit-code semantics.
- Dry-run and discovery modes are safe to run at session start.
- Unconfigured command slots return an explicit `unconfigured` status and next action.
- Commands that produce proof report evidence paths.
- Missing capabilities are represented as gaps to improve, not as passing checks.
- CLI command handlers stay thin and delegate business behaviour to acts and services.
- Services receive external dependencies through adapters for file system, process, git, server, telemetry, time, and environment access.
- CLI source includes runnable Biome formatting and linting checks.
- CLI services and acts are testable with fake adapters.
- A `justfile` exposes `fix`, `format`, `test`, and `fft` commands.
- `just fft` runs fix, format, and test as a single agent-friendly pre-commit command.
- The test command reports coverage.
- GitHub Actions CI runs the required CLI checks for pull requests and `main`.
- `main` is branch-protected so required CI must pass before merge.
- CI reports test coverage.

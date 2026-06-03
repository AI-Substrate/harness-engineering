---
name: engineering-harness-orient
description: Run a post-setup harnessability orientation and pre-check for the current repository. Produces Markdown and JSON reports describing harness surfaces, command tiers, evidence paths, product-code affordance gaps, proof readiness, first-session guidance, and next harness improvements.
---
# engineering-harness-orient

Run a post-setup **engineering harness orientation** for the current repository.

The setup skill creates the engineering harness nucleus. This skill makes that nucleus target-aware by inspecting the repository substrate, classifying harnessability, and writing a human-readable and agent-readable report.

The agent harness drives. The engineering harness proves.

## When to use

Run this after `engineering-harness-setup`, or when a repo already has a harness front door but a fresh human or agent still has to rediscover:

- what kind of repo this is;
- which commands are candidates versus verified;
- which services, ports, and environment prerequisites matter;
- whether auth, seed/reset, fixtures, observation, and evidence paths are usable;
- what proof level the repo can currently reach;
- which product-code affordances would make the next run safer, faster, more deterministic, or better proven.

## Input

```text
$ARGUMENTS

# Flags:
# --json                         Print or emphasize the JSON report path in the final answer.
# --markdown                     Print or emphasize the Markdown report path in the final answer.
# --execute-safe-probes          Allow explicitly safe local probes such as help/list/dry-run commands.
# --apply-safe-harness-patches   Allow low-risk harness-only patches. Never applies product-code changes.
# --propose-codebase-affordances Include product-code affordance recommendations. This is on by default.
# --target-mode clean-start      Future mode; evaluate clean-start experience in disposable context.
# --compare <previous.json>      Future mode; compare harnessability against a previous orientation run.
```

No flags means read-only static orientation plus report generation.

## Output contract

Write stable latest files and timestamped run files:

```text
harness/orientation/latest.md
harness/orientation/latest.json
harness/orientation/schema.json
harness/orientation/runs/<UTC_TIMESTAMP>.md
harness/orientation/runs/<UTC_TIMESTAMP>.json
```

Use UTC timestamp format `YYYYMMDDTHHMMSSZ` for run filenames.

The Markdown report follows `templates/orientation-report.md`. The JSON report follows `templates/orientation-report.schema.json`. Keep the JSON schema version at `engineering-harness-orientation.v0.1` until the core contract changes.

## Safety defaults

Default mode is static and conservative.

Allowed by default:

- read repository files;
- inspect installed harness surfaces;
- inspect non-secret config names and example files;
- classify evidence, inference, human-supplied facts, and unknowns;
- write orientation reports under `harness/orientation/`.

Not allowed by default:

- dependency installation;
- service boot;
- database, queue, cache, migration, or fixture mutation;
- reading or printing secret values;
- external service calls;
- real auth flows;
- product-code edits.

`--execute-safe-probes` may run only safe static or local-read probes such as help/list/dry-run/version commands. It still must not boot services, install dependencies, mutate state, read secrets, or call external services.

`--apply-safe-harness-patches` may apply low-risk harness-only patches. Product-code affordance recommendations remain proposal-only unless a later explicit implementation task is approved by the user.

## Relationship to setup and runtime skills

Setup, orient, and runtime skills have distinct jobs:

| Step | Owner | Responsibility |
|------|-------|----------------|
| Setup | `engineering-harness-setup` | Create or validate the nucleus: governance file, command map, `harness/cli/`, deterministic sensor inventory, `docs/harness`, and agent routing. |
| Orient | `engineering-harness-orient` | Inspect the target repo, classify harnessability, write orientation reports, recommend next safe actions, and propose harness/product-code affordances. |
| Runtime | tools runtime skills | Boot, observe, run retros, harvest learning, and perform advisory Backpressure Check over scoped work and available sensors. |

Backpressure Check is advisory over deterministic sensors. Do not add a generic backpressure command key. If a gap is found, recommend the specific sensor, command, check, fixture, diagnostic, schema, smoke path, or evidence capture that would prove it.

## Harnessability ladder

Use the H0-H5 ladder for repository readiness. This is distinct from setup's harness maturity ladder and from proof levels.

| Level | Meaning |
|-------|---------|
| H0 Unknown | No reliable harness surface or boot substrate detected. |
| H1 Front door exists | Harness installed, but commands are generic, unconfigured, or mostly inferred. |
| H2 Oriented | Repo type, command candidates, services, prerequisites, interaction surfaces, and evidence paths are mapped with source evidence. |
| H3 Operable | At least one boot/health or fast validation path is configured and can be dry-run or safely executed. |
| H4 Proveable | A meaningful smoke/proof scenario exists with evidence path, verdict, and rerun command. |
| H5 Compounding | Friction capture, known difficulties, proof records, and encoded harness improvements are wired into the loop. |

Use Proof L0-L6 for what a specific command or claim proves:

| Level | Meaning |
|-------|---------|
| L0 Claim | Actor says work is done, no evidence. |
| L1 Local command output | A command ran and output exists. |
| L2 Static/build/test | Build, lint, typecheck, unit, or isolated tests passed. |
| L3 Runtime interaction | Product/API/UI/CLI/queue/MCP/system path was exercised. |
| L4 Interaction plus side-effect | Runtime interaction plus state/file/database/message/event verification. |
| L5 Reproducible clean rerun | Proof passes again in clean context using recorded instructions. |
| L6 Production/customer outcome | Production telemetry, incident-free release, customer outcome, or business evidence. |

Static orientation alone should not claim L3 or above unless that evidence already exists and is cited.

## Execution flow

### 1. Establish repo context

Record:

- repo root;
- repo name;
- branch and commit if available;
- whether the run is default static mode or safe-probe mode;
- commands executed and commands skipped;
- safety notes.

Never print secret values.

### 2. Inspect installed harness surfaces

Check:

- `docs/project-rules/engineering-harness.md`;
- legacy `docs/project-rules/agent-harness.md`;
- legacy `docs/project-rules/harness.md`;
- `AGENTS.md`;
- common agent instruction files;
- `harness/cli/`;
- `harness/cli/commands.json`;
- `docs/harness/`;
- `harness/orientation/`.

Report canonical versus legacy surfaces. Missing harness surfaces should produce H0/H1-style guidance and usually recommend `engineering-harness-setup`.

### 3. Inspect repository substrate

Inspect repository files for:

- project type and package roots;
- local setup docs;
- build/test/lint/typecheck scripts;
- CI configuration;
- services, ports, env var names, and local prerequisites;
- health, readiness, API, browser, CLI, queue, or MCP interaction surfaces;
- auth and identity surfaces;
- seed/reset/fixture/state surfaces;
- observability and evidence paths;
- deterministic sensors such as tests, lint, schema, architecture, security, smoke, or observe commands.

Record whether each finding is `evidence`, `inference`, `human_supplied`, or `unknown`.

### 4. Normalize command tiers

Classify candidate commands into stable tiers:

- `bootstrap`
- `setup_services`
- `doctor`
- `boot`
- `health`
- `fast`
- `quick`
- `proof`
- `ci_equivalent`
- `smoke`
- `seed_or_reset`
- `observe`
- `cleanup`

Use statuses:

- `candidate_unverified`
- `configured_unverified`
- `verified`
- `not_applicable`
- `unknown`

Do not mark inferred commands as verified unless they were executed successfully in the current run or supported by reliable recorded evidence.

### 5. Classify gaps

Every material gap should include:

- subsystem: `instructions`, `tools`, `environment`, `state`, or `feedback`;
- loop stage: `boot`, `interact`, `observe`, `validate`, or `improve`;
- target layer: `harness`, `product_code`, `test_code`, `fixture_data`, `environment`, `ci`, `agent_instruction`, or `human_process`;
- encoding type: `guide`, `sensor`, `command`, `fixture`, `diagnostic`, `evidence`, `state`, or `policy`;
- severity: `blocker`, `high`, `medium`, `low`, or `info`;
- status;
- provenance;
- confidence;
- recommended next action.

## Product-code affordance recommendations

Harnessability can require product-code changes. This skill may recommend them, but it must not apply them by default.

Examples include:

- local/test-only auth provider;
- seeded fixture user;
- idempotent seed/reset command;
- health/readiness endpoint;
- side-effect sink for email, SMS, payments, webhooks, or external APIs;
- stable UI selectors or accessible labels;
- deterministic clock or ID provider;
- structured diagnostics endpoint;
- fixture-backed smoke scenario.

Every product-code affordance recommendation must state:

- `status: proposed`;
- risk tier;
- target layer;
- environment scope;
- environments where it must not apply;
- safety requirements;
- whether human/security review is required;
- which harness command or proof level it would unblock.

High-risk and critical recommendations are proposal-only by default.

## Report requirements

Every report must include:

- verdict;
- what is ready;
- what blocks confident feature work;
- first agent session plan;
- harness surfaces;
- project detection;
- command tiers;
- services and environment;
- interaction and auth;
- state, fixtures, and reset;
- observation and evidence;
- proof model;
- gaps;
- codebase affordance recommendations;
- harness recommendations;
- human questions;
- proposed patches;
- safety notes;
- evidence and inference log.

Human questions should be targeted and evidence-backed. Ask only after repository evidence has been inspected.

## Stop conditions

Stop and ask the user before:

- executing any service boot;
- installing dependencies;
- reading secret values;
- applying product-code changes;
- running destructive or state-mutating commands;
- making high-risk auth, identity, permission, tenant, billing, or data-access changes.

## Final response

Report:

- Markdown report path;
- JSON report path;
- harnessability level and confidence;
- highest detected proof level;
- top blockers;
- first safe next action;
- whether any product-code affordances were proposed.

Then stop. Do not begin implementing recommended product or harness changes unless the user explicitly requests a separate implementation task.


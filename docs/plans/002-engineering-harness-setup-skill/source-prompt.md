# Agentic Engineering Harness Setup Skill — Authoring Brief

Version: 0.1

This document is a verbose instruction brief for an agent that will write a reusable skill named something like **Engineering Harness Setup** or **Bootstrap Agentic Harness**.

The target skill should help a human and their coding agent install the first useful version of a repo-local **engineering harness**: a small, discoverable, agent-operable development surface that lets future humans and agents move from intent to evidence, then encode what they learn into the next run.

The skill should not try to create a finished, universal harness. It should create the minimum viable harness surface, teach the user what decisions matter, ask for the right choices, and leave behind durable files that future sessions can use.

---

## 1. Core philosophy the skill must preserve

The skill must be written around these principles.

### 1.1 Keep the harness boundary clear

Do not collapse the **agent harness** and the **engineering harness** into one vague thing.

The **agent harness** is the model runtime or control plane: Copilot, Claude Code, Codex, Cursor, Cline, tool dispatch, permissions, memory, orchestration, execution environment, and session state.

The **engineering harness** is the repo-local project-side loop that proves the actual software works: boot, build, run, seed, interact, observe, test, validate, diagnose, and improve.

The agent harness drives. The engineering harness proves.

The skill is about creating the engineering harness.

### 1.2 Productise the development loop

Harness engineering is the practice of productising the software-development loop so humans and agents can move from intent to evidence, then encode what they learn into the next run.

The target operating loop is:

```txt
Boot → Interact → Observe → Validate → Improve
```

- **Boot** proves the product can start from a known state.
- **Interact** exercises meaningful user or system behaviour through supported surfaces.
- **Observe** captures what happened in inspectable forms.
- **Validate** turns evidence into an explicit verdict.
- **Improve** encodes the lesson so the next run is faster, clearer, safer, or more deterministic.

If the loop stops at validation, the harness is only a test rig.

If the loop includes improvement, the harness compounds.

### 1.3 Make the paved path easier than the shortcut

The harness must be easier to discover and use than raw commands, scattered markdown, tribal knowledge, or ad hoc scripts.

The first version can be small. It only needs to make the supported path obvious.

The skill should therefore create a repo-local front door, usually a CLI, and route the agent toward that front door from `AGENTS.md` or the equivalent project instruction file.

### 1.4 Encode the fix, not the memory

The skill must teach the user and future agents this rule:

> Do not merely document the workaround. Encode the improvement into the harness where possible.

Documentation can orient, but the highest-value harness knowledge is executable.

Examples:

- If the app requires three setup commands before it boots, add a harness command or preflight check.
- If a migration step is often forgotten, add a diagnostic or validation step.
- If seed data is repeatedly missing, add a seed command.
- If an architecture rule is repeatedly violated, add a deterministic architecture check.
- If a confusing error causes repeated dead ends, improve the error message or doctor command.

Markdown explains the trap. Code prevents you falling in it.

### 1.5 Prefer deterministic validation over agent inference

The skill must help the user move validation out of agent judgement and into deterministic checks where possible.

Prompts are useful, but prompts should not be the only completion mechanism.

A prompt that says “follow our architecture” is useful.

A deterministic architecture check that fails when the rule is violated is better.

A prompt that says “make sure the app still works” is useful.

A boot-and-smoke command is better.

A prompt that says “do high quality work” is useful.

A validation path that catches the team’s real failure modes is better.

The agent can report progress. The harness should decide whether executable completion criteria passed. Where completion criteria are not executable, the harness should route the unresolved judgement to a human with evidence.

### 1.6 Treat agent friction as harness feedback

Agents are real users of the engineering harness. They expose rough edges because they do not naturally inherit local tribal knowledge.

When the agent gets stuck, the skill should not automatically frame that as a model failure. It should ask which harness layer failed:

- Was setup unclear?
- Was a command missing?
- Was the environment not bootable?
- Was the error message useless?
- Was seed data absent?
- Was validation too weak?
- Was state not durable between sessions?
- Was the supported path harder than the shortcut?

The skill should install a low-ceremony way to record these frictions and convert repeated frictions into encoded harness improvements.

### 1.7 Ask the magic-wand question, then close the loop

At the end of meaningful agent work, the skill should route the agent to ask:

> If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, faster, or higher quality?

The answer must be concrete enough to encode.

Some suggestions will be bad. Some will be too expensive. Some will be gold.

The point is not to collect lessons. The point is to encode the good ones into the harness after human review.

### 1.8 Keep the initial harness practical and low ceremony

The first version should not create bureaucracy.

Avoid giant ledgers, complex dashboards, heavyweight schemas, or a sprawling framework.

The minimum useful version should leave behind:

- a root harness instruction file;
- a small harness folder;
- a minimal CLI front door;
- a config file for build/test/run/health commands;
- a basic onboarding skill or guide for future agent sessions;
- a friction log or improvement backlog;
- a clear link from `AGENTS.md` or equivalent agent instruction file.

---

## 2. What the target skill should do

The target skill should be an interactive setup and onboarding skill.

When invoked in a code repository, it should:

1. Explain the boundary between agent harness and engineering harness.
2. Inspect the repository enough to understand likely build/test/run conventions.
3. Ask the user a short set of decision questions.
4. Create a new `harness/` folder.
5. Create a root `HARNESS.md` file containing the harness rules and operating loop.
6. Create or patch `AGENTS.md` so future agent sessions read `HARNESS.md` and prefer the harness CLI.
7. Ask the user whether the harness CLI should be Python or Node.
8. Create a minimal CLI skeleton in the chosen language.
9. Create a config file where the first build/test/run/health commands are encoded.
10. Help the user encode the first commands: build, test, run/boot, and health check where possible.
11. Create an onboarding skill or guide that future agent sessions can run to orient themselves through the harness.
12. Run or dry-run the new harness commands only after appropriate user confirmation.
13. Record any setup friction and propose one concrete next harness improvement.
14. End with a concise setup report and next actions.

The target skill should be educational, but it should not turn into a lecture. It should explain each decision at the moment the user needs to make it.

---

## 3. Non-goals

The target skill must not:

- create a fully featured universal CLI;
- replace CI/CD;
- claim the product is validated if the product has not actually booted, run, or passed checks;
- invent build/test/run commands without confirming them;
- run destructive commands without explicit user approval;
- hide known failures behind optimistic summaries;
- create a giant markdown manual instead of executable affordances;
- treat agent review as a substitute for product proof;
- auto-apply magic-wand suggestions without human review;
- make individual-productivity claims from harness activity metrics;
- overfit to a single ecosystem such as Node or Python, even though the CLI itself can be implemented in either Python or Node.

---

## 4. The skill package the authoring agent should create

The agent writing the skill should create a skill package with a structure like this:

```txt
engineering-harness-setup-skill/
  SKILL.md
  templates/
    root-HARNESS.md
    agents-md-snippet.md
    harness-README.md
    harness-config.json
    harness-known-difficulties.md
    harness-friction-log.md
    harness-proof-note.md
    harness-onboard-agent-session.md
    cli-python-harness.py
    cli-node-harness.mjs
    cli-command-contract.md
    install-report.md
```

The exact format can be adapted to the agent runtime, but the skill must retain these conceptual pieces.

If the skill runtime supports multi-file skills, keep the templates in separate files.

If the skill runtime only supports a single instruction file, embed the templates inside `SKILL.md` and tell the running agent to materialise them when invoked.

---

## 5. Target repository files created by the skill

When the setup skill is run inside a user’s repository, it should create or update this minimum file set:

```txt
.
├── AGENTS.md                         # created or patched if present
├── HARNESS.md                        # root harness instructions and rules
└── harness/
    ├── README.md                     # harness folder overview
    ├── config.json                   # encoded build/test/run/health command config
    ├── bin/
    │   └── harness.py                # if Python CLI selected
    │   └── harness.mjs               # if Node CLI selected
    ├── skills/
    │   └── onboard-agent-session.md  # future-session onboarding guide/skill
    ├── state/
    │   ├── known-difficulties.md
    │   └── friction-log.md
    ├── proofs/
    │   └── .gitkeep
    └── templates/
        ├── friction-entry.md
        └── proof-note.md
```

The skill may also create a small wrapper or package script if the user approves. For example:

- `./harness/bin/harness.py doctor`
- `node ./harness/bin/harness.mjs doctor`
- `python ./harness/bin/harness.py doctor`
- `npm run harness -- doctor`
- `uv run python harness/bin/harness.py doctor`

The skill should avoid assuming a global binary named `harness` exists.

---

## 6. User decision points

The target skill must ask these decision points in a short, grouped way.

Do not ask all possible questions upfront if repository inspection can answer them. Ask enough to avoid wrong or invasive setup.

### 6.1 Required decisions

Ask the user:

1. **CLI implementation language**
   - “Should the repo-local harness CLI be Python or Node?”
   - Explain that this choice is about the harness CLI implementation, not necessarily the project’s application language.

2. **Permission to create or patch files**
   - “May I create `HARNESS.md` and `harness/`, and patch or create `AGENTS.md` to point future agents at the harness?”

3. **Initial command encoding**
   - “What commands should the harness wrap for build, test, run/boot, and health check?”
   - If the agent detects candidate commands, present them as a proposed table and ask for confirmation.

4. **Health check approach**
   - “Does the product have a health endpoint, smoke route, CLI command, page, or other lightweight proof that it started correctly?”

5. **Command execution permission**
   - “May I run the newly configured harness commands, or should I only dry-run and leave instructions?”

### 6.2 Optional decisions

Ask only if relevant:

- Should the CLI be invoked through Python, Node, npm scripts, Make, Just, or a shell wrapper?
- Should the harness store proof notes in version control or in a gitignored local folder?
- Should `harness/proofs/` be committed, ignored, or partially ignored?
- Should the setup include a smoke-check placeholder?
- Should known difficulties be empty, or should the user seed known project traps immediately?
- Should future sessions run `harness onboard`, `harness doctor`, or both at startup?

---

## 7. Repository inspection behaviour

Before asking the command-encoding question, the target skill should inspect common project files.

The skill should not treat detection as truth. Detection produces candidates for user confirmation.

### 7.1 Common files to inspect

Look for:

```txt
package.json
pnpm-lock.yaml
yarn.lock
package-lock.json
pyproject.toml
requirements.txt
setup.py
setup.cfg
Pipfile
poetry.lock
uv.lock
go.mod
Cargo.toml
pom.xml
build.gradle
gradlew
mvnw
*.sln
*.csproj
Makefile
Justfile
Dockerfile
docker-compose.yml
compose.yml
README.md
AGENTS.md
```

### 7.2 Candidate command heuristics

Use these heuristics only as candidates.

#### Node candidate commands

From `package.json` scripts:

- `build`: `npm run build`, `pnpm build`, or `yarn build`
- `test`: `npm test`, `pnpm test`, or `yarn test`
- `lint`: `npm run lint`, `pnpm lint`, or `yarn lint`
- `format`: `npm run format`, `pnpm format`, or `yarn format`
- `run` / `boot`: `npm run dev`, `npm start`, `pnpm dev`, `pnpm start`, `yarn dev`, or `yarn start`

Prefer the detected package manager if a lockfile clearly indicates one.

#### Python candidate commands

From `pyproject.toml`, `requirements.txt`, or common tooling:

- `test`: `pytest`, `python -m pytest`, `uv run pytest`, or `poetry run pytest`
- `lint`: `ruff check .`, `flake8`, or `pylint`
- `typecheck`: `mypy .`, `pyright`, or `basedpyright`
- `format`: `ruff format .`, `black .`, or `isort .`
- `run` / `boot`: project-specific; do not invent if unclear.

#### Other ecosystems

If the repo is not Node or Python, the CLI can still be Python or Node. Detect and suggest wrappers:

- Go: `go build ./...`, `go test ./...`, `go run ./...`
- Rust: `cargo build`, `cargo test`, `cargo run`
- .NET: `dotnet build`, `dotnet test`, `dotnet run --project <project>`
- Java Maven: `./mvnw test`, `mvn test`
- Java Gradle: `./gradlew test`, `gradle test`
- Make: `make build`, `make test`, `make run`
- Just: `just build`, `just test`, `just run`

If the repo is brownfield or unclear, leave commands unconfigured and guide the user to encode one command at a time.

---

## 8. Install flow for the target skill

The target skill should follow this flow when invoked.

### Step 1 — Orient the user

Say something like:

```md
I’m going to set up the first useful version of a repo-local engineering harness.

The agent harness is the runtime driving the model.
The engineering harness is the project-side loop that proves the product works.

This setup will create:
- `HARNESS.md`
- `harness/`
- a small Python or Node CLI skeleton
- initial build/test/run/health command config
- an onboarding guide for future agent sessions
- a friction log for harness improvement
- an `AGENTS.md` pointer so future agents use the harness
```

### Step 2 — Inspect the repository

Inspect likely project files.

Summarise findings as a compact table:

```md
Detected repo signals:

| Signal | Finding | Confidence |
|---|---|---|
| Package manager | pnpm | high |
| Build command | pnpm build | medium |
| Test command | pnpm test | medium |
| Run command | pnpm dev | medium |
| Health check | not found | low |
```

### Step 3 — Ask required decisions

Ask the minimum set of required decisions.

Example:

```md
Before I write files, please choose:

1. CLI language: Python or Node?
2. Initial commands to encode:
   - build: `pnpm build`?
   - test: `pnpm test`?
   - run/boot: `pnpm dev`?
   - health check: none detected — do you have a URL or smoke command?
3. May I patch/create `AGENTS.md` to point future agents at `HARNESS.md`?
4. After setup, may I run `harness doctor` and dry-run the configured commands?
```

If the user gives incomplete information, proceed with safe defaults and leave unconfigured command slots clearly marked.

### Step 4 — Create files

Create the file tree described in Section 5.

If files already exist:

- never silently overwrite;
- read and merge where appropriate;
- create a backup only if the environment and user conventions support it;
- otherwise show a patch-style summary before modifying.

### Step 5 — Populate config

Create `harness/config.json` from confirmed commands.

The config should support unset commands. Unset commands should not be treated as failure unless the command is required by the selected validation path.

### Step 6 — Create the CLI skeleton

Create the chosen CLI file under `harness/bin/`.

The CLI should be intentionally small but usable:

- show help;
- read `harness/config.json`;
- expose `doctor`, `build`, `test`, `run`, `health`, `validate`, `onboard`, and `magic-wand` stubs;
- run configured commands where present;
- print what is unconfigured;
- return meaningful exit codes;
- prefer clear messages over cleverness;
- include `--dry-run` for command wrappers;
- include `--json` as a future contract if easy, even if the first implementation only emits simple JSON.

### Step 7 — Create root instructions

Create `HARNESS.md` containing:

- the harness boundary;
- the front-door command;
- core rules;
- boot/interact/observe/validate/improve loop;
- current command map;
- definition of done;
- friction and magic-wand instructions;
- known difficulties link;
- rule to encode fixes where possible rather than adding prose-only docs.

### Step 8 — Patch `AGENTS.md`

If `AGENTS.md` exists, append a concise section pointing to `HARNESS.md`.

If it does not exist, create a short `AGENTS.md` that routes agents to `HARNESS.md`.

Do not duplicate the entire harness manual inside `AGENTS.md`. The root agent file should be a router, not a dumping ground.

### Step 9 — Create future-session onboarding guide

Create `harness/skills/onboard-agent-session.md`.

This is a project-local guide that a future agent session can run or read at the start of work.

It should instruct the future agent to:

1. Read `AGENTS.md` and `HARNESS.md`.
2. Run the harness CLI help.
3. Run `doctor`.
4. Check known difficulties.
5. Run build/test/health commands if configured and approved.
6. Report what is proven, what is unproven, and what the next safe action is.
7. Record any harness friction.

### Step 10 — Validate the setup

Run only approved commands.

At minimum, if allowed:

```txt
<chosen CLI invocation> --help
<chosen CLI invocation> doctor
<chosen CLI invocation> validate --dry-run
```

If the user approves real command execution, run the configured build/test/health commands.

Do not claim success if commands are missing or fail. Report accurately:

- created files;
- commands configured;
- commands not configured;
- commands run;
- results;
- known gaps;
- suggested next harness improvement.

### Step 11 — End with the magic-wand loop

Ask:

```md
If you had a magic wand, what one command, check, fixture, diagnostic, output field, or workflow change would make this harness more useful for the next session?
```

If the agent itself observed friction, propose one candidate and ask whether to encode it now or record it in the friction log.

---

## 9. Template: root `HARNESS.md`

The skill should write a version of this file to the repository root.

```md
# Engineering Harness

This repository uses a repo-local engineering harness.

The agent harness is the model runtime: Copilot, Claude Code, Codex, Cursor, Cline, or another tool that drives the agent.

The engineering harness is this repository’s project-side development loop: boot, build, run, seed, interact, observe, test, validate, diagnose, and improve.

The agent harness drives.
The engineering harness proves.

## Front door

Prefer the harness CLI over raw commands where a harness command exists.

Current harness CLI:

```txt
{{HARNESS_CLI_INVOCATION}}
```

Start with:

```txt
{{HARNESS_CLI_INVOCATION}} --help
{{HARNESS_CLI_INVOCATION}} doctor
```

## Operating loop

Use the harness to move from intent to evidence:

```txt
Boot → Interact → Observe → Validate → Improve
```

- Boot: prove the product can start from a known state.
- Interact: exercise meaningful behaviour through supported surfaces.
- Observe: capture logs, responses, screenshots, generated files, events, or other evidence.
- Validate: turn evidence into a verdict.
- Improve: encode what was learned so the next run is better.

## Core rules

### Rule 1. Make the harness the front door

Use harness commands before inventing raw command sequences.

If a command is missing, consider whether adding a harness command is better than adding another prose instruction.

### Rule 2. Encode the fix, not the memory

Do not only document repeated workarounds.

When practical, encode the solution as a command, check, fixture, default, diagnostic, template, error message, or validation path.

Documentation can orient.
Executable knowledge compounds.

### Rule 3. Prefer deterministic validation over agent inference

Do not ask the agent to infer whether it is done when the repository can prove it.

Use build, test, lint, typecheck, boot, health, smoke, architecture, or other deterministic checks where possible.

If judgement remains non-executable, route it to a human with evidence.

### Rule 4. Treat friction as harness feedback

When a human or agent gets stuck, classify the friction:

- instructions unclear;
- command missing;
- environment not bootable;
- setup too slow;
- seed data absent;
- validation weak;
- state not durable;
- error message unhelpful;
- supported path harder than shortcut.

Record material friction in `harness/state/friction-log.md`.

### Rule 5. Ask the magic-wand question

At the end of meaningful work, ask:

> If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, faster, or higher quality?

After human review, encode good suggestions into the harness.

## Current command map

The canonical command map lives in:

```txt
harness/config.json
```

Typical commands:

```txt
{{HARNESS_CLI_INVOCATION}} doctor
{{HARNESS_CLI_INVOCATION}} build
{{HARNESS_CLI_INVOCATION}} test
{{HARNESS_CLI_INVOCATION}} run
{{HARNESS_CLI_INVOCATION}} health
{{HARNESS_CLI_INVOCATION}} validate
{{HARNESS_CLI_INVOCATION}} onboard
```

Unset commands are not failures by themselves. They are harness improvement opportunities.

## Definition of done for agent work

Before claiming work is complete, an agent should report:

1. What changed.
2. Which harness commands were run.
3. Which checks passed.
4. Which checks failed or were not configured.
5. What evidence was produced.
6. What remains unproven.
7. Any harness friction discovered.
8. One concrete magic-wand improvement candidate, if any.

Agent confidence is not completion evidence.

Where completion can be checked, use the harness.

Where completion requires judgement, give the human the evidence needed to decide.

## Known difficulties

Known project difficulties live in:

```txt
harness/state/known-difficulties.md
```

Do not let this become a dumping ground. Promote repeated difficulties into commands, checks, fixtures, or diagnostics.

## Friction log

Session friction and improvement candidates live in:

```txt
harness/state/friction-log.md
```

The friction log is an improvement backlog, not a diary.

Prioritise recurring, severe, or old issues.
```

---

## 10. Template: `AGENTS.md` patch/snippet

The skill should append or create this section in `AGENTS.md`.

```md
## Engineering harness

This repository has a project-side engineering harness. Read `HARNESS.md` before starting non-trivial work.

Prefer the harness CLI over raw commands where a harness command exists:

```txt
{{HARNESS_CLI_INVOCATION}}
```

Start new sessions with:

```txt
{{HARNESS_CLI_INVOCATION}} --help
{{HARNESS_CLI_INVOCATION}} doctor
```

When work is complete, report which harness commands were run, what passed, what failed, and what remains unproven.

If you discover repeated friction, do not only add prose instructions. Consider whether the fix belongs in the harness as a command, check, fixture, diagnostic, default, template, or validation step.

At the end of meaningful work, ask the magic-wand question from `HARNESS.md` and record useful, concrete improvement candidates in `harness/state/friction-log.md` after human review.
```

---

## 11. Template: `harness/README.md`

```md
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
- `templates/` — reusable proof and friction templates.

## First commands

```txt
{{HARNESS_CLI_INVOCATION}} --help
{{HARNESS_CLI_INVOCATION}} doctor
{{HARNESS_CLI_INVOCATION}} validate --dry-run
```

## Improvement rule

When the harness causes friction, improve the harness.

Prefer encoded fixes over remembered workarounds.
```

---

## 12. Template: `harness/config.json`

```json
{
  "schema_version": 1,
  "harness": {
    "name": "repo-local engineering harness",
    "cli_language": "{{python_or_node}}",
    "created_by": "engineering-harness-setup-skill"
  },
  "commands": {
    "install": {
      "command": "",
      "description": "Install project dependencies. Leave empty until confirmed."
    },
    "build": {
      "command": "{{BUILD_COMMAND}}",
      "description": "Build or compile the product."
    },
    "test": {
      "command": "{{TEST_COMMAND}}",
      "description": "Run the main test suite."
    },
    "lint": {
      "command": "{{LINT_COMMAND}}",
      "description": "Run lint checks."
    },
    "format_check": {
      "command": "{{FORMAT_CHECK_COMMAND}}",
      "description": "Check formatting without rewriting files."
    },
    "run": {
      "command": "{{RUN_COMMAND}}",
      "description": "Start the product or development server. Long-running commands require care."
    },
    "smoke": {
      "command": "{{SMOKE_COMMAND}}",
      "description": "Run a lightweight product smoke check."
    }
  },
  "health": {
    "url": "{{HEALTH_URL}}",
    "timeout_seconds": 30,
    "description": "Optional HTTP health endpoint or smoke URL."
  },
  "validation": {
    "quick": ["doctor", "build", "test"],
    "proof": ["doctor", "build", "test", "health", "smoke"]
  },
  "notes": {
    "unset_command_policy": "An unset command is an improvement opportunity, not proof of failure unless required for the selected validation path.",
    "safety": "Do not run destructive or long-running commands without explicit user approval."
  }
}
```

The running skill should replace placeholders with confirmed values or empty strings.

---

## 13. Template: Python CLI skeleton

The skill should create this as `harness/bin/harness.py` if Python is selected.

This is a deliberately small skeleton. It is allowed to run configured commands, but it is not a full production CLI.

```python
#!/usr/bin/env python3
"""
Minimal repo-local engineering harness CLI.

This CLI is intentionally small. It provides a discoverable front door for the
project harness and wraps commands configured in harness/config.json.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
HARNESS_DIR = ROOT / "harness"
CONFIG_PATH = HARNESS_DIR / "config.json"


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def command_config(name: str) -> dict[str, Any]:
    config = load_config()
    return (config.get("commands") or {}).get(name) or {}


def print_result(payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return

    status = payload.get("status", "unknown")
    title = payload.get("title") or payload.get("command") or "harness"
    print(f"[{status}] {title}")
    for line in payload.get("messages", []):
        print(f"- {line}")
    if payload.get("next_action"):
        print(f"Next: {payload['next_action']}")


def run_shell_command(name: str, *, dry_run: bool, as_json: bool) -> int:
    cfg = command_config(name)
    cmd = (cfg.get("command") or "").strip()

    if not cmd:
        print_result(
            {
                "status": "unconfigured",
                "command": name,
                "messages": [f"No command configured for '{name}' in harness/config.json."],
                "next_action": f"Decide the repository command for '{name}' and encode it in harness/config.json.",
            },
            as_json,
        )
        return 2

    if dry_run:
        print_result(
            {
                "status": "dry-run",
                "command": name,
                "messages": [f"Would run: {cmd}"],
            },
            as_json,
        )
        return 0

    print_result(
        {
            "status": "running",
            "command": name,
            "messages": [f"Running: {cmd}"],
        },
        as_json,
    )
    completed = subprocess.run(cmd, shell=True, cwd=ROOT)
    return completed.returncode


def doctor(args: argparse.Namespace) -> int:
    config_exists = CONFIG_PATH.exists()
    config = load_config()
    messages: list[str] = []

    messages.append(f"Repository root: {ROOT}")
    messages.append(f"Harness config: {'found' if config_exists else 'missing'} at {CONFIG_PATH}")

    configured = []
    unconfigured = []
    for name, cfg in (config.get("commands") or {}).items():
        if (cfg.get("command") or "").strip():
            configured.append(name)
        else:
            unconfigured.append(name)

    if configured:
        messages.append("Configured commands: " + ", ".join(sorted(configured)))
    if unconfigured:
        messages.append("Unconfigured commands: " + ", ".join(sorted(unconfigured)))

    health = config.get("health") or {}
    if (health.get("url") or "").strip():
        messages.append(f"Health URL configured: {health['url']}")
    else:
        messages.append("Health URL not configured.")

    print_result(
        {
            "status": "pass" if config_exists else "fail",
            "title": "doctor",
            "messages": messages,
            "next_action": "Run validate --dry-run, then encode missing commands one at a time.",
        },
        args.json,
    )
    return 0 if config_exists else 1


def health(args: argparse.Namespace) -> int:
    config = load_config()
    health_cfg = config.get("health") or {}
    url = (health_cfg.get("url") or "").strip()
    timeout = int(health_cfg.get("timeout_seconds") or 30)

    if not url:
        print_result(
            {
                "status": "unconfigured",
                "title": "health",
                "messages": ["No health URL configured in harness/config.json."],
                "next_action": "Add a health URL, smoke route, or smoke command.",
            },
            args.json,
        )
        return 2

    if args.dry_run:
        print_result(
            {
                "status": "dry-run",
                "title": "health",
                "messages": [f"Would request {url} with timeout {timeout}s."],
            },
            args.json,
        )
        return 0

    start = time.time()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            status_code = response.getcode()
            elapsed_ms = int((time.time() - start) * 1000)
            ok = 200 <= status_code < 400
            print_result(
                {
                    "status": "pass" if ok else "fail",
                    "title": "health",
                    "messages": [f"{url} returned HTTP {status_code} in {elapsed_ms}ms."],
                    "next_action": None if ok else "Inspect product startup logs and health route configuration.",
                },
                args.json,
            )
            return 0 if ok else 1
    except Exception as exc:
        print_result(
            {
                "status": "fail",
                "title": "health",
                "messages": [f"Failed to reach {url}: {exc}"],
                "next_action": "Check whether the product is running and whether the health URL is correct.",
            },
            args.json,
        )
        return 1


def validate(args: argparse.Namespace) -> int:
    # Minimal layered validation. Keep this simple and improve as the repo learns.
    steps = ["build", "test"]
    exit_codes: list[int] = []

    for step in steps:
        code = run_shell_command(step, dry_run=args.dry_run, as_json=args.json)
        exit_codes.append(code)
        if code not in (0, 2):
            return code

    # Health is optional in the first version.
    health_code = health(args)
    exit_codes.append(health_code)

    # Treat unconfigured optional health as non-fatal for quick validation.
    hard_failures = [code for code in exit_codes if code not in (0, 2)]
    return 1 if hard_failures else 0


def onboard(args: argparse.Namespace) -> int:
    print("Harness onboarding checklist")
    print("1. Read AGENTS.md and HARNESS.md.")
    print("2. Run this CLI with --help.")
    print("3. Run doctor.")
    print("4. Review harness/state/known-difficulties.md.")
    print("5. Run validate --dry-run, then real validation if approved.")
    print("6. Report what is proven, unproven, and blocked.")
    return 0


def magic_wand(args: argparse.Namespace) -> int:
    print("Magic-wand question:")
    print("If you had a magic wand, what one command, flag, output field, fixture,")
    print("diagnostic, template, or workflow change would make the next run easier,")
    print("safer, faster, or higher quality?")
    print()
    print("Record reviewed candidates in harness/state/friction-log.md.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Repo-local engineering harness CLI")
    parser.add_argument("--json", action="store_true", help="Emit simple JSON where supported")
    sub = parser.add_subparsers(dest="cmd")

    p_doctor = sub.add_parser("doctor", help="Check harness readiness and configuration")
    p_doctor.set_defaults(func=doctor)

    for name in ["install", "build", "test", "lint", "format_check", "run", "smoke"]:
        p = sub.add_parser(name, help=f"Run configured '{name}' command")
        p.add_argument("--dry-run", action="store_true", help="Show command without running it")
        p.set_defaults(func=lambda args, n=name: run_shell_command(n, dry_run=args.dry_run, as_json=args.json))

    p_health = sub.add_parser("health", help="Check configured health URL")
    p_health.add_argument("--dry-run", action="store_true", help="Show health request without running it")
    p_health.set_defaults(func=health)

    p_validate = sub.add_parser("validate", help="Run layered validation")
    p_validate.add_argument("--dry-run", action="store_true", help="Show validation commands without running them")
    p_validate.set_defaults(func=validate)

    p_onboard = sub.add_parser("onboard", help="Print onboarding checklist for a fresh agent session")
    p_onboard.set_defaults(func=onboard)

    p_magic = sub.add_parser("magic-wand", help="Print the harness improvement prompt")
    p_magic.set_defaults(func=magic_wand)

    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
```

---

## 14. Template: Node CLI skeleton

The skill should create this as `harness/bin/harness.mjs` if Node is selected.

This is a deliberately small skeleton. It is allowed to run configured commands, but it is not a full production CLI.

```js
#!/usr/bin/env node
/**
 * Minimal repo-local engineering harness CLI.
 *
 * This CLI is intentionally small. It provides a discoverable front door for
 * the project harness and wraps commands configured in harness/config.json.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const HARNESS_DIR = path.join(ROOT, "harness");
const CONFIG_PATH = path.join(HARNESS_DIR, "config.json");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function printHelp() {
  console.log(`Repo-local engineering harness CLI

Usage:
  node harness/bin/harness.mjs <command> [--dry-run] [--json]

Commands:
  doctor        Check harness readiness and configuration
  build         Run configured build command
  test          Run configured test command
  lint          Run configured lint command
  format_check  Run configured formatting check command
  run           Run configured product start command
  health        Check configured health URL
  smoke         Run configured smoke command
  validate      Run layered validation
  onboard       Print fresh-session onboarding checklist
  magic-wand    Print the harness improvement prompt
`);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function printResult(payload) {
  if (hasFlag("--json")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const status = payload.status ?? "unknown";
  const title = payload.title ?? payload.command ?? "harness";
  console.log(`[${status}] ${title}`);
  for (const line of payload.messages ?? []) console.log(`- ${line}`);
  if (payload.next_action) console.log(`Next: ${payload.next_action}`);
}

function commandConfig(name) {
  const config = loadConfig();
  return config?.commands?.[name] ?? {};
}

function runShellCommand(name, { dryRun = false } = {}) {
  const cfg = commandConfig(name);
  const cmd = String(cfg.command ?? "").trim();

  if (!cmd) {
    printResult({
      status: "unconfigured",
      command: name,
      messages: [`No command configured for '${name}' in harness/config.json.`],
      next_action: `Decide the repository command for '${name}' and encode it in harness/config.json.`
    });
    return Promise.resolve(2);
  }

  if (dryRun) {
    printResult({
      status: "dry-run",
      command: name,
      messages: [`Would run: ${cmd}`]
    });
    return Promise.resolve(0);
  }

  printResult({
    status: "running",
    command: name,
    messages: [`Running: ${cmd}`]
  });

  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: ROOT, shell: true, stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function doctor() {
  const configExists = fs.existsSync(CONFIG_PATH);
  const config = loadConfig();
  const messages = [];

  messages.push(`Repository root: ${ROOT}`);
  messages.push(`Harness config: ${configExists ? "found" : "missing"} at ${CONFIG_PATH}`);

  const configured = [];
  const unconfigured = [];

  for (const [name, cfg] of Object.entries(config.commands ?? {})) {
    if (String(cfg.command ?? "").trim()) configured.push(name);
    else unconfigured.push(name);
  }

  if (configured.length) messages.push(`Configured commands: ${configured.sort().join(", ")}`);
  if (unconfigured.length) messages.push(`Unconfigured commands: ${unconfigured.sort().join(", ")}`);

  const healthUrl = String(config?.health?.url ?? "").trim();
  if (healthUrl) messages.push(`Health URL configured: ${healthUrl}`);
  else messages.push("Health URL not configured.");

  printResult({
    status: configExists ? "pass" : "fail",
    title: "doctor",
    messages,
    next_action: "Run validate --dry-run, then encode missing commands one at a time."
  });

  return configExists ? 0 : 1;
}

async function health({ dryRun = false } = {}) {
  const config = loadConfig();
  const url = String(config?.health?.url ?? "").trim();
  const timeoutSeconds = Number(config?.health?.timeout_seconds ?? 30);

  if (!url) {
    printResult({
      status: "unconfigured",
      title: "health",
      messages: ["No health URL configured in harness/config.json."],
      next_action: "Add a health URL, smoke route, or smoke command."
    });
    return 2;
  }

  if (dryRun) {
    printResult({
      status: "dry-run",
      title: "health",
      messages: [`Would request ${url} with timeout ${timeoutSeconds}s.`]
    });
    return 0;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const started = Date.now();

  try {
    const response = await fetch(url, { signal: controller.signal });
    const elapsed = Date.now() - started;
    const ok = response.status >= 200 && response.status < 400;
    printResult({
      status: ok ? "pass" : "fail",
      title: "health",
      messages: [`${url} returned HTTP ${response.status} in ${elapsed}ms.`],
      next_action: ok ? undefined : "Inspect product startup logs and health route configuration."
    });
    return ok ? 0 : 1;
  } catch (error) {
    printResult({
      status: "fail",
      title: "health",
      messages: [`Failed to reach ${url}: ${error.message}`],
      next_action: "Check whether the product is running and whether the health URL is correct."
    });
    return 1;
  } finally {
    clearTimeout(timeout);
  }
}

async function validate({ dryRun = false } = {}) {
  const steps = ["build", "test"];
  const exitCodes = [];

  for (const step of steps) {
    const code = await runShellCommand(step, { dryRun });
    exitCodes.push(code);
    if (![0, 2].includes(code)) return code;
  }

  const healthCode = await health({ dryRun });
  exitCodes.push(healthCode);

  const hardFailures = exitCodes.filter((code) => ![0, 2].includes(code));
  return hardFailures.length ? 1 : 0;
}

function onboard() {
  console.log("Harness onboarding checklist");
  console.log("1. Read AGENTS.md and HARNESS.md.");
  console.log("2. Run this CLI with --help.");
  console.log("3. Run doctor.");
  console.log("4. Review harness/state/known-difficulties.md.");
  console.log("5. Run validate --dry-run, then real validation if approved.");
  console.log("6. Report what is proven, unproven, and blocked.");
  return 0;
}

function magicWand() {
  console.log("Magic-wand question:");
  console.log("If you had a magic wand, what one command, flag, output field, fixture,");
  console.log("diagnostic, template, or workflow change would make the next run easier,");
  console.log("safer, faster, or higher quality?");
  console.log("");
  console.log("Record reviewed candidates in harness/state/friction-log.md.");
  return 0;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !["--json", "--dry-run"].includes(arg));
  const cmd = args[0];
  const dryRun = hasFlag("--dry-run");

  if (!cmd || cmd === "--help" || cmd === "help") {
    printHelp();
    return 0;
  }

  if (cmd === "doctor") return doctor();
  if (["install", "build", "test", "lint", "format_check", "run", "smoke"].includes(cmd)) {
    return await runShellCommand(cmd, { dryRun });
  }
  if (cmd === "health") return await health({ dryRun });
  if (cmd === "validate") return await validate({ dryRun });
  if (cmd === "onboard") return onboard();
  if (cmd === "magic-wand") return magicWand();

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  return 1;
}

process.exit(await main());
```

---

## 15. Template: `harness/skills/onboard-agent-session.md`

```md
# Onboard Agent Session With Engineering Harness

Use this guide at the start of a fresh agent session in this repository.

## Goal

Orient through the repo-local engineering harness before doing feature work.

The agent harness drives the model.
The engineering harness proves the product.

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

7. If something fails, classify the failure before blaming the model:

- task/spec failure;
- instruction/context failure;
- environment failure;
- command/tooling failure;
- validation failure;
- state/continuity failure;
- possible model capability gap.

8. If the failure is likely harness friction, propose one concrete encoded improvement.

## Completion rule

Do not claim the repository is ready just because the instructions were read.

Readiness is based on evidence from the harness.

If a check cannot run, say why and record what needs to be encoded next.
```

---

## 16. Template: `harness/state/known-difficulties.md`

```md
# Known Difficulties

This file lists recurring project difficulties that a fresh human or agent should know at boot.

Keep this file capped and useful. If an entry recurs, promote it into a harness command, check, fixture, diagnostic, or clearer error.

## Active known difficulties

_No known difficulties recorded yet._

## Entry format

```md
### <short name>

- Status: active | mitigated | encoded | obsolete
- Layer: instructions | tools | environment | state | feedback | validation | product
- Symptom:
- Current workaround:
- Candidate encoded fix:
- Related harness command or file:
```
```

---

## 17. Template: `harness/state/friction-log.md`

```md
# Harness Friction Log

This is an improvement backlog, not a diary.

Record material friction that made the repo harder to enter, run, validate, or improve.

Prioritise entries that are recurring, severe, stale, or easy to encode.

## Open entries

_No entries yet._

## Entry template

```md
### YYYY-MM-DD — <short title>

- Status: open | planned | encoded | dismissed
- Severity: blocker | degrading | annoying
- Recurrence: first-seen | repeated | frequent
- Layer: instructions | tools | environment | state | feedback | validation | product
- What happened:
- Evidence:
- Workaround used:
- Candidate encoded fix:
- Human decision needed:
- Next action:
```

## Magic-wand prompt

At the end of meaningful work, ask:

> If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, faster, or higher quality?
```

---

## 18. Template: `harness/templates/proof-note.md`

```md
# Harness Proof Note

- Date:
- Task / change:
- Agent / operator:
- Harness CLI invocation:

## Commands run

| Command | Result | Evidence |
|---|---|---|
|  |  |  |

## What is proven

-

## What remains unproven

-

## Human judgement required

-

## Harness friction observed

-

## Magic-wand improvement candidate

-
```

---

## 19. Template: `harness/templates/friction-entry.md`

```md
### YYYY-MM-DD — <short title>

- Status: open
- Severity: blocker | degrading | annoying
- Recurrence: first-seen | repeated | frequent
- Layer: instructions | tools | environment | state | feedback | validation | product
- What happened:
- Evidence:
- Workaround used:
- Candidate encoded fix:
- Human decision needed:
- Next action:
```

---

## 20. CLI command contract

The target skill should include this guidance for the CLI, either as `harness/templates/cli-command-contract.md` or inside `harness/README.md`.

```md
# Harness CLI Command Contract

Harness commands should be useful to both humans and agents.

## Command expectations

A harness command should say:

1. What it checked or did.
2. Whether it passed, failed, degraded, or was unconfigured.
3. What evidence was produced.
4. What the next useful action is.

## Exit code expectations

Recommended exit codes:

- `0`: passed or completed successfully.
- `1`: failed.
- `2`: unconfigured or not applicable.

## Output expectations

Human-readable text is fine for the first version.

Where practical, support `--json` so future agents do not have to scrape logs.

## Safety expectations

- Long-running commands should be explicit.
- Destructive commands require confirmation.
- Dry-run mode should be available for wrappers.
- Commands should prefer fix-forward diagnostics over vague failure.
```

---

## 21. How the target skill should encode the first commands

The target skill’s first major job is to encode the first useful command map.

The user specifically wants the setup to prompt the user or explore enough to encode:

- how to build the product;
- how to run the product;
- how to run the tests;
- how to run a health check or smoke check if available.

The skill should produce a table before writing config.

Example:

```md
## Proposed first harness commands

| Harness command | Repository command | Source | Confidence | Notes |
|---|---|---|---|---|
| build | `pnpm build` | package.json script | high | Existing script found. |
| test | `pnpm test` | package.json script | high | Existing script found. |
| run | `pnpm dev` | package.json script | medium | Long-running. Will not run without approval. |
| health | `http://localhost:3000/health` | user supplied | medium | Requires run command active. |
| smoke | _unconfigured_ | none | low | Add once first scenario is known. |
```

Then ask the user to confirm, edit, or skip.

If the user gives no health endpoint, keep `health.url` empty and create an explicit next action:

```md
Next harness improvement candidate: encode a first health or smoke check so the harness can prove the product booted, not merely that commands exist.
```

---

## 22. How the target skill should handle long-running product boot

Running the product is often long-running. The skill should be careful.

It should not blindly run `npm run dev`, `dotnet run`, `python manage.py runserver`, or similar commands in a way that traps the session.

The first version can simply encode the run command and say:

```md
Run command encoded, but not executed because it is likely long-running.
```

If the skill does implement boot validation, it should:

- ask permission;
- start the process;
- capture logs;
- wait for a configured readiness signal;
- call the health URL or smoke command;
- terminate the process cleanly;
- report logs and exit status;
- avoid leaving orphaned processes.

For the first skill version, it is acceptable to leave full boot orchestration as a planned next harness improvement.

---

## 23. Definition of successful setup

The target skill should consider setup successful only if these conditions are met:

1. `HARNESS.md` exists and contains the operating rules.
2. `harness/` exists with README, config, state, templates, and CLI skeleton.
3. `AGENTS.md` points future agents to `HARNESS.md`.
4. The chosen CLI can print help.
5. `doctor` can read config and report configured/unconfigured commands.
6. At least one of build/test/run/health has either been encoded or explicitly marked as unknown.
7. The future-session onboarding guide exists.
8. The final report says what is proven and what is not proven.

The setup should not pretend the product works unless actual evidence was produced.

---

## 24. Final setup report template

At the end of a run, the target skill should produce:

```md
## Engineering harness setup report

Created or updated:

- `HARNESS.md`
- `AGENTS.md`
- `harness/README.md`
- `harness/config.json`
- `harness/bin/{{harness_cli_file}}`
- `harness/skills/onboard-agent-session.md`
- `harness/state/known-difficulties.md`
- `harness/state/friction-log.md`
- `harness/templates/proof-note.md`
- `harness/templates/friction-entry.md`

CLI language: {{python_or_node}}
CLI invocation: `{{HARNESS_CLI_INVOCATION}}`

Configured commands:

| Harness command | Repository command | Status |
|---|---|---|
| build |  | configured/unconfigured |
| test |  | configured/unconfigured |
| run |  | configured/unconfigured |
| health |  | configured/unconfigured |
| smoke |  | configured/unconfigured |

Validation performed:

| Check | Result | Evidence |
|---|---|---|
| CLI help |  |  |
| doctor |  |  |
| validate dry-run |  |  |
| build |  |  |
| test |  |  |
| health |  |  |

What is proven:

-

What remains unproven:

-

Recommended next harness improvement:

-

Magic-wand question:

> If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, faster, or higher quality?
```

---

## 25. How the skill should be educational

The skill should teach through the setup flow, not through a long up-front essay.

Use small explanations at decision points.

Examples:

### When asking for CLI language

```md
This only chooses the harness CLI implementation language. The product itself can be any stack. Choose Python if your team is more comfortable with simple scripts, or Node if your repo already has Node available and you want npm-based invocation.
```

### When encoding commands

```md
The goal is not to reimplement your toolchain. The harness can wrap commands you already trust. The value is that future agents get one obvious front door instead of guessing from scattered scripts.
```

### When health check is missing

```md
Build and tests are useful, but they do not always prove the product can start. If there is no health or smoke check yet, we will mark it as a harness improvement candidate rather than pretending startup is proven.
```

### When patching `AGENTS.md`

```md
`AGENTS.md` should route agents to the harness. It should not become the entire harness manual. The durable details live in `HARNESS.md` and executable commands where possible.
```

### When recording friction

```md
This is not a diary. It is a backlog of places where the harness can make the next run easier, safer, or more deterministic.
```

---

## 26. Safety and trust requirements

The target skill must preserve user trust.

### 26.1 File modification safety

- Show what files will be created or patched before doing it.
- Do not overwrite existing harness files without reading them first.
- Prefer append/merge for `AGENTS.md`.
- If a conflict exists, ask the user to choose merge, replace, skip, or show patch.

### 26.2 Command execution safety

- Do not run install/build/test/run commands without permission.
- Treat long-running commands specially.
- Use dry-run first where possible.
- Do not run destructive database reset, migration, deploy, or cleanup commands without explicit confirmation.
- Do not hide command failures.

### 26.3 Claim safety

- Never claim the product is validated unless commands actually ran and passed.
- Never claim a health check exists if it is unconfigured.
- Never treat generated tests as product truth unless the behaviour target is approved.
- Never treat agent confidence as evidence.

---

## 27. Improvement loop installed by the skill

The skill should leave behind a simple improvement loop that future agents can follow.

### During work

Agents should note friction quietly when it appears:

- confusing setup;
- missing command;
- weak error;
- slow validation;
- repeated manual workaround;
- uncertain done condition;
- missing seed state;
- absent health/smoke check;
- raw command that should become a harness command.

### At natural pauses

Agents should surface the friction:

```md
I noticed one harness friction point: <summary>.
Would you like me to record it, ignore it, or encode a fix now?
```

### At session end

Agents should ask the magic-wand question and recommend at most one concrete next improvement.

### During harness maintenance

The team should periodically review `harness/state/friction-log.md` and choose entries to:

- dismiss;
- keep open;
- convert to a task;
- encode immediately;
- promote into `known-difficulties.md` temporarily;
- delete as obsolete.

Measure value by encoded improvements, not by the number of logged notes.

---

## 28. Recommended first harness improvements after setup

The target skill should suggest these only after the initial setup completes.

Prioritise based on the actual repo.

1. Add or confirm a health endpoint or smoke route.
2. Add `harness validate` as a layered command: doctor → build → test → health/smoke.
3. Add a first seed or fixture command so the product boots into meaningful state.
4. Add structured JSON output for key commands.
5. Add architecture or dependency-direction checks for repeated architecture drift.
6. Add proof-note generation after validation.
7. Add a small set of known-bad cases to regression-test the harness itself.
8. Add cleanup/idempotent reset for local state.
9. Add fast-loop and proof-loop distinction.
10. Garbage-collect stale instructions that have become executable commands.

---

## 29. Fast loop vs proof loop

The target skill should optionally introduce this distinction once commands are encoded.

- The **fast loop** is used during development. It should be quick and cheap.
- The **proof loop** is used before claiming done. It should be trustworthy.

Example:

```json
"validation": {
  "fast": ["test"],
  "quick": ["doctor", "build", "test"],
  "proof": ["doctor", "build", "test", "health", "smoke"]
}
```

The skill should not force every tiny edit through the slowest proof loop.

It should also not let fast-loop success pretend to be final proof.

---

## 30. Handling existing project workflows

The skill should integrate with existing workflows rather than replacing them.

If the repo already uses Make, Just, npm scripts, tox, nox, Pants, Bazel, Gradle, Maven, dotnet, Cargo, or a custom script folder, the harness CLI can wrap those commands.

The harness is a façade over trusted project operations, not a rewrite of the toolchain.

If the repo already has CI checks, the harness should mirror or invoke the local equivalent where practical.

If the repo already has `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or other agent instruction files, the skill should prefer routing them to `HARNESS.md` instead of duplicating full instructions everywhere.

---

## 31. Brownfield and partial setup behaviour

Many repositories will not be cleanly harnessable on first run.

If the product cannot build, start, or test, the target skill should still create a useful harness by making the current gap explicit.

Example report:

```md
The harness setup completed, but the product is not yet proven bootable.

What is proven:
- The harness CLI exists and can read config.
- `doctor` runs and reports current command configuration.
- The test command is encoded.

What is unproven:
- Build command is unknown.
- Run command is unknown.
- No health or smoke check is configured.

Next harness improvement:
- Identify the product boot command and encode it as `run`, then add a health or smoke check.
```

Do not block all setup just because the repo is incomplete.

The first harness often starts by making incompleteness visible.

---

## 32. Authoring instructions for the agent writing the skill

Now write the actual skill package.

### 32.1 `SKILL.md` requirements

The `SKILL.md` file should contain:

1. Skill purpose.
2. When to use the skill.
3. What files it creates.
4. The setup flow.
5. Decision questions.
6. Repository inspection guidance.
7. File modification rules.
8. Command execution safety.
9. Template materialisation instructions.
10. Final report format.
11. The magic-wand closeout.

### 32.2 Template requirements

Create the templates listed in Section 4.

The templates should be parameterised with placeholders like:

```txt
{{HARNESS_CLI_INVOCATION}}
{{python_or_node}}
{{BUILD_COMMAND}}
{{TEST_COMMAND}}
{{RUN_COMMAND}}
{{HEALTH_URL}}
{{SMOKE_COMMAND}}
```

The running skill should replace placeholders or leave them visibly empty if unknown.

### 32.3 Tone requirements

The skill should be:

- direct;
- practical;
- educational;
- non-invasive;
- precise about evidence;
- skeptical of agent confidence;
- biased toward executable fixes;
- respectful of human decision points.

Avoid hype.

Avoid implying the harness is “done” after initial setup.

Use language like:

- “first useful version”;
- “candidate command”;
- “configured/unconfigured”;
- “proven/unproven”;
- “encode the fix”;
- “harness improvement candidate”.

### 32.4 Success criteria for the authored skill

The authored skill is acceptable if another agent can run it in an arbitrary repository and it can:

- explain what it is doing;
- inspect the repo;
- ask the key decisions;
- create the basic harness files;
- create either a Python or Node CLI skeleton;
- encode build/test/run/health commands when known;
- patch `AGENTS.md` to route future agents to the harness;
- create a future-session onboarding guide;
- safely validate the setup;
- report proof and gaps honestly;
- leave behind a friction/improvement loop.

---

## 33. Suggested `SKILL.md` outline for the authored skill

The agent writing the skill can use this outline directly.

```md
# Engineering Harness Setup

## Purpose

Set up the first useful version of a repo-local engineering harness for humans and coding agents.

## Use this skill when

- the repo does not yet have a clear harness front door;
- future agent sessions need repeatable onboarding;
- build/test/run knowledge is scattered across docs and scripts;
- the user wants to encode friction into commands and checks rather than more prose;
- the repo needs a basic Boot → Interact → Observe → Validate → Improve loop.

## Principles

- Agent harness drives; engineering harness proves.
- Make the harness the front door.
- Encode the fix, not the memory.
- Prefer deterministic validation over agent inference.
- Treat agent friction as harness feedback.
- Ask the magic-wand question, then close the loop.

## Setup flow

1. Explain the target outcome.
2. Inspect repo signals.
3. Ask key decisions.
4. Create `HARNESS.md` and `harness/`.
5. Create chosen CLI skeleton.
6. Encode initial commands.
7. Patch or create `AGENTS.md`.
8. Create onboarding guide.
9. Validate safely.
10. Report what is proven, unproven, and next.

## Safety

Do not overwrite existing files without inspection.
Do not run commands without permission.
Do not claim product proof without evidence.

## Final report

Use the setup report template.
```

---

## 34. One-pass example of the target skill in action

This section is for the skill author. It shows the expected behaviour.

```txt
User: Set up the engineering harness skill in this repo.

Agent:
I’ll create the first useful version of a repo-local engineering harness.
The agent harness drives the model. The engineering harness proves the product.

I’ll inspect the repo, ask a few decisions, then create HARNESS.md, harness/, a small CLI, and an AGENTS.md pointer.

[Agent inspects repo]

Detected:
- package.json found
- pnpm-lock.yaml found
- scripts: build, test, dev, lint
- no obvious health endpoint found

Before I write files:
1. CLI language for the harness: Python or Node?
2. Use these initial commands?
   - build: pnpm build
   - test: pnpm test
   - run: pnpm dev
   - lint: pnpm lint
3. Health check: do you have a URL or smoke command, or should I leave it unconfigured?
4. May I patch/create AGENTS.md to point future agents at HARNESS.md?
5. After setup, may I run CLI help and doctor? Should build/test be dry-run only?

User: Node. Yes to commands. Leave health blank. Patch AGENTS. Dry-run only.

Agent:
[Creates files]
[Runs node harness/bin/harness.mjs --help]
[Runs node harness/bin/harness.mjs doctor]
[Runs node harness/bin/harness.mjs validate --dry-run]

Engineering harness setup report:
- Created HARNESS.md
- Created harness/config.json
- Created harness/bin/harness.mjs
- Created onboarding guide
- Patched AGENTS.md

What is proven:
- Harness CLI exists and can print help.
- Doctor can read config.
- Build/test/run commands are encoded.

What remains unproven:
- Product has not been built or tested in this run.
- Product boot is not proven.
- No health or smoke check is configured.

Recommended next harness improvement:
- Add a health URL or smoke command so harness validation can prove startup.

Magic-wand question:
If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, faster, or higher quality?
```

---

## 35. Strong defaults

When in doubt, the target skill should use these defaults:

- Root instructions file: `HARNESS.md`
- Harness folder: `harness/`
- Config file: `harness/config.json`
- Future-session guide: `harness/skills/onboard-agent-session.md`
- Friction log: `harness/state/friction-log.md`
- Known difficulties: `harness/state/known-difficulties.md`
- Proof folder: `harness/proofs/`
- Python CLI path: `harness/bin/harness.py`
- Node CLI path: `harness/bin/harness.mjs`
- First commands to encode: build, test, run, health/smoke
- Initial validation: help, doctor, validate dry-run
- Final question: magic-wand improvement candidate

---

## 36. The shortest acceptable version of the setup

If the target agent is constrained by time or tool access, it should still create this minimum:

```txt
HARNESS.md
AGENTS.md patch
harness/README.md
harness/config.json
harness/bin/harness.py OR harness/bin/harness.mjs
harness/skills/onboard-agent-session.md
harness/state/friction-log.md
```

And it should still encode or explicitly mark unknown:

- build command;
- test command;
- run command;
- health or smoke check.

The minimum final report must say:

- what was created;
- what commands are configured;
- what commands are missing;
- what was run;
- what is proven;
- what remains unproven;
- the next harness improvement.

---

## 37. Final note for the skill author

This skill should make the first harness appear quickly, but its deeper purpose is to install a habit:

> When the agent learns how to work in the codebase, the repository should learn too.

Do not let the skill become a markdown generator.

Use markdown to route, orient, and preserve state.

Use the harness to encode commands, checks, fixtures, diagnostics, and validation paths.

The first setup is only the start.

The harness becomes valuable when future sessions stop rediscovering the same friction.

---
name: boot-harness
description: Boot the repo-local engineering harness at the start of an engineering session. Reads the harness contract, runs safe doctor/health checks, surfaces known difficulties and back-pressure gaps, checks signal readiness, and produces a readiness report.
---
# boot-harness

Use this skill when a user says "boot the harness", "start the harness", "get ready to work", "start an engineering session", or asks you to begin work through the repo-local engineering harness.

This skill is the **clock-in ritual** for harness engineering. It does not create the harness. It proves whether the current repository already has enough harness surface to start work safely, and it reminds the agent that every session must feed the self-improving loop.

The agent must leave the harness better informed than it found it: use the supported path, capture friction, and propose one concrete encoded improvement when the harness is missing a command, check, fixture, diagnostic, evidence path, sensor, or deterministic validation signal.

If no harness is present, stop and recommend `engineering-harness-setup`.

---

## Input

```md
$ARGUMENTS
# Optional hints:
# - a task or feature the user is about to work on
# - a preferred validation tier: fast | quick | proof
# - permission to start long-running services
```

---

## Step 1: Find the harness

Look for the harness contract in this order:

1. `docs/project-rules/engineering-harness.md`
2. `docs/project-rules/agent-harness.md` (legacy)
3. `docs/project-rules/harness.md` (legacy)
4. `HARNESS.md` (root fallback)

If none exists, stop immediately. Do not infer boot commands from package files. Report:

```md
No engineering harness found.

Run `engineering-harness-setup` first so this repository has a harness contract, boot instructions, health checks, and an AGENTS.md signpost.
```

If a legacy path is found, continue but include a one-line note that `docs/project-rules/engineering-harness.md` is the preferred current path.

---

## Step 2: Read the agent route

Read `AGENTS.md` if present. Look for an engineering-harness signpost, especially:

```md
<!-- ENGINEERING-HARNESS-SETUP START -->
```

If the signpost is missing, continue but include it as harness friction in the readiness report. Do not patch files from this skill unless the user explicitly asks.

---

## Step 3: Locate the self-improving loop

Before running checks, identify where this repository records harness learning. Look for:

- `## Known Difficulties` in the harness contract;
- `harness/state/friction-log.md`;
- `docs/compound/agents/**/*.retro.md`;
- `docs/compound/_buffers/<agent>.session-buffer.md`;
- `harness/templates/magic-wand-prompt.md`;
- `harness/templates/retrospective-schema.json`;
- any harness section that explains Boot → Interact → Observe → Validate → Improve.

If a friction log or retro location exists, remember it for the readiness report. If none exists, continue but mark this as harness friction: the repo can boot only partially because the Improve stage has nowhere durable to land.

If `docs/compound/` is missing, recommend `compound-0-setup`. If the current agent's session buffer exists and is non-empty, recommend `compound-2-bubble` before starting new work so prior learning is not stranded.

The agent must internalize this rule before work begins:

> Boot is not just startup. Boot orients the agent to the loop it must improve. If the session exposes repeated pain, missing commands, unclear errors, weak validation, missing fixtures, or absent evidence paths, the agent must name the gap and propose an encoded harness fix.

Also internalize the back-pressure rule:

> Improve is not only "make the agent experience easier." Improve also means adding sensors and checks that let the harness prove more. If the agent must infer runtime behaviour, architecture compliance, security posture, schema validity, or user-flow correctness, record the missing signal as harness friction.

---

## Step 4: Extract the boot contract

From the harness contract, extract:

- project type;
- maturity level;
- boot command;
- health check command or URL;
- expected healthy response;
- idempotence notes;
- primary interaction surface;
- observation/evidence paths;
- validation tiers or checklist;
- signals/back-pressure section if present;
- runtime inspectability path;
- smoke/user-flow checks;
- architecture, static-analysis, CodeQL, security, dependency, or schema checks;
- known difficulties;
- friction log or retro location;
- magic-wand / improvement prompt;
- history / last validation if present.

Keep this extraction short. The goal is orientation, not reprinting the harness document.

---

## Step 5: Run safe checks

Run the safest checks first.

Preferred order:

1. Harness CLI help or doctor command, if the harness names one.
2. Health check, if configured.
3. Dry-run validation, if configured.
4. Fast validation tier, if the user asked for it or the harness says it is safe.
5. Dry-run signal checks, if configured (`observe`, `smoke`, `arch`, `security`, `codeql`, or equivalent).

Rules:

- If the product is already healthy, do not start a boot command.
- If the health check fails, inspect the boot command and idempotence notes before running it.
- Do not start long-running services unless the user has granted permission or the harness explicitly marks the boot command as idempotent and safe.
- Prefer dry-run validation before real validation when the configured commands are unfamiliar.
- Do not run heavyweight static/security scans unless the harness marks them as safe for session start or the user asks for them. Report configured availability instead.
- Capture exact commands run and outcomes.

---

## Step 6: Surface known difficulties and improvement obligations

Read `## Known Difficulties` if present.

Report only the top few relevant items for this session. If the user supplied a task hint, bias toward difficulties that affect the task's likely surface, such as build, tests, auth, environment, data, boot, observe, or validation.

If no known difficulties are listed, say so briefly. Do not treat an empty table as success; it may mean the improvement loop has not started yet.

Also report the session's improvement obligation:

- where friction should be recorded;
- what counts as friction in this repo;
- what form an encoded fix should take;
- which validation command should prove the fix later.
- which missing signal, if any, made the agent depend on inference or human review.

Use this framing:

```md
Self-improving loop for this session:
1. Use the harness-supported path.
2. If the harness blocks, confuses, slows, or fails to prove the work, name the friction.
3. Prefer an encoded fix: command, check, fixture, diagnostic, default, template, evidence path, sensor, or deterministic validation signal.
4. Before claiming done, report what harness friction was found and what should be encoded next.
```

---

## Step 7: Produce readiness report

End with a compact report:

```md
## Harness boot report

- Harness contract: found / missing
- Agent route in AGENTS.md: found / missing
- Maturity: L?
- Boot command: configured / missing / not run / run
- Health: pass / fail / unconfigured / not run
- Interact surface: configured / missing
- Observe/evidence path: configured / missing
- Runtime inspectability: configured / missing
- Product smoke path: configured / missing
- Architecture/static checks: configured / missing
- Security/dependency/schema checks: configured / missing
- Back-pressure gaps:
- Known difficulties reviewed: yes / no
- Improve loop location: found / missing
- Magic-wand prompt or equivalent: found / missing
- Compound ledger: ready / missing / disabled / partial
- Session buffer: empty / non-empty / missing
- Commands run:
- Passing evidence:
- Failing evidence:
- Harness friction:
- Required improvement follow-up:
- Recommended next action:
```

The recommended next action should be one of:

- proceed with the user's task using the named fast loop;
- run a stronger validation tier first;
- ask for permission to start the boot command;
- run `engineering-harness-setup` because no harness exists;
- update the harness because a required command, health check, evidence path, sensor, deterministic check, or AGENTS.md signpost is missing.
- record a concrete harness improvement before starting feature work because the Improve stage is missing.

---

## Completion rule

Do not claim the repository is ready just because the harness file exists.

Readiness is evidence-backed:

- the harness contract was found;
- the route for future agents was checked;
- safe doctor/health/dry-run checks were attempted where configured;
- signal coverage was checked for runtime inspection, smoke/user-flow proof, architecture/static analysis, and security/dependency/schema checks;
- known difficulties were reviewed;
- the friction / retro / magic-wand location was identified or reported missing;
- missing surfaces were named as harness friction;
- the agent knows where to report the one concrete encoded improvement candidate at the end of meaningful work.

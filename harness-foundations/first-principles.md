Harness engineering is the practice of productising the software-development loop so humans and agents can move from intent to evidence, then encode what they learn into the next run. Agent harnesses make models operable; engineering harnesses make products operable. Productive agentic engineering needs both, but the project-side engineering harness is what proves real behaviour.

## Boundary and ontology

#### 1. Engineering harness and agent harness are distinct layers

An engineering harness makes the product operable, while an agent harness makes the model operable.

#### 2. The agent harness drives but does not replace the engineering harness

Runtime capabilities like tools, permissions, memory, orchestration, and session state still need a project substrate that can boot, run, seed, observe, and prove behaviour.

#### 3. Product proof belongs to the engineering harness

A model runtime can coordinate work, but only the project-side harness can prove the actual software behaves correctly.

#### 4. The harness is the product

Development infrastructure is not scaffolding; it is the product surface every future feature, experiment, human, and agent passes through.

#### 5. Harness engineering is not a silver bullet

Engineering fundamentals do not change: harness engineering amplifies disciplined delivery and may make good specification, design, review, prioritisation, and spec-driven development easier to achieve, but it must not water them down or pretend to replace them.

#### 6. Harnessability is a property of the codebase

Some products, especially brownfield systems, must be changed before they can be operated effectively through a harness.

#### 7. A harness is an interface to complexity

The point is not to eliminate complex systems, but to make them accessible to safe experimentation and evidence gathering.

#### 8. Harness engineering is iterative - let it cook

The right harness emerges through repeated runs, observed failures, and encoded improvements, not from a finished playbook.

#### 9. A harness has multiple subsystems

Instructions, tools, environment, state, and feedback all contribute to whether model capability becomes reliable execution.

## The operating loop

#### 10. The engineering harness closes the product-development loop

Its core job is to move a human or agent from intent to evidence through Boot → Interact → Observe → Validate → Improve.

#### 11. Boot is the first proof

Every serious run should begin by proving the product can start from a known state.

##### 11a. Cold-start orientation

A fresh human or agent should be able to answer what the system is, how it is organised, how to run it, how to verify it, and where the work currently stands from repository contents alone.

##### 11b. Initialisation contract

Before feature work begins, the harness should establish the runnable environment, dependencies, seed/fixture path, test framework, progress state, and first clean checkpoint.

##### 11c. Boot-and-validate command

A composite command should build or install if needed, start the product, wait for readiness, and prove the loop with a health endpoint or smoke route.

#### 12. Health checks are orientation, not just diagnostics

A boot or doctor command both validates readiness and reminds the agent how the project wants to be operated.

#### 13. Interact through supported product surfaces

The harness should expose repeatable ways to exercise real user or system behaviour instead of relying on private implementation shortcuts.

#### 14. Observation makes hidden state portable

Logs, traces, screenshots, database checks, responses, events, and diagnostics should make behaviour inspectable rather than guessed.

#### 15. Validation must produce a verdict

A useful harness turns observations into explicit pass, fail, degraded, expected, or actual outcomes.

#### 16. Improve is what makes the harness compound

Without Improve the harness is only a test rig, but with Improve each run can make the next run faster, clearer, or safer.

#### 17. Loop time is a first-class metric

The harness should reduce the time from boot to validated evidence while preserving quality and reducing context pressure.

## Encoding and interface design

#### 18. Encode, do not merely document

A wiki note is weaker than a command, fixture, check, recipe, default, error message, template, or validation that does the thing.

#### 19. The paved path must beat the shortcut

If raw shell commands or tribal workarounds feel easier than the harness, the harness is not finished.

#### 20. CLIs are natural harness surfaces

CLIs suit agents because they expose verbs, help text, stable arguments, exit codes, and parseable output.

#### 21. The CLI is the API

Harness commands should return structured status, data, errors, and failure details rather than forcing agents to scrape logs.

#### 22. Diagnostics should prescribe the fix

A good doctor command identifies the failed layer and tells the operator or agent the next useful action.

#### 23. Seed data is part of the product surface

A system that boots but has no meaningful state is still hard to explore, validate, or improve.

#### 24. Agent-readable guidance is part of the engineering harness

Instructions that explain how to boot, run, observe, validate, and improve the product loop should be versioned and testable.

#### 25. Dogfood the supported surface

Bypassing the harness hides exactly the UX gaps that humans and agents need the harness to reveal.

#### 26. Keep the harness outside the domain unless promoted

The harness may consume domain contracts, but it should not silently become part of the business domain.

## Verification and completion control

#### 27. Definition of Done must be machine-verifiable

Completion criteria should be executable checks such as tests, lint, type checks, builds, startup checks, and behavioural acceptance tests.

#### 28. Agent confidence is not completion evidence

The harness must close the verification gap between what the agent claims and what the system actually does.

#### 29. Completion belongs to the harness, not the agent

The agent can report progress, but the harness should independently decide whether the work is done.

#### 30. Termination should be layered

Static checks, runtime checks, and system-level checks should be sequenced so cheap failures are caught before expensive validation.

#### 31. Do less but finish

WIP=1 is the safest default because agents are prone to overreach and under-finish when scope is loose.

#### 32. Feature state must be harness-controlled

A feature should move to passing only when the verification command succeeds, not when the agent edits a status field.

#### 33. Verification must cover experienced failure modes

A green unit or typecheck suite is insufficient if the team’s real failures happen during startup, rendering, hydration, integration, or side effects.

#### 34. End-to-end tests change agent behaviour

E2E checks create pressure for agents to prove real workflows instead of producing locally plausible code.

#### 35. Error messages should teach repair

Agent-facing errors should say what failed, why it likely failed, and how to fix it.

#### 36. Clean state is part of done

A session is not complete unless build, tests, progress, artefacts, and startup are all left in a usable state.

#### 37. Cleanup must be idempotent

Setup and cleanup paths should be safe to rerun because repeated runs are normal harness behaviour.

## State, knowledge, and continuity

#### 38. The repo is the system of record

Knowledge that is not in the repository is effectively invisible to the agent during project work.

#### 39. Give a map, not a manual

Agent-facing guidance should orient the agent to where knowledge and commands live rather than becoming a giant context-heavy encyclopedia.

#### 40. State must survive the chat

Progress, evidence, decisions, outputs, and retrospectives should become durable artefacts rather than disappearing with the session.

#### 41. Run history can become harness evidence

Agent outputs, validation state, metadata, and retros can feed future project-harness improvements when preserved with provenance.

#### 42. Known difficulties should be visible at boot

Recurring friction should be surfaced early so new humans or agents do not rediscover the same traps.

#### 43. Determinism enables parallel work

Predictable ports, slots, environments, and worktrees prevent hidden coupling between concurrent humans, agents, and containers.

## Feedback, retrospection, and compounding

#### 44. Friction is product feedback

Agent confusion, flaky steps, missing fixtures, unclear errors, and slow validation are signals about the harness, not just annoyances.

#### 45. Agents are real users of the engineering harness

Agents expose UX failures because they do not naturally inherit local tribal knowledge.

#### 46. Magic-wand feedback is a harness-design primitive

Asking what one concrete command, flag, output field, fixture, diagnostic, or workflow change would help turns usage into improvement signal.

#### 47. Retrospectives need a lifecycle

Feedback only compounds when it is captured, bubbled, harvested, prioritised, encoded, and later validated.

#### 48. Ledgers are improvement backlogs, not diaries

Friction logs should be structured, ranked, and harvested so the harness owner can see where velocity is leaking.

#### 49. Measure encoded improvement, not activity volume

The useful signal is how many recurring frictions became encoded fixes, not how many retros were written.

#### 50. User control preserves trust

Humans should decide whether a retro entry is saved, dismissed, turned into a task, turned into a plan, or encoded as a fix.

#### 51. The improvement system must stay low ceremony

If the ledger or retro process becomes bureaucratic, humans and agents will bypass it.

#### 52. Prioritise recurrence, severity, and age

Repeated blockers matter more than isolated annoyances, and stale unresolved issues should become visible.

## Measurement and adoption

#### 53. Measure facts separately from interpretation

Harness metrics should distinguish evidence from classification so measurement does not become productivity theatre.

#### 54. Measure ease of entry, safety of change, speed of proof, and compounding

The harness is valuable when it makes work easier to start, safer to modify, faster to validate, and less repetitive.

#### 55. Harness UX is adoption infrastructure

Discoverability, defaults, one-command flows, readable status, and useful errors are not polish; they are what make the harness used.

#### 56. Harnesses should be periodically simplified

Components that once helped may become unnecessary as models, tools, or project practices improve.

#### 57. Harness work should be cohesive with SDD

The strongest form is not a parallel process but a harness-aware SDD flow where specification, proof, and compounding value reinforce each other.

#### 58. The core thesis is productising the loop

Harness engineering is the practice of making the project development loop explicit, operable, measurable, and compounding for humans and agents.

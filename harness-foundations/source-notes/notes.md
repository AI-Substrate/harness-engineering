# Source Notes 1: Engineering Harness Research Foundation

This is a public-safe synthesis of early research notes. Source IDs are retained for traceability, but raw sources, local file paths, project-specific names, exact private metrics, and implementation details have been removed.

## Boundary note

The central distinction is between two different harness layers.

An **engineering harness** is the project-side product development loop: commands, recipes, fixtures, seed data, boot, build, run, health, observe, verify, diagnose, and improve flows.

An **agent harness** is the runtime or control plane around a model: tool dispatch, permissions, context, session management, orchestration, memory, state, and execution environment.

An agent harness can drive an engineering harness, but it cannot replace one. If the product cannot boot, run, seed, and prove behaviour, the agent runtime has nothing reliable to operate.

## Engineering harness directives

### 1. Do not confuse the two harnesses

Keep the engineering harness and the agent harness as distinct layers. The engineering harness makes the product operable. The agent harness makes the model operable.

### 2. Close the product-development loop

A useful engineering harness lets a human or agent move from intent to evidence through **Boot → Interact → Observe → Validate → Improve**.

The goal is less friction, faster iteration, and stronger proof of real behaviour.

### 3. Make the harness easier than bypassing it

If raw shell commands, ad hoc scripts, manual setup, or tribal knowledge feel easier than the supported path, the harness is not finished.

The paved path should be discoverable, callable, observable, and reliable.

### 4. Encode the solution, not just the lesson

Do not merely record how to do something. Improve the loop with a command, recipe, fixture, check, default, error message, template, validation, or diagnostic.

Executable knowledge beats remembered knowledge.

### 5. Treat friction as product feedback

Agent confusion, repeated setup pain, flaky steps, unclear errors, missing fixtures, and slow validation are product feedback for the engineering harness.

A learning is only complete when the next run benefits from it.

### 6. Prefer interfaces agents can discover and operate

CLIs work especially well as engineering-harness surfaces because they expose verbs, help text, stable arguments, exit codes, non-interactive flags, and parseable output.

A CLI is not the whole harness, but it is often an excellent front door to the harness.

## First-class framing

### Boot → Interact → Observe → Validate → Improve

An engineering harness makes the product-development loop explicit and operable.

**Boot** starts the system from a known state. A composite command can install or build if needed, start the system, wait for readiness, and ping a health endpoint or smoke route.

**Interact** exercises meaningful product behaviour through supported surfaces: an API, CLI, page, workflow, form, fixture-backed object, or domain scenario.

**Observe** captures what happened in forms a human or agent can inspect: structured responses, logs, traces, screenshots, console messages, database checks, events, generated files, timings, and diagnostics.

**Validate** turns observations into a verdict: pass, fail, degraded, expected versus actual, or contract satisfied versus not satisfied.

**Improve** encodes what was learned back into the harness so the next run is faster, clearer, or more reliable.

Without Improve, the harness is only a test rig. With Improve, the harness compounds.

## High-leverage patterns from the early research

### The harness should be a productised development surface

Development infrastructure is not throwaway scaffolding. It is the surface every future feature, experiment, human, and agent passes through.

A named, maintained harness gives a team one place to discuss, measure, improve, and own the development loop.

### Accessibility beats rewrite-or-freeze

For difficult legacy systems, the first move is often to make the system accessible to experimentation rather than to rewrite it.

A harness is an interface to complexity. It lets humans and agents ask questions and produce evidence without first mastering the entire system.

### Difficulty is structured product feedback

Friction is most useful when it is captured with enough structure to act on: category, impact, workaround, mitigation status, and recurrence.

The ledger is not a diary. It is a roadmap for where velocity is leaking and where the harness can compound value.

### Each session should leave a gift

The important question is not only whether the current task finished. It is whether the next similar task is easier.

Each run should leave behind a gift: a command, fixture, check, note-to-encode, diagnostic, or mitigation that improves future work.

### Speed without evidence is not value

Faster output is only useful when information quality improves too.

A good harness produces trustworthy evidence: structured outputs, logs, database checks, API responses, screenshots where useful, and repeatable verification commands.

### Agents are real harness users

Agents expose harness UX problems because they do not naturally inherit local tribal workarounds.

Agent confusion is not a nuisance. It is usability feedback for the productised development surface.

### Experiments beat perfect planning

A harness makes experiments cheap enough that weak ideas can be discarded quickly and strong ideas can be proven end to end.

Useful experiments state the hypothesis, success criteria, failure criteria, validation path, and decision that will follow.

### Parallel research can improve information quality

Multiple focused agents can explore separate lenses of a complex system and return structured findings faster than one broad pass.

This works best when the agents have bounded goals, source expectations, and structured outputs.

### Fast loop and proof loop serve different jobs

A mature harness distinguishes the common loop from the proof loop.

The common loop should be fast enough for local iteration. The proof loop should be strong enough for acceptance evidence.

Do not force every small edit through the slowest possible gate. Do not let fast-loop success pretend to be final proof.

### Diagnostics should prescribe fixes

Health checks should not only fail. They should identify the failed layer and point to the next useful action.

A good doctor command is executable documentation. It turns environmental ambiguity into a bounded checklist.

### Structured CLI output is an agent contract

Human-friendly text is not enough for agentic workflows. Commands should return clear status, stable exit codes, structured data where appropriate, typed errors, and remediation guidance.

If agents must scrape logs to decide what happened, the harness has leaked implementation detail.

### Determinism enables parallel work

Predictable ports, slots, environments, worktrees, and setup paths prevent hidden coupling between concurrent humans, agents, and containers.

A good harness should make parallel work predictable rather than relying on people to coordinate manually.

### Verification must cover experienced failure modes

A green unit or typecheck suite can still miss failures that only appear when the product boots, compiles, renders, hydrates, integrates, or performs side effects.

Engineering harnesses should encode the failure modes the team actually experiences, not only generic test categories.

### Seed data is part of the product surface

A system that boots but has no meaningful state is still hard to explore, validate, or improve.

Fixtures and seed commands are product affordances. They make the first real interaction obvious.

### Retrospectives compound only when closed

Asking agents for feedback is not enough. The feedback must become a tracked improvement, be implemented, and be validated by a later run.

A retrospective without a closing workflow is just another log file.

### Keep the harness outside the business domain unless promoted

The harness can consume product and domain contracts without silently becoming part of the business domain.

This protects domain boundaries while still allowing the harness to be deeply useful.

### Agent-run history can feed engineering-harness evidence

Agent output should survive the chat session as structured artefacts with provenance where useful.

Using those artefacts to identify friction and encode project improvements is engineering-harness practice, even when the capture mechanism is provided by an agent harness.

### Companion review is not product verification

A companion or reviewer agent can improve quality and catch drift, but it is not a replacement for the engineering harness proving the product actually runs.

Review is a useful sensor. Product proof still belongs to the project-side harness.

### Measurement must distinguish facts from interpretation

Harness-effectiveness measurement should improve the loop, not rank individuals.

Measure whether the harness makes work easier to enter, safer to change, faster to prove, and more likely to compound.

Avoid productivity theatre, unsupported causal claims, and composite rankings that hide uncertainty.

### Dogfood the supported surface

If the harness exposes a supported CLI, API, or workflow, use it.

Bypassing the harness may unblock one session, but it prevents the harness from learning what surface it lacks.

## Public tutorial angle

A useful public tutorial can build from these sections:

1. Engineering harness versus agent harness.
2. Why engineering harnesses matter.
3. The minimal lifecycle: Boot → Interact → Observe → Validate → Improve.
4. Fast loop versus proof loop.
5. Doctor diagnostics and fix-forward errors.
6. Structured CLI envelopes for humans and agents.
7. Deterministic environments and isolated work.
8. Seed data and meaningful first interaction.
9. Magic-wand retrospectives as harness feedback.
10. Difficulty ledger and wishlist patterns.
11. Encoding improvements back into commands, fixtures, checks, and templates.
12. Agent harnesses as users and drivers, not substitutes.
13. Measurement without productivity theatre.
14. Evidence and validation patterns.
15. Experiment loops.

## Open questions

- Which claims should be backed by public citations before publication?
- Which private-source evidence should remain generalised rather than quoted or quantified?
- What is the smallest runnable example that demonstrates the compounding loop without private context?
- Which command surface is most appropriate for the tutorial: `just`, `make`, npm scripts, shell scripts, or a tiny purpose-built CLI?

## Source registry

### S001. Private legacy-platform harness experiment

Type: private technical insight source about improving work on a difficult legacy platform.

Handling: use only sanitised and generalised learning. Do not reuse identifying names, internal codewords, person names, company names, direct private quotes, exact metrics, or implementation-specific details.

### S002. Private product engineering-harness case study

Type: working product repository with an implemented engineering harness.

Handling: reference only as a source ID. Do not publish project names, local paths, internal plan numbers, exact commits, implementation-specific commands, or source excerpts unless later approved.

### S003. Agent harness and project-harness case study

Type: agent harness/runtime source with examples of run history, schemas, permissions, retrospectives, measurement, and its own project-side engineering harness.

Handling: use for agent-harness boundary calibration and for engineering-harness improvement patterns when those mechanisms improve a project/product development loop. Do not publish local paths or unreleased implementation details.

### S004. Public terminology research on agent harnesses

Type: public terminology calibration for the phrase “agent harness”.

Handling: use only verified original public URLs for citation and vocabulary calibration.

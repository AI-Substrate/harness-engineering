# Source Notes 2: Harness and Compounding Skills

This is a public-safe synthesis of local skill sources. Source IDs are retained for traceability, but local paths, raw instructions, and implementation-specific details have been removed.

## Boundary note

Some source material uses agent-facing overlay language. For this foundation, keep the boundary crisp.

An **agent harness** is the runtime or control plane around a model: tool dispatch, permissions, context, memory, orchestration, state, and execution environment.

An **engineering harness** is the project-side product development loop: boot, build, run, seed, interact, observe, validate, diagnose, and improve.

Agent runtimes can collect retros, enforce schemas, run companions, or preserve run artefacts. Those mechanisms become engineering-harness practices only when they improve the project/product loop.

## First principles extracted

### 1. The harness is a productised development surface

Development infrastructure is a first-class surface because every future feature, experiment, and agent run passes through it.

The harness should be judged by whether it makes the next run cheaper, safer, clearer, and more repeatable.

A feature is incomplete if the harness cannot help prove it or if the change leaves repeated manual work behind.

### 2. The engineering harness has a substrate and an agent-facing surface

The substrate includes recipes, build commands, test runners, seed scripts, environment setup, CI steps, development-server boot, fixtures, and diagnostics.

The agent-facing surface includes Boot → Interact → Observe → Validate guidance, evidence locations, known difficulties, command examples, and agent-readable rules.

The agent-facing surface is not the agent harness itself. It is the part of the engineering harness that lets any agent runtime operate the project safely.

### 3. Boot → Interact → Observe → Validate → Improve is the operating loop

Boot proves the product can start from a known state.

Interact exercises meaningful user or system behaviour through supported surfaces.

Observe captures evidence in inspectable forms.

Validate turns evidence into a verdict.

Improve encodes friction and learnings back into the harness so the loop compounds.

### 4. Encode, do not merely document

A paragraph that says “remember to do X” is weaker than a command that does X.

Prefer automated commands, recipes, fixtures, pre-flight checks, better defaults, validation gates, and clear errors over prose-only guidance.

Documentation is useful as orientation, but the highest-value knowledge is executable.

### 5. Every difficulty is a gift to future users

Friction should be captured while it is fresh: confusing errors, missing commands, slow searches, repeated retries, flaky setup, unclear contracts, and “if only there were...” moments.

A difficulty is not resolved until the next agent or human can avoid it or get a clearer path through it.

The compounding loop is: notice friction, record it, triage it, encode the fix, and verify the next run is better.

### 6. Agents are real users of the engineering harness

Agents expose harness UX problems because they do not naturally learn local tribal workarounds the way humans do.

Agent failures, retries, confusion, and magic-wand requests are product feedback for the engineering harness.

Treat agent retrospectives as usability studies for the development loop.

### 7. Retrospectives need a lifecycle

Feedback only compounds when it moves through a lifecycle.

A useful lifecycle is:

1. Setup a durable place for source entries.
2. Track friction during work.
3. Bubble accumulated entries at a natural pause.
4. Harvest entries by clustering, ageing, prioritising, and curating.
5. Encode selected entries into tasks, plans, diffs, commands, checks, or docs.

Without the lifecycle, retrospectives become hidden artefacts that do not compound.

### 8. Silent capture prevents interruption

Producer-side tracking should be quiet during work. The agent or operator notes friction, but the user is not interrupted mid-flow.

Bubble-up should happen at session end or logical pauses, not continuously.

Good calibration matters. Too little capture loses learning. Too much capture becomes noise.

### 9. The magic-wand reflex is the simplest improvement prompt

Ask: “If I had a magic wand right now, what would I change about the harness?”

The answer should be concrete: a command, flag, output field, fixture, default, diagnostic, template, or workflow improvement.

Magic-wand prompts are especially effective around CLI surfaces because command UX is visible, discoverable, and easy for agents to critique.

### 10. Buffers and ledgers serve different jobs

A session buffer is transient, private to active work, append-only, and used during the session.

A retro ledger is durable, schema-shaped, and used for history, curation, and harvest.

This separation keeps active work quiet while preserving durable learning after the user has had a chance to triage.

### 11. The ledger tree should be the source of truth

Cross-cutting views should be computed from source retro entries rather than maintained as derived index files.

Avoiding derived indexes reduces drift, noisy commits, and maintenance burden.

### 12. Curation should prioritise recurrence, severity, and age

Repeated friction matters more than isolated annoyance.

Blocking issues outrank degrading issues. Degrading issues outrank annoying issues.

Old open items should become visible as stale so they do not quietly rot.

This gives the harness owner a practical improvement backlog without pretending every note is equally important.

### 13. User control matters

A useful bubble or harvest interface should let the user decide what happens to entries.

Some entries are quick fixes. Some deserve a task. Some deserve a larger plan. Some should be dismissed.

Auto-applying fixes is risky. Staging suggested improvements for review preserves the encode-don’t-document direction without surprising the user.

### 14. Idempotence, reversibility, and opt-out are harness qualities

Setup should be safe to run repeatedly.

Migration should be reversible.

A repository should be able to opt out when a workflow is not wanted.

These properties make the harness feel trustworthy rather than invasive.

### 15. Known difficulties should be visible at boot

Boot-time reads should expose accumulated friction so a new agent or human does not rediscover recurring problems.

Keep the section capped and clustered so it remains useful rather than becoming a second ledger.

### 16. Measure compounding by encoded improvements, not activity volume

The useful signal is not how many retrospectives were written. It is how many recurring frictions became encoded fixes.

Good signs include declining open entries, growing encoded entries, resolved recurring clusters, boot docs that reflect real known difficulties, and future sessions that stop reporting the same issue.

### 17. The harness must remain practical and low ceremony

Capture should be simple. Bubble prompts should be terse. Harvest views should be useful on demand.

The improvement loop should make improvement easier than doing nothing.

If the ledger becomes bureaucratic, agents and humans will bypass it.

## Reusable public phrasing

- “The engineering harness makes the product-development loop explicit and operable.”
- “Without Improve, the harness is only a test rig. With Improve, the harness compounds.”
- “Every difficulty catalogued is a gift to your future self, but only if the fix gets encoded.”
- “Executable knowledge beats remembered knowledge.”
- “The paved path should be easier than the shortcut.”
- “Agents are the harness’s most honest users.”
- “Retrospectives do not compound until they enter a lifecycle.”

## Open synthesis questions

- Should the public tutorial present the compound ledger as a required core pattern or as an advanced pattern?
- How much of a retro schema should be exposed to readers versus hidden behind examples?
- What is the smallest worked example that demonstrates silent capture, bubble, and encode without requiring a full agent runtime?
- Should the canonical command be named `harness boot-and-validate`, `harness doctor`, or something language-neutral?

## Source registry

### N2-S001. Productised-development-surface skill source

Handling: use as philosophy input. Normalise terminology to the current engineering-harness and agent-harness boundary.

### N2-S002. Engineering-harness governance skill source

Handling: use for engineering-harness governance, boot-time known difficulties, and project-side operating-loop guidance.

### N2-S003. Compound setup skill source

Handling: use for setup, idempotence, reversibility, source-ledger structure, and opt-out principles.

### N2-S004. Friction-capture skill source

Handling: use for silent producer-side capture, magic-wand triggers, and low-interruption heuristics.

### N2-S005. Bubble and triage skill source

Handling: use for session-end triage, soft prompts, action routing, and staged encoding principles.

### N2-S006. Harvest and curation skill source

Handling: use for clustering, stale status, prioritisation, no-index views, and harvest dashboard ideas.

### N2-S007. Retro schema source

Handling: use for universal retro contracts, schema-versioning principles, and durable feedback structure.

# Engineering Harness Directives

These directives describe the engineering-harness concept itself. They are not repository-management rules. They are the operating commitments that keep the foundation focused on making the project-side development loop explicit, operable, measurable, and compounding.

## Directive 1. Keep the harness boundary clear

Do not collapse engineering harnesses and agent harnesses into one vague idea.

An engineering harness is the project-side development loop: boot, build, run, seed, interact, observe, test, validate, diagnose, and improve the actual product.

An agent harness is the runtime or control plane around a model: tool dispatch, permissions, context, memory, orchestration, state, and execution environment.

The agent harness can drive the engineering harness, but it cannot replace it. A model runtime can coordinate work. The project-side harness proves whether the product actually works.

## Directive 2. Close the loop from intent to evidence

The engineering harness exists to move a human or agent from intent to evidence through **Boot → Interact → Observe → Validate → Improve**.

Boot proves the product can start from a known state. Interact exercises real product behaviour through supported surfaces. Observe captures what happened. Validate turns that evidence into a verdict. Improve encodes the lesson so the next run is faster, clearer, or safer.

If the loop stops at validation, the harness is only a test rig. If the loop includes improvement, the harness compounds.

## Directive 3. Make the paved path easier than bypassing it

A harness that is harder than raw commands, tribal knowledge, or ad hoc scripts will be bypassed.

The supported path should be discoverable, callable, observable, and reliable. A fresh human or agent should be able to find the intended way to boot, seed, validate, diagnose, and hand off work without reconstructing the system from memory.

Harness UX is not polish. It is adoption infrastructure.

## Directive 4. Encode the solution, not just the lesson

Do not settle for recording a workaround that the next agent or human must perform manually.

Fix the loop where possible. Add a command, recipe, fixture, check, default, error message, template, diagnostic, validation, or state transition that does the thing. Documentation can orient people, but the highest-value harness knowledge is executable.

A lesson is not fully captured until the next run can benefit from it.

## Directive 5. Treat friction as product feedback

Agent confusion, repeated setup pain, flaky steps, unclear errors, missing fixtures, hidden state, slow validation, and unsupported manual workarounds are signals about the engineering harness.

Humans often adapt around friction and stop seeing it. Agents expose it repeatedly because they do not inherit local tribal knowledge. Treat that friction as usability research for the productised development surface.

The useful response is not only to explain the workaround. The useful response is to decide whether the harness should change.

## Directive 6. Prefer discoverable, agent-operable interfaces

The harness should expose capabilities in ways humans and agents can discover and operate without hidden context.

CLIs often work well as the front door because they provide verbs, help text, stable arguments, examples, exit codes, non-interactive flags, and parseable output. They let an agent inspect what is possible without loading a giant manual into context.

The CLI is not the whole harness. It is a façade over repo-local commands, fixtures, seed data, checks, docs, state, workflows, observability, and review paths. But when designed well, it makes the harness legible and callable.

# Harness Engineering

Harness engineering is the practice of productising the software-development loop so humans and agents can move from intent to evidence, then encode what they learn into the next run.

This repo is a public foundation and tutorial project for teams that want faster, safer, more observable development loops in the age of AI-assisted engineering.

## Core thesis

An engineering harness makes the **product-development loop** explicit and operable:

```text
Boot → Interact → Observe → Validate → Improve
```

- **Boot** proves the product can start from a known state.
- **Interact** exercises real product behaviour through supported surfaces.
- **Observe** captures what happened in inspectable forms.
- **Validate** turns evidence into a verdict.
- **Improve** encodes what was learned so the next run is faster, clearer, or safer.

The harness is not throwaway scaffolding. It is a **productised development surface**: the repo-local commands, fixtures, docs, checks, state, workflows, proof paths, and feedback loops every future feature, experiment, human, and agent passes through.

## Engineering harness versus agent harness

This repo is about the **engineering harness**, not agent runtimes themselves.

| Layer | Makes operable | Examples | Proves |
|---|---|---|---|
| Engineering harness | The product and its development loop | boot commands, build/test/run flows, seed data, fixtures, health checks, diagnostics, proof bundles, retros, encoded improvements | Whether the actual product can run and prove behaviour |
| Agent harness | The model as a tool-using agent | tool dispatch, permissions, context, session management, orchestration, memory, execution environment | Whether an agent can attempt or coordinate work |

An agent harness can drive an engineering harness, but it cannot replace one. If the product cannot boot, run, seed, observe, and prove behaviour, the agent has nothing reliable to operate.

## Backpressure

A useful harness is also a **backpressure system**.

Backpressure is project-side feedback that makes wrong, unsafe, incomplete, or unproven work hard to continue and easy to correct. It is how the harness says: **not yet, and here is why**.

Good backpressure includes:

- type checks, compilers, linters, schemas, tests, and proof gates;
- health checks, doctor commands, browser traces, logs, screenshots, and database checks;
- structured command output with failure categories and next actions;
- proof artefacts that show what passed, what remains unproven, and how to rerun;
- human judgement routes for decisions machines cannot make.

Prompts and checklists are useful guides, but high-risk or repeated invariants should move into the strongest practical refusal surface: a command, type, schema, fixture, validation, generated guard, diagnostic, or reviewable proof path.

The goal is not to add ceremony. The goal is to stop wasting human attention on machine-checkable failure and reserve human judgement for ambiguity, product intent, tradeoffs, taste, risk, and non-executable criteria.

## What this repo contains

- [`harness-foundations/first-principles.md`](harness-foundations/first-principles.md): the current first-principles foundation.
- [`harness-foundations/patterns-that-work.md`](harness-foundations/patterns-that-work.md): practical patterns for making the principles real.
- [`harness-foundations/directives.md`](harness-foundations/directives.md): concise operating commitments for the engineering-harness concept.
- [`harness-foundations/source-notes/`](harness-foundations/source-notes/): public-safe source syntheses and traceability notes.

## How to read this project

Start with the first-principles document if you want the thesis. Read the patterns if you want practical moves. Read the directives if you want the shortest operating version.

A good first question for any repo is:

> Can a fresh human or agent move from clean start to proved product behaviour without private tribal knowledge?

If the answer is no, the engineering harness is the product surface to improve.

## Publication boundary

This repo distils private and public research into general, publication-safe principles. Raw notes and private source material live outside the public surface. Public content should avoid private names, internal codewords, local paths, unreleased details, and exact private metrics unless explicitly approved.

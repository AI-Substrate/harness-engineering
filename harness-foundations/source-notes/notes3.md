# Source Notes 3: Harness Measurement and Implementation

This is a public-safe synthesis of two measurement documents. Source IDs are retained for traceability, but raw paths, internal source names, customer-specific examples, exact private metrics, and implementation details have been removed.

## Boundary note

These sources are more harness-focused than a general AI-engineering measurement article. They treat harness engineering as the project-side layer that makes the development loop operable and measurable.

An **engineering harness** measures whether the product loop can be entered, run, observed, validated, and improved.

An **agent harness** can provide session traces, tool events, and orchestration context, but those are not product proof. Product proof belongs to the engineering harness.

The central loop remains:

**Boot → Interact → Observe → Validate → Improve**

## Executive measurement thesis

A leader asking how to measure AI-driven engineering should not start with prompt count, token count, agent sessions, lines of code, commit count, PR count, or story-point velocity. Those are activity signals, not proof of engineering value.

The harness-engineering measurement question is:

> Is the product-development loop becoming easier to enter, safer to change, faster to prove, more reliable under AI-assisted work, and better at encoding repeated learning into the next run?

Harness metrics are leading evidence about the project-side loop. They should complement, not replace, DORA delivery metrics, SPACE/DevEx signals, Accelerate-style capability thinking, and executive operating-model measures.

## What normal tooling misses

Work-management, code, CI, deployment, and incident systems are necessary, but they usually cannot answer several harness questions on their own.

They usually do not prove whether:

- a fresh human or agent can understand how to run the repo;
- a clean environment can become usable without private help;
- the product merely started or real behaviour was exercised;
- the proof included state, side-effect, or domain evidence;
- an agent validated the right thing;
- a repeated failure became an executable harness improvement;
- people are bypassing the harness because the paved path is worse than the shortcut.

This gap is why harness telemetry and proof artefacts are needed.

## Non-negotiables before claiming value

Before claiming that AI-driven engineering value improved through harness engineering, the source material argues for a minimum evidence spine:

1. A linked value slice from requirement or issue to PR, CI/build/test, harness proof artefact, and deployment or release evidence where applicable.
2. A product-side harness loop that can boot, seed or reset, interact with a meaningful scenario, observe outputs, validate the result, and write proof.
3. A clean-start protocol that a fresh human or agent can run without private tribal knowledge.
4. Structured harness events for timing, outcomes, failure categories, proof depth, and artefact locations.
5. A proof-quality gate that separates claim, compile, unit test, runtime, API, side-effect, end-to-end, and reproducible clean rerun evidence.
6. A friction ledger that turns repeated problems into encoded fixes such as commands, checks, fixtures, defaults, diagnostics, templates, or routing guidance.
7. Team-level governance that prevents individual surveillance and productivity leaderboards.

## Ranked harness-measurement family

The sources rank the first harness measures around entry, proof, loop closure, and compounding.

1. **Harness loop closure**: can actors move through Boot → Interact → Observe → Validate → Improve?
2. **Clean repo or session to first proved value**: how long does a fresh actor need to reach meaningful proof?
3. **Time to Verified Working Context**: when is the workspace genuinely usable, not merely started?
4. **Zero-to-Proof Time**: time from clean start to first valid proof artefact.
5. **Agent or human close-the-loop time**: time from first failure or validation start to valid proof or evidence-backed escalation.
6. **Proof completeness rate**: are required proof fields present and reviewable?
7. **Proof reproducibility rate**: does proof pass again in a clean or replayed context?
8. **False-pass rate**: how often does a green or claimed pass later prove wrong?
9. **Harness bypass rate**: where do people avoid supported commands, and why?
10. **Friction taxonomy and recurrence**: which setup, proof, context, validation, or review blockers repeat?
11. **Encoded mitigation rate**: do recurring frictions become validated harness improvements?
12. **Doctor or preflight usefulness**: do diagnostics identify the failed layer and prescribe the next useful action?
13. **Seed/reset scenario operability**: can meaningful product state be created and verified repeatedly?
14. **Supported interaction coverage**: which important behaviours can the harness exercise through supported surfaces?
15. **Observability and evidence quality**: are logs, responses, traces, screenshots, state checks, and verdicts inspectable?
16. **Clean-to-validated PR or change**: how long from clean assignment/session to PR or change with required proof?
17. **Requirements-to-proof traceability**: is proof tied to acceptance criteria or intended value?
18. **Review evidence quality and reviewer burden**: does proof reduce review uncertainty instead of shifting burden downstream?
19. **DORA downstream impact**: do delivery lead time, deployment frequency, failure, rework, recovery, and reliability improve later?
20. **Harness UX / SPACE pulse**: do teams trust the harness, feel less cognitive load, and find it easier to validate AI-assisted work?

## Framework mapping

### DORA

DORA remains the downstream delivery-performance scoreboard. It helps show whether delivery became faster and safer, but it does not by itself prove clean-start usability, product-path proof, or harness compounding.

### SPACE and DevEx

SPACE is the guardrail against single-metric productivity thinking. Harness measurement should include satisfaction, flow, communication, cognitive load, trust, and qualitative friction, aggregated at team or repo level.

### Accelerate

Accelerate-style capabilities explain what to invest in: CI, small batches, test automation, deployment automation, observability, WIP control, learning culture, and harnessability. Metrics observe; capabilities cause.

### ESSP

Engineering System Success Playbook framing helps executives organise measures around quality, velocity, developer happiness, and business outcomes. Harness metrics are a leading layer inside that operating model.

## Proof levels

The sources use a practical proof ladder to avoid treating all green signals as equal.

- **L0 Claim**: actor says work is done, with no evidence.
- **L1 Local command output**: a command ran and output exists.
- **L2 Static/build/test**: build, lint, typecheck, unit, or isolated tests passed.
- **L3 Runtime interaction**: a product, API, UI, CLI, or system path was exercised.
- **L4 Interaction plus side effect**: runtime interaction plus state, file, database, message, package, or other side-effect verification.
- **L5 Reproducible clean rerun**: proof passes again in a clean context using recorded rerun instructions.
- **L6 Production or customer outcome**: production telemetry, incident-free release, customer outcome, or business outcome evidence.

For AI-assisted product-behaviour claims, the source material favours at least L3 or L4. For high-confidence or customer-facing claims, it favours L5 or stronger evidence.

## Implementation architecture

The implementation guide groups measurement into six data planes:

1. Work management: requirements, issue states, acceptance criteria, ownership, and flow timing.
2. Source and review: branches, commits, PRs, review cycles, proof links, and evidence-related review comments.
3. CI and test: build/test outcomes, duration, failures, flakiness, and pipeline feedback.
4. Deployment and reliability: releases, deployments, incidents, rework, recovery, and SLO context.
5. Harness and proof: clean-start milestones, product interaction, side-effect checks, proof bundles, rerun commands, and harness events.
6. Perceptual and qualitative: surveys, retros, interviews, friction ledgers, trust, cognitive load, and bypass reasons.

The routing rule is: **measure the event where the truth is cheapest to prove**.

## Canonical joins

A measurement system fails when IDs do not join. The sources recommend stable linkage across:

- work item or requirement ID;
- product decision or PRD ID where relevant;
- repository, branch, commit, and PR;
- CI workflow run;
- deployment and incident records;
- harness session and run IDs;
- proof artefact ID;
- scenario ID;
- environment fingerprint.

The public-safe lesson is simple: every dashboard should report linkage coverage. A delivery dashboard with weak joins is a hypothesis, not a fact.

## Harness CLI instrumentation

The implementation guide treats the harness CLI as a thin measurement and proof façade over the existing project surface. The minimum useful command set is:

- `doctor`: preflight readiness and orientation;
- `boot`: build, install, start, and wait for readiness;
- `seed` or `reset`: create repeatable meaningful state;
- `prove`: execute a product scenario and validate the result;
- `evidence`: show proof artefacts and rerun commands;
- `handoff`: summarise current state for review or the next session;
- `friction` or `retro`: record friction and improvement suggestions.

Commands should emit stable outcomes, exit codes, event records, artefact locations, and next-action guidance.

## Harness event model

The sources propose structured harness events for the product loop. Public-safe fields include:

- event ID and schema version;
- occurred/start/completed timestamps;
- harness session and run IDs;
- actor type, such as human, agent, agent-assisted human, or CI probe;
- repo, branch, and commit;
- issue or requirement reference;
- scenario ID;
- stage and event type;
- command;
- duration;
- outcome;
- failure category;
- proof level;
- proof artefact URI;
- rerun command;
- environment fingerprint.

Important event types include session start, orientation, doctor, boot, seed, interaction, validation, proof creation, failure, retry, escalation, friction recorded, improvement encoded, improvement validated, and session completion.

## Proof bundle schema

A useful proof bundle should be more than a log dump. It should include:

- repository and exact code version;
- linked issue, requirement, or acceptance criterion;
- scenario ID and proof level;
- actor type and harness run IDs;
- environment fingerprint;
- commands run and outcomes;
- product observations;
- validator verdict;
- side-effect or state evidence where required;
- rerun command;
- known limitations;
- human judgement field when non-executable criteria remain.

The key principle is that a proof artefact should be reviewable and rerunnable.

## Clean-start and soft setup probes

The source material separates hard setup from soft setup.

Hard setup includes dependencies, services, secrets, ports, build, runtime, and data.

Soft setup includes understanding what the system is, where work lives, what done means, which scenario to use, what current state matters, and what evidence is required.

A clean-start probe should record milestones such as orientation, harness discovery, doctor pass, build success, seed success, runtime readiness, first interaction, effect verification, proof completion, and optional PR readiness.

The important stop condition is a valid proof artefact for a meaningful scenario. A server starting is not enough.

## Dashboards and scorecards

The implementation guide suggests dashboards that separate leading harness evidence from downstream delivery outcomes.

Useful dashboard areas include:

- executive overview: clean-to-proof trend, proof completeness, DORA context, top friction, encoded fixes;
- entry and setup: Time to Verified Working Context, clean-start success, stage funnel, expert escalation;
- loop closure: close-loop time, retries, abort categories, escalation quality;
- proof quality: proof levels, completeness, reproducibility, false-pass;
- harness compounding: recurring friction, encoded mitigations, stale assumptions, validated fixes;
- requirement to proof: traceability gaps, work ageing, proof linkage;
- review and CI: proof-linked PRs, review cycles, evidence gaps, CI feedback;
- DORA downstream: lead time, deployment frequency, failure, rework, recovery, reliability;
- DevEx / SPACE: trust, cognitive load, flow, and qualitative themes.

## Rollout path

The practical rollout is intentionally small:

1. Pick one pilot repo and one meaningful scenario.
2. Define clean-start protocol and proof levels.
3. Create minimum commands for doctor, boot, seed or reset, prove, and handoff.
4. Add a proof bundle schema and artefact convention.
5. Establish issue, PR, CI, proof, and deployment linkage rules.
6. Run a small baseline set of clean-start probes.
7. Start a friction ledger.
8. Publish a measurement-readiness scorecard before making AI value claims.
9. Add structured events and data joins.
10. Implement the top recurring friction fixes and rerun comparable probes.
11. Add proof reproducibility sampling, review evidence metrics, DORA context, and a SPACE/DevEx pulse.
12. Scale only after proof completeness, reproducibility, clean-start success, and owner capacity are healthy enough.

Manual capture is acceptable for early probes and classification. Automation becomes necessary before quantitative executive claims.

## What not to use as productivity metrics

The sources strongly warn against individual productivity measurement using:

- prompt count;
- token count;
- agent-session count;
- autocomplete acceptance rate;
- lines of code;
- commit count;
- PR count;
- story points;
- time in editor;
- number of harness commands run;
- reviews completed without quality context.

These can sometimes be aggregate diagnostic context. They are not productivity and should not be used for individual performance management.

## Public tutorial implications

These sources extend the foundation in three practical ways:

1. Measurement needs harness-native artefacts, not only existing dashboard data.
2. Proof quality needs a schema, level, rerun command, and human-judgement path.
3. Executive claims should start with measurement readiness and leading harness evidence before claiming productivity or ROI.

A useful tutorial can therefore include a worked example of a nascent harness CLI emitting local event JSON, writing a proof bundle, recording a friction item, and producing a small scorecard.

## Open synthesis questions

- Should harness proof levels become part of the public first-principles document, or remain in patterns/tutorial material?
- Should the ranked Top-20 harness measures be a standalone public guide rather than source notes?
- What is the smallest example proof bundle that is concrete enough for readers but not tied to any private product?
- Should DORA/SPACE/ESSP mapping be introduced early for leaders or later after the basic harness loop is understood?
- How much event-schema detail belongs in the foundation versus an implementation tutorial?

## Source registry

### M001. CTO-facing harness measurement dossier

Type: measurement strategy source for leaders, covering harness-engineering value claims, ranked measures, DORA/SPACE/Accelerate/ESSP mapping, non-negotiable evidence, and anti-productivity-theatre guidance.

Handling: use as public-safe synthesis only. Do not publish raw local paths, internal source names, customer-specific examples, exact private metrics, or generated sample identifiers. Verify public framework URLs before citation.

### M002. Harness measurement implementation guide

Type: implementation source for Jira, GitHub, CI/CD, deployment, harness event, proof bundle, clean-start probe, friction ledger, dashboard, SQL-style, and rollout patterns.

Handling: use as public-safe implementation synthesis. Promote general schemas, templates, and rollout patterns only after removing private paths, internal examples, and customer-specific identifiers.

### M003. Public framework references

Type: public sources used for calibration, including DORA metrics and capabilities, SPACE, GitHub Engineering System Success Playbook, public harness-engineering framing, and relevant platform API documentation.

Handling: cite original public URLs directly where used. Treat public frameworks as support for measurement framing, not as proof that a local implementation produced value.

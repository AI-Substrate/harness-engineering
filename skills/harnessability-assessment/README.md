# harnessability-assessment

Assess how harnessable a repository is: how easily a human or agent can enter, operate, modify, observe, prove, and improve it through an engineering harness.

The assessment scores two axes — **Operate-Today** (can a fresh agent use the repo as it exists now?) and **Adaptability** (can the repo be safely and cheaply changed to create stronger harnesses and proof loops?) — and maps the repository's back-pressure surfaces, proof ceilings, external-dependency exposure, and highest-leverage improvements. Cold-start onboarding difficulty is one part of harnessability, not the whole assessment.

The agent harness drives. The engineering harness proves.

## What it produces

The skill writes stable latest files and timestamped run files:

```text
harness/assessment/latest.md
harness/assessment/latest.json
harness/assessment/schema.json
harness/assessment/runs/<UTC_TIMESTAMP>.md
harness/assessment/runs/<UTC_TIMESTAMP>.json
```

The Markdown report is for humans and agent skim-reading. The JSON report follows `templates/assessment-report.schema.json` (schema version `harnessability-assessment.v0.1`) and is for comparison, automation, and future skills. See `templates/assessment-latest.md` and `templates/assessment-latest.json` for sanitized examples.

## Default safety posture

Default mode is static and conservative. It reads repository files, inspects harness surfaces, classifies evidence versus inference, reports environment-variable names only, and writes assessment reports.

It does not install dependencies, boot services, mutate state, read secrets, call external services, perform auth flows, or edit product code by default. Optional flags (`--execute-safe-probes`, `--deep`, `--apply-safe-harness-patches`) widen the read-only or harness-only surface; product-code recommendations always stay proposal-only.

## Where it fits

```text
engineering-harness-setup -> harnessability-assessment -> tools runtime skills
```

- `engineering-harness-setup` creates or validates the local harness nucleus.
- `harnessability-assessment` reports target-aware harnessability and next safe actions.
- tools runtime skills operate the loop: boot, observe, retro, harvest, and advisory Backpressure Check.

The advisory Backpressure Check surveys whether enough deterministic sensors exist for scoped work. It is not itself proof, and this skill never introduces a generic core `backpressure` command. When a gap is found, it recommends the specific sensor, command, fixture, fake, sink, diagnostic, schema check, smoke path, architecture rule, or evidence capture that would prove the scoped work.

## Product-code affordances

Some repositories are not harnessable until the product exposes better local/test affordances. The report may propose changes such as a local/test auth path, seed/reset command, health endpoint, side-effect sink, stable UI hooks, or structured diagnostics.

Those recommendations are proposal-only by default. They are not applied by this skill unless a later, explicit implementation task is approved.

## Validation expectations

For this skill package, structural validation is enough:

- `just list-skills` discovers the skill;
- JSON templates parse and the schema validates as a Draft 2020-12 schema;
- the example JSON validates against the schema;
- shipped surfaces preserve the boundary sentence;
- shipped surfaces avoid private-source/source-ID leakage;
- placeholder syntax is well-formed where placeholders are allowed;
- no generic core backpressure command key is introduced.

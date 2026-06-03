# engineering-harness-orient

Run a post-setup harnessability orientation for a repository.

Use this after `engineering-harness-setup` has created or validated the engineering harness nucleus. Setup creates the front door; orient inspects how well that front door maps to the target repository and writes a report that helps the next human or agent start safely.

The agent harness drives. The engineering harness proves.

## What it produces

The skill writes:

```text
harness/orientation/latest.md
harness/orientation/latest.json
harness/orientation/schema.json
harness/orientation/runs/<UTC_TIMESTAMP>.md
harness/orientation/runs/<UTC_TIMESTAMP>.json
```

The Markdown report is for humans and agent skim-reading. The JSON report is for comparison, automation, and future skills.

## Default safety posture

Default mode is static and conservative. It reads repository files, inspects harness surfaces, classifies evidence versus inference, and writes orientation reports.

It does not install dependencies, boot services, mutate state, read secrets, call external services, perform auth flows, or edit product code by default.

## Where it fits

```text
engineering-harness-setup -> engineering-harness-orient -> tools runtime skills
```

- `engineering-harness-setup` creates or validates the local nucleus.
- `engineering-harness-orient` reports target-aware harnessability and next safe actions.
- tools runtime skills operate the loop: boot, observe, retro, harvest, and advisory Backpressure Check.

## Product-code affordances

Some repositories are not harnessable until the product exposes better local/test affordances. The report may propose changes such as a local/test auth path, seed/reset command, health endpoint, side-effect sink, stable UI hooks, or structured diagnostics.

Those recommendations are proposal-only by default. They are not applied by this skill unless a later, explicit implementation task is approved.

## Validation expectations

For this skill package, structural validation is enough:

- `just list-skills` discovers the skill;
- JSON templates parse;
- example JSON matches the required report fields;
- shipped surfaces preserve the boundary sentence;
- shipped surfaces avoid private-source/source-ID leakage;
- placeholder syntax is well-formed where placeholders are allowed;
- no generic core backpressure command key is introduced.


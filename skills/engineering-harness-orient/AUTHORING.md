# Authoring notes - engineering-harness-orient

**This file is repo-internal and NOT installed by the skill.** It documents conventions future editors should preserve.

## Why this skill exists

`engineering-harness-setup` creates or validates the repo-local engineering harness nucleus. `engineering-harness-orient` runs after setup and answers a different question: how harnessable is this target repository now, what can a fresh agent safely do first, and what should be encoded next?

Do not turn orient into setup v2. Do not turn orient into a runtime loop.

## Load-bearing invariants

These invariants apply to shipped surfaces only: `SKILL.md` and files under `templates/`.

### 1. Canonical boundary sentence

The sentence below must remain byte-identical wherever the agent/engineering harness boundary is stated:

```text
The agent harness drives. The engineering harness proves.
```

The canonical source is `templates/canonical-boundary.txt`.

### 2. Setup / orient / runtime separation

Shipped surfaces must preserve this responsibility split:

- setup creates or validates the engineering harness nucleus;
- orient reports target-aware harnessability and recommendations;
- tools runtime skills operate the loop.

### 3. Foundation citations

Markdown templates that paraphrase foundation principles should carry an HTML-comment citation near the top:

```html
<!-- foundations: first-principles#NN, patterns-that-work#PNN, directives#DN -->
```

Use foundation IDs only. Do not cite raw source IDs.

### 4. No private-source contamination

Shipped surfaces must not reference private scratch material, source-note paths, plan artifacts, source IDs, private substrate names, customer-specific details, or unreleased platform details.

The shipped-surface grep should include at least:

```text
harness-foundations/
docs/plans/
scratch/
source-notes/
S001|S002|S003|S004|N2-S00|M00
```

HTML-comment foundation citations are allowed.

### 5. Placeholder syntax

Every placeholder in templates must use canonical upper-snake form:

```text
{{[A-Z_][A-Z0-9_]*}}
```

Filled example files such as `orientation-latest.md` and `orientation-latest.json` should contain no unresolved placeholders.

### 6. Backpressure boundary

Backpressure Check is advisory over deterministic sensors. Shipped surfaces may describe Backpressure Check, but they must not introduce a generic core backpressure command key.

## Structural validation checklist

Run these checks before committing changes to this package:

1. `just list-skills`
2. Parse all JSON templates:
   - `skills/engineering-harness-orient/templates/orientation-report.schema.json`
   - `skills/engineering-harness-orient/templates/orientation-latest.json`
   - `skills/engineering-harness-orient/templates/codebase-affordance-record.json`
3. Compare `templates/canonical-boundary.txt` with every shipped surface that states the canonical sentence.
4. Grep shipped surfaces for private-source/source-ID patterns listed above.
5. Grep templates for malformed placeholders.
6. Confirm example reports have no unresolved placeholders.
7. Confirm no exact generic core backpressure command key appears in shipped surfaces.
8. Map spec acceptance criteria to files changed.

## Extension guidance

Keep v0.1 focused. Add new report fields only when they are needed by a named downstream consumer. Prefer additive optional fields over changing the core schema.


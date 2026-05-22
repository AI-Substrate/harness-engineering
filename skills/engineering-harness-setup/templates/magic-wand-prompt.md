# Magic-wand prompt (canonical source of truth)

The single canonical wording of the magic-wand prompt. Every other surface in this skill — `templates/root-HARNESS.md` Rule 5, `templates/harness-friction-log.md`, `templates/harness-proof-note.md`, `templates/install-report.md`, `templates/retrospective-schema.json` (`magicWand.description`) — must echo this string byte-for-byte. `check.sh magic-wand` enforces this.

<!-- foundations: first-principles#48, patterns-that-work#P10 -->

## Canonical wording

> If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, or higher quality? Be concrete — name a command, flag, output field, fixture, diagnostic, template, or workflow change.

## Why this wording

- **"ONE thing"** — forces the answerer to prioritise. A list of five vague wishes is worth less than one concrete one.
- **"Be concrete — name a command, flag, output field, fixture, diagnostic, template, or workflow change"** — names the seven categories that historically produce the highest-leverage harness improvements. Anything outside these categories is still allowed, but the enumeration anchors the answerer.
- **"easier, safer, faster, or higher quality"** — keeps the dimension of improvement open. The same prompt works after a smooth run (where the answerer probably picks "faster" or "easier") and after a painful run (where they probably pick "safer" or "higher quality").

## Where it appears

| Surface | Form |
|---|---|
| `templates/root-HARNESS.md` Rule 5 | Inline prose |
| `templates/harness-friction-log.md` | Section header + the canonical sentence |
| `templates/harness-proof-note.md` | Section "Magic-wand improvement candidate" |
| `templates/install-report.md` | Closing-out section |
| `templates/retrospective-schema.json` | The `magicWand.description` field |
| `cli-python-harness.py` / `cli-node-harness.mjs` | `<CLI> magic-wand` subcommand output |

## What counts as a good magic-wand answer

A good answer is something the team or the next agent run could **act on in under an hour** with the harness alone. Examples:

- *"Add a `<CLI> doctor --wait 60` flag so I don't have to retry by hand after a slow boot."*
- *"Change the `validate` envelope to include a `proof_level` field so install-report can show the ceiling without re-parsing."*
- *"Seed `harness/state/known-difficulties.md` with the macOS / Python 3.9 case so the next agent doesn't re-discover it."*
- *"Make the install fail fast when `package.json` exists without a `test` script — currently the install completes and `<CLI> test --tier fast` returns unconfigured."*

A weak answer is a wish for something outside the harness's reach (*"make pytest faster"*, *"buy more RAM"*). These are still valid friction-log entries, but they should be marked `magicWandTarget: project` instead of `harness`.

## How it is used

1. The harness CLI's `<CLI> magic-wand` subcommand prints this prompt (read from this template file).
2. The install flow's Step 14 prints this prompt and asks whether to append the answer to `harness/state/friction-log.md`.
3. The retrospective schema (`harness/templates/retrospective-schema.json`) makes `magicWand` a required string of minimum length 20, with this prompt as the `description` field.

The wording is **load-bearing**. Drift erodes the signal. `check.sh magic-wand` runs `grep -rcF` against the canonical sentence across the six surfaces above and expects ≥6 matches with zero variants.

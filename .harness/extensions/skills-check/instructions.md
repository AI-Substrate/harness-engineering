# `harness skills-check` — agent briefing

This verb is **deterministic skill-loadability back pressure**: whether a host
CLI will actually *load* our skills moved out of the inferred world ("looks
fine to me", "it installed OK") into the deterministic one — yes or no, with
the exact character counts.

The failure mode it kills was measured in the field (2026-06-11): Copilot CLI
**silently skipped** `eng-harness-flow` because its frontmatter `description`
ran 1379 chars — over the Agent Skills spec maximum of 1024. No error, no
warning: the skill installed, landed on disk, and simply never appeared. An
"installed but invisible" skill is worse than a missing one, because every
downstream doc (AGENTS_README, the-flow, the SDD seams) assumes the router is
invocable. Run this verb after **any** edit to a SKILL.md frontmatter.

## What it proves — and the proof boundary

**Proves**: every `SKILL.md` under `skills/` (or `--dir <path>`) satisfies the
Agent Skills spec rules hosts enforce at load time
(https://agentskills.io/specification):

- `name`: required · ≤64 chars · lowercase letters/digits/hyphens · no
  leading/trailing hyphen · **equal to its directory name** (how hosts resolve
  it) · unique across the tree.
- `description`: required · 1–1024 chars (**error** over the limit) · with a
  **warn** band above 900 chars so the next edit doesn't walk it off the cliff.
- frontmatter mechanics: opens at byte 0 (no BOM), closes, parses (plain,
  quoted, and `|`/`>` block scalars — lengths are counted on the **YAML-parsed
  value**, the same string a host's loader sees, not the raw indented block).

**Does not prove**: that a host has *re-loaded* the skill (operators must
restart/reload their CLI after installs); that the description is *good* (only
that it's legal — trigger quality is editorial); per-host quirks beyond the
spec (a host may impose stricter limits); anything about the skill **body**
below the frontmatter. Lengths are UTF-16 code units (`String.length`) — the
conservative bound a JS loader measures.

## Outcome states

| Condition | `status` | exit | what to do |
|---|---|---|---|
| all skills clean | `ok` | 0 | nothing — every skill will load |
| only >900-char headroom warnings | `degraded` | 0 | trim those descriptions before they drift over 1024 |
| ≥1 spec violation | `error` | 1 | `next_action` names the first offender + exact overage; fix the frontmatter, re-run |
| scan dir missing | `unconfigured` | 2 | run from the repo root, or pass `--dir <path>` |
| no SKILL.md found | `unconfigured` | 2 | point `--dir` at a real skills tree |

Error codes: `E_SKILL_INVALID` (spec violations), `E_SKILLS_CHECK_UNEXPECTED`
(backstop — should never fire). Where the findings live: `data.findings[]` on
`ok`/`degraded`; on `error` the kernel's envelope has no data slot, so the same
object rides in `error.details.findings[]`.

## What to do on a violation

1. Read the findings — each entry has `rule`, `severity`, `path`, and a
   `message` with the exact counts. Findings are sorted path→rule, so report
   diffs are stable.
2. Fix the **frontmatter**, not the checker. For `description-too-long`: cut
   to ≤900 chars while keeping the *trigger-rich* opening (hosts select skills
   on the description — the first sentence does the routing work; move depth
   into the skill body, which has no limit).
3. The source of truth is `skills/**` in this repo. Installed copies
   (`./.claude/skills`, `./.agents/skills`) are derived — fix here, reinstall,
   then ask the operator to reload their CLI.

## Gotchas

- A host that rejects a skill does it **silently** — never "it installed, so
  it loads". This verb is the only deterministic signal.
- The 1024 limit applies to the **parsed** description. A `description: |`
  block's two-space indents don't count; its newlines do.
- Run from the **repo root** — discovery and the default `skills/` path both
  resolve against the invocation cwd.
- Checking an installed tree directly also works:
  `harness skills-check --dir ./.claude/skills`.

## Evidence

No durable evidence files are written (P9): counts and findings live in the
envelope (`skills`, `errors`, `warnings`, `findings[]` — under `data` or
`error.details` per the table above) — capture the JSON if you need a record
(`harness skills-check --json > out.json`).

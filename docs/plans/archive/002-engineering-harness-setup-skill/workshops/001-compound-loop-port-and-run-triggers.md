# Workshop: Compound Loop Port and Run Triggers

**Type**: Integration Pattern / State Machine / Storage Design  
**Plan**: 002-engineering-harness-setup-skill  
**Spec**: [engineering-harness-setup-skill-spec.md](../engineering-harness-setup-skill-spec.md)  
**Created**: 2026-05-26T10:32:16+10:00  
**Status**: Draft

**Value Thesis**: This workshop makes the engineering-harness Improve stage operational by specifying which compound-loop skills to port, how they connect to `engineering-harness-setup` and `boot-harness`, and when agents should run each part of the loop without creating nagware or ceremony.

**Target Proof Level**: Implementation Ready  
**Current Proof Level**: Preferred Direction

**Selected Value Axes**:
- **Learning Compounding**: The port exists to turn repeated session friction into durable, reviewable, encodable harness improvements.
- **Agent Readiness**: Agents need explicit run triggers; otherwise "remember to improve the harness" remains a vague instruction.
- **Operator Usability**: Users should see at most one end-of-session prompt, not a stream of interruptions.
- **Implementation Readiness**: The workshop should be concrete enough to port sanitized skill packages without re-reading the source repo.
- **Review Compression**: Reviewers should be able to check the lifecycle and trigger policy from tables rather than reconstructing the loop.

**Related Documents**:
- [skills/engineering-harness-setup/SKILL.md](../../../skills/engineering-harness-setup/SKILL.md)
- [skills/boot-harness/SKILL.md](../../../skills/boot-harness/SKILL.md)
- [harness-foundations/first-principles.md](../../../harness-foundations/first-principles.md)
- [harness-foundations/patterns-that-work.md](../../../harness-foundations/patterns-that-work.md)

---

## Purpose

Clarify the compound-loop port from `~/github/tools/skills/compound/` into this repo and define when each skill should run. The design should let a fresh agent start with `boot-harness`, work through the engineering harness, capture friction quietly, bubble it once, and later harvest recurring issues into encoded harness improvements.

## Fresh Entrant Outcome

A fresh human or agent should be able to use this workshop to reach **Implementation Ready** with no additional context.

They should be able to:

- port the compound skills into this repo using public-safe wording;
- wire `engineering-harness-setup` and `boot-harness` to the compound lifecycle;
- know exactly when to run setup, track, bubble, and harvest;
- preserve user control and avoid mid-session interruption;
- explain how compound entries become encoded harness improvements.

## Key Questions Addressed

- Which compound skills should be ported?
- What repository paths should the compound loop own?
- When should each compound skill run?
- How should `boot-harness` and `engineering-harness-setup` integrate with the compound loop?
- What source wording must be sanitized before porting?
- What should be automatic, suggested, or manual?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Implementation Ready | The next loop is a port; the workshop must provide file placement, trigger rules, and acceptance criteria. |
| Primary Value Axis | Learning Compounding | The core risk is that Improve stays aspirational instead of becoming an operating loop. |
| Supporting Value Axes | Agent Readiness, Operator Usability, Review Compression | The port must tell agents when to act, avoid nagware, and be easy to review. |
| Downstream Loop Improved | Setup -> Boot -> Work -> Bubble -> Harvest -> Encode | This makes the harness's Improve stage durable and repeatable. |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Existing compound source skill anatomy | `~/github/tools/skills/compound/*/SKILL.md` | Port scope and trigger policy | Reviewed |
| Current setup integration point | `skills/engineering-harness-setup/SKILL.md` Step 4a / Step 4b | Known Difficulties and AGENTS signpost integration | Ready |
| Current boot integration point | `skills/boot-harness/SKILL.md` Step 3 / Step 6 | Improve-loop readiness checks | Ready |
| Foundation principle | `harness-foundations/first-principles.md` #44-52 | Friction lifecycle and magic-wand loop | Ready |
| This workshop | This file | Port decisions and acceptance criteria | Draft |

---

## Current State

The repo now has two authored skills:

| Skill | Current Role | Compound Relationship |
|-------|--------------|-----------------------|
| `engineering-harness-setup` | Creates/validates `docs/project-rules/engineering-harness.md`; patches `AGENTS.md`; seeds Known Difficulties from `docs/compound` if present. | Already expects compound retros as an optional source for Known Difficulties. |
| `boot-harness` | Start-of-session ritual; reads harness contract; runs safe checks; surfaces known difficulties and improvement obligation. | Already checks for friction/retro/magic-wand locations and reports missing Improve storage as harness friction. |

Gap: there is no portable compound-loop skill set in this repo yet. Without it, `boot-harness` can ask the agent to improve the loop, but it cannot point to a complete capture -> bubble -> harvest lifecycle shipped by this repo.

---

## Recommended Direction

Port the compound family as four installable skills:

```txt
skills/compound-0-setup/SKILL.md
skills/compound-1-track/SKILL.md
skills/compound-2-bubble/SKILL.md
skills/compound-3-harvest/SKILL.md
```

Use flat top-level skill directories rather than `skills/compound/<slug>/` because this repo currently exposes `skills/<slug>/SKILL.md` and Vercel `npx skills` already discovers that layout.

The port should preserve the lifecycle but sanitize the source:

- remove private/internal workshop references;
- remove project-specific names from examples;
- replace `engineering-harness-v2` with `engineering-harness-setup`;
- replace legacy "agent harness" wording with engineering-harness wording where the mechanism improves the project-side loop;
- keep `docs/compound/` as the canonical ledger path;
- keep `.disabled` as the opt-out sentinel;
- keep session buffers gitignored;
- keep harvest views computed at read time, not persisted as index files.

---

## Lifecycle Overview

```text
                 first repo setup
                       |
                       v
              compound-0-setup
                       |
                       v
        docs/compound/ ledger exists
                       |
      during work      |      start/end of work
          |            |            |
          v            |            v
  compound-1-track ----+----> compound-2-bubble
  silent buffer append         one user prompt
          |                         |
          v                         v
 docs/compound/_buffers/     docs/compound/agents/
 transient entries           durable retros
                                    |
                                    v
                            compound-3-harvest
                            recurrence, age,
                            severity, encode queue
```

The lifecycle is intentionally asymmetric:

- tracking is silent and cheap;
- bubbling is user-visible but rare;
- harvesting is manual or at long-horizon reflection points;
- encoding is proposed/staged, not auto-applied.

---

## Skill Responsibilities

| Skill | Primary Job | Reads | Writes | User Surface |
|-------|-------------|-------|--------|--------------|
| `compound-0-setup` | Scaffold `docs/compound/` and optional legacy migration | `docs/compound/`, optional `docs/retros/` | `docs/compound/README.md`, `_buffers/.gitignore`, `agents/.gitkeep` | One setup report / pointer |
| `compound-1-track` | Silent producer-side capture | none, except sentinel | `_buffers/<agent>.session-buffer.md` | None |
| `compound-2-bubble` | Session-end triage and persistence | `_buffers/<agent>.session-buffer.md` | `agents/<agent>/<date>/*.retro.md`, clears buffer | One soft prompt |
| `compound-3-harvest` | Curator-side recurrence view and lifecycle status updates | `agents/**/*.retro.md`, optional legacy retros | Optional in-place status updates only | Terminal view / action menu |

---

## Run Trigger Contract

### Trigger Summary

| Moment | Action | Required / Suggested / Manual | Why |
|--------|--------|-------------------------------|-----|
| `engineering-harness-setup` create mode | Run or offer `compound-0-setup` | Suggested by default; required if Known Difficulties should be seeded in future | Creates the Improve ledger early. |
| `boot-harness` start | Check for `docs/compound/` and buffer leftovers | Required check | Boot must verify the Improve stage has somewhere to land. |
| `boot-harness` if compound missing | Report Improve loop missing; recommend `compound-0-setup` | Required report | Missing compound is harness friction, not silent success. |
| During work, when friction occurs | Invoke `compound-1-track` silently | Required when trigger is material | Captures friction while fresh without interrupting. |
| Natural pause with empty buffer | Self-prompt once for magic-wand; track if concrete | Suggested, capped | Avoids missing learning when no obvious friction occurred. |
| End of meaningful session/phase | Invoke `compound-2-bubble` | Required if buffer non-empty; silent if empty | Gives user control and persists selected entries. |
| Start of a new session with leftover buffer | Invoke `compound-2-bubble` before continuing | Required | Prevents stranded session-local learning. |
| Before planning large work | Suggest `compound-3-harvest` if many open entries exist | Suggested | Avoids planning around recurring unresolved harness pain. |
| End of phase / merge / review | Invoke or suggest `compound-3-harvest` | Suggested; required for harness-maintenance phases | Converts accumulated entries into prioritized improvement backlog. |
| User asks "what should we improve?" | Invoke `compound-3-harvest` | Manual | Curator view is the right answer. |

### Trigger Details

#### `compound-0-setup`

Run when:

- installing the skill suite into a repo that does not have `docs/compound/`;
- `boot-harness` finds no Improve ledger and the user wants to enable it;
- `engineering-harness-setup` creates a new harness and the user accepts compounding support.

Do not run when:

- `docs/compound/.disabled` exists;
- the user wants a pure governance-file harness with no ledger yet.

Default behavior in `engineering-harness-setup` should be:

```text
Compound ledger: missing
Recommended: run compound-0-setup so Known Difficulties and Improve have a durable source.
Proceed? [yes/no]
```

#### `compound-1-track`

Run silently during work when the agent observes material friction:

- command/search/tool call takes >30 seconds and blocks progress;
- expected search returns zero results and causes backtracking;
- same operation is retried more than once;
- build/test failure required guesswork to interpret;
- boot/health/observe evidence is missing or unclear;
- agent catches a magic-wand idea: "if only there were a command/flag/output/fixture/diagnostic";
- user points out a repeated harness/workflow annoyance.

Do not run:

- more than roughly once every 5 minutes for self-prompted entries;
- for trivial preference notes;
- for one-off noise with no likely encoded fix;
- if `.disabled` exists.

#### `compound-2-bubble`

Run at:

- end of a meaningful user session;
- end of a plan phase;
- after a feature/bugfix reaches a validation checkpoint;
- before handing off to another agent;
- start of a session if the buffer has leftover entries.

User-facing rule:

- one prompt maximum per logical pause;
- empty buffer is silent;
- default action is save/all-save;
- no auto-application of fixes.

#### `compound-3-harvest`

Run or suggest at:

- start of planning if there are enough open/unharvested entries to affect scope;
- after multiple sessions have produced retros;
- before a harness-improvement phase;
- end of merge/review/phase debrief;
- whenever the user asks what recurring friction should be fixed next.

Default thresholds:

| Condition | Behavior |
|-----------|----------|
| 0 retros | Print "no retros yet"; suggest using `boot-harness` + `compound-1-track` during work. |
| 1-4 open entries | Manual harvest only; do not nag. |
| 5+ open entries | Suggest harvest at start of planning/exploration. |
| 10+ open entries | Strongly suggest harvest before architecture/implementation planning. |
| Any stale blocking entry | Surface prominently in boot/setup output. |

---

## Integration with `engineering-harness-setup`

`engineering-harness-setup` should integrate with compound in three places.

### 1. Create-mode discovery

Detect:

```txt
docs/compound/
docs/compound/.disabled
docs/compound/agents/**/*.retro.md
docs/compound/_buffers/
```

Report:

```txt
Compound ledger: ready | missing | disabled | partial
```

### 2. Optional scaffold

If missing, ask whether to scaffold:

```txt
No compound ledger found. Scaffold docs/compound/ so the harness can capture and harvest recurring friction?
```

If accepted, run the equivalent of `compound-0-setup` or tell the user to run it next. The first implementation can recommend rather than auto-run to keep the setup skill simple.

### 3. Known Difficulties

Keep the current behavior:

- read `docs/compound/agents/**/*.retro.md`;
- filter open/suggested entries relevant to boot;
- cluster by kind + target;
- render top 10 in `## Known Difficulties`.

If compound is missing, the Known Difficulties section should say:

```md
_No compound ledger found yet. Run `compound-0-setup` to create the durable Improve loop._
```

---

## Integration with `boot-harness`

`boot-harness` should treat compound readiness as part of boot readiness.

Add these checks:

| Check | Healthy | Degraded | Recommended Action |
|-------|---------|----------|--------------------|
| `docs/compound/` exists | Ledger ready | Missing | Run `compound-0-setup` |
| `.disabled` absent | Capture enabled | Disabled | Respect opt-out; say Improve capture is disabled |
| `_buffers/<agent>.session-buffer.md` empty/missing | No carryover | Non-empty | Run `compound-2-bubble` before work |
| `agents/**/*.retro.md` exists | Prior learning available | Empty | Say no retros yet; not a failure |
| Known Difficulties populated | Boot-time learning visible | Empty/missing | Say the loop has not produced boot-visible friction yet |

Readiness report additions:

```md
- Compound ledger: ready / missing / disabled / partial
- Session buffer: empty / non-empty / missing
- Prior retros: N
- Improve loop action: none / run compound-0-setup / run compound-2-bubble / consider compound-3-harvest
```

---

## Storage Contract

Canonical tree:

```txt
docs/compound/
├── README.md
├── .disabled                  # optional opt-out, not created by setup
├── _buffers/
│   ├── README.md
│   └── .gitignore             # ignores *.session-buffer.md
└── agents/
    └── .gitkeep
```

Runtime paths:

```txt
docs/compound/_buffers/<agent>.session-buffer.md
docs/compound/agents/<agent>/<YYYY-MM-DD>/T<HH-MM-SS>Z-<hash>.retro.md
```

Rules:

- buffers are transient and gitignored;
- retros are durable and may be committed;
- no derived index files are written;
- harvest computes views at read time;
- `.disabled` disables all compound skills;
- setup is idempotent and non-destructive.

---

## Entry Contract

Minimum entry shape:

```yaml
- id: DL-001
  kind: difficulty
  description: "Health check failed without saying which service was unreachable."
  target: observe
  severity: degrading
  workaround: "Inspected logs manually."
  suggested_encoding: "Add service-level failure category to the health check output."
  system:
    compound:
      status: open
      source: agent-self
      first_seen_at: "2026-05-26T00:00:00Z"
```

Recommended enums:

| Field | Values |
|-------|--------|
| `kind` | `difficulty`, `magic-wand`, `gift`, `insight`, `coordination`, `improvement-suggestion`, `confusion` |
| `target` | `engineering-harness`, `tooling`, `infra`, `build`, `config`, `dependencies`, `env`, `auth`, `tests`, `observe`, `docs`, `skill`, `project`, `coordination` |
| `severity` | `blocking`, `degrading`, `annoying` |
| `status` | `open`, `suggested`, `encoded`, `dismissed`, `wontfix`, `stale` |
| `source` | `agent-self`, `user` |

The port should avoid target values tied to a private source project.

---

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| A. Do not port compound; keep boot-harness prose only | Agents report friction in final messages. | Lowest implementation cost. | Improve remains non-durable and hard to harvest. | Rejected |
| B. Port only `compound-0-setup` | Scaffold ledger but no capture/bubble/harvest skills. | Gives a durable path. | Incomplete lifecycle; agents still improvise capture. | Rejected |
| C. Port all four compound skills with sanitized wording | Full capture -> bubble -> harvest lifecycle. | Makes Improve operational; clear run triggers. | More docs/skills to maintain. | Selected |
| D. Fold compound into `boot-harness` | One skill owns boot and Improve. | Fewer skill names. | Bloats boot; mixes start-of-session with curation lifecycle. | Rejected |
| E. Setup auto-runs compound silently | Harness setup always creates ledger. | Strong default compounding. | Might surprise users by adding a ledger. | Rejected for v0.1; ask/recommend instead |

---

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation | Agent must infer which compound pieces to port and where. | Port list, paths, and sanitization rules are explicit. |
| Review | Reviewer must compare four source skills manually. | Reviewer can check responsibilities and trigger tables. |
| Boot | Agent can say "Improve missing" but not prescribe lifecycle. | Boot can point to `compound-0/2/3` actions based on state. |
| Session end | Agent may ask ad-hoc retro questions. | Bubble is the single user-visible prompt. |
| Harness maintenance | Recurring friction is scattered. | Harvest clusters by recurrence, severity, and age. |

---

## Acceptance Criteria for the Port

The port reaches Implementation Ready when:

- [ ] Four skills exist in this repo: `compound-0-setup`, `compound-1-track`, `compound-2-bubble`, `compound-3-harvest`.
- [ ] Each skill frontmatter has only public-safe name and description.
- [ ] Source-specific workshop references and private project names are removed or generalized.
- [ ] `engineering-harness-v2` references are replaced with `engineering-harness-setup` or neutral engineering-harness wording.
- [ ] `engineering-harness-setup` either offers `compound-0-setup` or clearly recommends it when compound is missing.
- [ ] `boot-harness` reports compound ledger state and buffer carryover.
- [ ] README and `INSTALL.md` list the compound skills or explain that the full repo skill install includes them.
- [ ] `npx skills@latest add "$(pwd)" -l` discovers all ported skills.
- [ ] `git diff --check` passes.
- [ ] The port does not create or commit transient `*.session-buffer.md` files.

---

## Open Questions

### Q1: Should `engineering-harness-setup` auto-run `compound-0-setup`?

**Preferred**: No for the first port. It should recommend or ask. Auto-running later is reasonable once users have seen the ledger shape.

### Q2: Should compound skills live under `skills/compound/<slug>/`?

**Preferred**: No for now. Keep flat `skills/<slug>/SKILL.md` because this repo already uses that layout and `npx skills` discovers it.

### Q3: Should `compound-1-track` truly be silent in all CLIs?

**Preferred**: Yes. The only user-facing loop should be `compound-2-bubble`, otherwise compounding becomes nagware.

### Q4: Should harvest mutate retro status?

**Preferred**: Yes, but only for explicit lifecycle actions such as resolved/wontfix/dismissed. The default harvest view should be read-only.

### Q5: Should compound be required for harness readiness?

**Preferred**: Not initially. `boot-harness` should mark missing compound as degraded Improve readiness, not block all work. It should become a stronger gate only for harness-improvement work.

---

## Quick Reference

```bash
# One-time ledger setup
/compound-0-setup

# Silent capture during work when material friction appears
/compound-1-track

# End-of-session / phase pause, drains buffer if non-empty
/compound-2-bubble

# Periodic curation and recurrence view
/compound-3-harvest
```

Operational rule:

```text
setup creates the place;
track captures silently;
bubble asks once;
harvest prioritizes;
engineering-harness work encodes the fix.
```

---

## Validation Record (2026-05-26T10:59:44+10:00)

### Validation Thesis

**Raison d'être**: The change set exists to turn the repo from a foundation/tutorial repo with one drifted skill into an installable harness-engineering skill suite that users can install, use to set up/boot a harness, and operate a self-improving compound loop.

**Value claim**: First-time users and future agents should have less ambiguity about what to install, when to run each skill, and how friction becomes encoded improvements.

**Artifact promise**: The suite exposes a coherent path: install skills -> run `engineering-harness-setup` if no harness -> run `boot-harness` at session start -> track friction silently -> bubble once -> harvest recurring improvements.

**Intended beneficiaries**: New users, future coding agents, maintainers, reviewers, and target repos adopting harness engineering.

**Proof target**: Integration / Implementation

**Evidence standard**: Vercel skills discovery, local self-checks, install-doc consistency, explicit lifecycle contracts and triggers, setup/boot references to compound, and public-safe shipped skill text.

**Thesis source**: User request plus this workshop.

**Thesis verdict**: Advanced

**Main thesis risk**: No runtime enforcement yet; the loop depends on agents following the documented triggers and CLI installs.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|----------------|---------------------|--------|---------|
| install-contract-validator | Accuracy, Consistency, Evidence Sufficiency, Integration & Ripple, Deployment & Ops, User Experience, Thesis Alignment | Agent Readiness, Operator Usability, Review Compression | 1 MEDIUM fixed | Validated with fix |
| compound-loop-validator | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit, Hidden Assumptions, Edge Cases & Failures, Integration & Ripple, Concept Documentation, User Experience, Learning Compounding | Learning Compounding, Agent Readiness, Operator Usability | 0 | Validated |
| thesis-proof-validator | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit, User/Product Value Preservation, Agent Readiness, Learning Compounding, Attention Reduction, Concept Documentation, Hidden Assumptions | Learning Compounding, Implementation Readiness, Attention Reduction | 0 | Validated |
| forward-compat-validator | Forward-Compatibility, Integration & Ripple, Contract Integrity, Shape Mismatch, Lifecycle Ownership, Test Boundary, Deployment & Ops, Thesis Alignment | Agent Readiness, Review Compression, Implementation Readiness | 0 | Validated |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Vercel skills CLI | Discoverable `skills/*/SKILL.md` with valid frontmatter | Skills not discoverable | Pass | `npx skills@latest add "$(pwd)" -l` found 6 skills |
| First-time user | Clear install command plus client variants | Hidden install path / missing variants | Pass | `README.md`, `INSTALL.md` |
| Target-repo agent | setup -> boot -> compound lifecycle guidance | Wrong skill choice / missing next step | Pass | `boot-harness/SKILL.md`, `engineering-harness-setup/SKILL.md` |
| engineering-harness-setup | compound recommendation plus AGENTS signpost | Missing Improve ledger guidance | Pass | `engineering-harness-setup/SKILL.md` |
| boot-harness | readiness checks plus compound awareness | No place to land friction | Pass | `boot-harness/SKILL.md` |
| compound lifecycle | shared storage/status contract | Shape mismatch between buffer/retro/harvest | Pass | `compound-0/1/2/3` skill docs |

**Thesis alignment**: Value claim advanced at Integration / Implementation proof level; main risk is that runtime enforcement still depends on agents following documented triggers and CLI installs.

**Outcome alignment**: “setup creates the place; track captures silently; bubble asks once; harvest prioritizes; engineering-harness work encodes the fix.”

**Standalone?**: No — the workshop feeds the skill-suite port, install docs, `boot-harness`, and `engineering-harness-setup` integration.

Overall: VALIDATED WITH FIXES

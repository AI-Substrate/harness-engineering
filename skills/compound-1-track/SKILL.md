---
name: compound-1-track
description: Silent producer-side capture for the compounding-value loop. Appends one friction, insight, magic-wand, or improvement entry to docs/compound/_buffers/<agent>.session-buffer.md without interrupting the user.
---
# compound-1-track

Run this skill silently during work when the agent observes material friction or a concrete improvement idea.

No user-facing output. No prompting. No fixing. This skill only appends to the current agent's session buffer so `compound-2-bubble` can present one end-of-session decision point later.

If `docs/compound/.disabled` exists, no-op silently.

---

## When to run

Run for material friction:

- a command, search, test, or build step blocks for more than about 30 seconds;
- a search unexpectedly returns no useful results and causes backtracking;
- the agent retries the same operation more than once;
- a build/test/boot failure requires guesswork to interpret;
- a harness command is missing, unclear, unsafe, or not discoverable;
- evidence capture, health checks, fixtures, auth, data, or observation paths are missing;
- the agent has a concrete magic-wand thought: "if only there were a command, flag, output field, fixture, diagnostic, template, or workflow change."

Do not run for:

- trivial preferences;
- one-off noise with no likely encoded fix;
- repeated self-reflection more than roughly once every five minutes;
- more than about five entries per ordinary session unless the session is explicitly harness-maintenance work.

---

## Preconditions

If `docs/compound/_buffers/` is missing, do not create the full scaffold here. Report internally that `compound-0-setup` is needed, or ask the user at a natural pause.

If the buffer file is missing but `_buffers/` exists, create:

```txt
docs/compound/_buffers/<agent>.session-buffer.md
```

Agent slug examples:

| Agent | Slug |
|---|---|
| Claude Code | `claude-code` |
| Codex CLI | `codex` |
| GitHub Copilot CLI | `github-copilot` |
| OpenCode | `opencode` |
| Pi | `pi` |

---

## Entry format

Append one YAML list item per call.

```yaml
- id: DL-001
  kind: difficulty
  description: "Health check failed without identifying which dependency was unreachable."
  target: observe
  severity: degrading
  workaround: "Inspected raw logs manually."
  suggested_encoding: "Add dependency-level failure categories to the health output."
  system:
    compound:
      status: open
      source: agent-self
      first_seen_at: "2026-05-26T00:00:00Z"
```

Recommended IDs:

| Kind | Prefix |
|---|---|
| `difficulty` | `DL` |
| `magic-wand` | `MW` |
| `gift` | `GFT` |
| `insight` | `INS` |
| `coordination` | `COORD` |
| `improvement-suggestion` | `SUGG` |
| `confusion` | `CONF` |

Generate IDs by scanning the current buffer for the highest matching prefix and incrementing it. Keep counters scoped to the buffer file.

Recommended values:

| Field | Values |
|---|---|
| `kind` | `difficulty`, `magic-wand`, `gift`, `insight`, `coordination`, `improvement-suggestion`, `confusion` |
| `target` | `engineering-harness`, `tooling`, `infra`, `build`, `config`, `dependencies`, `env`, `auth`, `tests`, `observe`, `docs`, `skill`, `project`, `coordination` |
| `severity` | `blocking`, `degrading`, `annoying` |
| `system.compound.status` | `open` |
| `system.compound.source` | `agent-self`, `user` |

---

## Append-only rule

Append entries. Do not rewrite, sort, validate, or drain the buffer. `compound-2-bubble` owns draining; `compound-3-harvest` owns curation.

---

## Task-boundary heuristic

At a natural pause:

- if the buffer is empty, ask the agent-internal magic-wand question once and track only if the answer is concrete;
- if the buffer is non-empty, do not self-prompt again.

The point is to capture learning without turning the loop into nagware.


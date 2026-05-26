---
name: compound-0-setup
description: Scaffold the repo-local compounding-value ledger at docs/compound/. Creates the durable Improve-stage storage used by compound-1-track, compound-2-bubble, compound-3-harvest, boot-harness, and engineering-harness-setup. Idempotent and opt-out aware.
---
# compound-0-setup

Run this skill once per repository to create the durable ledger for the engineering-harness Improve stage.

This skill does not validate the product. It creates the place where future humans and agents can preserve friction, insights, magic-wand requests, encoded fixes, and proof that the harness is improving.

If `docs/compound/.disabled` exists, stop silently. The opt-out is absolute.

---

## When to run

- First time a repo wants the compounding-value loop.
- After `engineering-harness-setup` creates a harness and reports that no compound ledger exists.
- When `boot-harness` reports `Improve loop location: missing`.
- When `compound-1-track` cannot find `docs/compound/_buffers/`.
- Any time the user wants an idempotent re-check.

---

## Step 1: Scaffold the tree

Create missing directories and files only. Never overwrite user-modified files.

```txt
docs/compound/
├── README.md
├── .disabled                  # optional opt-out; do not create
├── _buffers/
│   ├── README.md
│   └── .gitignore             # ignores *.session-buffer.md
└── agents/
    └── .gitkeep
```

### `docs/compound/README.md`

Seed content:

```markdown
# docs/compound/ - Compounding Value Ledger

This tree is the source of truth for the engineering-harness improvement loop.

## Layout

- `agents/<agent-slug>/<YYYY-MM-DD>/T<HH-MM-SS>Z-<hash>.retro.md` - one durable retro file per saved session.
- `_buffers/<agent>.session-buffer.md` - transient per-agent buffer, drained by `compound-2-bubble`.
- `.disabled` - optional opt-out sentinel. If present, compound skills no-op.

## Lifecycle

| Skill | Reads | Writes |
|---|---|---|
| `compound-0-setup` | existing tree | scaffolds this tree |
| `compound-1-track` | opt-out sentinel | appends to `_buffers/<agent>.session-buffer.md` |
| `compound-2-bubble` | one buffer | writes `.retro.md` files under `agents/` |
| `compound-3-harvest` | retros | prints prioritized views and updates explicit lifecycle statuses |

## Rule

Retros are the source of truth. Do not maintain derived index files by hand.
```

### `docs/compound/_buffers/README.md`

Seed content:

```markdown
# _buffers/

Transient per-agent session buffers. `compound-1-track` appends entries here during work; `compound-2-bubble` drains them at session end or logical pauses.

These files are gitignored because they are session-local scratch state.
```

### `docs/compound/_buffers/.gitignore`

Seed content:

```gitignore
*.session-buffer.md
```

### `docs/compound/agents/.gitkeep`

Create an empty file.

---

## Step 2: Optional legacy migration

If `docs/retros/` exists and contains legacy `*.md` retros, do not migrate automatically unless the user asks. Instead, report:

```txt
Legacy retros found in docs/retros/. The compound ledger is ready; migrate those retros only after review.
```

This keeps the first port safe and reversible.

---

## Step 3: Report

Print a short report:

```md
## Compound setup report

- Ledger: ready / disabled / partial
- Files created:
- Files already present:
- Legacy retros: none / found
- Next action:
```

Recommended next action:

- run `boot-harness` to verify the engineering harness can see the Improve loop;
- run `engineering-harness-setup --validate` if the harness Known Difficulties section should be refreshed from compound retros.

---

## Re-entrant behavior

On rerun:

- create only missing files;
- leave existing content untouched;
- respect `.disabled`;
- do not delete buffers or retros;
- report the ledger as ready if the required tree exists.


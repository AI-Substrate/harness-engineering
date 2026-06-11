# Workshop: `harness record` CLI shape

**Type**: CLI Flow
**Plan**: 012-harness-record-command
**Spec**: (pre-spec — grounded in [`../original-ask.md`](../original-ask.md))
**Created**: 2026-06-09T09:55:44Z
**Status**: Draft

**Value Thesis**: Specifies the exact command surface, envelope, exit codes, and placement so `/plan-3` can build `harness record` as a drop-in sibling of `harness new` — agent-callable, non-blocking, evidence-returning.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Preferred Direction → Contract Ready

**Selected Value Axes**:
- **Operator Usability**: the command an agent types to get a file path back.
- **Agent Readiness**: stable `--json` envelope + exit codes mean no log-scraping.
- **Implementation Readiness**: concrete act/service/error-code wiring for the architect.
- **User Experience**: honest `unconfigured`/error states with a `next_action` every time.

**Related Documents**:
- Workshop 1 — record-type contract (the registry this command resolves against)
- Workshop 3 — skills update inventory (who calls this command)
- Envelope contract: `harness/cli/src/output/{envelope,error-codes,exit}.ts`
- Sibling command: `harness/cli/src/acts/new.ts` + `services/scaffold/`

---

## Purpose

Pin the `harness record` command surface: the create path, the discover path, the author-a-new-type path, the output envelope (human + JSON), placement/collision rules, and the error/exit codes — all consistent with the repo's "CLI is the API" contract.

## Fresh Entrant Outcome

A fresh agent/human reaches **Contract Ready**: they can implement `acts/record.ts` + `services/record/`, knowing every command, flag, envelope field, exit code, and error code.

They should be able to:
- Run `harness record <type>` and parse the returned path from the JSON envelope.
- Discover available types with `harness record --list`.
- Author a new type with `harness new <name> --record`.

## Key Questions Addressed

- What are the commands, flags, and outputs?
- What's the placement + collision rule, concretely?
- What status/exit/error codes does each path return?
- How does this stay a sibling of `harness new` (not a new pattern)?

---

## Value Frame

| Field | Selection | Why It Matters |
|---|---|---|
| Target Proof Level | Contract Ready | Architect builds the act/service from this. |
| Primary Value Axis | Agent Readiness | Stable envelope + exit codes are the contract agents depend on. |
| Supporting Value Axes | Operator Usability, Implementation Readiness, UX | Discoverable, buildable, honest states. |
| Downstream Loop Improved | Implementation + every skill that records | One callable command replaces hand-written YAML. |

---

## Command Summary

| Command | Purpose | Core? |
|---|---|---|
| `harness record <type> [--slug s] [--json]` | Scaffold a record file from `<type>`'s template; return its path | core (reserved) |
| `harness record` / `harness record --list` | List available record types (core ∪ extension) | core |
| `harness new <name> --record` | Scaffold a new record-type **extension** stub into `.harness/extensions/` | core (`new` variant) |
| `harness doctor` | (extended) enumerates record types alongside verbs | core |

`record` joins `help`/`doctor`/`new`/`docs`/`skills` as a **reserved core name** (runs in `--no-extensions` safe mode; cannot be shadowed by an extension verb).

---

## `harness record <type>` — create

```
$ harness record retro --slug "harness-flow-skill"

┌─────────────────────────────────────────────────────────────┐
│ 1. Resolve <type> in merged registry (core ∪ extension)     │
│    • retro → found (core)                                    │
│ 2. Resolve path                                             │
│    • .harness/records/retro/2026-06-09-harness-flow-skill.md │
│    • exists? → append -001, -002, … (3-digit, zero-padded)   │
│ 3. Write template (never clobber). Return the path.          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ OUTPUT (human → stderr summary + path on stdout)            │
│                                                             │
│   Created .harness/records/retro/2026-06-09-harness-flow-…  │
│   → open and fill it, then save.                            │
│   record: ok                                                │
└─────────────────────────────────────────────────────────────┘
```

### `harness record <type>` (JSON output)

```
$ harness record retro --slug "harness-flow-skill" --json

{
  "command": "record",
  "status": "ok",
  "timestamp": "2026-06-09T09:55:44Z",
  "data": {
    "type": "retro",
    "path": ".harness/records/retro/2026-06-09-harness-flow-skill.md",
    "source": "core"
  },
  "evidence": [
    { "label": "retro record", "path": ".harness/records/retro/2026-06-09-harness-flow-skill.md" }
  ],
  "next_action": "Open and fill .harness/records/retro/2026-06-09-harness-flow-skill.md, then save."
}
```

**The contract**: `data.path` + `evidence[0].path` are where the agent "hops to" next. Fire-and-fill: the CLI does placement + creation; the agent does content.

### Placement & collision (the locked rule)

```
.harness/records/<type>/<YYYY-MM-DD>-<slug>.md          ← base (UTC date via injected Clock)
.harness/records/<type>/<YYYY-MM-DD>-<slug>-001.md      ← base exists → -001
.harness/records/<type>/<YYYY-MM-DD>-<slug>-002.md      ← next clash → -002
```

- Date from the injected `Clock` (deterministic in tests).
- `--slug` is **optional**; absent → `<YYYY-MM-DD>.md` (date-only), collisions still get `-NNN`. Provided slug is slugified (`^[a-z0-9-]+$`, lowercased, unsafe chars stripped).
- `.harness/records/<type>/` is `mkdirp`'d if missing. `.harness/` itself is **not** scaffolded — see `unconfigured` below.
- Never clobbers: the collision counter guarantees a fresh path.

---

## `harness record --list` — discover

```
$ harness record --list
harness record — available types:
  • retro        Harness loop retrospective — session friction, gifts, magic-wand wishes.   [core]
  • dev-survey   Developer-experience survey — one respondent, one sitting.                 [extension]

  harness record <type> [--slug "<name>"]
```

```
$ harness record --list --json
{ "command": "record", "status": "ok", "timestamp": "…",
  "data": { "types": [
    { "type": "retro", "description": "Harness loop retrospective …", "source": "core" },
    { "type": "dev-survey", "description": "Developer-experience survey …", "source": "extension", "entryPath": ".harness/extensions/dev-survey.record.ts" }
  ] },
  "next_action": "Create one with `harness record <type> --slug \"<name>\"`." }
```

Bare `harness record` (no subcommand/type) → the same orientation listing (non-blocking, exit 0), mirroring bare `harness skills`.

---

## `harness new <name> --record` — author a new type

A new variant of the existing `harness new` (which already has `--wrap`/`--js`). Scaffolds a **record-type extension** so the loader discovers it.

```
$ harness new dev-survey --record
Created .harness/extensions/dev-survey.record.ts
→ edit the template body, then `harness record dev-survey`. `harness doctor` confirms it loaded.
new: ok
```

The stub exports `{ kind:'record', type:'dev-survey', description:'…', template:'…' }` (Workshop 1 §3). No separate "add a type" concept — authoring a type *is* scaffolding a record extension.

---

## `harness doctor` (extended)

Doctor gains a record-types line alongside the extensions/verbs enumeration (declarative; invokes nothing):

```
✓ record-types: 2 available (1 core, 1 extension)
    • retro [core]
    • dev-survey [extension]  .harness/extensions/dev-survey.record.ts
```

---

## Error & status codes

| Path | Status | Exit | Code | next_action |
|---|---|---|---|---|
| created OK | `ok` | 0 | — | "Open and fill `<path>`." |
| `.harness/` absent | `unconfigured` | 2 | — | "No `.harness/` here — set up the harness first." |
| `<type>` not in registry | `error` | 1 | **E180** | "Unknown record type `<x>`. Known: retro, dev-survey, … (`harness record --list`)." |
| invalid/empty `--slug` after slugify | `error` | 1 | E108 | "Pass a slug of [a-z0-9-], e.g. `--slug my-note`." |
| dir create / file write failed | `error` | 1 | **E181** | "Could not write `<path>` (permissions?). Check `.harness/` is writable." |
| `harness new <n> --record` name reserved/exists | `error` | 1 | E151 / E152 | (existing scaffold codes) |

New entries for `src/output/error-codes.ts`:
```typescript
/** `harness record <type>`: no such record type in the merged registry. */
RECORD_TYPE_UNKNOWN: 'E180',
/** `harness record <type>`: the directory create or file write failed. */
RECORD_WRITE_FAILED: 'E181',
```

> **Why `unconfigured` (not error) for missing `.harness/`**: honesty-over-fake-success (Principle 5). A repo with no harness is a *gap to set up*, not a failure — exit 2, with a `next_action`. This is also what lets the calling skills treat it as `UNAVAILABLE` and stay silent (Workshop 3).

---

## Decision Space

| Option | Description | Pros | Cons | Decision |
|---|---|---|---|---|
| A. `harness record <type>` noun+arg | type is a positional arg to a reserved `record` command | reads naturally; one reserved name; matches `skills install` style | adds a reserved core name | **Selected** |
| B. `harness record-<type>` dynamic verbs | each type registers its own verb | no `record` reserved name | re-adds the retired-verb pattern P10 killed; fragments help | Rejected |
| C. fold under `harness new <type>` | reuse `new` for records too | one command | overloads `new` (extension scaffold vs record create); confusing | Rejected (but `new --record` authors a *type*) |

---

## Architecture wiring (sibling of `new`)

```
src/acts/record.ts            # thin commander act: <type> arg, --slug, --list; renders envelope
src/services/record/
  contract.ts                 # HarnessRecordType (Workshop 1 §1)
  core-types/retro.ts         # the core-bundled retro type + RETRO_TEMPLATE
  record-service.ts           # pure: resolve type, resolve path (clock+fs), render template, return outcome
  registry.ts                 # merge core ∪ extension record types (from the extensions loader)
src/output/error-codes.ts     # + E180, E181
src/app.ts                    # registerRecordAct(program, io, deps); 'record' reserved
```

Ports used (all existing): `fs` (readdir for collision scan, mkdirp, write, exists), `clock` (date + timestamp), `proc` (cwd). **No new adapter** needed for create/list (collision scan is a single-dir `readdir`, which the FsPort already supports). No `git`, no `exec`, no network.

## Evidence Ledger

| Evidence | Location | Supports | Status |
|---|---|---|---|
| Command summary + 3 flows | §Command Summary…author | full surface | Ready |
| JSON envelopes (create + list) | §create, §discover | agent contract | Ready |
| Placement + collision spec | §Placement | the locked naming rule | Ready |
| Error/status/exit table + new codes | §Error & status codes | failure contract | Ready |
| Act/service wiring | §Architecture wiring | buildability | Ready |

## Open Questions

### Q1: `--slug` optional or required?
**RESOLVED**: Optional. Absent → date-only filename `<date>.md`; collision counter still applies. A slug is recommended for legibility but never blocks (agent-first, non-blocking).

### Q2: Should `record <type>` echo the template to stdout (so the agent fills in-place) vs. just return the path?
**OPEN (lean: path only).** Returning just the path keeps `--json` a clean single envelope and the agent reads the file itself (it has `view`). Echoing the body duplicates content and bloats JSON. Revisit if a non-filesystem caller appears.

### Q3: Does `--list` need `--json` to include `entryPath` for extension types?
**RESOLVED**: Yes (shown above) — parity with `doctor`'s extension provenance; core types omit it.

## Validation / Acceptance

Reaches Contract Ready when:
- `harness record retro --json` returns a valid `ok` envelope whose `data.path` is a freshly-created file under `.harness/records/retro/`.
- A second create the same day yields `-001`.
- `harness record nope` → `E180` exit 1 with a `next_action` listing known types.
- `harness record` in a repo without `.harness/` → `unconfigured` exit 2.
- `harness record --list` enumerates core ∪ extension types; `doctor` shows the record-types line.

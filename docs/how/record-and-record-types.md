# Record and record types

How to use `harness record <type>` to scaffold a structured record file your
agent fills, and how to add a new **record type** — bundled in core or dropped in
as an extension.

> **Where docs live (for now):** user guides live under `docs/how/`. Documentation
> is planned to become a first-class, CLI-surfaced concept later; this guide is
> written standalone so it can be promoted/indexed without moving.

---

## The model in one minute

A **record** is a structured markdown file an agent (or human) fills — a
retrospective, a developer survey, a handover. A **record type** is the template
that file is scaffolded from. `harness record <type>` does the boring part —
placement, naming, never clobbering — and hands you back a path to fill:

```
<your repo>/
└── .harness/
    ├── records/
    │   └── retro/
    │       └── 2026-06-09-harness-flow-skill.md   ← committed record you fill
    └── temp/                                       ← gitignored agent scratch (see below)
```

The CLI is deliberately **schema-agnostic**: it knows only four fields about a
type (`kind`, `type`, `description`, `template`) and writes the `template` to a
path. The record's *actual* schema lives inside the template body (frontmatter
keys + commented guidance). So adding the next record type is **a template and
four fields**, never a change to the `record` command.

---

## Create a record: `harness record <type>`

```bash
harness record retro --slug "harness-flow-skill"     # → .harness/records/retro/<date>-harness-flow-skill.md
harness record retro                                 # no slug → .harness/records/<date>.md
harness record retro --slug x --json                 # machine-readable envelope
```

The success Envelope reports the path — that's where your agent "hops to" next:

```bash
$ harness record retro --slug "harness-flow-skill" --json
{"command":"record","status":"ok","timestamp":"…",
 "data":{"type":"retro","path":".harness/records/retro/2026-06-09-harness-flow-skill.md","source":"core"},
 "evidence":[{"label":"retro record","path":".harness/records/retro/2026-06-09-harness-flow-skill.md"}],
 "next_action":"Open and fill .harness/records/retro/2026-06-09-harness-flow-skill.md, then save."}
```

Fire-and-fill: the CLI does placement + creation; the agent reads the returned
file and fills the values.

### Placement & collision (the locked rule)

```
.harness/records/<type>/<YYYY-MM-DD>-<slug>.md          ← base (UTC date)
.harness/records/<type>/<YYYY-MM-DD>-<slug>-001.md      ← base exists → -001
.harness/records/<type>/<YYYY-MM-DD>-<slug>-002.md      ← next clash → -002
```

- The date comes from the system clock (UTC). `--slug` is optional and is
  slugified to `[a-z0-9-]`; absent → a date-only filename.
- The `<type>/` directory is created if missing. `.harness/` itself is **not**
  scaffolded — if there's no `.harness/`, `record` reports `unconfigured` (exit 2)
  with a `next_action`, and writes nothing.
- It **never clobbers**: the collision counter always yields a fresh path.

### Status & exit codes

| Path | Status | Exit | Code |
|------|--------|------|------|
| created OK | `ok` | 0 | — |
| no `.harness/` here | `unconfigured` | 2 | — |
| unknown `<type>` | `error` | 1 | `E180` (lists known types) |
| invalid/empty `--slug` | `error` | 1 | `E108` |
| dir create / write failed | `error` | 1 | `E181` |

---

## Discover types: `harness record --list`

```bash
harness record --list          # human listing (bare `harness record` shows the same)
harness record --list --json   # data.types[]: { type, description, source, entryPath? }
```

`harness doctor` also reports a `record-types` line enumerating the same
core ∪ extension types.

---

## Author a new record type

A record type needs only four fields:

```ts
import type { HarnessRecordType } from 'harness-engineering/contract';

const devSurvey: HarnessRecordType = {
  kind: 'record',                                    // discriminator (vs a verb)
  type: 'dev-survey',                                // the <type> arg + dir name; ^[a-z][a-z0-9-]*$
  description: 'Developer-experience survey.',       // shown by --list + doctor
  template: `---\nrecord_type: dev-survey\n---\n…`,   // the body the agent fills (this IS the schema)
};

export default devSurvey;
```

### Fast path: `harness new <name> --record`

```bash
$ harness new dev-survey --record
# → .harness/extensions/dev-survey.record.ts  (a loadable record-type stub)
```

Edit the template body, then `harness record dev-survey` works and `harness
doctor` shows it under record-types. (Routing is by the `kind:'record'` field —
the `.record.ts` suffix is just a human hint.)

### Core vs extension

- **Core types** (bundled, e.g. `retro`) are always present, even under
  `--no-extensions`.
- **Extension types** are discovered from `.harness/extensions/` by the same
  loader that loads verbs. Isolation is identical: a load failure is non-fatal
  (`E140`, reported by `doctor`); a malformed type is skipped + recorded.
- **Conflicts are deterministic**: an extension declaring an existing core `type`
  → core wins, the conflict is recorded by `doctor` (never fatal); two extensions
  with the same `type` → first-loaded wins, the other is recorded and skipped.

### Naming rules

- Lowercase, hyphenated, starting with a letter: `retro`, `dev-survey`.
- `record` is a reserved core command — `harness new record` is rejected (`E151`).

---

## Records vs the scratch buffer (`.harness/temp/`)

Two storage tiers, easy to mix up:

| | `.harness/records/` | `.harness/temp/` |
|---|---|---|
| What | Committed records you fill (`harness record <type>` output) | Gitignored crash-resilient agent scratch |
| Git | **Tracked** | **Ignored** |
| Lifetime | Durable | Survives `/compact`, then drained |

The loop's Observe stage (`eng-harness-3-observe`) jots working notes to
`.harness/temp/<agent>/session-buffer.md`; at session end `eng-harness-4-retro
--drain` materializes a **committed** record via `harness record retro`. `harness
record` ensures `.harness/temp/` exists + is gitignored on first use.

---

## Verify

```bash
harness record --list   # the type appears (core or extension)
harness doctor          # the record-types line shows it (with provenance)
harness record <type>   # creates a file under .harness/records/<type>/ — `ok` (exit 0)
```

To skip extensions entirely (core types only), use `harness --no-extensions
record …` or `HARNESS_NO_EXTENSIONS=1`.

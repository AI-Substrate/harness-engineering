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
 "data":{"type":"retro","path":".harness/records/retro/2026-06-09/001-harness-flow-skill.md","source":"core"},
 "evidence":[{"label":"retro record","path":".harness/records/retro/2026-06-09/001-harness-flow-skill.md"}],
 "next_action":"Open and fill .harness/records/retro/2026-06-09/001-harness-flow-skill.md, then save."}
```

Fire-and-fill: the CLI does placement + creation; the agent reads the returned
file and fills the values.

### Placement & ordinal (the locked rule)

```
.harness/records/<type>/<YYYY-MM-DD>/001-<slug>.md      ← first record that day
.harness/records/<type>/<YYYY-MM-DD>/002-<slug>.md      ← next → 002
.harness/records/<type>/<YYYY-MM-DD>/003-<other>.md     ← a different slug shares the per-day sequence
```

- The date comes from the system clock (UTC) and is the **directory**; `<NNN>`
  is a per-day, per-type **ordinal** (`001`, `002`, …) = 1 + the highest already
  present, so records sort chronologically within the day.
- `--slug` is optional and is slugified to `[a-z0-9-]`; absent → an ordinal-only
  filename (`<NNN>.md`).
- The `<type>/<date>/` directories are created if missing. `.harness/` itself is
  **not** scaffolded — if there's no `.harness/`, `record` reports `unconfigured`
  (exit 2) with a `next_action`, and writes nothing.
- It **never clobbers**: the ordinal always yields a fresh path.

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

## Bundled core record types

Beyond `retro`, two **core** types ship for documenting the harness's own
deterministic layer (both always present, even under `--no-extensions`):

### `harness-bypass` — the paved path was avoided

Records that an agent or human reached for a shortcut instead of the supported
command, and why. Body keys (the template's schema):

| Key | Type / values |
|---|---|
| `cause` | `missing-command \| command-failed \| too-slow \| unclear-output \| no-coverage \| policy \| agent-could-not` |
| `attempted` | bool — was the supported command tried first? |
| `command` | string — the supported command that was bypassed |
| `severity` | `blocking \| degrading \| annoying` |

```bash
harness record harness-bypass --slug "prove-too-slow"
# → .harness/records/harness-bypass/<date>/001-prove-too-slow.md
```

### `harness-change` — the harness was improved

Records an improvement to the harness, optionally pointing back at the friction
it resolves. Body keys:

| Key | Type / values |
|---|---|
| `change_type` | `new-command \| sensor \| fixture \| template \| doc \| skill-edit \| routing` |
| `target` | string — what was changed |
| `resolves` | free-form ref (≤200 chars) — the friction this closes, e.g. a `harness-bypass` record |

```bash
harness record harness-change --slug "prove-fast-path"
# → .harness/records/harness-change/<date>/001-prove-fast-path.md
```

Together these make the deterministic layer **self-documenting**: every bypass
and every improvement becomes a committed, joinable record. See
[Harness value measures](./harness-value-measures.md) for how they roll up into
bypass / change rates.

---

## The provenance header (stamped on every record)

Every record `harness record <type>` scaffolds carries a **provenance header**
the CLI splices into the frontmatter at write time — so records join to a repo,
branch, time, and plan with no manual bookkeeping. It is the **8-key frozen
contract**: **7 keys spliced by the CLI**, plus the **template-owned**
`schema_version`.

```yaml
---
record_kind: harness-bypass        # ← 7 spliced keys, in this order
harness_version: 0.3.0
branch: 020-harness-bypass-change-records
repo: https://github.com/AI-Substrate/harness-engineering
created_at: 2026-06-16T08:42:11Z
agent: the-flow-implementer        # optional provenance slug
plan_id: 020-harness-bypass-change-records
schema_version: "1.0"              # ← 8th key — template-owned, never spliced
# … then the type's body keys …
---
```

- The 7 spliced keys, in order: `record_kind`, `harness_version`, `branch`,
  `repo`, `created_at`, `agent`, `plan_id`. Values come from deterministic
  substrate (`git`, the CLI version, the clock); `repo` is the git remote URL.
- `schema_version` is **template-owned** — the CLI never splices it (that would
  duplicate the YAML key). The splice is **idempotent**: it strips any existing
  top-level copy of a spliced key first, then prepends.
- `agent` is optional identity (`--agent <slug>` → `HARNESS_AGENT` env →
  omitted); capture never fails when it's absent, and it is aggregated
  **team-level only**, never per-person.

---

## Author a new record type

A record type needs only four fields:

```ts
import type { HarnessRecordType } from '@ai-substrate/engineering-harness/contract';

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

## Two storage classes: committed records vs transient observations

| | `.harness/records/` | `.harness/temp/` |
|---|---|---|
| What | Committed records you fill (`harness record <type>` output) | Gitignored crash-resilient agent scratch — incl. observation buffers (`harness observe` output) |
| Git | **Tracked** — team memory | **Ignored** — never committed |
| Lifetime | Durable | Survives `/compact`, then drained |

### Capturing observations: `harness observe`

In-flight friction is captured with one command — the CLI owns the buffer path,
per-kind sequential IDs, ISO timestamps, schema validation, and the gitignore
guarantee; the agent supplies only the noticing:

```bash
harness observe "grep on src/ took 47s — should use ripgrep" \
  --kind difficulty --target tooling --severity degrading --json
# → data: { "bucket":"agent", "id":"DL-001", "kind":"difficulty",
#           "path":".harness/temp/agent/session-buffer.md" }
```

- Kinds: `difficulty | magic-wand | gift | insight | coordination |
  improvement-suggestion | confusion | win`; severities `blocking | degrading | annoying`.
- Identity is optional provenance: `--agent <slug>` → `HARNESS_AGENT` env → a
  shared `agent` bucket. Capture never fails on identity.
- Bad input (`unconfigured`, exit 2) names the allowed values and leaves the
  buffer untouched; an unreadable buffer is `error` exit 1 (`E146`) — never
  silent data loss.

### Draining observations into a committed record

```bash
harness observe --list --json   # all buckets by default; --agent <slug> scopes
harness record retro --slug "<label>" --json   # scaffold the committed record
# … write the drained entries into the returned data.path …
harness observe --clear         # remove the drained entries (files kept)
```

`--list` returns entries bucket-annotated plus a `malformed_skipped` count
(deviant hand-written blocks are skipped and counted, never silently dropped —
`--clear` removes only valid entries and leaves deviant text in place for
manual review). Capture (`harness observe "<desc>" …`) and `harness record
<type>` self-heal the `.harness/temp/` nested `.gitignore`; `--list`/`--clear`
only read and rewrite buffers. `harness doctor` reports a convention complaint
(degraded, exit 0) if the temp dir ever exists unprotected.

---

## Verify

```bash
harness record --list   # the type appears (core or extension)
harness doctor          # the record-types line shows it (with provenance)
harness record <type>   # creates a file under .harness/records/<type>/ — `ok` (exit 0)
```

To skip extensions entirely (core types only), use `harness --no-extensions
record …` or `HARNESS_NO_EXTENSIONS=1`.

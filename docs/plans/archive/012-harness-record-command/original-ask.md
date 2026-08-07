# Original ask — harness-record-command
**Captured**: 2026-06-09T09:48:28Z  ·  **By**: /the-flow

> yeah let's investigate what a cli might look like. not extension, it shuld be core.

> okay lets just have it create a file from a template in the right place and return the
> file path, then the agent can read and fill it. Then later we can add more other types
> of stuff to record. maybe we collect other data or surveys from developres etc... just
> have a simple take this template and creaet a file in the righ place with the right
> ordinal or what ever and then return the file path and the agent can hop to

> oh and mke it date slug yeah still please. if they clash, add 000 number format.
> .harness will definitely be comitted.

> how is a "retro" defined in a generaic way with template / schema so that we can add
> more of them later easily. We would want to add them both as core and in extensions, so
> perhaps an extension can be of type "record" and it will then be loaded up as a record
> and then you can add that type of record via the cli. also need to be able to add record
> types via the cli etc. dont over enginer yet, just still basic planing

> we also need to include resarch in to how we adapt our flows to use this, as opposed to
> writing where teh do at the moment. also identify any other core record types eeneded
> what what hte schema needs to be to start with

> lets get a new plan ordinal etc and get all this down.

---

## Locked design decisions (from the session that preceded this plan)

- **Core, not extension.** A new first-class `harness record <type>` command, sibling of
  `harness new` (template → right place → return path). Reserved core name.
- **It scaffolds, the agent fills.** The CLI writes a template file to the right place and
  returns the path + `next_action`; the agent reads and fills it. No runtime schema
  validation, no buffer-append, no harvest/cluster in core (those evaporate at this scope).
- **Placement**: `.harness/records/<type>/<YYYY-MM-DD>-<slug>.md` (UTC date from injected
  Clock). On collision, append a zero-padded 3-digit counter (`…-001.md`, `…-002.md`).
  `.harness/` is committed → records compound + are shared by default.
- **Generic record-type contract** (minimal): `{ kind: 'record', type, description, template }`.
  "Schema" = structure/comments embedded in the template for now; a machine-validatable
  JSON Schema is an optional future field, not built yet. Placement stays CLI-owned/uniform.
- **Two sources, one registry** (symmetry with verbs): **core** (bundled types, e.g. `retro`)
  ∪ **extension** (an extension whose default export is `kind: 'record'`, discovered by the
  existing loader). Verbs and record types are separate namespaces.
- **CLI affordances**: `harness record <type>` (create), `harness record --list` (discover),
  `harness new <name> --record` (scaffold a new record-type extension). `doctor` enumerates
  record types alongside verbs.
- **`retro` is the first core record type** (template embeds the universal Entry fields;
  the frozen `retro.schema.json` is echoed in the template comments).

## In scope for this plan's research (the two explicit research asks)

1. **Flow adaptation** — research how the existing flows (the `eng-harness-3-observe` /
   `eng-harness-4-retro` loop skills, and any `plan-*` pipeline write-sites) should change
   to **call `harness record`** instead of hand-writing to `docs/harness/...` where they do
   today. Produce a write-site inventory + an adaptation map.
2. **Record-type catalog + starting schema** — identify any **other core record types**
   needed beyond `retro` (e.g. survey / dev-feedback / handover / …) and define **what the
   schema needs to be to start with**.

## Explicitly NOT in scope (deferred)

- Runtime schema validation, atomic buffer-append, harvest/cluster/lifecycle in core
  (the heavier data-plane the rubber-duck flagged — superseded by the scaffold-only model).
- Governance amendment for "reserved core nouns" is light here since `record` is a scaffold
  sibling of `new`; confirm during the spec.

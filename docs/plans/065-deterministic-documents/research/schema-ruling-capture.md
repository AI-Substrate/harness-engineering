> **FROZEN PROVENANCE — verbatim as authored, not maintained.**
> This file records what was said or found at the time it was written. Its terminology,
> shapes, and decisions are **as-written and may not be current** — later rulings supersede
> without editing this file. The authoritative, maintained record of decisions and open
> items is `workshop-notes.md`. Consistency sweeps should **skip this file by design**:
> a stale-looking term here is correct, not a defect.

# Schema referencing & resolution — ruled by Jordan 2026-08-03 (PM capture, off-tree)

> D-entry draft for silkworm to record in workshop-notes.md. Resolves W6 by
> supersession. Every line below is Jordan-ruled in the koala session today
> unless marked (PM).

## D14 (proposed number) — Schemas are named packages, resolved by convention

- **By-reference, not in-file**: a `.dd.json` names its schema; it never embeds
  it. SUPERSEDES the brief's ".dd.json files will contain their schema" line.
  No inline schema mode.
- **Identity is `package/schema`** — two segments, e.g. `builder/plan`,
  `builder/backpressure`. No `-schema` suffixes in refs or folder names ("we
  know they're schemas"). Refs are always fully qualified; no bare short form.
- **Layout**: `.dd/schemas/<package>/<schema>/` — one folder per schema inside
  its package folder. Schema file is self-describing (name, description);
  description lives IN the schema file, no sidecar. (PM note: folder later
  hosts W1 render adapters / templates.)
- **Resolution order** (first hit wins):
  1. the doc's own folder (ultimate override — "schema in same folder works")
  2. `<gitroot>/.dd/schemas/`
  3. `.harness/.dd/schemas/`
  4. `~/.dd/schemas/`
  Hierarchy/children under each root are scanned for the name.
- **Clashes are loud**: dd doctor highlights ALL clashes — duplicate qualified
  name within a root (hard error), cross-root shadowing (shows winner +
  shadowed), and same-folder local override shadowing a repo schema. `dd
  schema list` shows name, description, source root/path, shadowed dupes.
- **Discovery**: `dd schema list` (+ `dd schema show <package>/<schema>` (PM
  proposed, unruled)).
- **Evolution = breaking change**: docs float live against the current schema
  — no basis pin, no versions in refs. A tightened schema fails its docs
  immediately; doctor reports the full blast radius.
- **Unresolvable ref = hard validate ERROR** (not warn).
- **No fixtures in schema packages**: validator correctness is dd's own
  central unit tests' job, not per-package examples. (Jordan ruled against PM
  recommendation — recorded as considered-and-rejected.)

## W-item impact

- W6 (schema-in-file depth): RESOLVED by supersession → by-reference model.
- W9 (addressing): must record that schema refs are a SECOND reference kind —
  a qualified NAME resolved by root-scan — distinct from doc links (relative
  PATHS). Two kinds, two resolution rules, side by side.
- W1 (render adapters): schema package folder is the natural shipping home.

## Loose ends (small, for the D-entry or W9)

- "scan children for name": confirm hierarchy above package folders is
  organization-only and never part of the name.
- dd schema show verb: proposed, unruled.

# dd schema-resolution fixture corpus

Every case is a whole **world**: a `repo/` tree (the git root, whose documents live in
`repo/docs/`) and, where the case needs it, a `home/` tree. The four discovery roots the
resolver derives from a world are always the same:

| # | Root kind | Path in a fixture world |
|---|---|---|
| 1 | `doc-folder` | `repo/docs` (the folder holding the document) |
| 2 | `gitroot` | `repo/.dd` |
| 3 | `harness` | `repo/.harness/.dd` |
| 4 | `home` | `home/.dd` |

Each root is **deep-scanned** for the `schemas/<pkg>/<schema>/schema.json` convention, so a
package may sit at any depth beneath its root.

Tests load a world through `loadSchemaWorld()` (`../world.ts`), which walks the real fixture
tree once and seeds a `FakeFs` with it — the corpus stays real, enumerable files while the
resolver still runs against a fake port (house rule: fakes only). `dd validate`'s live
end-to-end proof runs against the same files on real disk.

## Failure classes and their good twins

| Bad fixture / input | Class | E-code | Good twin |
|---|---|---|---|
| `malformed-package/` (`builder/plan`: `sections` is an array; `builder/notes`: non-object shape fields) | package invalid | E411 | `single-root/` |
| `duplicate-in-root/` (`builder/plan` under two `schemas/` dirs in the **same** root) | name conflict — hard error | E412 | `precedence-chain/` (same name across **different** roots is legal) |
| `precedence-chain/` (three lower-precedence duplicates) | shadowed — WARN-class, resolution still succeeds | E413 | `single-root/` (no shadows) |
| `unsupported-version/` (`dd_schema: 99`) | version unsupported | E414 | `single-root/` (`dd_schema: 1`) |
| `invalid-enum/builder/subset` (`gate_terminal` outside `values`), `…/unbound` (field binds an undeclared enum), `…/conflicting` (two `state` fields bind different gate-terminal sets) | enum/gate-terminal declaration invalid | E415 | `custom-enum/` |
| a throwing `SchemaFs` port over `single-root/` (no on-disk fixture — a scan failure is a *port* failure, not a file) | scan failed | E416 | `single-root/` |
| a qualified name with traversal segments (`../../escape/plan`) requested against `single-root/` | path escape | E417 | `single-root/` (`builder/plan`) |
| `single-root/repo/docs/unknown-schema.dd.json` (`builder/nowhere`) | schema not found | E410 | `single-root/repo/docs/plan.dd.json` |

## Resolution / precedence fixtures

- **`precedence-chain/`** — the *same* qualified name `builder/plan` exists in **all four**
  roots, each with a distinguishing `description` (`…from the doc-folder root`, `…gitroot…`,
  `…harness…`, `…home…`). Proves first-hit-wins order exactly and that the three losers are
  reported as shadows with their paths.
- **`deep-scan/`** — `builder/plan` buried at `repo/.dd/team/shared/nested/schemas/builder/plan/`.
  Proves the scan is deep, not a fixed two-level probe.
- **`beyond-cap/`** — `builder/plan` nested **nine** levels below its root, at
  `repo/.dd/org/team/squad/area/service/module/component/feature/config/schemas/builder/plan/`.
  D14 rules the hierarchy above a package organization-only and sets **no** depth bound, so this
  world exists to redden the moment anyone reintroduces one: it sits one level past the 8-level
  semantic cap that P2 review F001 removed. A bounded scan omits it silently — the worst failure
  mode there is, since the schema is simply "not found" rather than reported.
- **`single-root/`** — one schema, one root: the plain good twin, plus documents that exercise
  each validate outcome (`plan` clean, `invalid-plan` ERROR-class, `warn-only` WARN-class,
  `unknown-schema` unresolvable).
- **`custom-enum/`** — `builder/review` declares a `review` enum with its own
  `gate_terminal: ["approved","waived"]` plus a plain `severity` enum. `review.dd.json` is
  gate-complete, `review-incomplete.dd.json` is not, `review-bad-value.dd.json` uses a built-in
  completion state the custom enum does not declare.
- **`chain/`** — `a → b → c → d` one link per hop, with `d` carrying an ERROR-class issue.
  Proves `--depth 2` and `--depth 3` differ: depth 3 reaches `d`, depth 2 does not.
- **`exemplar/`** — a real `plan.dd.json` + `backpressure.dd.json` + `execution-log.dd.json`
  trio validated against the repository's **own** committed `.dd/schemas/builder/*` packages
  (not a fixture copy), so a change to a shipped exemplar schema reddens the suite. It pins the
  workshop-002 shapes: D2's `pressure`/`proven_by` link columns on AC rows, one evidence list
  per task **keyed by the owning task id**, and a `human-skipped` entry carrying its receipt.

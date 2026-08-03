# dd links fixture corpus

Real `.dd.json` data laid out as a miniature repository (`repo/`), so the link
resolver, the corpus scan, the graph and the doctor sweep are exercised against
documents rather than hand-built objects. Two schemas live in `schemas/`; tests
inject them through a fixture `SchemaResolver`, exactly like the dd-core corpus.

`repo/docs/plan.dd.json` and `repo/docs/evidence.dd.json` are the canonical good
pair every twin below is measured against.

## Address-resolution ERROR classes (`link-unresolved`)

Workshop 001 § Resolution rules both "segment names a schema part that doesn't
exist" and "id not found in the named collection" as validate ERRORs. `reason`
is the discriminator carried on the finding.

| Fixture | `reason` | Good twin |
|---|---|---|
| `repo/docs/unresolved-section.dd.json` | `section-unknown` | `repo/docs/plan.dd.json` |
| `repo/docs/unresolved-part.dd.json` | `part-unknown` | `repo/docs/plan.dd.json` |
| `repo/docs/unresolved-id.dd.json` | `id-not-found` | `repo/docs/plan.dd.json` |
| `repo/docs/unresolved-not-a-container.dd.json` | `not-a-container` | `repo/docs/plan.dd.json` |

## Schema-aware target check (rides P2 resolution)

| Fixture | Expected class | Good twin |
|---|---|---|
| `repo/docs/type-mismatch.dd.json` | `link-type-mismatch` | `repo/docs/type-match.dd.json` |

## WARN-only path and target classes

| Fixture | Expected class | Good twin |
|---|---|---|
| `repo/docs/path-absolute.dd.json` | `address-path-absolute` | `repo/docs/plan.dd.json` |
| `repo/docs/path-non-posix.dd.json` | `address-path-non-posix` | `repo/docs/nested/child.dd.json` |
| `repo/docs/path-escape.dd.json` | `address-path-escape` | `repo/docs/plan.dd.json` |
| `repo/docs/target-missing.dd.json` | `address-target-missing` | `repo/docs/target-untracked.dd.json` |
| `repo/docs/target-untracked.dd.json` | `address-target-untracked` | `repo/docs/plan.dd.json` |
| `repo/docs/basis-stale.dd.json` | `basis-stale` | `repo/docs/basis-fresh.dd.json` |

## Finding ownership (the file that must change owns the finding)

`repo/docs/broken-neighbour.dd.json` is `blocked` with no note — an ERROR on its
own terms. `repo/docs/plan-cites-broken.dd.json` links to it and is itself
clean. A run rooted at the citing plan surfaces the finding, but its `owner` is
the neighbour: the neighbour is the file that must change.

## Loop breakers

- `repo/docs/cycle-a.dd.json` ↔ `repo/docs/cycle-b.dd.json` — the two-document loop.
- `repo/docs/self-cycle.dd.json` — self-reference by path (a one-document loop).

Traversal must terminate on both, visiting each document once. The visited set
is the breaker; removing it must redden a bounded test, never hang it.

`repo/docs/two-missing-neighbours.dd.json` guards the *other* side of that
tripwire: one valid document pointing at two distinct in-repo documents that do
not exist. Those are three legitimate pops, so a bound that counts only
successfully loaded documents fires on a perfectly terminating walk — turning two
ruled WARNs into an ERROR. The bound counts scheduled paths for exactly this
reason.

## Scoped roots beyond the subtree

`repo/docs/nested/gateway.dd.json` links out of the `nested/` subtree to
`repo/docs/beyond-scope.dd.json`, which carries an invalid interior of its own.
With the sweep scoped to `nested/`, `beyond-scope` is reached only by link — and
its finding must still be reported, because `--path` scopes the root set and
never the radius.

## Same-document form

`repo/docs/bare-same-doc.dd.json` carries a bare-`#` address, which resolves
against its own containing document (workshop 001 addendum 1).

## Sweep exclusion (OD-1)

`repo/docs/sweep-excluded.dd.json` is deliberately broken and carries
`dd.sweep_exclude: true`. Sweep mode skips it; direct invocation never does.

## Scan layout

- `repo/docs/nested/child.dd.json` — the scan recurses, and inbound edges cross folders.
- `repo/docs/notes.md` — enumeration is `*.dd.json` only.
- `repo/node_modules/ignored.dd.json` — skip-listed directories are pruned.

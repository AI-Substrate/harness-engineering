# Freshness and the basis ledger

Links answer where a value lives. A **basis** answers which bytes a conclusion
was checked against.

The top-level `references` array records one target document per entry:

```json
{
  "references": [
    {
      "path": "tasks/phase-2/tasks.dd.json",
      "sha": "7ecec970543db1f5523bedf52714d63ed3d194434c48948827f9eeed775c4f3c",
      "mode": "live"
    },
    {
      "path": "execution-log.dd.json",
      "sha": "59be498a8d7ba8374a995658da81c295dc069a78399e0649453e254d0c336975",
      "mode": "pinned"
    }
  ]
}
```

The SHA covers the entire target `.dd.json`, even when a link addresses one
section or row inside it. The path resolves relative to the document carrying
the ledger.

## `live` and `pinned`

| Mode | Meaning |
| --- | --- |
| `live` | render current derived summaries from the target |
| `pinned` | preserve the recorded review point until explicit re-verification |

Both modes retain a recorded SHA, and validation reports a WARN when the target
document's current SHA differs.

A live render reads the current target to compute linked section summaries. It
does **not** rewrite the SHA in the `.dd.json`; the build result reports moved
bases in `refreshed_bases`. This keeps `dd build --check` read-only and
byte-stable.

A pinned entry does not participate in live summary refresh. Move it only after
recomputing or reviewing whatever depended on that target.

## Check a basis

At the command line, use a repository-root-qualified address:

```bash
node_modules/.bin/dd link verify-basis \
  "docs/how/dd/exemplar/plan.dd.json#meta" \
  --sha <recorded-sha>
```

A match returns `state: fresh`. A mismatch returns a `degraded` envelope with
`state: stale`, error code `E434`, and both hashes. Staleness is information:
it tells the consumer to recompute; it does not by itself fail a dd gate.

## Move a recorded basis

After reviewing the current target:

```bash
node_modules/.bin/dd link verify-basis \
  "docs/how/dd/exemplar/plan.dd.json#meta" \
  --sha <recorded-sha> \
  --update path/to/consumer.dd.json
```

`--update` names the document whose ledger changes. The address remains
repository-root-qualified; it is not resolved relative to the update target.
The old single-page guide implied otherwise; that documentation defect is
tracked as FU-7.

The mutation:

1. resolves and hashes the target;
2. finds an existing ledger entry in the consumer;
3. changes only that entry's `sha` value and preserves its mode;
4. serializes the consumer as canonical two-space JSON;
5. regenerates the consumer's `.dd.md` sibling.

It never creates a missing ledger entry. Adding a dependency is authoring;
re-verification only moves a dependency already recorded.

## Links and ledger entries are different structures

A schema-declared `link` creates a graph edge and can be followed by validation.
A `references` entry records freshness for a target document. A ledger entry
does not create a navigable link by itself, and a link does not automatically
add a ledger entry.

Record a basis when a conclusion or rendered summary depends on target bytes,
not for every incidental mention.

## Avoid reciprocal basis cycles

Suppose `a.dd.json` records the SHA of `b.dd.json`, and `b.dd.json` records the
SHA of `a.dd.json`. Updating either recorded SHA changes that document's bytes,
which changes the SHA the other file records. The pair cannot settle.

The validator does not prohibit this structure. Keep basis dependencies
acyclic by design. A log can link back to a plan without recording the plan as
a basis if the log's meaning does not depend on transcluding plan state.

For why freshness matters — how these mechanisms add up to an auditable claim — see
[The builder proof graph](11-the-builder-proof-graph.md).

# How to add a schema (and an adapter)

A worked example: a `review/checklist` schema with its own completion vocabulary, and a custom
type rendered by an adapter. Everything below is convention — there is no registry to edit.

## 1. Create the package

Schemas live in folders. The qualified name comes from the **path**, never from the file, so a
copied package cannot misreport its identity:

```
<gitroot>/.dd/schemas/review/checklist/schema.json
                      ^pkg   ^schema
```

Any of the four discovery roots works — the document's own folder, `<gitroot>/.dd`,
`<gitroot>/.harness/.dd`, or `~/.dd` — and the package may sit at any depth beneath one.

## 2. Write `schema.json`

```json
{
  "dd_schema": 1,
  "description": "A review checklist whose items are approved or waived, not ticked.",
  "enums": {
    "review": {
      "values": ["draft", "in-review", "approved", "waived"],
      "gate_terminal": ["approved", "waived"]
    },
    "severity": { "values": ["info", "warn", "error"] }
  },
  "sections": {
    "meta": {
      "required": true,
      "shape": {
        "type": "object",
        "required": ["title"],
        "fields": {
          "title": { "type": "string" },
          "severity": { "type": "enum", "enum": "severity" }
        }
      }
    },
    "items": {
      "shape": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["id", "state"],
          "fields": {
            "id": { "type": "string" },
            "claim": { "type": "text" },
            "state": { "type": "state", "enum": "review" },
            "note": { "type": "string" },
            "receipt": { "type": "string" },
            "proven_by": { "type": "link" },
            "burndown": { "type": "sparkline" }
          }
        }
      }
    }
  }
}
```

Three rules worth stating plainly:

- **`description` lives in the file.** `dd schema list` shows it beside the resolved path.
- **`gate_terminal` is declared on the enum, never on a field.** A schema may bind at most one
  gate-terminal declaration to its `state` fields — `deriveState` takes exactly one terminal set,
  so an ambiguity is refused at declaration time instead of quietly changing what "done" means.
- **An unknown `type` is not an error.** `sparkline` above is a custom type; core has nothing to
  validate for it, and the renderer asks an adapter to draw it.

## 3. Check it resolves

```bash
harness dd schema list
harness dd schema show review/checklist
```

`show` prints the winning path, the section shapes, every declared enum with its gate-terminal
set, and — when a lower-precedence root holds a copy — the shadow chain. If two copies live in
the *same* root, that is a hard error: nothing can arbitrate them, so fix the duplicate.

## 4. Write a document and validate it

```json
{
  "dd": { "schema": "review/checklist" },
  "sections": [
    { "name": "meta", "value": { "title": "Release review", "severity": "warn" } },
    {
      "name": "items",
      "value": [
        { "id": "dw-11c2", "claim": "Migration is reversible", "state": "approved" },
        {
          "id": "dw-4e01",
          "claim": "Council sign-off",
          "state": "waived",
          "note": "no council for internal tooling"
        }
      ]
    }
  ],
  "references": []
}
```

```bash
harness dd validate review.dd.json --json | jq '{status, counts: .data.counts}'
```

## 5. The `human-skipped` receipt convention

`human-skipped` is the one state an agent may never set. It passes the gate — so it must be
answerable forever. The document records the human's own words:

```json
{
  "id": "dw-a9c4",
  "claim": "Perf benchmark re-run on the new host",
  "state": "human-skipped",
  "receipt": "Jordan, 2026-08-03: skip it, the host is identical and I watched the last run."
}
```

Validation refuses a `human-skipped` entry without a receipt containing verbatim words, exactly
as it refuses `blocked` or `na` without a note. `--force` on a flow gate is a different lever: it
moves past a gate once and is recorded; a skip waives one item, permanently and queryably.
Neither is a substitute for the other.

## 6. Add an adapter for a custom type

An adapter is a file whose presence *is* its registration — no manifest, no import list:

```
<gitroot>/.dd/schemas/review/checklist/adapters/sparkline.ts
```

```ts
/**
 * (value, ctx) => string — pure, synchronous, and never throws for user input.
 *
 * `ctx` carries: `type` (the custom type name, i.e. this file's own basename),
 * `field` (the column), `shape` (the column's declaration, verbatim from the
 * schema), `path` (the document being rendered), and `location` (where the
 * value sits inside it). Destructure only what you need — the parameter below
 * narrows to `location` on purpose.
 */
export default function sparkline(value: unknown, ctx: { location: string }): string {
  if (!Array.isArray(value) || value.length === 0) {
    return `_(no data for ${ctx.location})_`;
  }
  const bars = '▁▂▃▄▅▆▇█';
  const numbers = value.filter((entry): entry is number => typeof entry === 'number');
  const max = Math.max(...numbers, 1);
  return numbers
    .map((entry) => bars[Math.min(bars.length - 1, Math.round((entry / max) * (bars.length - 1)))])
    .join('');
}
```

A missing or throwing adapter is **loud, not fatal**: the value renders with an honest fallback
and the build envelope carries an explicit warning, which the doctor repeats. A quiet fallback
would let a broken adapter look like a boring document forever.

## Checklist

1. `<root>/schemas/<pkg>/<schema>/schema.json` with `dd_schema: 1` and a `description`.
2. Enums declared once, bound per field; `gate_terminal` on the enum.
3. `harness dd schema show <pkg>/<schema>` resolves, and the path is the one you meant.
4. `harness dd validate <doc>` is clean at `--depth 0`, then at the default depth.
5. Adapters (if any) at `adapters/<type>.ts`, pure and total.

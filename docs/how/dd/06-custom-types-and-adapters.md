# Custom types and adapters

Schema shapes handle validation. Adapters handle presentation. The custom
release corpus keeps byte counts, minute counts, and number arrays as ordinary
JSON:

```json
{
  "window": 2610,
  "footprint": 1572864,
  "burndown": [41, 38, 33, 27, 27, 19, 11, 6, 2]
}
```

Its generated markdown presents them as:

| Field | Rendered value |
| --- | --- |
| `window` | **1d 19h 30m** |
| `footprint` | 1.5 MiB |
| `burndown` | █▇▇▅▅▄▃▂▁ 2 |

The source stays exact and queryable:

```bash
jq '.sections[] | select(.name=="meta") | .value.footprint' \
  docs/how/dd/exemplar/custom-render/release.dd.json
```

The result is `1572864`, not formatted text.

## Declare a custom type

Any shape type outside the built-in set is custom:

```json
{
  "fields": {
    "window": { "type": "duration" },
    "footprint": { "type": "bytes" },
    "burndown": { "type": "sparkline" }
  }
}
```

Core validation does not invent rules for an unknown type. If the value needs
structural validation, represent that structure with built-in shapes or add a
separate project check. The adapter only changes rendering.

## Registration is the file path

Adapters live beside the winning `schema.json`:

```text
<schema-package>/adapters/<type-name>.ts
```

For `release/gate`:

```text
schemas/release/gate/
├── schema.json
└── adapters/
    ├── bytes.ts
    ├── duration.ts
    └── sparkline.ts
```

There is no adapter manifest or import list. Only `.ts` is supported by the
current contract.

Adapters resolve from the winning schema package, not from the document or a
global registry. A higher-precedence schema override therefore carries its own
rendering behavior.

## Adapter contract

An adapter default-exports a synchronous function:

```ts
export default function duration(
  value: unknown,
  context: {
    type: string;
    field: string;
    shape: unknown;
    path: string;
    location: string;
  },
): string {
  const minutes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) {
    return `<${context.field}: not a duration>`;
  }
  return `**${minutes}m**`;
}
```

The context identifies:

- the custom type;
- the field or column;
- the full declared shape;
- the document path;
- the value's document location.

The function must return a markdown string. Keep it pure and total: do not read
the filesystem, mutate the document, or throw for user data.

## Loading and failure behavior

Only custom types populated by the current document are loaded. Each failure is
a WARN-class adapter issue:

| Failure | Meaning |
| --- | --- |
| `adapter-not-found` | the expected `.ts` file does not exist |
| `adapter-load-failed` | the module cannot load or lacks a callable default export |
| `adapter-runtime-failed` | the adapter throws while rendering |
| `adapter-output-invalid` | the adapter returns a non-string |

Rendering still produces a complete `.dd.md`. The affected cell falls back to
the raw JSON value plus a type tag:

```text
`[3,2,1]` ⟨type:sparkline⟩
```

The build envelope becomes `degraded` and carries the adapter issue, including
the expected path and first affected location. A verified missing-adapter probe
returned `E423` and wrote:

```text
| trend | `[3,2,1]` ⟨type:sparkline⟩ |
```

`dd doctor` repeats adapter problems across the corpus as warnings. A degraded
render never becomes a false clean result, but it also does not discard every
other readable cell.

## Worked corpus

Read these files together:

```text
docs/how/dd/exemplar/custom-render/
├── README.md
├── release.dd.json
├── release.dd.md
└── schemas/release/gate/
    ├── schema.json
    └── adapters/
```

Regenerate it from the repository root:

```bash
node_modules/.bin/dd build \
  docs/how/dd/exemplar/custom-render/release.dd.json
```

Check byte drift without writing:

```bash
node_modules/.bin/dd build \
  docs/how/dd/exemplar/custom-render/release.dd.json \
  --check
```

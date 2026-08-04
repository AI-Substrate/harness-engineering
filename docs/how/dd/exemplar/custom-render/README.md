# custom-render — a self-contained dd corpus with its own schema and adapters

> **⚠ This corpus fails on purpose, and that is the point.**
>
> Run `harness dd validate` on it from **this folder** and you get 5 warnings.
> Run it from the **repository root** and you get a clean bill of health. Run it
> from the folder **above** and you get a hard `E401`.
>
> Three verdicts, one unmodified document, and the only thing that changed is
> where you were standing. That is open defect **FU-4**, reproduced deliberately
> and left un-silenced — a fixture that has been quietened cannot prove a fix.
> See § Known issue at the bottom, or run `just fu4` from `docs/how/dd/` to
> watch all three happen in a row.
>
> **Everything else here works normally.** The custom schema, the three
> adapters, the enums and the dynamic-key map are all sound, and they resolve
> from any directory. Only the cross-document links and the containment boundary
> move with your cwd.

Everything this document needs lives in this folder. Nothing here is registered
anywhere, imported by anything, or listed in a manifest.

```
custom-render/
├── release.dd.json                  the data
├── release.dd.md                    the generated view  ← read this one
└── schemas/
    └── release/                     ← package name comes from the PATH
        └── gate/                    ← schema name comes from the PATH
            ├── schema.json
            └── adapters/
                ├── duration.ts      ← presence IS registration
                ├── sparkline.ts
                └── bytes.ts
```

The qualified name `release/gate` is read off the directory path, never out of
the file, so a copied package cannot misreport its identity. `release.dd.json`
says `"schema": "release/gate"` and resolution finds it because **the
document's own folder is the first discovery root**, deep-scanned for
`schemas/<pkg>/<schema>/schema.json`.

Adapters resolve from the **winning `schema.json`'s own folder** —
`<that folder>/adapters/<type-name>.ts`. Add a file, get a type. Delete it and
the render degrades loudly instead of lying.

## What to look at in `release.dd.md`

**A custom completion vocabulary.** This schema does not use `checked`/
`unchecked`. It declares its own, with its own passing set:

```json
"signoff": {
  "values": ["pending", "in-review", "approved", "waived", "rejected"],
  "gate_terminal": ["approved", "waived"]
}
```

So `[x] approved` and `[x] waived` pass the gate while `[ ] in-review`,
`[ ] pending` and `[ ] rejected` hold it. Note **`rejected` renders as holding,
not as passing** — a decided "no" is still an open gate, and the schema says so
rather than the renderer guessing.

**A second enum that is a vocabulary, not a gate.** `surface` (`cli` / `api` /
`docs` / `telemetry`) declares no `gate_terminal`, so it renders bare — no mark
at all. An enum only becomes a gate when a schema says it is one; the renderer
never invents the semantic.

**Three custom types, three adapters.** The data stays boring and queryable;
only the render is clever:

| in the JSON | in the markdown | adapter |
| --- | --- | --- |
| `"window": 2610` | **1d 19h 30m** | `duration.ts` |
| `"footprint": 1572864` | 1.5 MiB | `bytes.ts` |
| `"burndown": [41, 38, …, 2]` | █▇▇▅▅▄▃▂▁ 2 | `sparkline.ts` |

`jq '.sections[] | select(.name=="meta") | .value.footprint'` still returns
`1572864`. Presentation never contaminates the data.

**A dynamic-key map (`valuesShape`).** `sign_offs` is keyed by gate id —
`gt-0101`, `gt-0103`, `gt-0104` — which no schema can enumerate in advance. The
schema shapes the *interior* instead, and every key earns its own `###` heading
so its rows are addressable.

**Arrays of links.** `evidence` is `array of link`, and every element renders
clickable across files: `[ac-0201](../plan.dd.md#acceptance-criteria)`. Links
point at the sibling `.dd.md`, because that is the artifact a human clicking can
actually read.

**Honest emptiness.** `gt-0105` is an unstarted gate: `0m`, `0 B`,
`_(no data)_`. Nothing is hidden and nothing is faked.

## Regenerating

```bash
harness dd build docs/how/dd/exemplar/custom-render/release.dd.json
```

**Run it from the repository root.** That is not a preference — see below.

## Known issue: what does and does not resolve relatively (FU-4)

This corpus is also a live reproduction of the open defect in
[`docs/plans/065-deterministic-documents/follow-ups.md`](../../../../plans/065-deterministic-documents/follow-ups.md)
§ FU-4. The same unmodified
document produces **three different verdicts depending on where you stand**:

| cwd | `dd validate release.dd.json` |
| --- | --- |
| repository root | `ok` — 0 errors, 0 warnings |
| this folder | `degraded` — 5 `address-path-escape` warnings |
| `exemplar/` (the parent) | `error` — E401, `builder/plan` not found |

**What genuinely is relative, and works:**

- the document finding its own schema (`release/gate`) — proven by the
  doc-folder run reporting **0 errors**;
- the schema finding its own adapters — proven by all three custom types
  rendering, from every cwd;
- `harness dd build --check` reporting no byte drift from this folder.

**What is not, and is the bug:** `repoRoot` is taken from `process.cwd()`
(`acts/dd/build.ts:270`, `acts/dd/shared.ts:204`), and it serves as both the
`<gitroot>` discovery root *and* the containment boundary. So standing here
makes `../plan.dd.json` look like it escapes the repository (the 5 warnings),
and standing in `exemplar/` makes the depth-walk unable to resolve `builder/plan`
for that linked document (the E401) — because the real `.dd/` lives at the
repository root either way.

A related, smaller wrinkle: `harness dd schema list` reports **no doc-folder
root at all** (only gitroot / harness / home), so run from this folder it lists
zero schemas even though `release/gate` demonstrably resolves for a document
here. `list` has no document to anchor on, so the first precedence root simply
cannot exist for it — worth stating in the docs, since "which schemas resolve
from here" is exactly what a reader will assume it answers.

FU-4 is assigned to another seat; this folder is deliberately left as-is so it
keeps reproducing until that lands.

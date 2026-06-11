# Workshop: Doc Bundling & Source-of-Truth Strategy

**Type**: Storage Design
**Plan**: 007-first-class-documentation
**Spec**: [first-class-documentation-spec.md](../first-class-documentation-spec.md)
**Created**: 2026-06-08
**Status**: Approved

**Value Thesis**: Locks *how* curated Markdown reaches the installed CLI so `/plan-3` and the implementer never re-litigate the build/packaging mechanism, and so the `DocsService` stays pure (MCP-ready) by construction.
**Target Proof Level**: Implementation Ready
**Current Proof Level**: Implementation Ready

**Selected Value Axes**:
- **Implementation Readiness**: gives the implementer the exact file layout, generator behavior, and build wiring — no inference.
- **Safety to Change**: pins the single-source-of-truth + drift guard so editing a `.md` can't silently desync from what ships.
- **Agent Readiness**: keeps the service a pure in-memory data source, so a future MCP `docs_*` tool imports the same functions unchanged.
- **Cost / Attention Reduction**: collapses three candidate strategies (+ external research) into one decided path with a documented escape hatch.

**Related Documents**:
- [research-dossier.md](../research-dossier.md) — § "Where docs physically come from" (the A/B/C framing)
- Perplexity research (2026-06-08, in-session) — validated codegen-before-`tsc` as idiomatic for a `tsc`-only build

**Domain Context**: no `docs/domains/` registry. Primary cluster: `services/docs` (NEW); touches build/packaging.

---

## Purpose

Decide and specify how a curated set of Markdown docs is bundled into the shipped `harness` package so `harness docs <id>` works **offline for an npx/installed consumer**, while keeping `DocsService` pure (no `node:fs`, no `process.cwd()`) and the build a plain `tsc` pipeline.

## Fresh Entrant Outcome

A fresh human or agent should be able to use this workshop to reach **Implementation Ready** with no additional context. They should be able to:

- Place the generator, manifest, and generated module in the right paths (compiled by the existing `tsc` config).
- Wire generation into `build`/`prepare`/`test` correctly (ordering, zero new deps).
- Write the `DocsService` against a stable in-memory contract that a future MCP tool can reuse.
- Prove ship-ability and prevent source/artifact drift with tests + a CI check.

## Key Questions Addressed

1. Embed-as-TS (A) vs. copy-step (B) vs. generate-TS-from-MD (C)? → **C**.
2. Where do the manifest, generator, and generated module live so `tsc` compiles the result?
3. How is generation wired so every consumer command (build, test, lint) sees the artifact?
4. Is the generated file **committed** or **gitignored**? (the one real sub-decision)
5. How is source→artifact drift prevented, and how is "it actually ships" proven?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Implementation Ready | `/plan-3` can write tasks directly; no design left to the implementer |
| Primary Value Axis | Implementation Readiness | The mechanism is the riskiest unknown (no asset pipeline exists today) |
| Supporting Value Axes | Safety to Change, Agent Readiness, Cost/Attention Reduction | Drift guard + MCP-pure seam + one decided path |
| Downstream Loop Improved | Implementation + Review | Implementer follows a recipe; reviewer checks against a fixed contract |

## Decision Space

### D1 — Bundling strategy (the headline)

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A — Embed as TS** | Doc prose authored directly in `.ts` string consts | Zero build change; pure; snapshot-testable | Abandons `.md` authoring (no preview/tooling); fights plan-006 "author in docs/how, index later"; drift vs README/site | **Rejected** |
| **B — Copy-step + runtime read** | `scripts/copy-docs` → `dist/docs/`; read at runtime via `import.meta.url` | `.md` stays source; matches minih `agent-readme` | Introduces runtime path-resolution this repo deliberately avoids; pushes `node:fs` near service (P2 friction); most moving parts; brittle under odd exec envs | **Rejected** |
| **C — Generate TS from MD at build** | `scripts/gen-docs.mjs` reads curated `.md` → emits `docs-content.ts`; `tsc` compiles it | `.md` is sole source; **no runtime fs/path**; pure service; ships via plain `tsc`; snapshot-guardable; reversible to a bundler later with no API change | One small generator script to maintain; generated code in tree | **✅ Selected** |

**Rationale (evidence-backed)**: External research (Perplexity, 2026-06-08) found **no popular npm package** that turns `.md`→importable module for a *plain-`tsc`* build — the ecosystem text-loaders (esbuild `loader:{'.md':'text'}`, `@rollup/plugin-string`, Vite `?raw`, `vite-plugin-markdown`, `unplugin`) **all require a bundler**. For a `tsc`-only pipeline the two real options are codegen (C) or TS transformers (`ts-patch`/`ttypescript` — explicitly "overkill and brittle"). Codegen-before-`tsc` was called "both the simplest and most idiomatic," the same shape as Prisma / GraphQL / OpenAPI generators. C satisfies every spec constraint (md source-of-truth, offline, no runtime fs, pure service, plain `tsc`).

### D2 — Generated file: committed vs gitignored (the sub-decision)

Because `tsconfig` is `rootDir: "src"` + `include: ["src"]`, the generated module **must live under `harness/cli/src/`** to be compiled — and it is therefore **imported by source, tests, and linted by biome**.

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **Gitignored + regen hooks** | Treats `.md` as the *only* committed source | Every entry point must regen first (`pretest`, `prebuild`, biome ignore); a contributor running `vitest` directly hits a missing-import foot-gun; fragile ordering | Rejected (primary) |
| **Committed + drift guard** | No ordering fragility; `vitest`/`biome`/`tsc` all just work; visible in diffs; Prisma-style norm | `.md` content duplicated in git; editing a doc requires committing the regenerated artifact too | **✅ Selected** |

**Rationale**: the artifact lives *inside* `src/` and is consumed by the test + lint commands, so committing removes a real foot-gun (running `vitest` without a prior gen). Staleness — the only downside — is fully neutralized by the drift test (D5) plus a CI "regen is clean" check. *(This overrides the offhand "gitignored" suggestion from earlier conversation; the `rootDir: src` constraint is the deciding factor.)*

### D3 — Generator runtime: plain node vs tsx/jiti

| Option | Decision |
|--------|----------|
| **`node scripts/gen-docs.mjs`** (node:fs + node:path only, zero new deps) | **✅ Selected** |
| `tsx scripts/gen-docs.ts` | Rejected — `tsx` is **not** in devDeps; adding a dep for a 40-line script is unjustified |
| `jiti` (already a runtime dep) | Rejected — not needed; plain `.mjs` is simpler and dependency-light |

### D4 — `harness docs <id>` output shape (carried from spec Open Question)

| Surface | Shape | Decision |
|---------|-------|----------|
| `harness docs` (list) | JSON `formatOk` envelope `{ docs: DocEntry[] }` (+ human table) | Selected |
| `harness docs <id>` | **raw markdown to stdout**, exit 0 (EPIPE-safe, agent-pipe-friendly, mirrors minih `agent-readme`) | Selected |
| `harness docs <unknown>` | `formatError` envelope, `E16x`, non-zero exit | Selected |

*(Confirms spec; not a bundling concern but recorded here since it shapes the act↔service split below.)*

---

## Contract: file layout & shapes

### File tree (what gets created)

```
harness/cli/
├── src/
│   └── services/
│       └── docs/
│           ├── docs-manifest.ts        # curated ALLOW-LIST (P12) — id/title/summary/sourcePath/audience
│           ├── docs-content.ts         # GENERATED — { id, title, summary, content }[]  (committed; "do not edit")
│           ├── docs-service.ts         # PURE — list()/get(id) over DOCS; no fs, no cwd
│           └── contract.ts (or add to services/extensions/contract.ts) # DocEntry/DocContent/DocsListResult types
└── (root) scripts/gen-docs.mjs         # build-time generator (plain node)
```

> **Manifest as TS, content as generated TS**: the *allow-list* (`docs-manifest.ts`) is hand-authored and is the single curation point (AC4 / P12). The generator reads it to know which `.md` to inline. The allow-list's `sourcePath` values are **relative to repo root** (npm scripts run from the package/repo root).

### Types (transport-agnostic — the MCP seam)

```ts
// the stable contract a future mcp/tools/docs_* will import unchanged
export interface DocEntry   { id: string; title: string; summary: string; audience: 'human' | 'agent' | 'both'; }
export interface DocContent { id: string; title: string; content: string; format: 'markdown'; }
export interface DocsListResult { docs: DocEntry[]; }
export type DocLookup = DocContent | { notFound: true; id: string };
```

### Generated module shape (`docs-content.ts`)

```ts
// AUTO-GENERATED by scripts/gen-docs.mjs from the docs-manifest allow-list. DO NOT EDIT.
// Run `npm run gen:docs` (or `npm run build`) to regenerate.
export const DOCS = [
  { id: "extend-the-harness", title: "Extend the harness", summary: "Add a new verb…",
    content: "# Extend the Harness\n…" },
  // …one entry per allow-listed doc…
] as const;
```

> **Escaping**: the generator emits each `content` via `JSON.stringify(text)` (double-quoted, fully-escaped JS string literal) — robust against backticks, `${`, and newlines. Never template literals.

### Pure service (`docs-service.ts`)

```ts
import { DOCS } from './docs-content.js';            // repo uses .js specifiers (verbatimModuleSyntax)
import type { DocsListResult, DocLookup } from './contract.js';

export function listDocs(): DocsListResult {
  return { docs: DOCS.map(({ id, title, summary, audience }) => ({ id, title, summary, audience })) };
}
export function getDoc(id: string): DocLookup {
  const d = DOCS.find((x) => x.id === id);
  return d ? { id: d.id, title: d.title, content: d.content, format: 'markdown' } : { notFound: true, id };
}
```
*No `node:fs`, no `process.cwd()`, no commander — P2 clean, MCP-ready.*

### Generator behavior (`scripts/gen-docs.mjs`) — pseudocode

```
import { readFileSync, writeFileSync } from 'node:fs';
read allow-list (the manifest data — duplicated as a small JSON/JS the .mjs can import, OR re-declared)
for each entry: text = readFileSync(entry.sourcePath, 'utf8')
emit header + `export const DOCS = [ {id,title,summary,audience, content: JSON.stringify(text)} , … ] as const;`
writeFileSync('harness/cli/src/services/docs/docs-content.ts', out)
```
> **Manifest duplication note**: a plain `.mjs` can't import a `.ts` manifest. Resolve by making the allow-list a **`.json`** (`docs-manifest.json`) imported by BOTH the generator (`.mjs`) and the service-side TS — single source for curation, no duplication. (Implementer may instead inline the allow-list in the `.mjs` if simpler; the `.json` approach is preferred for the AC4 test to assert against.)

---

## Build wiring

`package.json` (root) scripts:

```jsonc
{
  "gen:docs": "node scripts/gen-docs.mjs",
  "build":    "npm run gen:docs && tsc -p harness/cli/tsconfig.json",
  "prepare":  "npm run build"        // already present — npx/install regenerates+compiles automatically
}
```

- **Ordering**: `gen:docs` runs **before** `tsc` (the `&&`). A missing/garbled generated file fails the typecheck loudly = desired fail-fast.
- **`files`**: **unchanged** — still `["harness/cli/dist", "LICENSE"]`. The generated `.ts` compiles into `dist` like any source; **no new `files` entry, no `dist/docs/` asset dir**. (This is the whole point of C over B.)
- **CI drift guard** (recommended): `npm run gen:docs && git diff --exit-code harness/cli/src/services/docs/docs-content.ts` — fails if someone edited a `.md` without regenerating.

---

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation | "how do docs even ship? do I touch `files`? `import.meta.url`?" | Follow the file tree + build wiring verbatim; `files` untouched |
| Review | reviewer reconstructs the packaging story | reviewer checks: service pure? generated file committed? drift test green? `files` unchanged? |
| Testing | invent what "it ships" means | AC: snapshot content == source `.md`; service unit tests; build-output contains content |
| Agent execution (future MCP) | unclear if service is reusable | `listDocs`/`getDoc` are the documented MCP seam — import unchanged |

## Validation / Acceptance

This workshop reaches Implementation Ready when the plan's tasks can assert:

1. **Strategy = C**: a generator emits `docs-content.ts` under `src/`; no bundler, no `import.meta.url`, no `dist/docs/` asset dir, `files` unchanged.
2. **Purity**: `docs-service.ts` source contains no `node:fs` / `process.cwd()` import; returns typed records (test/inspection).
3. **Curation (P12)**: `DOCS` ids ⊆ the manifest allow-list; excludes `AGENTS.md`, `docs/plans/**`, `scratch/**` (asserted by a test reading the manifest).
4. **No drift**: a test asserts `getDoc(id).content` is byte-equal to the source `.md` for every entry; CI regen-clean check present.
5. **Ships offline**: building the package yields `harness/cli/dist/services/docs/docs-content.js` containing the content (proves an npx consumer gets docs with no repo checkout).
6. **Reversibility documented**: note that adopting a bundler later (`tsup`/esbuild text loader) can replace the generator with **no change** to `DOCS`/`listDocs`/`getDoc`.

## Open Questions

### Q1: Commit or gitignore the generated `docs-content.ts`?
**RESOLVED → Commit** (D2). It lives under `src/` and is consumed by tests/lint; committing avoids fragile per-command regen ordering. Drift test + CI regen-check neutralize staleness.

### Q2: Manifest format — `.ts` or `.json`?
**RESOLVED (preferred) → `.json`** so the plain-node generator and the TS service share one curation source without duplication; implementer may inline in the `.mjs` if they prefer, but then the AC4 curation test asserts against the generated `DOCS` directly.

### Q3: Escape `tsup`/bundler hatch now?
**RESOLVED → No.** Stay vanilla `tsc` + generator. `tsup` (esbuild text loader) is the sanctioned future migration **only if** the CLI adopts bundling for independent reasons; `DOCS` stays an imported constant either way, so it's a no-API-change swap.

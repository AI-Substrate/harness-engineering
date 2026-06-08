# First-Class Documentation Support for the Harness CLI

**Mode**: Simple

📚 Specification incorporates findings from `research-dossier.md`.

## Research Context

Key findings driving this spec (full detail in `research-dossier.md`):
- **No asset pipeline today**: `build` is bare `tsc`; `files` ships only `harness/cli/dist`. Markdown under repo-root `docs/` does **not** reach an `npx` user. → *how docs get bundled is the headline decision.*
- **`doctor-service` is the forward-compatible template**: a pure service returns typed data; the act formats. Mirroring it makes a future MCP `docs_list`/`docs_get` tool a zero-rework add-on.
- **Bundled docs are package-relative, not cwd-relative**: extension discovery roots at `proc.cwd()`; bundled docs must resolve against the installed package. The codebase uses no `import.meta.url`, which steers us toward compiling doc content in (no runtime path resolution).
- **Prior intent**: plan 006 explicitly promised this `harness docs` upgrade and authored `docs/how/extend-the-harness.md` to be "cleanly indexable" for it.
- **Free error band**: `E160+` (everything through `E153` is assigned).

## Summary

**What**: Add a first-class, core `harness docs` command — a peer of `help`/`doctor`/`new` — backed by a pure `DocsService`, that lets a developer or agent **discover and read the harness's curated documentation locally** (offline, from the installed CLI). `harness docs` lists the available docs; `harness docs <id>` prints one.

**Why**: Docs that live only in the repo tree are invisible to an agent that `npx`-installed the harness. Baking a curated, publication-safe doc set into the shipped CLI closes that gap and delivers the "docs as a first-class CLI concept" upgrade that plan 006 deferred. The design must not preclude a **future MCP server** (out of scope now) reusing the same doc surface.

## Goals

- A core `harness docs` command that **lists** curated docs (id, title, summary) as a JSON envelope (and human table).
- `harness docs <id>` that **returns one doc's content** (markdown), readable offline.
- Docs are **bundled into the shipped package** so `npx`/installed users get them with no repo checkout.
- A **pure, transport-agnostic `DocsService`** (list/get returning typed records) so a future MCP `docs_list`/`docs_get` tool reuses it unchanged.
- **Curated, publication-safe corpus** (P12): only sanitized, agent/human-facing docs are surfaced; governance/internal/plan/scratch content is excluded.
- The command is **discoverable** from `help` (advertised) and documented in `harness/cli/README.md` + a `docs/how/` guide.

## Non-Goals

- **No MCP server / MCP tools** in this plan — only preserve the seam (a guardrail, not a deliverable).
- **No doc authoring/editing via the CLI** — `docs` is read-only; docs are authored as files in-repo.
- **No full-text search / fuzzy matching** across docs (v1 is list + get by id).
- **No rendering** beyond emitting raw markdown (no ANSI/HTML/paging).
- **No dynamic indexing of arbitrary repo files** — the corpus is an explicit curated allow-list, not a directory glob.
- **No changes to the existing `help`/`doctor`/`new` behavior** beyond `help` advertising `docs` and cross-links.

## Target Domains

> This repo has **no formal `docs/domains/` registry**. Domains below are informal source clusters in `harness/cli/src/`, named for traceability only (no files are moved/refactored).

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| `services/docs` (docs) | **NEW** | **create** | Pure `DocsService` (list/get) + bundled doc content/index |
| `acts` (cli acts) | existing | **modify** | Add `registerDocsAct` (core command), register in `app.ts` |
| `services/help` (help) | existing | **modify** | Advertise `docs` in PURPOSE/safe-first-actions/help text |
| `output` (output kernel) | existing | **consume** | Add `E160+` doc error codes; reuse envelope/exit |
| build/packaging | existing | **modify** | Ensure bundled doc content ships in `dist` (see Workshop W1) |

### New Domain Sketches

#### docs (`services/docs`) [NEW]
- **Purpose**: Provide the harness's curated documentation as structured, transport-agnostic data — a registry of doc entries and their content.
- **Boundary Owns**: the curated doc index (id/title/summary/audience), retrieval of a doc's markdown content, the `DocEntry`/`DocContent` record shapes.
- **Boundary Excludes**: output formatting (owned by the act), markdown rendering, file authoring, MCP transport (future), and *any* `process.cwd()`/`node:fs` side-effect in the service body (P2).

## Testing Strategy

- **Approach**: **Hybrid**.
  - **TDD (red→green)** for `DocsService.list()`/`get(id)` (happy path, unknown-id → typed not-found) and the `docs` act (envelope shape, exit codes, list vs. get, unconfigured/empty-corpus honesty).
  - **Snapshot/byte tests** for the bundled doc **index** and **content** (ids, titles, content matches source), mirroring plan 006's template snapshot tests.
- **Rationale**: service+act logic is behavioral (deserves TDD); bundled content is static (snapshot guards drift).
- **Focus Areas**: list output, get-by-id, unknown-id error (`E16x`), empty/missing-corpus honesty (P5 exit 2 if applicable), `help` advertises `docs`.
- **Excluded**: MCP behavior (OOS), markdown rendering, search.
- **Mock Usage**: **Option A — fakes only** (FakeFs/FakeProcess/FakeClock; **no `vi.mock`**), per constitution **P3**.

## Documentation Strategy

- **Location**: **Hybrid (README + docs/how/)**.
  - Add `harness docs` to `harness/cli/README.md` (front door + documented exit codes, P6).
  - Add `docs/how/using-harness-docs.md` — a standalone, indexable guide (which the `docs` command itself then surfaces).
- **Rationale**: consistent with the `docs/how/` convention plan 006 established; the feature dogfoods itself by indexing its own guide.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=1, D=1, N=1, F=1, T=1 (P=6)
- **Confidence**: 0.80
- **Assumptions**:
  - The corpus is a small curated allow-list (≤ ~6 docs) for v1.
  - "Continue without an agent harness" (consistent with plans 004/005/006); validate via unit tests + manual smoke + optional minih e2e. No Phase 0 agent-harness build.
  - Bundling strategy **resolved** (W1, workshop 001): **Option C** (generate-TS-from-MD), generated module committed under `src/`, plain-`node` generator, `files` unchanged.
- **Dependencies**: existing output kernel, FsPort, app.ts composition root, build/`prepare` flow.
- **Risks**: see below.
- **Phases**: single phase (Simple).

## Acceptance Criteria

1. `harness docs` (no args) emits a JSON-envelope `ok` payload listing curated docs as `{ id, title, summary }[]`; human mode renders a readable table. Exit 0.
2. `harness docs <id>` for a known id emits the doc's markdown content (exit 0). The emitted content is byte-faithful to the authored source.
3. `harness docs <unknown-id>` emits a `formatError` envelope with a new `E16x` code and a fix-prescribing message (P7); non-zero exit.
4. The curated corpus is an **explicit allow-list** — it includes `docs/how/extend-the-harness.md`, `docs/how/using-harness-docs.md`, `harness/cli/README.md`, and `harness/cli/docs/authoring-verbs.md`; it **excludes** `AGENTS.md`, `docs/plans/**`, and `scratch/**` (P12).
5. The bundled docs **ship in the installed package** — a build of the package (the `prepare`/`build` output under `harness/cli/dist`) contains the doc content such that `harness docs <id>` works for a consumer who installed via npm/npx with **no repo checkout**.
6. `DocsService` is **pure**: its source imports no `node:fs` and reads no `process.cwd()`; it returns typed `DocEntry`/`DocContent` records. All formatting lives in the `docs` act. (Verifiable by inspection/test + the existing architecture constraints.)
7. The `docs` command is a **core** command (registered in `buildProgram`), not an extension verb — it does not appear in / depend on the dynamic verb registry (P10 intact).
8. `harness help` advertises `docs` (PURPOSE / safe-first-actions / help text), and `harness/cli/README.md` documents `docs` with its exit codes (P6).
9. Exit codes for `docs` are documented (P6) and the new `E16x` code(s) are added to the error-codes table (and its frozen snapshot test updated).
10. A `docs/how/using-harness-docs.md` guide exists, reads standalone, and is itself listed/retrievable via `harness docs`.
11. **MCP forward-compat guardrail**: the `DocsService` interface is documented as the seam a future `mcp/tools/docs_*` would call; nothing in this plan adds MCP, and nothing in the service couples to commander or stdout.
12. All new/changed code passes `biome` + `tsc` + the vitest suite with coverage, consistent with the repo's existing gates.

## Risks & Assumptions

- **R1 — Bundling mechanism (HIGH → MITIGATED)**: no asset pipeline exists; a wrong choice bloats the build, relocates authored markdown, or adds fragile runtime path-resolution. *Resolved*: W1 selected Option C (generate-TS-from-MD), `files` unchanged, no runtime resolution. See workshop 001.
- **R2 — Source-of-truth drift**: bundled content could diverge from authored `.md`. *Mitigation*: generator emits from `.md` at build + a byte-equality drift test per entry + CI regen-clean check (`git diff --exit-code` on the generated file). Never hand-edit the generated module.
- **R3 — Corpus curation leak (P12)**: a glob could surface private/governance prose. *Mitigation*: explicit allow-list, asserted by a test (AC4).
- **R4 — Package-relative resolution**: if a copy-step strategy is chosen, runtime path resolution (`import.meta.url`) is new to this codebase. *Mitigation*: prefer compiled-in content (no resolution) — a key input to W1.
- **A1 — Recursive docs**: the feature documents itself; `using-harness-docs.md` is both a deliverable and a corpus member.

## Open Questions

> **All resolved** — see [workshops/001-doc-bundling-and-source-of-truth.md](workshops/001-doc-bundling-and-source-of-truth.md) (authoritative).

- **Bundling strategy** (W1): **RESOLVED → Option C (generate-TS-from-MD)**. A plain-`node` build-time generator (`scripts/gen-docs.mjs`) reads a curated allow-list manifest and emits `harness/cli/src/services/docs/docs-content.ts`, compiled into `dist` by `tsc`. Single source of truth = the `.md`; no runtime path resolution; pure service; `files` unchanged. The generated file is **committed** under `src/` (it's consumed by tests/lint; drift test + CI regen-check guard staleness). Validated by external research: no popular npm package does md→module for a `tsc`-only build; codegen-before-`tsc` is the idiomatic pattern (Prisma/GraphQL/OpenAPI-style). `tsup`/esbuild text-loader is the sanctioned future escape hatch with no `DOCS` API change.
- **Output of `harness docs <id>`**: **RESOLVED → raw markdown to stdout** for `<id>` (agent-pipe-friendly, EPIPE-safe, mirrors minih `agent-readme`); **JSON envelope** for the bare `harness docs` list; unknown id → `formatError` + `E16x`.

## Workshop Opportunities

| Topic | Type | Status | Outcome |
|-------|------|--------|---------|
| W1 — Doc bundling & source-of-truth | Storage Design | ✅ **Resolved** → [workshops/001-doc-bundling-and-source-of-truth.md](workshops/001-doc-bundling-and-source-of-truth.md) | **Option C** (generate-TS-from-MD), generated `docs-content.ts` **committed** under `src/`, plain-`node` generator, `files` unchanged. Validated by Perplexity research (no popular `tsc`-only md→module package; codegen is idiomatic). |
| W2 — Output shape & index contract | API Contract | ✅ Folded into W1 §D4 + spec Open Questions | List = JSON envelope; `<id>` = raw markdown to stdout; unknown = `E16x` error. |

## Clarifications

### Session 2026-06-08

- **Workflow Mode** (Round 1): **Simple** — contained CS-3 feature, single new `services/docs` cluster, one phase.
- **Testing Strategy** (Round 1): **Hybrid** — TDD for `DocsService` + `docs` act; byte-snapshot for bundled index/content.
- **Mock Usage** (Round 1): **Option A — fakes only** (no `vi.mock`), per constitution P3. (Recorded, not asked — hard repo convention.)
- **Documentation Strategy** (Round 1): **Hybrid** — `harness/cli/README.md` + `docs/how/using-harness-docs.md`.
- **W1 Doc bundling strategy** (Workshop 001, 2026-06-08): **Option C — generate-TS-from-MD**, generated `docs-content.ts` **committed** under `harness/cli/src/services/docs/`, generator is plain `node scripts/gen-docs.mjs` (zero new deps), `files` stays `["harness/cli/dist","LICENSE"]`. Backed by Perplexity research: no popular npm package does md→importable-module for a `tsc`-only build; codegen-before-`tsc` is the idiomatic, reversible choice (`tsup`/esbuild text-loader is the future escape hatch with no API change). `harness docs <id>` emits **raw markdown to stdout**; the list emits a **JSON envelope**; unknown id → `E16x`.

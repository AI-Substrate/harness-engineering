# Research Report: First-class documentation support for the harness CLI

**Generated**: 2026-06-08T11:18:00Z
**Research Query**: "first-class documentation support for the harness CLI"
**Mode**: Pre-Plan (feeds `/plan-1b`)
**Location**: docs/plans/007-first-class-documentation/research-dossier.md
**FlowSpace**: Not used (focused 3-thread parallel exploration + direct reads)
**Forward constraint**: A future **MCP server** for the harness is explicitly out-of-scope now, but the docs design must NOT preclude it.

---

## Executive Summary

### What we'd build
A **core `harness docs` command** (peer of `help`/`doctor`/`new`) backed by a pure **`DocsService`** that lists and returns the repo's curated, agent/human-facing docs so they're discoverable and readable **locally** (offline, via the installed CLI) — the same move minih made with `minih agent-readme`. This is the upgrade that plan 006 explicitly anticipated and authored toward.

### Why it exists
Plan 006's spec already promised it: *"Documentation will later become a first-class concept surfaced on the CLI (e.g. a `harness docs`/`--help`-integrated path)… so that future upgrade can promote/index these files rather than relocate scattered prose"* (`006…spec.md:55-58`). Docs that only live in the repo tree are invisible to an agent that `npx`-installed the harness; baking them into the CLI closes that gap.

### Key insights
1. **The build is bare `tsc` with no asset pipeline, and `files` ships only `harness/cli/dist`** — markdown under `docs/how/` (repo root) will **not** ship today. How docs get into the shipped package is the **headline design decision** (copy-step vs. generate-TS-from-md vs. embed-as-TS). (`package.json:17-26`, `tsconfig.json`)
2. **`doctor-service.ts` is the exact forward-compatible template**: service returns typed data, the act does all formatting. Mirror it and a future MCP `docs_list`/`docs_get` tool can call the same service with zero rework. (`doctor-service.ts:29-37,105-156`; minih `src/mcp/tools/*` share services, never call CLI commands.)
3. **Bundled docs are *package*-relative, not *cwd*-relative** — a subtle architecture trap. Extension discovery roots at `proc.cwd()` (correct for consumer `.harness/`), but bundled docs must resolve against the installed package. The codebase uses **no `import.meta.url`** today; embedding doc content as TS sidesteps path resolution entirely. (`discovery.ts:31-33`)

### Quick stats
- **New surface**: 1 core act (`docs`), 1 service (`DocsService`), 1 error band (`E160+`), N bundled doc records.
- **Existing doc corpus**: ~8 markdown candidates (README, `docs/how/`, `authoring-verbs.md`, project-rules).
- **Constitution principles in play**: P1, P2, P4, P5, P6, P10, P12.
- **Prior learnings**: 1 directly-relevant deferral (006), 0 retros (no `docs/harness/` ledger yet).
- **Domains**: no domain registry — organize under a new `services/docs/` cluster.

---

## How docs work today (current state)

### CLI doc/help surface
- **`help`** is a *custom act* that renders from the injected verb registry (PURPOSE / EMPTY_HINT / safe_first_actions / `renderHelpText()`), **not** a docs exporter. (`acts/help.ts:16-34`, `services/help/help-service.ts:20-109`)
- **`doctor`** is a readiness report (toolchain/build/extensions), not docs. (`acts/doctor.ts:25-52`, `doctor-service.ts:105-156`)
- **`--help`** is Commander-native; `app.ts` swallows Commander's help/version "errors" and exits 0. (`app.ts:78-96,219-228`)
- **No command dumps markdown/docs.** Only `help`, `doctor`, `new`, and extension verbs exist.
- Docs are only **cross-referenced as prose**: `harness/cli/README.md:64` → `authoring-verbs.md`; `authoring-verbs.md:11-14,167-169` → `docs/how/extend-the-harness.md`. No machine-readable index.

### Output contract (what a `docs` act must conform to)
- Envelope constructors: `formatOk` / `formatDegraded` / `formatUnconfigured` / `formatError`. (`output/envelope.ts:34-109`)
- Acts build an `Envelope`, hand it to an `OutputPort`; JSON mode = one line, human mode = summary/stderr. (`output/output-port.ts:66-93`)
- **Error bands taken**: E100, E108, E120, E130, E140/141/142, E150–E153. **Next free band: `E160+`** for docs errors (e.g. doc-not-found, index-missing). (`output/error-codes.ts:5-28`)
- **Precedent for raw output**: minih's `agent-readme` *deliberately deviates* from the JSON envelope to write raw markdown to stdout so agents can read it/pipe it. We'll face the same choice (raw markdown vs. enveloped). (`minih src/cli/commands/agent-readme.ts:1-17`)

### Act registration & DI shape
```
registerHelpAct(program: Command, io: CliIo, registry: VerbRegistry): void   // acts/help.ts:16
registerDoctorAct(program: Command, io: CliIo, registry: VerbRegistry): void // acts/doctor.ts:25
registerNewAct(program: Command, io: CliIo, deps: NewActDeps): void          // acts/new.ts:36
```
A `docs` act follows the same shape: `registerDocsAct(program, io, deps)` registered in `buildProgram()` alongside the others (`app.ts:146-148`). DI deps are the port bag `{ fs, proc, clock, env, exec, git }`; `docs` likely needs only `{ fs?, clock }` (or none, if content is embedded).

### Build & ship mechanism (the constraint that shapes everything)
- `build` = `tsc -p harness/cli/tsconfig.json` — **no esbuild, no copy script, no asset pipeline.** (`package.json:24-26`)
- `files: ["harness/cli/dist","LICENSE"]`; `bin: harness → harness/cli/dist/index.js`; `dist/` is gitignored. (`package.json:6-20`, `.gitignore:81-84`)
- **Consequence**: `.md` files under repo-root `docs/` are **not** packaged. To ship docs you must either (a) add a copy step that lands them in `harness/cli/dist/…` and extend `files`, or (b) compile them in as TS (tsc guarantees `dist` output). minih chose (a) via `scripts/copy-schemas.js:42-43`; our repo has no such script yet.

### FsPort / rooting capabilities
- `FsPort`: `exists`, `readText`(→ UTF-8 | null), `readdir`, `mkdirp`, `writeText`. (`adapters/fs/fs-port.ts:9-20`, `node-fs.ts`)
- Rooting is **cwd-based via injected `ProcessPort.cwd()`** (`discovery.ts:31-33`); **no `import.meta.url`/`__dirname` anywhere**. Bundled-doc reads cannot reuse this pattern (cwd = consumer repo, not the package). → argues for **embedding doc content** (no runtime path resolution) or introducing a package-relative resolver.

---

## Architecture & design direction

### The forward-compatible seam (MCP-ready by construction)
Mirror `doctor`'s split exactly:

```ts
// services/docs/docs-service.ts  — PURE, transport-agnostic, no fs/cwd/commander
interface DocEntry   { id: string; title: string; summary?: string; audience?: 'human'|'agent'|'both' }
interface DocContent { id: string; title: string; content: string; format: 'markdown' }
interface DocsService {
  list(): DocsListResult;           // { docs: DocEntry[] }
  get(id: string): DocContent | DocNotFound;
}
```
- **Service returns typed data only.** The **act** formats: `harness docs` → list/table; `harness docs <id>` → markdown to stdout (raw, like `agent-readme`) or enveloped.
- A future **`mcp/tools/docs_list` / `docs_get`** wraps the *same* `DocsService` result as `structuredContent`/text — exactly how minih's MCP tools reuse `runner`/services and **never call CLI commands**. (`minih src/mcp/tools/wait.ts:45-63`, `permission-status.ts:40-147`)
- Already-present enabler: the package exposes a **types-only, transport-agnostic `./contract`** export (`package.json:9-15`, `contract.ts:1-96`) — the docs contract can live alongside it.

### MCP blockers to avoid (forward-compat guardrails)
- ❌ Formatting markdown/stdout **inside** the service.
- ❌ Reading `process.cwd()` **inside** the service.
- ❌ Coupling the service to commander / CLI flags.
- ❌ Returning raw strings instead of typed `DocEntry`/`DocContent` records.

### Where docs physically come from (the decision)
Three viable bundling strategies (see Workshop Opportunity W1):
- **A — Embed as TS modules**: doc content as `export const … = "…"`. Zero new build step (tsc ships it), no path resolution, snapshot-testable. Matches plan-006's "templates-as-functions" precedent. Cost: content lives in `.ts` (or is generated into it) rather than plain `.md`.
- **B — Copy step (minih-style)**: `scripts/copy-docs.js` copies `docs/how/*.md` → `harness/cli/dist/docs/`, extend `files`, resolve at runtime via a new package-relative resolver (`import.meta.url`). Keeps `.md` as source of truth; adds a build step + a new rooting mechanism the codebase doesn't yet have.
- **C — Generate TS from MD at build**: codegen reads curated `.md` → emits `docs-content.ts`. Single source = the `.md` files; artifact is plain TS (ships via tsc). Best-of-both; adds a generator. The 006 forward note ("promote/index these files rather than relocate") favors keeping `.md` authored in place → **B or C**.

### What corpus to surface (the index)
Curated, publication-safe, agent/human-facing set (from the inventory below): `docs/how/extend-the-harness.md`, `harness/cli/README.md`, `harness/cli/docs/authoring-verbs.md`, and selectively the project-rules (`constitution`/`architecture`/`idioms`/`rules`). **Governance/internal** docs (`AGENTS.md`, plan artifacts, `scratch/`) are **excluded** — P12 publication boundary. The index should be **explicit/curated**, not a blind directory glob (avoids leaking private or half-baked prose).

---

## Documentation inventory (bake-in candidates)

| Path | Audience | Covers | Bake in? |
|---|---|---|---|
| `harness/cli/README.md` | both | CLI front door: help/doctor, extensions, envelope, exit codes | **Yes (primary)** |
| `docs/how/extend-the-harness.md` | human+agent | Add-a-verb guide; authored standalone/indexable for this upgrade | **Yes (best candidate)** |
| `harness/cli/docs/authoring-verbs.md` | human+agent | Extension-author contract (`HarnessVerb`, `VerbContext`, safety) | **Yes** |
| `docs/project-rules/constitution.md` | both | Principles P1–P12 | Selective (reference) |
| `docs/project-rules/architecture.md` | both | Clean-architecture layering, output contract | Selective |
| `docs/project-rules/idioms.md` / `rules.md` | both | Layout idioms, testing, doc conventions | Selective |
| `README.md` (root) | both | Public project framing, harness vs. agent-harness | Maybe (intro) |
| `AGENTS.md` | agent | Internal governance, scratch/ policy | **No** (P12) |
| `docs/plans/**`, `scratch/**` | internal | Plan artifacts, private sources | **No** (P12) |

---

## Constitution principles that constrain this feature
- **P1** harness is a first-class product surface (this *is* P1 in action). (`constitution.md:59-63`)
- **P2** clean architecture — services must not import `node:fs`/`child_process`/cwd; `node:path` pure-only. (`:65-78`, `rules.md:23-25`)
- **P4** CLI is the API — stable envelope + agent-friendly `--help`. (`:88-92`)
- **P5** unconfigured/stub honesty — exit `2`, never fake success (relevant if no docs are bundled/installed). (`:94-98`)
- **P6** exit codes documented per command. (`:100-104`)
- **P10** dynamic extension-owned verbs / no hardcoded verb list — **`docs` is a CORE command (like help/doctor/new), not a verb**, so it does not violate P10. (`:124-134`)
- **P12** publication boundary — only sanitized/neutral tracked docs are surfaced; never private/raw sources. (`:142-145`)
- **P3** fakes-over-mocks testing (FakeFs/FakeProcess) for the docs service/act. (`:80-85`)

---

## Prior learnings
- **PL-01 — the deferral that created this plan.** 006 spec, user-captured: *"later we will be upgrading doco to first class concept on the cli, so just write it in docs/how for now"* and the forward note about a `harness docs`/`--help`-integrated path that *promotes/indexes* rather than relocates. **Action**: keep `docs/how/*.md` authored in place; the feature indexes them (favors bundling strategy B/C). (`006…spec.md:55-58,85,122-123`)
- **PL-02 — templates-as-TS precedent.** 006 shipped scaffold templates as pure TS string functions (not loose files) specifically to survive npx/bundling and be snapshot-testable. Directly informs bundling strategy A/C. (`services/scaffold/templates.ts`)
- No `docs/harness/` retro ledger exists yet → compound/harness loop nodes correctly omitted from this flow.

---

## Workshop Opportunities (for `/plan-2c`, optional)
- **W1 — Bundling & source-of-truth strategy (HIGH).** Embed-as-TS (A) vs. copy-step (B) vs. generate-TS-from-MD (C). Drives build changes, `files`, path-resolution, and the single-source question. This is the one genuinely fuzzy decision; everything else follows from it. *Recommend workshopping W1 before `/plan-3`.*
- **W2 — Output shape & index contract (MEDIUM).** Raw-markdown-to-stdout (agent-pipe-friendly, like `agent-readme`) vs. JSON envelope for `harness docs`/`harness docs <id>`; the `DocEntry`/`DocContent` schema that must stay MCP-stable; how `help`/`doctor` cross-link to `docs`.

## MCP forward-compat note (the OOS constraint, satisfied by design)
Keeping `DocsService` pure + typed (list/get) and putting all formatting in the act means a future `mcp/tools/docs_*` reuses the service unchanged — verified against minih, where CLI and MCP share the service/runner layer and MCP never invokes CLI commands. No MCP work now; no rework later. This is a **design guardrail to assert in the spec**, not a deliverable.

---

## External research opportunities
None required — the design is well-grounded by two in-repo precedents (006 templates, doctor-service split) and the minih reference implementation (agent-readme + src/mcp). The only open decision (W1 bundling) is a local engineering trade-off best resolved in a workshop, not external research.

---

## Recommendations & next step
1. **Spec a Simple-leaning feature** (likely CS-4): one core `docs` act + pure `DocsService` + `E160+` band + curated bundled corpus, with the **MCP-purity guardrail** and **P12 corpus curation** asserted as constraints.
2. **Flag W1 (bundling strategy) as the decision to resolve** — either in the spec's clarifications or a quick `/plan-2c` workshop.
3. **Don't build MCP**; only preserve the seam.

**Next step**: `/plan-1b-v3-specify-and-clarify` to write the spec (it will front-load the bundling/output questions).

---
**Research Complete**: 2026-06-08T11:18:00Z

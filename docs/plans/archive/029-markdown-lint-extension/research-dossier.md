# Research Report: `markdown-lint` harness extension

**Generated**: 2026-06-19T00:20:00Z
**Research Query**: "Add a markdown-lint harness extension that wraps third-party tools (markdownlint, headless mermaid syntax check, in-repo link validation) behind one harness verb and wires it into `just fft`"
**Mode**: Pre-Plan (feeds the `plan` stage)
**Location**: docs/plans/029-markdown-lint-extension/research-dossier.md
**FlowSpace**: Not available (standard tools)
**Findings**: 6 parallel research threads → 30 numbered findings, curated below

---

## Executive Summary

### What It Does
The proposal adds **one new harness verb, `harness markdown-lint`**, that wraps **three third-party tools** behind a single honest envelope: (1) standard markdown lint via **markdownlint-cli2**, (2) **headless mermaid syntax validation** of ` ```mermaid ` fenced blocks via `mermaid.parse()`, and (3) **in-repo link + heading-anchor validation** via **remark-validate-links**. The verb is then wired into `just fft` so every fix→format→test loop also proves the repo's markdown.

### Business Purpose
The repo has **351 tracked markdown files** and **119 mermaid fences across 73 files** (ML-01/ML-02) — all currently **unlinted**: no `.markdownlint*` / `.remarkrc*` config exists (ML-05). Broken in-repo links and malformed mermaid silently degrade the repo's public-facing docs (its primary product surface). This moves markdown health from *eyeballed* to *deterministic back pressure*, the same posture as the existing `arch-check`/`skills-check` extensions. It is also a **dogfood**: building it exercises the extension authoring path end-to-end.

### Key Insights
1. **This is a pure "wrap, don't rebuild" job.** All three capabilities exist as mature npm packages (markdownlint-cli2 0.22.1, remark-validate-links 13.1.0, mermaid 11.15.0 — all installed, all ESM, TI-01). The only original code is glue: fence extraction + a 3-way envelope decision. Matches the repo's stored convention (wrap existing, implement only real gaps).
2. **The exemplar pattern is unambiguous and proven twice.** `arch-check` and `skills-check` both = thin `extension.ts` shell (preflight + `ctx.exec`/`ctx.fs`) + a **pure, synchronous, `node:*`-free** lib module + a **colocated `*.test.ts`** (IC-04). Copy it.
3. **The colocated tests run inside the very loop the verb gates.** `vitest.config.ts` already globs `../../.harness/extensions/**/*.test.ts`, so the extension's unit tests run under `just test` → `just fft` (QT, confirmed). No test wiring needed.
4. **Mermaid is best isolated in a subprocess `.mjs` runner**, not imported into the jiti-loaded `extension.ts` — to contain its heavy browser-oriented ESM graph and any import side-effects (LD-07, TI-04). A prior spike already proved `mermaid.parse(text,{suppressErrors:true})` works headless in Node 22 (valid→`{diagramType}`, invalid→`false`).
5. **The #1 risk is lint noise, not feasibility.** 351 never-linted files + a constant `fft` gate means an untuned rule set or too-broad a scope will break the loop **for every agent in this shared tree**. Scope must start narrow (authored docs only) and be tuned to green.

### Quick Stats
- **New surface**: 1 verb, ~1 extension folder (shell + 2-3 pure libs + 1 `.mjs` runner + tests + instructions.md)
- **Third-party deps** (already devDependencies): markdownlint-cli2, remark-cli, remark-validate-links, mermaid
- **Repo markdown**: 351 tracked `.md`; 73 with mermaid (119 fences); 0 currently linted
- **Complexity**: Medium — feasibility is low-risk; the work is scope/rule tuning + a clean 3-way envelope
- **Prior Learnings**: 9 directly relevant (all from the arch-check / extension-system / dogfood history)
- **Domains**: No domain registry — extension fits the existing `.harness/extensions/` boundary

---

## How It Currently Works (the substrate this plugs into)

### The extension model
Discovery scans `<cwd>/.harness/extensions/` one level deep; each folder's entry (`extension.ts`) default-exports a `HarnessVerb` → a top-level `harness <verb>` command (IC-01, `extend-the-harness.md`). The repo already ships 4 extensions (arch-check, skills-check, validate-harness-flow, validate-harnessability), all `loaded`, 0 failed (`harness doctor`).

**`HarnessVerb`** (`contract.ts:87-104`): `{ name, summary, description?, options?: VerbOption[], args?: VerbArg[], run(ctx) }`. Variadic positional args are rejected in v1 (IC-01) — use a repeatable/`--dir` option instead.

**`VerbContext` (`ctx`)** — all I/O flows through it (IC-02):
| Helper | Signature | Use here |
|---|---|---|
| `ctx.exec` | `(cmd, args?[], {cwd?}) => Promise<{code,stdout,stderr,ok}>` (never rejects) | run markdownlint-cli2 / remark / node mermaid-runner |
| `ctx.fs` | `exists / readText / readdir` | walk markdown, read fences, preflight bins |
| `ctx.git` | `isRepo() / currentBranch()` | — |
| `ctx.cwd` | repo cwd (≈ repo root — discovery scans `<cwd>/.harness/extensions`) | resolve bin/config/globs |
| `ctx.ok / degraded / unconfigured / error` | envelope factories | the 3-way aggregate result |

**Envelope → exit contract** (IC-03): `ok`/`degraded` → exit 0, `error` → exit 1, `unconfigured` → exit 2. `next_action` is **required** on every non-`ok` result (`contract.ts:41-45`).

### The three tools (exact invocations — TI-02/03/04)
| Check | Tool (ver) | Invocation (via `ctx.exec`, local bin) | Success / failure signal | Config |
|---|---|---|---|---|
| **lint** | markdownlint-cli2 0.22.1 | `./node_modules/.bin/markdownlint-cli2 "<glob>" …` | exit 0 clean · 1 lint errors · 2 failure; issues → **stderr**; JSON via `outputFormatters` | `.markdownlint-cli2.jsonc` (`globs`, `ignores`, `outputFormatters`) auto-discovered |
| **links** | remark-validate-links 13.1.0 (via remark-cli) | `./node_modules/.bin/remark --use remark-validate-links --frail --quiet .` | checks relative files **+ heading anchors**, **offline** (skips external URLs); `--frail` → exit 1 on warnings | `.remarkrc.json` `{ "plugins": ["remark-validate-links"] }` |
| **mermaid** | mermaid 11.15.0 | extract ` ```mermaid ` fences (pure), then `ctx.exec('node', ['lib/mermaid-runner.mjs', …])` → JSON | runner does `await mermaid.parse(text,{suppressErrors:true})`: `false`/throw = invalid | none |

> ⚠️ **remark gotcha (TI-03):** never pass `--output` — remark is a *processor* and will **rewrite files**. Run check-only (`--frail --quiet`, no output). 
> ⚠️ **markdownlint gotcha (TI-02):** quote globs; issues print to **stderr** not stdout.

---

## Architecture & Design (the recommended shape)

### File layout (mirrors arch-check / skills-check — IC-04, extension-contract recommendation)
```
.harness/extensions/markdown-lint/
├── extension.ts          # thin SHELL: preflight, ctx.exec ×3, aggregate → 1 envelope
├── lib/
│   ├── extract.ts        # pure: pull ```mermaid fences (path+line) from md text
│   ├── decision.ts       # pure: 3 sub-results → ok|degraded|error|unconfigured + next_action
│   └── mermaid-runner.mjs # subprocess: import('mermaid') + parse, print JSON (ISOLATED)
├── extract.test.ts       # colocated (runs under just test via existing glob)
├── decision.test.ts      # colocated, fixture/table-driven
└── instructions.md       # agent briefing (REQUIRED — doctor E144 if absent)
```

### Why a subprocess for mermaid (LD-01..07, TI-04)
The loader jiti-transpiles `.ts` extensions and resolves their imports from the repo's `node_modules` (LD-01/02). A direct `await import('mermaid')` *should* work, **but** mermaid drags a large browser-oriented ESM graph; no existing extension imports a runtime third-party package (LD-07 — all current imports are type-only contract + local files). Isolating mermaid in a `.mjs` run by `ctx.exec('node', …)` (a) contains its dependency graph and any import side-effects to a child process, (b) plays to the proven "wrap via exec" pattern, (c) means a mermaid breakage degrades to an envelope, never crashes the CLI. **Recommendation: subprocess runner.**

### Envelope decision (pure `decision.ts`, unit-tested)
Aggregate the three sub-results. Proposed mapping (a **plan-stage decision** — see Open Questions):
- any required bin/dep/config missing → **`unconfigured`** (exit 2) — honest "not set up", with a `next_action` to install/restore (PL-05)
- any real violation (lint error / broken link / invalid mermaid) → **`error`** (exit 1) so `fft` fails — *or* a deliberate **warn-launch** as `degraded` first (arch-check precedent, IC-03)
- clean → **`ok`** with **real evidence** (counts: files linted, fences parsed, links checked) — not a bare `ok` (PL-07)

Follow the shared idioms (IC-05): no `node:*` in the shell, all I/O via `ctx`, deterministic sort of findings, a `try/catch` **never-throws backstop** → unexpected-error envelope, every non-ok carries `next_action`.

---

## Dependencies & Integration

### Tool dependencies (LD-06 — placement is correct)
markdownlint-cli2 / mermaid / remark-cli / remark-validate-links are **devDependencies**, which is right: the published package's `files` whitelist ships only `harness/cli/bin` + `harness/cli/dist` (not `.harness/extensions/`), so these tools power **this repo's dogfood only** and never reach consumers (LD-06, `package.json:22-26`). *(Note: a prior `npm install` of these was interrupted — implementation must complete `npm install` and confirm bins resolve.)*

### `just fft` + CI wiring (FW-01..05 — additive, no branch changes)
- **justfile**: `fft: fix format test` (`justfile:173-174`). Add a recipe and extend the chain:
  ```
  lint-md:
      node harness/cli/bin/harness.js markdown-lint
  fft: fix format test lint-md
  ```
- **Invoke via node, not npx** — AGENTS.md rule, and the CI precedent for arch-check/skills-check (`ci.yml:108-139`) calls `node harness/cli/bin/harness.js <verb> --json` (FW-04/05).
- **Optional npm script**: `"lint:md": "node harness/cli/bin/harness.js markdown-lint"` (FW-02).
- **Optional CI**: one additive step in the `build-test` job after `check:flows` (FW-03) — mirrors how arch-check/skills-check already run in CI.

### Testing integration (QT)
`harness/cli/vitest.config.ts` `include` already globs `'../../.harness/extensions/**/*.test.ts'` — the extension's colocated tests run under `just test` and therefore inside `just fft`. The verb that gates the loop is itself proven by the loop.

---

## Prior Learnings (institutional knowledge — pay attention)

| ID | Learning | Source | Action for markdown-lint |
|---|---|---|---|
| PL-01 | Bare `npx` silently scans 0 modules — **always the local `./node_modules/.bin`** | `.dependency-cruiser.cjs:6-8`; plan 016 spec | Call markdownlint/remark via explicit local bin path |
| PL-02 | `ExecResult` resolves (never rejects) on nonzero exit; child exit codes can lie | plan 016 spec:22-23 | Check `.code` **and** parse output; markdownlint issues are on stderr |
| PL-03 | Shelling from an extension is an injection hazard — **pass every value as literal argv**, never `bash -c` string assembly | retro 009-harnessability-survey:18-23 | Build `args[]` arrays for `ctx.exec`; never interpolate paths into a shell string |
| PL-04 | Ship `instructions.md`; every non-ok path returns envelope + `next_action` | plan 016 spec | Author the briefing; doctor flags E144 without it |
| PL-05 | `unconfigured` (exit 2) is a first-class honest state | plan 016 spec:68-74 | Preflight bins/config → `unconfigured`, don't crash or fake-fail |
| PL-07 | `harness new --wrap` stubs are sparse — **enrich the envelope with real evidence** | retro validate-harness-flow:27 | Return counts (files/fences/links checked), not bare `ok` |
| PL-08 | Dogfood feedback loop is mandatory after runs | AGENTS.md:60-61 | Capture a retro/magic-wand after building & first run |
| PL-09 | `ctx.cwd` / run-root assumptions are brittle | retros validate-harness-flow, code-review-companion | Resolve from `ctx.cwd` + explicit preflight; fail honestly if assets absent |

---

## Critical Discoveries

### 🚨 Critical 01 — Untuned lint over 351 files will break `fft` for every agent in this shared tree
**Impact**: Critical. **Source**: ML-01/04/05 + FW-01. No markdown has ever been linted; `fft` is the constant loop other agents depend on. A broad scope or default-strict rules will fail the loop immediately. **Required action**: start with a **narrow authored-docs scope** and **tune the rule set to green** before adding `lint-md` to `fft`. Land the extension first (runnable, green) and wire it into `fft` only once authored docs pass.

### 🚨 Critical 02 — Scope must exclude generated/transient markdown
**Impact**: High. **Source**: ML-04. `docs/plans/**` (243 files incl. generated `the-flow.md` "Do not hand-edit", `*.fltplan.md`, `tasks/**`, `reviews/_computed.diff`), `.harness/**`, `agents/**`, `docs/retros/**`, `harness/cli/test/**` fixtures, and placeholder-heavy routing docs are noise/false-positive sources. **Required action**: ignore set (below) in both markdownlint `ignores` and the remark scope.

### Recommended initial scope (ML-03/04 recommendation)
- **Include (authored prose)**: `README.md`, `AGENTS.md`, `AGENTS_README.md`, `INSTALL.md`, `CHANGELOG.md`, `docs/guide/**`, `docs/how/**`, `docs/project-rules/**`, `harness-foundations/**`, `skills/**`, `harness/cli/docs/**`, `harness/cli/README.md`
- **Ignore**: `docs/plans/**`, `.harness/**`, `agents/**`, `docs/retros/**`, `harness/cli/test/**`, `node_modules`, `dist`, `scratch/`, `coverage`, `**/the-flow.md`, `**/*.fltplan.md`, `**/tasks/**`, `**/reviews/**`
- **Links**: validate relative in-repo files + anchors only; **skip external URLs** (remark-validate-links does this by default, TI-03).

---

## External Research Opportunities

Most external unknowns were **already resolved** during scoping (Perplexity + a live Node spike + web search):
- ✅ **Headless mermaid validation** — `mermaid.parse(text,{suppressErrors:true})` confirmed working in Node 22 with mermaid 11.15.0 (no Chromium); subprocess isolation chosen. *No further research needed.*
- ✅ **remark-validate-links offline in-repo behavior** — confirmed it checks relative files + anchors and skips external URLs (TI-03). *No further research needed.*

**Residual (empirical, not researchable):**
1. **markdownlint rule tuning** — which rules to enable/disable so authored docs pass cannot be answered by reading; it requires *running* markdownlint over the scope and tuning. This is an implementation task (a "tune to green" step), not external research.

---

## Recommendations

### If building this (the recommended path)
1. **Complete the install** (`npm install`) and confirm `./node_modules/.bin/markdownlint-cli2` and `remark` resolve.
2. **Scaffold** via `harness new markdown-lint`, then restructure to the shell + `lib/` + colocated-tests + `instructions.md` shape (IC-04).
3. **Build the three sub-checks** behind `ctx.exec` (local bins + node mermaid-runner.mjs); keep fence extraction + the 3-way decision **pure and unit-tested**.
4. **Author config** (`.markdownlint-cli2.jsonc`, `.remarkrc.json`) with the narrow scope + ignore set above.
5. **Tune to green** over the authored scope; surface remaining real findings to the user.
6. **Wire into `fft`** (and optionally npm script + CI) **only after** authored docs pass — additive, no branch changes.
7. **Capture a retro/magic-wand** after the first run (PL-08).

### What to avoid
- Don't import mermaid into `extension.ts` directly (use the subprocess runner).
- Don't lint `docs/plans/**` or generated `the-flow.md`/`*.fltplan.md`.
- Don't interpolate paths into a `bash -c` string (argv only, PL-03).
- Don't add `lint-md` to `fft` while authored docs still fail.

---

## Open Questions for the `plan` stage
1. **Gate posture**: should violations be `error` (block `fft` immediately) or a deliberate **warn-launch** `degraded` first (arch-check precedent), promoted to `error` once green?
2. **Scope knob**: hard-code the authored-docs scope in config, or expose a `--dir`/`--scope` option (like skills-check's `--dir`)?
3. **markdownlint rule set**: defaults minus a few, or an explicit allowlist? (Determined empirically in the tune-to-green step.)
4. **Mermaid runner**: confirm subprocess `.mjs` (recommended) vs in-process `import()`.
5. **One verb, three checks** vs sub-options (e.g. `--only links`)? Default: one verb, run all three, aggregate.

---

**Research Complete**: 2026-06-19T00:20:00Z
**Report Location**: docs/plans/029-markdown-lint-extension/research-dossier.md

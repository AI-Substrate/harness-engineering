# Retro — Plan 029 Markdown-Lint Harness Extension

**Date**: 2026-06-19 · **Mode**: Simple, single phase (the-flow build) · **Verdict**: shipped green (warn-launch degraded/exit 0; 8 real findings surfaced, deferred). No companion (solo build).

## What it is

One verb, `harness markdown-lint`, wrapping three third-party tools behind one honest envelope — markdownlint-cli2 (style), remark-validate-links (in-repo links + heading anchors), headless `mermaid.parse()` (mermaid syntax) — with the risk-carrying glue (scope, fence extraction, envelope decision) in unit-tested `lib/`, wired into `just fft`.

## Worked well

- **The arch-check exemplar paid off.** Thin `extension.ts` shell + pure `lib/*` + colocated `*.test.ts` + `instructions.md` was a ready-made mould; the verb went from scaffold to green fast, and `harness new` dogfooded cleanly.
- **The harness caught real bugs on first run.** Before any tuning it found a genuine broken in-repo link (`docs/how/architecture-conformance.md` → a nonexistent `../harness-presentations/...` path) and would have caught any invalid mermaid. The point of the tool, proven on the repo that authored it.
- **Warn-launch made landing safe in a shared tree.** Findings as `degraded`/exit 0 meant the verb could land with an honest 8-finding backlog without breaking `fft` for the other agents working here.
- **Single source of scope (`lib/scope.ts`).** Deriving all three checks' file lists from one unit-tested `inScope()` (over `git ls-files`) made AC-04 ("zero findings from excluded dirs") provable in one place, and the mermaid walk couldn't drift from the linters.

## Friction

- **MH-029-01 — a "headless" third-party claim that wasn't, hidden by a trivial spike.** Bare `mermaid.parse()` throws `DOMPurify.addHook is not a function` on *any labeled* diagram (mermaid sanitizes label text through DOMPurify, which needs a DOM). A label-less spike (`graph TD\nA-->B`) skips sanitization and *passes* — so the plan's "LIGHT mermaid.parse, no Chromium" assumption looked validated when it wasn't. Over the repo's real diagrams it surfaced as **all 12 fences invalid**. Fix: a `jsdom` DOM shim in the subprocess (pure JS, not a browser — AC-07 holds). **Lesson: spike third-party "headless" claims with REALISTIC inputs, never the minimal toy.**
- **MH-029-02 — `ctx.exec` has no stdin.** The mermaid runner wants its fence list on stdin; the VerbContext only spawns with argv (no input channel), so fences ride as a single JSON argv arg. Safe here (tiny payload, no shell), but argv-smuggling is the wrong default for a subprocess that should stream input.
- **MH-029-03 — extension TS is outside the repo's static tooling.** `.harness/extensions/**` is ignored by biome AND not in `tsc`'s program, so `extension.ts`/`lib/*.ts` get **no type-check and no lint** from `fft`. Only jiti-load + the colocated unit tests catch errors. (Same blind spot the 009 retro hit for shell-injection — recurring.)
- **MH-029-04 — `fft`'s `fix`/`format` are destructive (`biome --write`).** In a shared multi-agent tree with other agents' uncommitted work, running the full `just fft` would reformat *their* in-progress files (and the tree already had their biome errors). There's no read-only loop to *validate* without mutating, so I had to verify the components by hand (test + lint-md green; biome in read-only mode).
- **MH-029-05 — remark plugin/cwd/git coupling (PL-09 in the flesh).** remark-validate-links resolves its plugin from **cwd** and shells `git remote -v`, so it only works run from the repo root inside the git tree. Handled by `cwd: ctx.cwd` + a `.remarkrc.json` preflight, but it's a sharp edge for any extension that shells a cwd-sensitive tool.

## Magic wand (project / harness CLI)

If I had one wand: **give `VerbContext.exec` an `input` option** (`ctx.exec(cmd, args, { cwd, input })`) so a subprocess runner can receive data on stdin instead of argv-smuggling. Runner-up: a **read-only loop recipe** (`just check` = biome *check* + test + the verbs, no `--write`) so the engineering loop can be *validated* in a shared tree without mutating other agents' files.

## Follow-ups

- **FU-029-01** (harness CLI): add an `input?: string` (stdin) option to `VerbContext.exec` / the exec port — subprocess runners shouldn't pass payloads as argv. (MH-029-02.)
- **FU-029-02** (harness CLI / authoring): give extension authors static feedback on `.harness/extensions/**` — an opt-in `tsc --noEmit` + biome pass over extension TS (it's currently unchecked by `fft`). Recurring with the 009 retro's shell-injection blind spot. (MH-029-03.)
- **FU-029-03** (research/spike discipline): when a plan assumes a third-party tool runs "headless/light", the spike MUST use a realistic input (a labeled mermaid diagram, not `A-->B`). Encode this in the explore/plan guidance. (MH-029-01.)
- **FU-029-04** (harness loop): add a non-destructive `just check` (read-only biome + test + verbs) so the loop is validatable in a shared/multi-agent tree. (MH-029-04.)
- **FU-029-05** (authored-doc backlog, deferred): 7 `MD001/heading-increment` (h2→h4) in `harness-foundations/first-principles.md` + 1 broken link in `docs/how/architecture-conformance.md` — left as warn-launch advisories; clean them, then promote the disabled whitespace-hygiene rules per-rule and tighten the gate toward error/exit 1.

> **Boundary note**: this retro uses neutral language only; no private identifiers. The 8 surfaced findings are real repo content (paths only), publication-safe.

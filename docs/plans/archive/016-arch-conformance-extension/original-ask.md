# Original ask — arch-conformance-extension
**Captured**: 2026-06-10T06:32:14Z  ·  **By**: /the-flow

> Next up, we need to add another exemplar extension. This one is using deterministic back pressure to do architectural checking. We use the hexagonal architecture design. I want to investigate a way that we can use code to actually validate that our implementations are following that pattern and that we are not violating them. take a peek and then figure out do we use node native, install something? codeql etC? we can use perplexty to hel find the best ways to do this too

---

## Context at capture (noted by /the-flow, not the user's words)

The investigation half of the ask was completed in-session **before** this flow was opened; the flow carries the build half forward. Investigation outcome:

- **Tool chosen: dependency-cruiser** (devDependency) — forbidden/allowed rule triad, regex `path`/`pathNot`, `dependencyTypesNot: ['type-only']` for enforcing type-only port imports, schema'd JSON output, exit 1 on error-severity violations.
- **PoC proven on the real codebase**: 7 hexagonal rules ran clean over `harness/cli/src` (66 modules, 112 dependencies, 0 violations, exit 0); a seeded violation (`help-service.ts` importing concrete `node-fs.ts`) was caught by the correct rule (`services-only-adapter-ports`) with structured JSON and exit 1, then reverted. Rule set preserved at `/tmp/arch-rules-poc-2026-06-10.cjs`.
- **Alternatives ruled out**: eslint-plugin-boundaries (forces ESLint beside Biome), ts-arch/ArchUnitTS (prose-string violations, weak for the JSON envelope), madge (cycles only), CodeQL (QL authoring weight + licensing), roll-your-own ts-morph (reimplements module resolution).
- **Proposed shape**: `.dependency-cruiser.cjs` at repo root as single source of truth (rule `comment` fields double as agent-readable explanations) + `.harness/extensions/arch/` verb shelling out via `ctx.exec` to `./node_modules/.bin/depcruise --output-type json`, mapping violations → envelope (`ok`/`error` + `next_action` naming the violated rule) + CI step.

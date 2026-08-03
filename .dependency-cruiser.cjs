// Architecture conformance rules — the hexagonal (ports & adapters) contract
// for harness/cli/src, encoded as dependency-cruiser rules. This file is the
// single source of truth consumed identically by `harness arch-check`, raw
// depcruise runs, and CI (which calls the verb).
//
// Gotcha #1: ALWAYS invoke as `./node_modules/.bin/depcruise` — bare
//   `npx depcruise` silently scans 0 modules in directory mode.
// Gotcha #2: do NOT add a `tsConfig` option here — depcruise v17 rejects it
//   in this layout (TS18003).
//
// Launch posture (plan 016 grill decision, 2026-06-10): every rule ships at
// `warn` — violations surface as a degraded envelope + CI ::warning::
// annotation, never a red build, until severities are deliberately promoted
// to `error`. Promotion is a one-line flip per rule.
//
// Rule-change discipline: never weaken, except, or demote a rule in the same
// PR that trips it. Rule changes ship alone, with rationale.
//
// Proven: 2026-06-10 PoC — 66 modules / 112 dependencies / 0 violations on
// the live tree; a seeded violation was caught by services-only-adapter-ports.
// Run: ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type json harness/cli/src
module.exports = {
  options: {
    doNotFollow: { path: 'node_modules' },
  },
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No circular dependencies anywhere in the CLI.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
    {
      name: 'services-never-import-acts',
      comment:
        'Services are adapter-agnostic business logic — they must not know about command handlers.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services' },
      to: { path: '^harness/cli/src/acts' },
    },
    {
      name: 'services-only-adapter-ports',
      comment:
        'Services may depend on adapter PORT interfaces only, never concrete node-*/exec-*/system-* implementations or fakes.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services' },
      to: { path: '^harness/cli/src/adapters', pathNot: '-port\\.ts$' },
    },
    {
      name: 'services-ports-type-only',
      comment:
        'Port imports from services must be type-only (the kernel injects the implementation).',
      severity: 'warn',
      from: { path: '^harness/cli/src/services' },
      to: { path: '^harness/cli/src/adapters/.*-port\\.ts$', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'dd-core-never-imports-output',
      comment: 'dd-core returns structured values and never imports harness envelopes or exits.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services/dd/core' },
      to: { path: '^harness/cli/src/output', reachable: true },
    },
    {
      name: 'dd-core-never-imports-acts',
      comment: 'dd-core is a library boundary and never imports command handlers.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services/dd/core' },
      to: { path: '^harness/cli/src/acts', reachable: true },
    },
    {
      name: 'dd-core-never-imports-node-adapters',
      comment: 'dd-core is ports-free and never imports any harness adapter.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services/dd/core' },
      to: { path: '^harness/cli/src/adapters', reachable: true },
    },
    {
      name: 'dd-graph-never-imports-render',
      comment:
        'dd graph emits mermaid directly. A renderer import anywhere in its chain would re-couple the render and links phases, which were split so they could land in parallel.',
      severity: 'warn',
      from: { path: '^harness/cli/src/acts/dd/(graph|links)\\.ts$' },
      to: { path: '^harness/cli/src/services/dd/render', reachable: true },
    },
    {
      name: 'dd-links-never-imports-render',
      comment:
        'The links layer consumes the render layer only through an injected interface; it never imports it.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services/dd/links' },
      to: { path: '^harness/cli/src/services/dd/render', reachable: true },
    },
    {
      name: 'dd-links-never-imports-output',
      comment: 'The links layer returns structured findings and never imports harness envelopes or exits.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services/dd/links' },
      to: { path: '^harness/cli/src/output', reachable: true },
    },
    {
      name: 'dd-links-never-imports-acts',
      comment: 'The links layer is a library boundary and never imports command handlers.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services/dd/links' },
      to: { path: '^harness/cli/src/acts', reachable: true },
    },
    {
      name: 'dd-render-never-imports-output',
      comment: 'The dd renderer is pure — it returns markdown and never imports harness envelopes or exits.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services/dd/render' },
      to: { path: '^harness/cli/src/output', reachable: true },
    },
    {
      name: 'dd-render-never-imports-acts',
      comment: 'The dd renderer is a library boundary and never imports command handlers.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services/dd/render' },
      to: { path: '^harness/cli/src/acts', reachable: true },
    },
    {
      name: 'dd-render-never-imports-node-adapters',
      comment: 'The dd renderer takes precomputed inputs — it is ports-free and imports no harness adapter.',
      severity: 'warn',
      from: { path: '^harness/cli/src/services/dd/render' },
      to: { path: '^harness/cli/src/adapters', reachable: true },
    },
    {
      name: 'adapters-stay-leaf',
      comment: 'Adapters are leaves — they never import services, acts, or output.',
      severity: 'warn',
      from: { path: '^harness/cli/src/adapters' },
      to: { path: '^harness/cli/src/(services|acts|output)' },
    },
    {
      name: 'output-stays-leaf',
      comment: 'The output/envelope layer must not reach back into services or acts.',
      severity: 'warn',
      from: { path: '^harness/cli/src/output' },
      to: { path: '^harness/cli/src/(services|acts)' },
    },
    {
      name: 'no-fakes-in-prod',
      comment: 'Fake adapters are test doubles — production source must not import them.',
      severity: 'warn',
      from: { path: '^harness/cli/src', pathNot: '\\.(test|spec)\\.ts$' },
      to: { path: '/fake-[^/]+\\.ts$' },
    },
  ],
};

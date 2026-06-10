// PoC rule set — proven 2026-06-10 against harness/cli/src (66 modules, 112
// dependencies, 0 violations, exit 0; seeded violation in help-service.ts
// caught by services-only-adapter-ports with exit 1, then reverted).
// This is the committed source of truth for the investigation evidence; the
// shipping copy will live at the repo root as .dependency-cruiser.cjs.
// Run with: ./node_modules/.bin/depcruise --config <this file> --output-type json harness/cli/src
// (NEVER bare `npx depcruise` — it silently scans 0 modules in directory mode.)
module.exports = {
  options: {
    doNotFollow: { path: 'node_modules' },
  },
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No circular dependencies anywhere in the CLI.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'services-never-import-acts',
      comment: 'Services are adapter-agnostic business logic — they must not know about command handlers.',
      severity: 'error',
      from: { path: '^harness/cli/src/services' },
      to: { path: '^harness/cli/src/acts' },
    },
    {
      name: 'services-only-adapter-ports',
      comment: 'Services may depend on adapter PORT interfaces only, never concrete node-*/exec-*/system-* implementations or fakes.',
      severity: 'error',
      from: { path: '^harness/cli/src/services' },
      to: { path: '^harness/cli/src/adapters', pathNot: '-port\\.ts$' },
    },
    {
      name: 'services-ports-type-only',
      comment: 'Port imports from services must be type-only (the kernel injects the implementation).',
      severity: 'error',
      from: { path: '^harness/cli/src/services' },
      to: { path: '^harness/cli/src/adapters/.*-port\\.ts$', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'adapters-stay-leaf',
      comment: 'Adapters are leaves — they never import services, acts, or output.',
      severity: 'error',
      from: { path: '^harness/cli/src/adapters' },
      to: { path: '^harness/cli/src/(services|acts|output)' },
    },
    {
      name: 'output-stays-leaf',
      comment: 'The output/envelope layer must not reach back into services or acts.',
      severity: 'error',
      from: { path: '^harness/cli/src/output' },
      to: { path: '^harness/cli/src/(services|acts)' },
    },
    {
      name: 'no-fakes-in-prod',
      comment: 'Fake adapters are test doubles — production source must not import them.',
      severity: 'error',
      from: { path: '^harness/cli/src', pathNot: '\\.(test|spec)\\.ts$' },
      to: { path: '/fake-[^/]+\\.ts$' },
    },
  ],
};

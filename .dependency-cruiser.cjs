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
    // Gotcha #4 (measured 2026-08-04, plan 065 P6 review F008): WITHOUT this,
    // depcruise analyses the TRANSPILED graph, where TypeScript has already erased
    // every `import type` — so a type-only import across a forbidden boundary is
    // invisible and every rule here silently exempts it. An enforcement rule with a
    // bypass is decoration. Turning it on left the violation count exactly where it
    // was (2 × services-ports-type-only), so it costs nothing and closes the hole.
    // NOTE this is NOT the rejected `tsConfig` option of Gotcha #2 — different key,
    // no TS18003.
    tsPreCompilationDeps: true,
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
    // ─────────────────────────────────────────────────────────────────────────
    // D-4: the flow→dd boundary rules USED to live here, and are deliberately
    // gone (plan 080 tk-000d/tk-0010).
    //
    // Eighteen rules were removed: seventeen `dd-*-never-imports-*` layering
    // rules, plus `flow-consumes-dd-sdk-only`, which required the flow spine to
    // reach dd only through `services/dd/{links,schema,plan}/index.ts`. All of
    // them addressed `^harness/cli/src/services/dd`, a path that no longer
    // exists — dd is an installed PACKAGE now.
    //
    // They are not replaced, and that is the ruling, not an omission. A
    // package-aware successor would have to police `node_modules/@ai-substrate/dd`,
    // which is (a) not ours to lay out, and (b) already constrained by something
    // stronger than a lint rule: dd's own `exports` map. Node REFUSES a reach
    // past it at runtime with ERR_PACKAGE_PATH_NOT_EXPORTED — a real barrier
    // rather than a warning someone can promote, demote, or waive.
    //
    // So the boundary did not weaken; its ENFORCER changed from a rule we own to
    // a mechanism the package owns. What we lost is the **naming**: this file no
    // longer tells a reader the boundary exists. That is what this comment is
    // for. Do not rebuild the rules against `node_modules` — see D-4 in
    // docs/plans/080-dd-consume-upgrade.
    // ─────────────────────────────────────────────────────────────────────────
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

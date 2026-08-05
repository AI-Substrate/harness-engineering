import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ddLinks from '../../../src/services/dd/links/index.js';
import * as ddPlan from '../../../src/services/dd/plan/index.js';
import * as ddSchema from '../../../src/services/dd/schema/index.js';

/**
 * The flow→dd SDK-seam boundary (P6 review F001, hardened by F008).
 *
 * The flow spine is an EXTERNAL consumer of dd. It may import dd's two published
 * barrels and nothing else; a module path under `dd/core/`, `dd/links/*` or
 * `dd/schema/*` is an internal, and reaching past a barrel for one is how an SDK
 * silently decays into a shared folder — the export list stops describing the
 * contract, and dd can no longer move an internal without breaking the flow.
 *
 * `.dependency-cruiser.cjs`'s `flow-consumes-dd-sdk-only` rule is the authoritative
 * enforcement (it sees the whole reachable graph). This test is its fast, always-run
 * sibling: `harness arch-check` runs in `checks`, but the unit suite runs on every
 * save, and a boundary that is only checked at the end of the loop is a boundary
 * that gets crossed in the middle of one.
 *
 * **F008 — the first version of this file had the bypass it existed to prevent.**
 * It read only the TOP LEVEL of `services/flow`, so a nested file could import
 * anything; and depcruise, analysing the transpiled graph, could not see `import
 * type` at all. Between them, an `import type … from '../dd/core/model.js'` in
 * `services/flow/sub/x.ts` passed both controls. An enforcement rule with a bypass
 * is decoration. So this walks the tree RECURSIVELY, covers the act consumer, and
 * matches type-only and value imports with the same regex — because it reads the
 * source text, where nothing has been erased yet.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI_ROOT = join(HERE, '..', '..', '..');
const SRC = join(CLI_ROOT, 'src');
const FLOW_SRC = join(SRC, 'services', 'flow');
/** The act is a flow consumer too — it composes dd's adapters as the composition root. */
const ACT_CONSUMER = join(SRC, 'acts', 'flow.ts');
const DEPCRUISE_CONFIG = join(CLI_ROOT, '..', '..', '.dependency-cruiser.cjs');

/** The shape this test reads out of the config — not depcruise's full schema. */
interface DepcruiseConfig {
  options?: { tsPreCompilationDeps?: boolean };
  forbidden: Array<{
    name?: string;
    from?: { path?: string };
    to?: { path?: string; pathNot?: string };
  }>;
}

/**
 * The config as depcruise receives it: REQUIRED and evaluated, never read as text.
 *
 * A text assertion cannot tell a live setting from a commented-out one — the
 * substring survives inside the comment — so it goes green on precisely the edit
 * that breaks the thing it guards. Requiring the module asks the same question the
 * tool asks. Cache-busted so a mutation mid-run is actually re-read.
 */
function requireConfig(): DepcruiseConfig {
  const req = createRequire(import.meta.url);
  delete req.cache[req.resolve(DEPCRUISE_CONFIG)];
  return req(DEPCRUISE_CONFIG) as DepcruiseConfig;
}

/** The dd service tree — the boundary's subject, matching the depcruise rule's `to.path`. */
const DD_SERVICE = join(SRC, 'services', 'dd');

/**
 * The ONLY modules inside that tree a flow consumer may import. Adding one is a
 * design decision, not a convenience — that is the whole point of the list.
 *
 * `plan/index.ts` joined at plan 071 tk-7134, for the check-kind gate: the gate
 * asks "does this plan pass its own validator?", and the ONE implementation of
 * that answer is `readPlanCheck`. The alternative was the flow re-deriving a
 * verdict `harness plan validate` already computes — a second opinion about the
 * same documents, drifting silently. So the seam was EXPOSED rather than reached
 * past, which is the rule working, not the rule bending.
 */
const PERMITTED_DD_MODULES: readonly string[] = [
  join(DD_SERVICE, 'links', 'index.ts'),
  join(DD_SERVICE, 'plan', 'index.ts'),
  join(DD_SERVICE, 'schema', 'index.ts'),
];

/**
 * Every module specifier in a source file — `import`, `import type`, `export …
 * from`, and dynamic `import()`.
 *
 * Deliberately a regex over source text rather than a TS AST walk: the erasure that
 * hid type-only edges from depcruise happens at COMPILE time, and this reads what
 * the author actually wrote. `from '…'` catches `import type` and `export … from`
 * for free, which is exactly the coverage F008 found missing.
 */
function specifiersOf(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'|import\('([^']+)'\)/g)].map(
    (m) => m[1] ?? m[2] ?? '',
  );
}

/** Every `.ts` under a directory, RECURSIVELY — the second half of the F008 hole. */
function sourcesUnder(dir: string, prefix = ''): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourcesUnder(join(dir, entry.name), rel));
    else if (entry.name.endsWith('.ts')) {
      out.push({ file: rel, text: readFileSync(join(dir, entry.name), 'utf8') });
    }
  }
  return out;
}

function flowConsumerSources(): { file: string; text: string }[] {
  return [
    ...sourcesUnder(FLOW_SRC),
    { file: 'acts/flow.ts', text: readFileSync(ACT_CONSUMER, 'utf8') },
  ];
}

/**
 * The offending specifiers in a chunk of source, RESOLVED — the detector under test.
 *
 * Resolution rather than string matching, so this asks the same question the
 * depcruise rule asks (`to.path: ^…/services/dd`, `pathNot:` the two barrels)
 * against the same tree. It matters: `acts/flow.ts` imports `./dd/shared.js`, which
 * is the ACT layer's own dd helper (`acts/dd/shared.ts`) — act→act composition,
 * outside the dd SERVICE and outside this boundary. A substring test on `/dd/`
 * flags it; resolving does not, and neither does the config. Two controls asking
 * different questions is how a boundary starts disagreeing with itself.
 */
function offendingSpecifiers(source: string, fromDir: string): string[] {
  const out: string[] = [];
  for (const spec of specifiersOf(source)) {
    if (!spec.startsWith('.')) continue; // a package, not a path into this tree
    const target = resolve(fromDir, spec).replace(/\.js$/, '.ts');
    if (!target.startsWith(`${DD_SERVICE}/`)) continue; // not the dd service at all
    if (!PERMITTED_DD_MODULES.includes(target)) out.push(spec);
  }
  return out;
}

/** Resolve as if written in `services/flow/` — the common consumer location. */
const fromFlow = (source: string): string[] => offendingSpecifiers(source, FLOW_SRC);

describe('flow → dd: published SDK seams only (F001, F008)', () => {
  it('includes the act consumer alongside the flow service tree', () => {
    const files = flowConsumerSources().map((s) => s.file);
    expect(files).toContain('flow-dd-gate.ts');
    expect(files).toContain('acts/flow.ts');
  });

  it('the walker RECURSES — proven on a tree, not on the current file layout', () => {
    // The guard on the guard, and it has to be built rather than observed:
    // `services/flow` has no nested `.ts` today, so a walker that quietly stopped
    // descending would still find every file and every assertion here would pass by
    // not looking. That is the exact shape of the F008 defect, so it is not enough
    // to fix the walker — the recursion itself must be a tested property.
    const root = mkdtempSync(join(tmpdir(), 'seam-walk-'));
    try {
      mkdirSync(join(root, 'deep', 'deeper'), { recursive: true });
      writeFileSync(join(root, 'top.ts'), "import { a } from './x.js';\n");
      writeFileSync(join(root, 'deep', 'mid.ts'), "import { b } from './y.js';\n");
      writeFileSync(
        join(root, 'deep', 'deeper', 'buried.ts'),
        "import type { DdSection } from '../../../dd/core/model.js';\n",
      );
      writeFileSync(join(root, 'deep', 'notes.md'), 'ignored');

      const found = sourcesUnder(root)
        .map((s) => s.file)
        .sort();
      expect(found).toEqual(['deep/deeper/buried.ts', 'deep/mid.ts', 'top.ts']);

      // And end to end: a type-only reach past the barrel, buried two directories
      // down, is caught — the precise combination that passed BOTH controls before.
      const buried = sourcesUnder(root).find((s) => s.file === 'deep/deeper/buried.ts');
      expect(offendingSpecifiers(buried?.text ?? '', join(FLOW_SRC, 'deep', 'deeper'))).toEqual([
        '../../../dd/core/model.js',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('every dd import in a flow consumer names a barrel, never a module path', () => {
    const offences: string[] = [];
    for (const { file, text } of flowConsumerSources()) {
      const dir = file === 'acts/flow.ts' ? dirname(ACT_CONSUMER) : join(FLOW_SRC, dirname(file));
      for (const spec of offendingSpecifiers(text, dir)) offences.push(`${file}: ${spec}`);
    }
    expect(offences).toEqual([]);
  });

  it('catches a TYPE-ONLY reach past the barrel, not just a value import', () => {
    // The F008 bypass, stated as a property of the detector rather than assumed.
    // depcruise reads the transpiled graph, where `import type` has been erased;
    // this reads source, where it has not.
    expect(fromFlow("import type { DdSection } from '../dd/core/model.js';")).toEqual([
      '../dd/core/model.js',
    ]);
  });

  it('catches a re-export that reaches past the barrel', () => {
    expect(fromFlow("export { deriveState } from '../dd/core/derive.js';")).toEqual([
      '../dd/core/derive.js',
    ]);
  });

  it('catches a nested consumer reaching past the barrel', () => {
    // The other half of F008: a top-level-only scan let `services/flow/sub/x.ts`
    // import anything. Same detector, applied to the path the walker now reaches.
    expect(
      offendingSpecifiers("import { walk } from '../../dd/core/walk.js';", join(FLOW_SRC, 'sub')),
    ).toEqual(['../../dd/core/walk.js']);
  });

  it('does NOT flag the permitted barrels — the detector is not just "any dd string"', () => {
    const ok = [
      "import { resolveLink } from '../dd/links/index.js';",
      "import type { SchemaRecord } from '../dd/schema/index.js';",
      "import { readPlanCheck } from '../dd/plan/index.js';",
    ].join('\n');
    expect(fromFlow(ok)).toEqual([]);
    // The act names the same two barrels from one directory further out, plus its
    // OWN act-layer dd helper — which is composition, not a reach past the barrel.
    const act = [
      "import { MemoizingDocLoader } from '../services/dd/links/index.js';",
      "import { ConventionSchemaResolver } from '../services/dd/schema/index.js';",
      "import { FsDocLoader } from './dd/shared.js';",
    ].join('\n');
    expect(offendingSpecifiers(act, dirname(ACT_CONSUMER))).toEqual([]);
  });

  it('the gate reaches dd through exactly the published barrels', () => {
    const gate = readFileSync(join(FLOW_SRC, 'flow-dd-gate.ts'), 'utf8');
    const dd = specifiersOf(gate).filter((s) => s.includes('/dd/'));
    expect([...new Set(dd)].sort()).toEqual([
      '../dd/links/index.js',
      '../dd/plan/index.js',
      '../dd/schema/index.js',
    ]);
  });

  it('the barrels export every value seam the flow consumes', () => {
    // By value, not by shape: a barrel that stops exporting one of these is a
    // BREAKING change to an external consumer, and should fail here loudly rather
    // than at whichever call site happens to be typechecked first.
    expect(typeof ddLinks.resolveLink).toBe('function');
    expect(typeof ddLinks.verifyBasis).toBe('function');
    expect(typeof ddLinks.MemoizingDocLoader).toBe('function');
    expect(typeof ddSchema.deriveSchemaState).toBe('function');
    expect(typeof ddSchema.deriveSchemaItems).toBe('function');
    expect(typeof ddSchema.ConventionSchemaResolver).toBe('function');
    expect(typeof ddPlan.readPlanCheck).toBe('function');
    expect(typeof ddPlan.isPlanCheckKind).toBe('function');
    expect(ddPlan.PLAN_CHECK_KINDS).toEqual(['plan-validate']);
  });

  it('deriveSchemaItems and deriveSchemaState project the SAME collector', () => {
    // The reason `deriveSchemaItems` was exposed rather than reconstructed in the
    // flow: one walker, two views. If they ever disagreed about what an item is,
    // the gate's refusal list and its own n/m count would contradict each other.
    const record = {
      name: 'test.schema',
      description: '',
      version: 1,
      path: '/repo/schemas/test/schema.json',
      root: 'gitroot' as const,
      schema: { sections: {} } as unknown as ddSchema.SchemaRecord['schema'],
      gateTerminal: ['done'] as readonly string[],
      shadows: [],
    };
    const section = {
      name: 'tasks',
      value: [
        { id: 'tk-1', state: 'done' },
        { id: 'tk-2', state: 'blocked' },
        { id: 'tk-3', state: 'unchecked' },
      ],
    };
    const state = ddSchema.deriveSchemaState(record, section);
    const items = ddSchema.deriveSchemaItems(record, section);

    expect(items.map((i) => i.id)).toEqual(['tk-1', 'tk-2', 'tk-3']);
    expect(items.length).toBe(state.total);
    expect(items.filter((i) => i.terminal).length).toBe(state.terminal);
    expect(items.filter((i) => !i.terminal).map((i) => i.id)).toEqual(state.incomplete);
    // And the states are NAMED, which is the whole reason the seam exists.
    expect(items.map((i) => i.state)).toEqual(['done', 'blocked', 'unchecked']);
  });

  it('the depcruise config is asserted as EVALUATED, never as text', () => {
    // Two controls, one contract — and the tie between them has to be read the way
    // depcruise reads it. The first version of this test substring-matched the raw
    // `.cjs`, which meant COMMENTING OUT the option kept the substring alive inside
    // the comment: the test stayed green while depcruise silently went back to
    // erasing every type-only edge. That is a probe that defeats itself, the third
    // time this phase has met that class (DL-006, DL-007) and the reason this one
    // requires the module and asserts the object depcruise is actually handed.
    const config = requireConfig();

    // Without this, depcruise analyses the TRANSPILED graph, where TypeScript has
    // already erased every `import type` — so EVERY rule in the file silently
    // exempts type-only edges, not merely this one. It is load-bearing.
    expect(config.options?.tsPreCompilationDeps).toBe(true);

    const rule = config.forbidden.find((r) => r.name === 'flow-consumes-dd-sdk-only');
    expect(rule).toBeDefined();
    // The boundary itself, from the parsed rule rather than from prose about it.
    expect(rule?.to?.path).toBe('^harness/cli/src/services/dd');
    expect(rule?.to?.pathNot).toBe('^harness/cli/src/services/dd/(links|schema|plan)/index\\.ts$');
    expect(rule?.from?.path).toBe('^harness/cli/src/(services/flow|acts/flow\\.ts$)');
  });

  it("the rule's own regexes accept the permitted modules and reject an internal", () => {
    // The final tie: run the config's ACTUAL patterns over the ACTUAL paths, so the
    // two controls cannot drift into disagreeing about the same file. A `pathNot`
    // typo that quietly exempted all of `services/dd` would pass every assertion
    // above and fail here.
    const rule = requireConfig().forbidden.find((r) => r.name === 'flow-consumes-dd-sdk-only');
    const inScope = (p: string) => new RegExp(rule?.from?.path ?? '$^').test(p);
    const forbidden = (p: string) =>
      new RegExp(rule?.to?.path ?? '$^').test(p) && !new RegExp(rule?.to?.pathNot ?? '$^').test(p);

    expect(inScope('harness/cli/src/services/flow/flow-dd-gate.ts')).toBe(true);
    expect(inScope('harness/cli/src/services/flow/sub/nested.ts')).toBe(true);
    expect(inScope('harness/cli/src/acts/flow.ts')).toBe(true);
    expect(inScope('harness/cli/src/acts/dd/link.ts')).toBe(false);

    expect(forbidden('harness/cli/src/services/dd/core/model.ts')).toBe(true);
    expect(forbidden('harness/cli/src/services/dd/schema/resolve.ts')).toBe(true);
    expect(forbidden('harness/cli/src/services/dd/links/index.ts')).toBe(false);
    expect(forbidden('harness/cli/src/services/dd/schema/index.ts')).toBe(false);
    expect(forbidden('harness/cli/src/services/dd/plan/index.ts')).toBe(false);
    // The barrel is permitted; the modules BEHIND it are not — which is the whole
    // difference between exposing a seam and widening the boundary.
    expect(forbidden('harness/cli/src/services/dd/plan/check.ts')).toBe(true);
    expect(forbidden('harness/cli/src/services/dd/plan/semantics.ts')).toBe(true);
    expect(forbidden('harness/cli/src/acts/dd/shared.ts')).toBe(false); // not the dd SERVICE
  });
});

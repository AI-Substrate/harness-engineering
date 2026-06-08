import { describe, expect, it } from 'vitest';
import {
  minimalJs,
  minimalTs,
  renderStarter,
  toIdentifier,
  wrapJs,
  wrapTs,
} from '../../../src/services/scaffold/templates.js';

/*
Test Doc:
- Why: the scaffolded file IS the product of `harness new`; plan 006 workshop §4 fixes its
  exact contents so authoring starts from a valid, loadable file. These tests pin that output
  byte-for-byte so drift is caught immediately.
- Contract: the template builders emit the workshop §4a–4d text verbatim, camelCasing the verb
  name into a valid const identifier (Finding 03).
- Quality Contribution: turns "what should the stub look like?" into an assertion, not prose.
*/

const MINIMAL_TS_GREET = `import type { HarnessVerb } from 'harness-engineering/contract';

const greet: HarnessVerb = {
  name: 'greet',
  summary: 'TODO: one-line summary of what \`harness greet\` does.',
  // options: [{ flags: '--example <value>', description: 'an example flag' }],
  run(ctx) {
    // TODO: implement this verb. Until you do, it honestly reports "not built yet".
    return ctx.unconfigured('Implement run() in .harness/extensions/greet.ts');
  },
};

export default greet;
`;

const WRAP_TS_TEST = `import type { HarnessVerb } from 'harness-engineering/contract';

const test: HarnessVerb = {
  name: 'test',
  summary: 'TODO: summary (wraps \`npm test\`).',
  async run(ctx) {
    const r = await ctx.exec('npm', ['test']);
    return r.ok
      ? ctx.ok({ command: 'npm test' })
      : ctx.error('E1', \`npm test failed (exit \${r.code})\`, {
          details: r.stderr,
          next_action: 'Fix the failure above, then re-run \`harness test\`.',
        });
  },
};

export default test;
`;

const MINIMAL_JS_GREET = `/** @type {import('harness-engineering/contract').HarnessVerb} */
const greet = {
  name: 'greet',
  summary: 'TODO: one-line summary of what \`harness greet\` does.',
  run(ctx) {
    // TODO: implement this verb.
    return ctx.unconfigured('Implement run() in .harness/extensions/greet.js');
  },
};

export default greet;
`;

const WRAP_JS_TEST = `/** @type {import('harness-engineering/contract').HarnessVerb} */
const test = {
  name: 'test',
  summary: 'TODO: summary (wraps \`npm test\`).',
  async run(ctx) {
    const r = await ctx.exec('npm', ['test']);
    return r.ok
      ? ctx.ok({ command: 'npm test' })
      : ctx.error('E1', \`npm test failed (exit \${r.code})\`, {
          details: r.stderr,
          next_action: 'Fix the failure above, then re-run \`harness test\`.',
        });
  },
};

export default test;
`;

describe('scaffold templates', () => {
  it('toIdentifier camelCases a kebab verb name into a valid const identifier', () => {
    expect(toIdentifier('greet')).toBe('greet');
    expect(toIdentifier('ci-smoke')).toBe('ciSmoke');
    expect(toIdentifier('a-b-c')).toBe('aBC');
  });

  it('minimalTs emits the workshop §4a starter verbatim', () => {
    expect(minimalTs('greet')).toBe(MINIMAL_TS_GREET);
  });

  it('wrapTs emits the workshop §4b starter verbatim (command split into exec argv)', () => {
    expect(wrapTs('test', 'npm test')).toBe(WRAP_TS_TEST);
  });

  it('minimalJs emits the workshop §4c starter verbatim (JSDoc, no runtime import)', () => {
    expect(minimalJs('greet')).toBe(MINIMAL_JS_GREET);
  });

  it('wrapJs emits the workshop §4d starter verbatim (JSDoc header + wrap body + .js path)', () => {
    expect(wrapJs('test', 'npm test')).toBe(WRAP_JS_TEST);
    // and the dispatcher returns the same bytes for the wrap-js variant
    expect(renderStarter({ name: 'test', js: true, wrap: 'npm test' }).contents).toBe(WRAP_JS_TEST);
  });

  it('wrap splits multi-token commands and camelCases the identifier', () => {
    const out = wrapTs('ci-smoke', 'just ci-smoke');
    expect(out).toContain('const ciSmoke: HarnessVerb');
    expect(out).toContain("await ctx.exec('just', ['ci-smoke'])");
    expect(out).toContain('re-run `harness ci-smoke`');
  });

  it('renderStarter picks the variant + extension from flags', () => {
    expect(renderStarter({ name: 'greet', js: false })).toMatchObject({
      variant: 'minimal-ts',
      ext: 'ts',
    });
    expect(renderStarter({ name: 'greet', js: true })).toMatchObject({
      variant: 'minimal-js',
      ext: 'js',
    });
    expect(renderStarter({ name: 'test', js: false, wrap: 'npm test' })).toMatchObject({
      variant: 'wrap-ts',
      ext: 'ts',
    });
    expect(renderStarter({ name: 'test', js: true, wrap: 'npm test' })).toMatchObject({
      variant: 'wrap-js',
      ext: 'js',
    });
  });
});

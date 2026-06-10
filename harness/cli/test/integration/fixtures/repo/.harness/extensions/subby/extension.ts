import type { HarnessVerb } from 'harness-engineering/contract';
// AC-14 fixture (plan 014): an extension package whose entry imports a helper
// from a SUBFOLDER via a relative path — proves the real jiti loader resolves
// package-internal imports.
import { craftGreeting } from './lib/helper.ts';

const subby: HarnessVerb = {
  name: 'subby',
  summary: 'Proves package-internal relative imports load via jiti (AC-14 fixture).',
  run(ctx) {
    return ctx.ok({ greeting: craftGreeting('subfolder') });
  },
};

export default subby;

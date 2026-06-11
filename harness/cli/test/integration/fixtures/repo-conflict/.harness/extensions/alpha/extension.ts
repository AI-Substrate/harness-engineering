import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

// Sorts BEFORE beta.ts → wins the `greet` verb name (first-sorted wins).
const greet: HarnessVerb = {
  name: 'greet',
  summary: 'Greet (from alpha — the winner).',
  run(ctx) {
    return ctx.ok({ from: 'alpha' });
  },
};

export default greet;

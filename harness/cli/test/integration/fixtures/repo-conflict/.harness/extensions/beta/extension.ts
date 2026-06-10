import type { HarnessVerb } from 'harness-engineering/contract';

// Sorts AFTER alpha.ts → its `greet` verb is shadowed → recorded as a conflict (E142).
const greet: HarnessVerb = {
  name: 'greet',
  summary: 'Greet (from beta — the shadowed duplicate).',
  run(ctx) {
    return ctx.ok({ from: 'beta' });
  },
};

export default greet;

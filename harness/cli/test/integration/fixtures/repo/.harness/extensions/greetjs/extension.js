// Plain-.js extension authored with NO runtime import of the core: the contract
// is referenced only via a JSDoc @type (erased at runtime), proving a plain-JS
// author can extend the harness with zero runtime dependency on the core (plan
// D4). Loaded via the native dynamic import() fast path, not jiti.

/** @type {import('@ai-substrate/engineering-harness/contract').HarnessVerb} */
const greetjs = {
  name: 'greetjs',
  summary: 'Greet from a plain .js extension (integration fixture).',
  run(ctx) {
    return ctx.ok({ greeting: 'hi from a .js extension' });
  },
};

export default greetjs;

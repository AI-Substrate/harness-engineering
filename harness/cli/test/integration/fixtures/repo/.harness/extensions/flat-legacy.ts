import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

// PERMANENT fixture (plan 014 T011): the retired FLAT layout. Discovery must
// REJECT this file with E143 ("unsupported flat layout — move to
// flat-legacy/extension.ts") and never load it. If a `flat-legacy` verb ever
// registers, the rejection path has regressed — do not "fix" this file by
// moving it into a folder.
const flatLegacy: HarnessVerb = {
  name: 'flat-legacy',
  summary: 'Must never register — flat files are an unsupported layout.',
  run(ctx) {
    return ctx.ok({ shouldNeverRun: true });
  },
};

export default flatLegacy;

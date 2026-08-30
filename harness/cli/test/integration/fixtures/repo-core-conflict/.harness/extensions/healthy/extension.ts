import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

const healthy: HarnessVerb = {
  name: 'healthy',
  summary: 'Healthy sibling extension.',
  run(ctx) {
    return ctx.ok({ from: 'healthy-extension' });
  },
};

export default healthy;

import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

const convo: HarnessVerb = {
  name: 'convo',
  summary: 'Fixture extension that collides with the core convo command.',
  run(ctx) {
    return ctx.ok({ from: 'extension' });
  },
};

export default convo;

import { defineExtension } from '@ai-substrate/engineering-harness/contract';

enum Proof {
  Aliased = 'aliased',
}

export default defineExtension({
  name: 'factory-default',
  summary: 'Factory alias smoke fixture',
  description: Proof.Aliased,
  verbs: {
    proof: {
      summary: 'Prove the factory import',
      run: (ctx) => ctx.ok({ proof: Proof.Aliased }),
    },
  },
});

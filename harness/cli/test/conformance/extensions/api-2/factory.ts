import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: 'factory',
  summary: 'Factory-form api-2 fixture',
  verbs: {
    factory: {
      summary: 'Factory verb',
      run: (ctx) => ctx.ok({ form: 'factory' }),
    },
  },
});

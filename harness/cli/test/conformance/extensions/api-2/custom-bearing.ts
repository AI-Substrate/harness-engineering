import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: 'custom-bearing',
  summary: 'Carries an api-2 custom item',
  custom: {
    migration: {
      users: {
        summary: 'Migrate users',
        order: 1,
      },
    },
  },
});

import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: 'manual-sensor',
  summary: 'Exercises the api-2 manual trigger contract',
  sensors: {
    audit: {
      summary: 'Run the manual audit',
      trigger: 'manual',
      guidance: 'Run `harness sensors run audit` after changing audit configuration.',
      run: () => ({ state: 'pass' }),
    },
  },
});

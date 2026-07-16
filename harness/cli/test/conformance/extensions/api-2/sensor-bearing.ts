import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: 'sensor-bearing',
  summary: 'Carries an api-2 reserved sensor declaration',
  sensors: {
    lint: {
      summary: 'Lint sensor',
      command: 'npm',
      args: ['run', 'lint'],
    },
  },
});

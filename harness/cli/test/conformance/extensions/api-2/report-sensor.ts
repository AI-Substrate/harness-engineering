import { defineExtension } from '../../../../src/services/extensions/contract.js';

export default defineExtension({
  name: 'reporting',
  summary: 'Report-bearing sensor conformance fixture.',
  sensors: {
    coverage: {
      summary: 'Reports concise and detailed coverage signals.',
      trigger: 'manual',
      run: () => ({
        state: 'pass',
        score: 80.7,
        direction: 'higher',
        threshold: 80,
        details: '80.7% branch coverage (target 80%)',
        report: ['Statements: 91.1%', 'Branches: 80.7%', 'Uncovered: scheduler.ts:118-124'].join(
          '\n',
        ),
      }),
    },
  },
});

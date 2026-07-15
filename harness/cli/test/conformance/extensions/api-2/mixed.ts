import {
  defineExtension,
  type HarnessRecordType,
  type HarnessVerb,
} from '@ai-substrate/engineering-harness/contract';

const legacy: HarnessVerb = {
  name: 'legacy-mixed',
  summary: 'Legacy member',
  run: (ctx) => ctx.ok({ format: 'v1' }),
};

const modern = defineExtension({
  name: 'mixed',
  summary: 'Modern member',
  verbs: {
    modernMixed: {
      summary: 'Modern member verb',
      run: (ctx) => ctx.ok({ format: 'v2' }),
    },
  },
});

const record: HarnessRecordType = {
  kind: 'record',
  type: 'mixed-note',
  description: 'Mixed fixture record',
  template: '---\nrecord_type: mixed-note\n---\n',
};

export default [legacy, modern, record];

import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: 'subverbs',
  summary: 'Nested subverb api-2 fixture',
  verbs: {
    files: {
      summary: 'File operations',
      options: [{ flags: '--profile <name>', description: 'Shared profile' }],
      sub: {
        print: {
          summary: 'Print files',
          options: [{ flags: '--numbered', description: 'Number each line' }],
          args: [{ name: '<files...>', description: 'Files to print' }],
          run: (ctx) => ctx.ok({ files: ctx.args.files, options: ctx.options }),
        },
      },
    },
  },
});

import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

const hello: HarnessVerb = {
  name: 'hello',
  summary: 'Say hello (integration fixture).',
  options: [{ flags: '--name <name>', description: 'who to greet', defaultValue: 'world' }],
  run(ctx) {
    return ctx.ok(
      { greeting: `hello, ${ctx.options.name}` },
      { next_action: 'Edit .harness/extensions/hello/extension.ts to customise.' },
    );
  },
};

export default hello;

import type { HarnessVerb } from 'harness-engineering/contract';

const hello: HarnessVerb = {
  name: 'hello',
  summary: 'Say hello (integration fixture).',
  options: [{ flags: '--name <name>', description: 'who to greet', defaultValue: 'world' }],
  run(ctx) {
    return ctx.ok(
      { greeting: `hello, ${ctx.options.name}` },
      { next_action: 'Edit .harness/extensions/hello.ts to customise.' },
    );
  },
};

export default hello;

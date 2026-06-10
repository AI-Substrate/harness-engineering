import type { HarnessVerb } from 'harness-engineering/contract';

/**
 * The minimal extension — copy this into your repo's `.harness/extensions/`
 * folder and run `harness hello --name pi`.
 */
const hello: HarnessVerb = {
  name: 'hello',
  summary: 'Say hello (example extension).',
  description: 'A minimal verb showing options + the ok() envelope helper.',
  options: [{ flags: '--name <name>', description: 'who to greet', defaultValue: 'world' }],
  run(ctx) {
    return ctx.ok(
      { greeting: `hello, ${ctx.options.name}` },
      { next_action: 'Edit .harness/extensions/hello/extension.ts to customise.' },
    );
  },
};

export default hello;

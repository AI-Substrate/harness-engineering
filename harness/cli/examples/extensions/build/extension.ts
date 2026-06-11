import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

/**
 * The point of a verb: WRAP a real repo command (don't rebuild it). This one
 * runs `npm run build` via ctx.exec and maps the child's exit to the Envelope.
 * Copy it into your repo's `.harness/extensions/` folder and run `harness build`.
 */
const build: HarnessVerb = {
  name: 'build',
  summary: 'Build the project (wraps `npm run build`).',
  async run(ctx) {
    const result = await ctx.exec('npm', ['run', 'build']);
    return result.ok
      ? ctx.ok({ command: 'npm run build' }, { evidence: [{ label: 'build log', none: true }] })
      : ctx.error('E1', `build failed (exit ${result.code})`, {
          details: result.stderr,
          next_action: 'Fix the build error above, then re-run `harness build`.',
        });
  },
};

export default build;

import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

// Wraps a real command via ctx.exec (P8): calls `node -e`, a real, deterministic
// command on PATH, and maps the child's exit to the Envelope. `--fail` forces a
// failing child so the integration test can assert the error/exit mapping.
const build: HarnessVerb = {
  name: 'build',
  summary: 'Build the project (integration fixture wrapping a real command).',
  options: [{ flags: '--fail', description: 'force a failing child command' }],
  async run(ctx) {
    const script = ctx.options.fail ? 'process.exit(1)' : 'process.stdout.write("built")';
    const result = await ctx.exec('node', ['-e', script]);
    return result.ok
      ? ctx.ok(
          { command: 'node -e', stdout: result.stdout },
          { evidence: [{ label: 'build log', none: true }] },
        )
      : ctx.error('E1', `build failed (exit ${result.code})`, {
          details: result.stderr,
          next_action: 'Fix the build error above.',
        });
  },
};

export default build;

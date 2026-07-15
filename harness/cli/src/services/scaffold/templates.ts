/** Pure v2 extension template builders used by `harness new`. */

export type ScaffoldVariant = 'v2-ts' | 'v2-sub-ts' | 'v2-wrap-ts' | 'v2-js' | 'v2-sensor-ts';

/** kebab/lower name → a valid camelCase JS identifier (kept as a public utility). */
export function toIdentifier(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function splitCommand(command: string): { argv0: string; rest: string[] } {
  const parts = command.trim().split(/\s+/);
  return { argv0: parts[0] ?? '', rest: parts.slice(1) };
}

function argsLiteral(rest: string[]): string {
  return `[${rest.map((arg) => `'${arg}'`).join(', ')}]`;
}

/** Default TypeScript factory starter. */
export function v2Ts(name: string): string {
  return `import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: '${name}',
  summary: 'TODO: one-line summary of this extension package.',
  verbs: {
    '${name}': {
      summary: 'TODO: one-line summary of what \`harness ${name}\` does.',
      run(ctx) {
        return ctx.unconfigured('Implement run() in .harness/extensions/${name}/extension.ts');
      },
    },
  },
});
`;
}

/** TypeScript factory starter with real, one-level subcommands. */
export function v2SubTs(name: string, subverbs: readonly string[]): string {
  const children = subverbs
    .map(
      (subverb) => `      '${subverb}': {
        summary: 'TODO: describe \`harness ${name} ${subverb}\`.',
        run(ctx) {
          return ctx.unconfigured(
            'Implement ${subverb} in .harness/extensions/${name}/extension.ts',
          );
        },
      },`,
    )
    .join('\n');
  return `import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: '${name}',
  summary: 'TODO: one-line summary of this extension package.',
  verbs: {
    '${name}': {
      summary: 'TODO: one-line summary of \`harness ${name}\`.',
      sub: {
${children}
      },
    },
  },
});
`;
}

/** TypeScript factory starter that wraps one existing command with a hard deadline. */
export function v2WrapTs(name: string, command: string): string {
  const { argv0, rest } = splitCommand(command);
  return `import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: '${name}',
  summary: 'Wraps \`${command}\`.',
  verbs: {
    '${name}': {
      summary: 'Wraps \`${command}\`.',
      async run(ctx) {
        const result = await ctx.exec('${argv0}', ${argsLiteral(rest)}, { timeoutMs: 120_000 });
        const stdout = result.stdout.trimEnd().split('\\n').slice(-20).join('\\n');
        return result.ok
          ? ctx.ok({ command: '${command}', stdout })
          : ctx.error('E_WRAP_FAILED', \`${command} failed (exit \${result.code})\`, {
              details: result.stderr,
              next_action: 'Fix the failure above, then re-run \`harness ${name}\`.',
            });
      },
    },
  },
});
`;
}

/** TypeScript sensor starter: wrap one command and report only an exit-code reading. */
export function v2SensorTs(name: string): string {
  return `import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: '${name}',
  summary: 'Deterministic ${name} sensor.',
  sensors: {
    '${name}': {
      summary: 'Runs the existing \`npm run ${name}\` project command.',
      watch: ['src/**', 'test/**'],
      timeoutMs: 120_000,
      guidance: 'Define or fix \`npm run ${name}\`, then run \`harness sensors run ${name}\` again.',
      async run(ctx) {
        const result = await ctx.exec('npm', ['run', '${name}', '--silent']);
        // Persist an authored one-liner only — never copy raw stdout/stderr into a reading.
        return result.code === 0
          ? { state: 'pass' }
          : { state: 'fail', details: '${name} command reported problems' };
      },
    },
  },
});
`;
}

/** Plain-JS bare-literal starter. No runtime import: native `.js` loading needs none. */
export function v2Js(name: string): string {
  return `/** @type {import('@ai-substrate/engineering-harness/contract').ExtensionDefinition} */
const extension = {
  kind: 'extension',
  name: '${name}',
  summary: 'TODO: one-line summary of this extension package.',
  verbs: {
    '${name}': {
      summary: 'TODO: one-line summary of what \`harness ${name}\` does.',
      run(ctx) {
        return ctx.unconfigured('Implement run() in .harness/extensions/${name}/extension.js');
      },
    },
  },
};

export default extension;
`;
}

/** Starter agent briefing written beside every scaffolded entry. */
export function starterInstructions(name: string): string {
  return `# \`harness ${name}\` — agent briefing

<!-- TODO: author this briefing for the CALLING agent (not a human README).
     \`harness instructions ${name}\` serves this file verbatim, freshly read
     on every invocation — edit it any time, no rebuild. -->

## What this verb computes (the deterministic part)

TODO: state exactly what \`harness ${name}\` runs or collects, and what its
envelope \`data\` contains.

## Your role (the inference part)

TODO: state the judgment the calling agent is expected to apply to the output —
what to review, what to compare against, what verdict to reach.

## Watch out for

TODO: list failure modes or misleading outputs an agent should not take at
face value.
`;
}

/** Starter briefing for a sensor item (invoked through the core sensors family). */
export function starterSensorInstructions(name: string): string {
  return `# \`${name}\` sensor — agent briefing

Run with \`harness sensors run ${name}\`; inspect all state with \`harness sensors --json\`.

## What it measures

TODO: describe the deterministic signal and why its pass/warn/fail/skip state matters.

## How to respond

TODO: mirror the declaration's \`guidance\` and state what an agent should change when it fails.

## Watch scope

TODO: verify the declaration's \`watch\` globs are narrow enough to avoid noisy reruns.
`;
}

/** Pick one of the v2-only starters. Flag compatibility is validated by the service. */
export function renderStarter(opts: {
  name: string;
  js: boolean;
  sensor?: boolean;
  wrap?: string;
  sub?: readonly string[];
}): {
  contents: string;
  variant: ScaffoldVariant;
  ext: 'ts' | 'js';
} {
  const { name, js, sensor = false, wrap, sub = [] } = opts;
  if (sensor) {
    return { contents: v2SensorTs(name), variant: 'v2-sensor-ts', ext: 'ts' };
  }
  if (sub.length > 0) {
    return { contents: v2SubTs(name, sub), variant: 'v2-sub-ts', ext: 'ts' };
  }
  if (wrap !== undefined) {
    return { contents: v2WrapTs(name, wrap), variant: 'v2-wrap-ts', ext: 'ts' };
  }
  return js
    ? { contents: v2Js(name), variant: 'v2-js', ext: 'js' }
    : { contents: v2Ts(name), variant: 'v2-ts', ext: 'ts' };
}

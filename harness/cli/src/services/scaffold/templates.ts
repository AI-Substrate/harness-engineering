/**
 * Pure string builders for the scaffolded extension starters (`harness new`,
 * plan 006). Output is byte-exact to workshop 001 §4 so it can be asserted in
 * tests and survives `npx`/bundling (no loose template files to resolve at
 * runtime). Authors never see this module — only the file it writes.
 */

export type ScaffoldVariant = 'minimal-ts' | 'minimal-js' | 'wrap-ts' | 'wrap-js' | 'record-ts';

/** kebab/lower verb name → a valid camelCase JS identifier for the local const. */
export function toIdentifier(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function splitCommand(command: string): { argv0: string; rest: string[] } {
  const parts = command.trim().split(/\s+/);
  return { argv0: parts[0] ?? '', rest: parts.slice(1) };
}

function argsLiteral(rest: string[]): string {
  return `[${rest.map((a) => `'${a}'`).join(', ')}]`;
}

/** Minimal TypeScript starter — an honest `unconfigured` stub (workshop §4a). */
export function minimalTs(name: string): string {
  const id = toIdentifier(name);
  return `import type { HarnessVerb } from 'harness-engineering/contract';

const ${id}: HarnessVerb = {
  name: '${name}',
  summary: 'TODO: one-line summary of what \`harness ${name}\` does.',
  // options: [{ flags: '--example <value>', description: 'an example flag' }],
  run(ctx) {
    // TODO: implement this verb. Until you do, it honestly reports "not built yet".
    return ctx.unconfigured('Implement run() in .harness/extensions/${name}.ts');
  },
};

export default ${id};
`;
}

/** Wrap-a-real-command TypeScript starter (workshop §4b). */
export function wrapTs(name: string, command: string): string {
  const id = toIdentifier(name);
  const { argv0, rest } = splitCommand(command);
  return `import type { HarnessVerb } from 'harness-engineering/contract';

const ${id}: HarnessVerb = {
  name: '${name}',
  summary: 'Wraps \`${command}\`.',
  async run(ctx) {
    const started = Date.now();
    const r = await ctx.exec('${argv0}', ${argsLiteral(rest)});
    const durationMs = Date.now() - started;
    const tail = r.stdout.trimEnd().split('\\n').slice(-20).join('\\n');
    return r.ok
      ? ctx.ok({ command: '${command}', durationMs, stdout: tail })
      : ctx.error('E1', \`${command} failed (exit \${r.code})\`, {
          details: r.stderr,
          next_action: 'Fix the failure above, then re-run \`harness ${name}\`.',
        });
  },
};

export default ${id};
`;
}

/** Minimal plain-JS starter — JSDoc contract reference, no runtime import (workshop §4c). */
export function minimalJs(name: string): string {
  const id = toIdentifier(name);
  return `/** @type {import('harness-engineering/contract').HarnessVerb} */
const ${id} = {
  name: '${name}',
  summary: 'TODO: one-line summary of what \`harness ${name}\` does.',
  run(ctx) {
    // TODO: implement this verb.
    return ctx.unconfigured('Implement run() in .harness/extensions/${name}.js');
  },
};

export default ${id};
`;
}

/** Wrap-a-real-command plain-JS starter (workshop §4d). */
export function wrapJs(name: string, command: string): string {
  const id = toIdentifier(name);
  const { argv0, rest } = splitCommand(command);
  return `/** @type {import('harness-engineering/contract').HarnessVerb} */
const ${id} = {
  name: '${name}',
  summary: 'Wraps \`${command}\`.',
  async run(ctx) {
    const started = Date.now();
    const r = await ctx.exec('${argv0}', ${argsLiteral(rest)});
    const durationMs = Date.now() - started;
    const tail = r.stdout.trimEnd().split('\\n').slice(-20).join('\\n');
    return r.ok
      ? ctx.ok({ command: '${command}', durationMs, stdout: tail })
      : ctx.error('E1', \`${command} failed (exit \${r.code})\`, {
          details: r.stderr,
          next_action: 'Fix the failure above, then re-run \`harness ${name}\`.',
        });
  },
};

export default ${id};
`;
}

/**
 * Record-type extension starter (`harness new <name> --record`). Exports a
 * {@link HarnessRecordType} the loader discovers by its `kind:'record'`. The
 * record's "schema" lives in the `template` body (frontmatter + comments); the
 * CLI is schema-agnostic, so editing the template is all it takes to design a type.
 */
export function recordTs(name: string): string {
  const id = toIdentifier(name);
  return `import type { HarnessRecordType } from 'harness-engineering/contract';

const ${id}: HarnessRecordType = {
  kind: 'record',
  type: '${name}',
  description: 'TODO: one-line description of the ${name} record type.',
  // The record's schema lives HERE — frontmatter keys + commented guidance.
  template: \`---
record_type: ${name}
captured_at: "<ISO8601Z>"
# TODO: add the fields this record captures.
---

# ${name} — <subject>

<!-- TODO: optional narrative; the frontmatter above is the durable signal. -->
\`,
};

export default ${id};
`;
}

/** Pick the starter + extension from the `harness new` flags. */
export function renderStarter(opts: {
  name: string;
  js: boolean;
  wrap?: string;
  record?: boolean;
}): {
  contents: string;
  variant: ScaffoldVariant;
  ext: 'ts' | 'js';
} {
  const { name, js, wrap, record } = opts;
  if (record) {
    // Record types are TS stubs (they import the record contract); --wrap/--js don't apply.
    return { contents: recordTs(name), variant: 'record-ts', ext: 'ts' };
  }
  if (wrap !== undefined) {
    return js
      ? { contents: wrapJs(name, wrap), variant: 'wrap-js', ext: 'js' }
      : { contents: wrapTs(name, wrap), variant: 'wrap-ts', ext: 'ts' };
  }
  return js
    ? { contents: minimalJs(name), variant: 'minimal-js', ext: 'js' }
    : { contents: minimalTs(name), variant: 'minimal-ts', ext: 'ts' };
}

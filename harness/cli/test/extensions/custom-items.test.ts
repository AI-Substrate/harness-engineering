import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeModuleLoader } from '../../src/adapters/loader/fake-loader.js';
import { buildExtensionRegistry } from '../../src/services/extensions/registry.js';
import { buildV2VerbContext } from '../../src/services/extensions/verb-context.js';

describe('custom item registry (workshop 001 D6-a)', () => {
  it('lets a v2 verb fold over its own and sibling custom items by type', async () => {
    const migrate = '/repo/.harness/extensions/migrate/extension.ts';
    const billing = '/repo/.harness/extensions/billing/extension.ts';
    const registry = await buildExtensionRegistry(
      [migrate, billing],
      new FakeModuleLoader({
        [migrate]: {
          kind: 'extension',
          name: 'migrate',
          summary: 'Migration runner',
          custom: { migration: { users: { summary: 'Users', order: 2 } } },
          verbs: {
            migrate: {
              summary: 'Run migrations',
              run: (ctx: {
                registry?: { items(type: string): Array<{ declaration: unknown }> };
                ok(data: unknown): unknown;
              }) => {
                const items = ctx.registry?.items('migration') ?? [];
                const total = items.reduce(
                  (sum, item) => sum + Number((item.declaration as { order?: number }).order ?? 0),
                  0,
                );
                return ctx.ok({ count: items.length, total });
              },
            },
          },
        },
        [billing]: {
          kind: 'extension',
          name: 'billing',
          summary: 'Billing migration',
          custom: { migration: { invoices: { summary: 'Invoices', order: 3 } } },
        },
      }),
    );

    expect(registry.customItems).toEqual([
      expect.objectContaining({ type: 'migration', name: 'users', entryPath: migrate }),
      expect.objectContaining({ type: 'migration', name: 'invoices', entryPath: billing }),
    ]);
    const ctx = buildV2VerbContext(
      {
        exec: new FakeExec(),
        fs: new FakeFs(),
        env: new FakeEnv(),
        git: new FakeGit(),
        clock: new FakeClock(),
      },
      { cwd: '/repo', args: {}, options: {} },
      registry.customItems,
    );
    const result = await registry.verbs[0]?.run(ctx);
    expect(result).toMatchObject({ status: 'ok', data: { count: 2, total: 5 } });
    expect(ctx.registry?.items('unknown')).toEqual([]);
  });
});

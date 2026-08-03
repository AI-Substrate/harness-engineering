import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/*
Test Doc:
- Why: task 6.6(a) — the dd↔flow gate is the repo's first mechanical refusal, and every
  other suite proves it through in-process seams. This one drives the REAL built CLI over
  a REAL filesystem, so the wiring itself (adapter composition, envelope, exit codes,
  atomic write, sibling re-render) is on the hook rather than assumed.
- Contract: the whole journey, in order — scaffold a flow + a dd document, wire `dd_link`
  through `apply --ops`, watch the gate REFUSE by name, watch `--force` record a defended
  override, complete the work and watch the gate open, edit the upstream document and
  watch drift surface at `orient` without ever becoming a refusal.
- Usage Notes: every artifact lives in a throwaway temp dir. Nothing here points at a
  tracked flow file — the plan's own `the-flow.json` is live state, and a fixture flow
  that lived in the tree would be one `--path` typo away from being written over.
- Quality Contribution: the difference between "the gate refuses in a unit test" and
  "the gate refuses when you type the command".
- Worked Example: `harness flow nav set --now review` → exit 1, `E440`, names `dw-0002`.
*/

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const bin = join(repoRoot, 'harness/cli/bin/harness.js');

/**
 * The child environment for every spawned CLI call.
 *
 * `HARNESS_NO_TELEMETRY` is the shipped kill switch, and it is load-bearing for the
 * runtime of this file rather than a preference: telemetry capture costs this
 * suite ~4.7s of its ~4.8s per invocation, so leaving it on turns a dozen CLI
 * calls into 80 seconds of `just test` that measures the telemetry writer instead
 * of the gate. Nothing under test reads telemetry.
 */
const CHILD_ENV = { ...process.env, HARNESS_NO_TELEMETRY: '1' };

let sandbox: string | undefined;

afterEach(() => {
  if (sandbox !== undefined) rmSync(sandbox, { recursive: true, force: true });
  sandbox = undefined;
});

interface Run {
  code: number;
  stdout: string;
  envelope: Record<string, unknown>;
}

/** Run the built CLI inside the sandbox, capturing the envelope and the exit code. */
function harness(cwd: string, args: string[], json = true): Run {
  const argv = json ? [...args, '--json'] : args;
  try {
    const stdout = execFileSync(process.execPath, [bin, ...argv, '--no-extensions'], {
      cwd,
      encoding: 'utf8',
      env: CHILD_ENV,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout, envelope: json ? parseEnvelope(stdout) : {} };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string };
    const stdout = failed.stdout ?? '';
    return { code: failed.status ?? -1, stdout, envelope: json ? parseEnvelope(stdout) : {} };
  }
}

function parseEnvelope(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return {};
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // The last line is the envelope for commands that also stream text.
    const last = trimmed.split('\n').at(-1) ?? '';
    try {
      return JSON.parse(last) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

const SCHEMA = {
  dd_schema: 1,
  description: 'the gate journey fixture schema',
  sections: {
    tasks: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'state'],
          fields: {
            id: { type: 'string' },
            title: { type: 'string' },
            state: { type: 'state' },
          },
        },
      },
    },
  },
};

function writeTasks(
  root: string,
  items: Array<{ id: string; title: string; state: string }>,
): void {
  writeFileSync(
    join(root, 'docs/tasks.dd.json'),
    `${JSON.stringify(
      { dd: { schema: 'demo/plan' }, sections: [{ name: 'tasks', value: items }], references: [] },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/** A sandbox repo carrying a schema package, a dd document, and a two-node flow. */
function scaffold(): { root: string; flow: string } {
  // realpath, not the raw mkdtemp answer: on macOS `/var` is a symlink to
  // `/private/var`, and the CLI's own cwd resolves the symlink — so an unresolved
  // sandbox path would fail the flow act's write-containment check (`E303`) for a
  // reason no reader of the two paths could see.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harness-gate-e2e-')));
  sandbox = root;
  mkdirSync(join(root, '.dd/schemas/demo/plan'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(
    join(root, '.dd/schemas/demo/plan/schema.json'),
    `${JSON.stringify(SCHEMA, null, 2)}\n`,
    'utf8',
  );
  writeTasks(root, [
    { id: 'dw-0001', title: 'wire the capture', state: 'checked' },
    { id: 'dw-0002', title: 'prove the window is cumulative', state: 'unchecked' },
  ]);

  const created = harness(root, ['flow', 'create', 'harness-loop', '--slug', 'journey']);
  expect(created.code, created.stdout).toBe(0);
  const flow = join(root, '.harness/flows/journey.json');
  expect(existsSync(flow)).toBe(true);
  return { root, flow };
}

function flowJson(path: string): {
  nav: { now: string };
  nodes: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
} {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('6.6(a) — the dd gate journey, end to end through the real CLI', () => {
  beforeAll(() => {
    if (!existsSync(join(repoRoot, 'harness/cli/dist/index.js'))) {
      const win32 = process.platform === 'win32';
      execFileSync(win32 ? 'npm.cmd' : 'npm', ['run', 'build'], {
        cwd: repoRoot,
        stdio: 'ignore',
        env: CHILD_ENV,
        shell: win32,
      });
    }
  }, 240_000);

  it('refuses, records a defended override, opens on completion, and reports drift', () => {
    const { root, flow } = scaffold();
    const at = ['--path', flow];

    // ---- 1. the flow starts ungated: nothing about it has changed -----------
    const before = readFileSync(flow, 'utf8');
    const boot = flowJson(flow).nav.now;
    expect(boot.length).toBeGreaterThan(0);

    // ---- 2. wire the gate through `apply --ops` -----------------------------
    const ops = join(root, 'ops.json');
    writeFileSync(
      ops,
      JSON.stringify([
        {
          op: 'set',
          id: boot,
          dd_link: { address: 'docs/tasks.dd.json#tasks' },
        },
      ]),
      'utf8',
    );
    const wired = harness(root, ['flow', 'apply', ...at, '--ops', ops]);
    expect(wired.code, wired.stdout).toBe(0);
    expect(flowJson(flow).nodes[0]?.dd_link).toEqual({
      address: 'docs/tasks.dd.json#tasks',
    });
    expect(readFileSync(flow, 'utf8')).not.toBe(before);

    // ---- 3. departure REFUSES, naming the outstanding item ------------------
    const successor = (flowJson(flow).nodes[0]?.next as string[])[0] as string;
    const refused = harness(root, ['flow', 'nav', 'set', ...at, '--now', successor]);
    expect(refused.code).toBe(1);
    expect((refused.envelope.error as { code: string }).code).toBe('E440');
    expect(
      refused.envelope.message ?? (refused.envelope.error as { message: string }).message,
    ).toContain('dw-0002');
    // Nothing was written: the cursor has not moved.
    expect(flowJson(flow).nav.now).toBe(boot);

    // ---- 4. orient SHOWS why, item by item ---------------------------------
    const oriented = harness(root, ['flow', 'orient', ...at]);
    expect(oriented.code).toBe(0);
    const gate = (oriented.envelope.data as { dd_gate: Record<string, unknown> }).dd_gate;
    expect(gate).toMatchObject({ status: 'incomplete', terminal: 1, total: 2, gates: true });
    expect(gate.items).toEqual([
      { id: 'dw-0001', state: 'checked', pip: '■' },
      { id: 'dw-0002', state: 'unchecked', pip: '□' },
    ]);

    // ---- 5. `--force` proceeds, but never as a clean ok ---------------------
    const forced = harness(root, ['flow', 'nav', 'set', ...at, '--now', successor, '--force']);
    expect(forced.code).toBe(0);
    expect(forced.envelope.status).toBe('degraded');
    expect(forced.envelope.next_action).toContain("the human's decision");
    const override = flowJson(flow).events.find((e) => e.kind === 'dd-gate-override');
    expect(override).toBeDefined();
    expect((override?.details as { incomplete: string[] }).incomplete).toEqual(['dw-0002']);
    expect(flowJson(flow).nav.now).toBe(successor);

    // ---- 6. do the work; the same gate now opens ----------------------------
    harness(root, ['flow', 'nav', 'set', ...at, '--now', boot, '--force']);
    writeTasks(root, [
      { id: 'dw-0001', title: 'wire the capture', state: 'checked' },
      { id: 'dw-0002', title: 'prove the window is cumulative', state: 'human-skipped' },
    ]);
    const opened = harness(root, ['flow', 'nav', 'set', ...at, '--now', successor]);
    expect(opened.code, opened.stdout).toBe(0);
    expect(opened.envelope.status).toBe('ok');
    const recorded = flowJson(flow).nodes[0]?.dd_link as {
      basis_sha: string;
      reading: { status: string; terminal: number; total: number };
    };
    expect(recorded.reading).toMatchObject({ status: 'complete', terminal: 2, total: 2 });
    expect(recorded.basis_sha).toMatch(/^[0-9a-f]{64}$/);

    // ---- 7. the rendered sibling badges the node, from the stored reading ---
    const rendered = readFileSync(flow.replace(/\.json$/, '.md'), 'utf8');
    expect(rendered).toContain('⛨2/2 ✓');

    // ---- 8. an upstream edit surfaces as DRIFT, never as a refusal ----------
    harness(root, ['flow', 'nav', 'set', ...at, '--now', boot]);
    writeTasks(root, [
      { id: 'dw-0001', title: 'wire the capture', state: 'checked' },
      { id: 'dw-0002', title: 'prove the window is cumulative', state: 'human-skipped' },
      { id: 'dw-0003', title: 'a row nobody told the flow about', state: 'checked' },
    ]);
    const drifted = harness(root, ['flow', 'orient', ...at]);
    expect(drifted.code).toBe(0);
    const driftedGate = (drifted.envelope.data as { dd_gate: Record<string, unknown> }).dd_gate;
    expect(driftedGate.drift).toMatchObject({ recorded: recorded.basis_sha });
    // The live verdict is still computed against the CURRENT file…
    expect(driftedGate).toMatchObject({ status: 'complete', total: 3 });
    // …and drift alone never stops the cursor.
    const stillOpen = harness(root, ['flow', 'nav', 'set', ...at, '--now', successor]);
    expect(stillOpen.code).toBe(0);
    expect(stillOpen.envelope.status).toBe('ok');
  }, 240_000);

  it('an unresolvable gate refuses with its own code rather than guessing', () => {
    const { root, flow } = scaffold();
    const at = ['--path', flow];
    const boot = flowJson(flow).nav.now;
    const ops = join(root, 'ops.json');
    writeFileSync(
      ops,
      JSON.stringify([{ op: 'set', id: boot, dd_link: { address: 'docs/nope.dd.json#tasks' } }]),
      'utf8',
    );
    harness(root, ['flow', 'apply', ...at, '--ops', ops]);
    const successor = (flowJson(flow).nodes[0]?.next as string[])[0] as string;
    const refused = harness(root, ['flow', 'nav', 'set', ...at, '--now', successor]);
    expect(refused.code).toBe(1);
    expect((refused.envelope.error as { code: string }).code).toBe('E441');
    expect(flowJson(flow).nav.now).toBe(boot);
  }, 240_000);

  it('a flow with no dd_link is byte-identical to the pre-gate CLI', () => {
    const { root, flow } = scaffold();
    const at = ['--path', flow];
    const boot = flowJson(flow).nav.now;
    const successor = (flowJson(flow).nodes[0]?.next as string[])[0] as string;

    const plain = harness(root, ['flow', 'nav', 'set', ...at, '--now', successor]);
    expect(plain.code).toBe(0);
    expect(plain.envelope.status).toBe('ok');
    const afterPlain = flowJson(flow);
    expect(afterPlain.nav.now).toBe(successor);
    expect(afterPlain.nodes.every((n) => n.dd_link === undefined)).toBe(true);
    expect(afterPlain.events.some((e) => e.kind === 'dd-gate-override')).toBe(false);

    // …and `--force` on an ungated flow is indistinguishable from not passing it.
    harness(root, ['flow', 'nav', 'set', ...at, '--now', boot]);
    const forced = harness(root, ['flow', 'nav', 'set', ...at, '--now', successor, '--force']);
    expect(forced.envelope.status).toBe('ok');
  }, 240_000);
});

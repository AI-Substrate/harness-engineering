import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hooksDepsFor } from '../../../src/acts/hooks.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { AGENT_MATRIX, eventKeys, findAgent } from '../../../src/services/hooks/agent-matrix.js';
import {
  embedInvocation,
  extractBinaryPath,
  extractInterpreterPath,
  normaliseBinaryPath,
  quoteForShell,
} from '../../../src/services/hooks/binary-path.js';
import { entryCommands } from '../../../src/services/hooks/hook-marker.js';
import {
  buildEntry,
  hookCommand,
  installStrategyA,
} from '../../../src/services/hooks/install-strategy-a.js';

/**
 * THE COMMAND MUST NAME ITS INTERPRETER (plan 082, F008).
 *
 * MEASURED ON A WINDOWS 11 GUEST, 2026-08-10, and stated flatly because it was
 * observed rather than reasoned:
 *
 *   .js=JSFile
 *   JSFile=C:\Windows\System32\WScript.exe "%1" %*
 *
 *   A) the EXACT command hooks.json contains — bare quoted .js, real payload
 *      on stdin:  journal lines 2 -> 2, exit 0.   NEVER REACHED OUR CODE.
 *   B) identical, with `node` in front:            journal lines 2 -> 3.
 *
 * A bare `.js` path on Windows is dispatched by FILE ASSOCIATION to Windows
 * Script Host, not Node. WScript opens the file, cannot execute an ES module,
 * and EXITS 0 — so the hook looked healthy from every angle we had. Cursor's own
 * execution log recorded ~58 invocations of our hook during a real session; our
 * fires journal recorded zero. Both facts are true: something ran, and it was
 * not us.
 *
 * `binary: embedBinaryPath(process.argv[1])` is the cause, and its documented
 * rationale STAYS TRUE — the path written into a user's config is the running
 * script and no caller can supply a truthful substitute. What was wrong is the
 * conclusion: on macOS the shebang makes that path executable, on Windows it is
 * a DOCUMENT. So the invocation names the interpreter that is running us
 * (`process.execPath`) beside the script — a truthful PAIR rather than a
 * truthful single, still derived from the running process, still no PATH lookup.
 *
 * Everything asserted here runs on any platform: the emitted string is a pure
 * function of two injected paths. Windows RUNTIME behaviour is
 * EXPECTED-UNVERIFIED — these rows prove we removed the mechanism, not that the
 * fix works on the field machine.
 */

const NODE_WIN = 'C:/Program Files/nodejs/node.exe';
const SCRIPT_WIN =
  'C:/Users/ada/AppData/Roaming/npm/node_modules/harness/harness/cli/bin/harness.js';
const NODE_POSIX = '/usr/local/bin/node';
const SCRIPT_POSIX = '/usr/local/lib/node_modules/harness/harness/cli/bin/harness.js';

let home: string;
const fs = new NodeFs();
const env = () => undefined;

const spec = (agent: string) => {
  const found = findAgent(agent);
  if (found === undefined) throw new Error(`${agent} missing from the matrix`);
  return found;
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness win invocation '));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the emitted command NAMES THE INTERPRETER (row 1)', () => {
  it('puts the running node in front of the script, quoted, both parts', () => {
    /*
    Test Doc:
    - Why: the measured defect. A bare `.js` first token is handed to WScript.exe
      by file association and our code never runs. The only token that makes the
      OS dispatch to Node is Node itself.
    - Contract: the invocation is `"<node>" "<script>"`, in that order.
    */
    expect(embedInvocation(NODE_WIN, SCRIPT_WIN)).toBe(
      `"${NODE_WIN}" --no-warnings "${SCRIPT_WIN}"`,
    );
  });

  it.each([
    ['cursor — FLAT entry', 'cursor'],
    ['claude-code — NESTED entry', 'claude-code'],
    ['github-copilot — FLAT + powershell variant', 'github-copilot'],
  ])('%s: the exact command string, pinned whole', (_name, agent) => {
    /*
    Test Doc:
    - Why: the brief requires the emitted string pinned per agent for all three
      F005 entry shapes, not a regex over it. A regex that only checks "starts
      with node" would pass a command that lost the script path.
    - Contract: byte-exact.
    */
    const invocation = embedInvocation(NODE_WIN, SCRIPT_WIN);
    expect(hookCommand(invocation, agent, 'post')).toBe(
      `"${NODE_WIN}" --no-warnings "${SCRIPT_WIN}" hooks fire ${agent} --phase post --hook-input stdin --hook-owner ai-substrate-harness-hook-v1`,
    );
  });

  it.each([
    ['cursor', 'cursor', 'flat'],
    ['claude-code', 'claude-code', 'nested'],
    ['github-copilot', 'github-copilot', 'flat'],
  ])('%s: what lands ON DISK carries both parts and the JSON parses (row 2)', (_n, agent) => {
    /*
    Test Doc:
    - Why: `C:\\Program Files\\nodejs\\node.exe` contains a SPACE, and it is now
      the first token of every command we write. Quoting was already load-bearing
      for the script; it is now load-bearing twice, in one string, inside JSON.
    - Contract: the file parses, and every command of ours in it starts with the
      quoted interpreter followed by the quoted script.
    */
    const invocation = embedInvocation(NODE_WIN, SCRIPT_WIN);
    const outcomes = installStrategyA(fs, spec(agent), home, env, invocation);
    for (const outcome of outcomes) {
      const text = readFileSync(outcome.path, 'utf8');
      expect(() => JSON.parse(text) as unknown).not.toThrow();
      const commands = [...text.matchAll(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
        (m[1] as string).replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
      );
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command.startsWith(`"${NODE_WIN}" --no-warnings "${SCRIPT_WIN}" `)).toBe(true);
      }
    }
  });

  it('github-copilot POWERSHELL variant carries BOTH parts too', () => {
    /*
    Test Doc:
    - Why: the powershell field is built by slicing the binary off the front of
      the command and re-prefixing `& '<path>'` with a SINGLE extracted path. A
      two-part invocation walks straight into that arithmetic: the naive result
      invokes node with no script, or invokes the script with no interpreter —
      and it is a second command string, so the fix to the first does not reach
      it.
    - Contract: `& '<node>' --no-warnings '<script>' hooks fire …` — BOTH paths, and
      the interpreter's FLAGS too. The flags were dropped here while `command`
      carried them, so one entry held two strings that ran different commands. A
      hook's stdout is parsed by the agent, so a stray Node warning is not cosmetic,
      and it is the same defect shape as the path arithmetic above, one field over.
    */
    const invocation = embedInvocation(NODE_WIN, SCRIPT_WIN);
    const entry = buildEntry(spec('github-copilot'), invocation, 'post') as {
      command: string;
      powershell?: string;
    };
    expect(entry.powershell).toBe(
      `& '${NODE_WIN}' --no-warnings '${SCRIPT_WIN}' hooks fire github-copilot --phase post --hook-input stdin --hook-owner ai-substrate-harness-hook-v1`,
    );
  });
});

describe('`configuredBinary` is OUR SCRIPT, and the interpreter is stat`d SEPARATELY', () => {
  it('extracts the script from a two-part invocation', () => {
    /*
    Test Doc:
    - Why: `extractBinaryPath` returns the FIRST token, and `binaryState` stats
      it. Prefixing node without teaching the reader would make every status
      stat node.exe — which exists on every machine that could possibly be
      running this code. The check would report `resolves` unconditionally: a
      green light that cannot go red, which is worse than the bug it hides.
    - Contract: the SCRIPT comes back out, and the interpreter is available
      separately rather than silently discarded.
    - UPDATED (plan 084): this describe was named "status must stat OUR SCRIPT,
      NEVER the interpreter", which is now half true and would mislead. Status
      stats BOTH — `binaryResolves` is the conjunction and `interpreterResolves`
      reports the second half — because an entry whose node had moved reported
      `resolves` on a real machine while every fire died. The rule above survives
      intact and is why the two are separate fields: `configuredBinary` must stay
      the script, since a lone node stat is the green that cannot go red.
    */
    const command = hookCommand(embedInvocation(NODE_WIN, SCRIPT_WIN), 'cursor', 'post');
    expect(extractBinaryPath(command)).toBe(SCRIPT_WIN);
    expect(extractInterpreterPath(command)).toBe(NODE_WIN);
  });

  it('a ONE-PART command still extracts as before — hand-edited configs stay readable', () => {
    expect(extractBinaryPath(`"${SCRIPT_POSIX}" hooks fire cursor --phase post`)).toBe(
      SCRIPT_POSIX,
    );
    expect(extractInterpreterPath(`"${SCRIPT_POSIX}" hooks fire cursor --phase post`)).toBeNull();
  });

  it('survives a space in BOTH parts', () => {
    const node = '/opt/my tools/node';
    const script = '/opt/my tools/harness.js';
    const command = hookCommand(embedInvocation(node, script), 'cursor', 'post');
    expect(extractBinaryPath(command)).toBe(script);
    expect(extractInterpreterPath(command)).toBe(node);
  });
});

describe('ONE command form on every platform (row 5, disclosed change)', () => {
  it('POSIX emits the same interpreter-first shape', () => {
    /*
    Test Doc:
    - Why: the brief offers byte-identical POSIX output OR a single cross-platform
      form with the change disclosed. This takes the single form: an explicit
      interpreter is correct on POSIX too (no shebang reliance), and one form
      means the shape shipped to Windows users is the shape exercised by every
      macOS gate run — the divergence is what let this defect live.
    - Contract: darwin/linux emit interpreter-first, and the script is still
      recoverable, so existing status/uninstall behaviour is preserved.
    */
    const command = hookCommand(embedInvocation(NODE_POSIX, SCRIPT_POSIX), 'cursor', 'post');
    expect(command).toBe(
      `"${NODE_POSIX}" --no-warnings "${SCRIPT_POSIX}" hooks fire cursor --phase post --hook-input stdin --hook-owner ai-substrate-harness-hook-v1`,
    );
    expect(extractBinaryPath(command)).toBe(SCRIPT_POSIX);
  });
});

describe('the PRODUCTION composition, not a re-derivation (F008 review F3)', () => {
  /**
   * THE ROWS ABOVE CALL `embedInvocation` THEMSELVES, so they cannot see
   * `hooksDepsFor` ceasing to call it. A reviewer changed the composition root to
   * `embedInvocation(argv[1], argv[1])` — which collapses to the legacy bare
   * script — and every guard in this file and in the integration file passed.
   *
   * The byte-exact tables prove the FORMATTER. This proves the SOURCE: that the
   * two paths we embed are the running interpreter and the running script, taken
   * from the process rather than reconstructed.
   */
  it('names the RUNNING interpreter and the RUNNING script', () => {
    const deps = hooksDepsFor(new NodeFs(), home, { get: () => undefined });
    expect(deps).not.toBeNull();
    expect(deps?.binary).toBe(
      `${quoteForShell(normaliseBinaryPath(process.execPath))} --no-warnings ${quoteForShell(
        normaliseBinaryPath(process.argv[1] ?? 'harness'),
      )}`,
    );
    // And the two are DIFFERENT paths — the mutation that collapses the pair
    // produces a well-formed command that passes every string-shape assertion.
    expect(extractInterpreterPath(`${deps?.binary} hooks fire cursor`)).toBe(
      normaliseBinaryPath(process.execPath),
    );
    expect(extractBinaryPath(`${deps?.binary} hooks fire cursor`)).not.toBe(
      normaliseBinaryPath(process.execPath),
    );
  });
});

describe('every SUPPORTED agent, whole-string (F008 review F3)', () => {
  /**
   * The tables above covered three agents. Gemini, droid and windsurf had no
   * byte-exact row, and the on-disk assertion was a `startsWith`. Derived from
   * the matrix so a new agent cannot be added without one.
   */
  it.each(
    AGENT_MATRIX.filter((spec) => spec.supported).map((spec) => [spec.agent, spec]),
  )('%s: every command on disk equals the expected string exactly', (_name, spec) => {
    const invocation = embedInvocation(NODE_WIN, SCRIPT_WIN);
    const outcomes = installStrategyA(fs, spec, home, env, invocation);
    const seen: string[] = [];
    for (const outcome of outcomes) {
      const doc = JSON.parse(readFileSync(outcome.path, 'utf8')) as {
        hooks: Record<string, unknown[]>;
      };
      for (const entries of Object.values(doc.hooks)) {
        for (const entry of entries) seen.push(...entryCommands(entry));
      }
    }
    expect(seen.length).toBe(outcomes.length * eventKeys(spec).length);
    const expected = new Set(
      (['pre', 'post'] as const).map(
        (phase) =>
          `"${NODE_WIN}" --no-warnings "${SCRIPT_WIN}" hooks fire ${spec.agent} --phase ${phase} --hook-input stdin --hook-owner ai-substrate-harness-hook-v1`,
      ),
    );
    for (const command of seen) expect(expected.has(command)).toBe(true);
  });
});

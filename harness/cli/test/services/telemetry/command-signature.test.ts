import { describe, expect, it } from 'vitest';
import {
  commandSignature,
  commandSignatures,
  harnessSubcommand,
  partitionCommands,
} from '../../../src/services/telemetry/command-signature.js';

/**
 * The sans-params command-signature extractor (plan 034 follow-on). The
 * load-bearing claims: (1) PRIVACY — no flag value, path, quoted string, secret,
 * or message text survives; only the program + bare sub-command verbs; (2)
 * CROSS-PLATFORM — Windows `\`-paths + `.exe` and POSIX both reduce to the same
 * bare program; (3) harness invocations are split out by sub-command.
 */

describe('commandSignature — keeps program + sub-command verbs, drops all params', () => {
  it('drops flag VALUES (the classic secret carrier)', () => {
    expect(commandSignature('git commit -m "my password is hunter2"')).toBe('git commit');
    expect(commandSignature('curl -H "Authorization: Bearer sk-LEAKED" https://x')).toBe('curl');
    expect(commandSignature('npm run build')).toBe('npm run'); // 1 verb kept; script name dropped
  });

  it('drops paths, URLs, redirects, and quoted args', () => {
    expect(commandSignature('cat /Users/jordan/secrets/keys.env')).toBe('cat');
    expect(commandSignature('rg "TODO" src/services')).toBe('rg');
    expect(commandSignature('echo "SUPER_SECRET" > /tmp/x')).toBe('echo');
    expect(commandSignature('ssh user@prod-host.internal')).toBe('ssh');
  });

  it('drops a leading VAR=value env prefix but keeps the program', () => {
    expect(commandSignature('RG_CONFIG=/x/y rg foo')).toBe('rg');
    expect(commandSignature('NODE_ENV=production node server.js')).toBe('node');
  });

  it('caps the signature at program + 2 sub-command words', () => {
    expect(commandSignature('harness flow nav extra trailing args')).toBe('harness flow nav');
  });

  it('returns null when there is no plausible program (a flag/empty)', () => {
    expect(commandSignature('   ')).toBeNull();
    expect(commandSignature('--help')).toBeNull();
  });
});

describe('commandSignature — cross-platform (Windows + POSIX reduce identically)', () => {
  it('strips a Windows `\\`-directory and `.exe`/`.cmd` suffix to the bare basename', () => {
    expect(commandSignature('C:\\Users\\jordan\\tools\\harness.exe checks')).toBe('harness checks');
    expect(commandSignature('git.cmd status')).toBe('git status');
    expect(commandSignature('.\\node_modules\\.bin\\vitest.cmd run')).toBe('vitest'); // not a verb-tool → program only
  });

  it('strips a POSIX `/`-directory to the bare basename', () => {
    expect(commandSignature('/usr/local/bin/git push')).toBe('git push');
    expect(commandSignature('/Users/jordan/.npm-global/bin/harness boot')).toBe('harness boot');
  });
});

describe('commandSignatures — splits chained command lines (cross-shell)', () => {
  it('splits on &&, ||, ;, |, & and newlines', () => {
    expect(commandSignatures('harness boot && npm test')).toEqual(['harness boot', 'npm test']);
    expect(commandSignatures('cat x | grep y; ls -la')).toEqual(['cat', 'grep', 'ls']);
    expect(commandSignatures('git add . && git commit -m "x" && git push')).toEqual([
      'git add',
      'git commit',
      'git push',
    ]);
  });

  it('is empty for a blank / non-string line', () => {
    expect(commandSignatures('')).toEqual([]);
    expect(commandSignatures(undefined as unknown as string)).toEqual([]);
  });
});

describe('commandSignatures — quote/heredoc/multi-line robustness (no script-body garbage)', () => {
  it('does not split inside a quoted inline script — node -e "…" → node', () => {
    expect(commandSignatures('node -e "const x = a ; const y = b | c"')).toEqual(['node']);
    expect(commandSignatures('python3 -c "import os; print(os.getcwd())"')).toEqual(['python3']);
  });

  it('skips a heredoc body entirely', () => {
    const cmd = "python3 - <<'PY'\nimport json\nfor x in y: print(x)\no = json.load(f)\nPY";
    expect(commandSignatures(cmd)).toEqual(['python3']);
  });

  it('splits newline-separated statements but drops shell control words', () => {
    const script = 'cd repo\nif true\nthen\n  harness boot\n  echo done\nfi';
    // cd + harness boot + echo survive; if/then/fi are dropped as control words
    expect(commandSignatures(script)).toEqual(['cd', 'harness boot', 'echo']);
  });

  it('catches a harness command hidden behind cd && (real agent pattern)', () => {
    expect(commandSignatures('cd /Users/x/repo && harness checks')).toEqual(['cd', 'harness checks']);
  });
});

describe('partitionCommands — harness sub-commands vs everything else', () => {
  it('routes harness invocations (sub-command only) and bash commands separately', () => {
    const { bash, harness } = partitionCommands([
      'harness boot',
      'git status',
      'harness flow nav --to docs/x',
      'npm run build',
      'harness', // bare help — dropped (no verb)
    ]);
    expect(harness).toEqual(['boot', 'flow nav']);
    expect(bash).toEqual(['git status', 'npm run']);
  });

  it('preserves order and keeps every occurrence (no dedupe)', () => {
    const { bash, harness } = partitionCommands(['git status', 'git status', 'harness checks']);
    expect(bash).toEqual(['git status', 'git status']);
    expect(harness).toEqual(['checks']);
  });

  it('a chained line contributes each command to the right bucket', () => {
    const { bash, harness } = partitionCommands(['harness boot && git push && harness checks']);
    expect(harness).toEqual(['boot', 'checks']);
    expect(bash).toEqual(['git push']);
  });
});

describe('harnessSubcommand', () => {
  it('strips the harness prefix; null for non-harness or bare harness', () => {
    expect(harnessSubcommand('harness flow nav')).toBe('flow nav');
    expect(harnessSubcommand('git status')).toBeNull();
    expect(harnessSubcommand('harness')).toBeNull();
  });
});

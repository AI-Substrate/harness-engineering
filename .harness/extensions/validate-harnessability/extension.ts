import type { HarnessVerb, VerbContext } from '@ai-substrate/engineering-harness/contract';

/**
 * Dogfood self-test verb (plan 009, Phase G5).
 *
 * Clones a few small, public, cross-language repos to a temp dir and fires one
 * BACKGROUND, fire-and-forget `minih` agent per clone that runs the
 * `harnessability-assessment` skill against it and self-verifies the output. The
 * verb returns IMMEDIATELY with the run IDs + a runnable `next_action` script; the
 * detached agents keep running after the verb exits.
 *
 * Design is pinned by docs/plans/009-harnessability-survey/workshops/001-validate-harnessability-verb.md.
 * Guardrails honoured (Constitution + plan 031 cross-platform): no `node:*`
 * imports and NO POSIX shell-outs — all I/O via the portable contract
 * (`ctx.exec` for real repo commands, `ctx.fsWrite.mkdtemp` for the temp dir,
 * `ctx.background.spawnDetached` for the detached worker, `ctx.clock.sleep` for
 * poll waits); never throws; every non-ok result carries a `next_action`.
 */

const AGENT_SLUG = 'validate-harnessability-assessment-skill';

const DEFAULT_REPOS = [
  'https://github.com/chalk/chalk.git', // JS
  'https://github.com/BurntSushi/byteorder.git', // Rust
  'https://github.com/spf13/pflag.git', // Go
];

interface RunRecord {
  repo: string;
  url: string;
  dest: string;
  cloned: boolean;
  fired: boolean;
  runId: string | null;
  runDir: string | null;
  logPath: string;
  pid: string | null;
  error?: string;
}

/** `https://github.com/chalk/chalk.git` -> `chalk`, sanitized to a safe basename. */
function repoName(url: string): string {
  // Split on BOTH separators so a backslash Windows path still yields a clean
  // basename (plan 031 AC-06), not the whole drive path.
  const tail = (url.split(/[/\\]/).pop() ?? 'repo').replace(/\.git$/, '');
  // Keep only safe basename chars so `dest`/`logPath` can never escape tmpRoot.
  const safe = tail.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return safe || 'repo';
}

/** Newest run id for the slug, or null when there are no runs yet. */
async function lastRunId(ctx: VerbContext): Promise<string | null> {
  const r = await ctx.exec('minih', ['last-run', AGENT_SLUG]);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.stdout) as { data?: { runId?: string } };
    return j?.data?.runId ?? null;
  } catch {
    return null;
  }
}

/** Poll `minih last-run` until a run newer than `before` appears (≈3.6s cap). */
async function captureNewRun(
  ctx: VerbContext,
  before: string | null,
): Promise<{ runId: string; runDir: string | null } | null> {
  for (let i = 0; i < 12; i++) {
    const r = await ctx.exec('minih', ['last-run', AGENT_SLUG]);
    if (r.ok) {
      try {
        const j = JSON.parse(r.stdout) as { data?: { runId?: string; runDir?: string } };
        const id = j?.data?.runId ?? null;
        if (id && id !== before) {
          return { runId: id, runDir: j?.data?.runDir ?? null };
        }
      } catch {
        // not JSON yet — keep polling
      }
    }
    await ctx.clock.sleep(300);
  }
  return null;
}

const validateHarnessability: HarnessVerb = {
  name: 'validate-harnessability',
  summary:
    'Dogfood self-test: clone small cross-language repos and fire background minih agents that validate the harnessability-assessment skill on each.',
  description:
    'Clones the default repos (chalk/JS, byteorder/Rust, pflag/Go) — or --repo overrides — to a temp dir, then fires one detached, fire-and-forget `minih` agent per clone that runs the harnessability-assessment skill against it and independently verifies the output. Returns immediately with run IDs + a runnable next_action describing how to poll the runs and validate each report. The agents keep running after this verb exits.',
  options: [
    {
      flags: '--repo <urls...>',
      description: 'override the default target repos (one or more clonable URLs)',
    },
    { flags: '--keep', description: 'keep the temp clones + run dirs for inspection' },
    { flags: '--model <model>', description: 'pass-through model for `minih run -m`' },
  ],
  async run(ctx) {
    // 0a. Portable-capability guard (plan 031): needs the temp + background ports.
    if (!ctx.fsWrite || !ctx.background) {
      return ctx.error('E_CORE_TOO_OLD', 'this verb needs a newer harness core', {
        next_action:
          'Update the harness CLI (the cross-platform fsWrite/background ports landed in plan 031): run `harness update`, then re-run `harness validate-harnessability`.',
      });
    }

    // 0b. minih must be on PATH (E_MINIH_MISSING -> hard error). `minih --version`
    // resolves the `.cmd` shim on Windows via the core resolver (portable).
    const minihCheck = await ctx.exec('minih', ['--version']);
    if (!minihCheck.ok) {
      return ctx.error('E_MINIH_MISSING', 'minih is not on PATH', {
        next_action:
          'Install minih (https://github.com/AI-Substrate/minih) or fix your PATH, then re-run `harness validate-harnessability`.',
      });
    }

    // 1. Resolve targets + flags.
    const repoOpt = ctx.options.repo;
    const urls = Array.isArray(repoOpt)
      ? (repoOpt as string[])
      : typeof repoOpt === 'string'
        ? [repoOpt]
        : DEFAULT_REPOS;
    const keep = ctx.options.keep === true;
    const model = typeof ctx.options.model === 'string' ? ctx.options.model : undefined;

    // 2. Make the temp env — a UNIQUE dir under the OS temp dir via the write
    // port (portable; replaces the hard-coded temp path + its directory create).
    let tmpRoot: string;
    try {
      tmpRoot = ctx.fsWrite.mkdtemp('harnessability-selftest-');
    } catch (e) {
      return ctx.error('E_TMP', 'could not create a temp dir under the OS temp dir', {
        details: e instanceof Error ? e.message : String(e),
        next_action:
          'Check that the OS temp dir is writable, then re-run `harness validate-harnessability`.',
      });
    }

    // 3 + 4. Clone, fire (background), and capture each run's id — one repo at a time.
    const runs: RunRecord[] = [];
    const usedNames = new Set<string>();
    for (const url of urls) {
      let repo = repoName(url);
      // De-dupe so two URLs with the same tail never clone into the same dest.
      if (usedNames.has(repo)) {
        let n = 2;
        while (usedNames.has(`${repo}-${n}`)) n++;
        repo = `${repo}-${n}`;
      }
      usedNames.add(repo);
      const dest = `${tmpRoot}/${repo}`;
      const logPath = `${dest}/run.log`;
      const rec: RunRecord = {
        repo,
        url,
        dest,
        cloned: false,
        fired: false,
        runId: null,
        runDir: null,
        logPath,
        pid: null,
      };

      const clone = await ctx.exec('git', [
        'clone',
        '-c',
        'core.longpaths=true',
        '--depth=1',
        url,
        dest,
      ]);
      if (!clone.ok) {
        rec.error = `clone failed (exit ${clone.code})`;
        runs.push(rec);
        continue;
      }
      rec.cloned = true;

      const before = await lastRunId(ctx);

      // Fire the worker DETACHED via the background port (portable; replaces the
      // POSIX detached-launch shell idiom). Args travel as literal argv — never a
      // shell string — so dest/model/logPath can't be re-parsed (no injection). On
      // Windows the `minih` shim is launched via cmd.exe by the core resolver
      // (never a bare `.cmd` spawn).
      const workerArgs = [
        'run',
        AGENT_SLUG,
        '-p',
        `targetRepo=${dest}`,
        ...(model ? ['-m', model] : []),
        '--skill-source',
        'path:skills/eng-harness-setup',
        '--skill',
        'eng-harness-0-harnessability-assessment',
      ];
      try {
        const { pid } = ctx.background.spawnDetached({
          command: 'minih',
          args: workerArgs,
          cwd: ctx.cwd, // run from the repo root so `path:skills` resolves
          logPath,
        });
        rec.fired = true;
        rec.pid = pid != null ? String(pid) : null;
      } catch (e) {
        rec.error = `background fire failed: ${e instanceof Error ? e.message : String(e)}`;
        runs.push(rec);
        continue;
      }

      const captured = await captureNewRun(ctx, before);
      if (captured) {
        rec.runId = captured.runId;
        rec.runDir = captured.runDir;
      } else {
        rec.error = 'run-id capture timed out';
      }
      runs.push(rec);
    }

    // 5. Return immediately with the durable handles + the runnable prompting.
    const cloned = runs.filter((r) => r.cloned);
    const fired = runs.filter((r) => r.fired);
    const captured = runs.filter((r) => r.runId);

    const cleanup = keep
      ? `Temp kept at ${tmpRoot} (--keep).`
      : `Clean up when done: delete ${tmpRoot}`;
    const pollLines =
      `  • All:    minih status ${AGENT_SLUG}\n` +
      `  • One:    minih tail ${AGENT_SLUG} --run <runId>\n` +
      `  • Newest: minih last-run ${AGENT_SLUG}`;
    const checklist =
      'When a run shows completed, read its report (output/report.json) and validate: ' +
      '(1) verdict === PASS; ' +
      '(2) the assessment wrote .harness/reports/harnessability/latest.json AND a <ordinal>-<slug>/ run dir in the clone; ' +
      '(3) report.json validates against skills/eng-harness-setup/eng-harness-0-harnessability-assessment/templates/assessment-report.schema.json; ' +
      '(4) spot-check 2-3 evidence claims against the real tree. ' +
      'Then fold each retrospective magicWand/difficulties into plan 009 (v0.2 evidence).';

    if (cloned.length === 0) {
      return ctx.error('E_NO_CLONES', 'no target repos could be cloned', {
        details: runs.map((r) => `${r.repo}: ${r.error ?? 'unknown'}`),
        next_action: `Check the --repo URLs / network / repo visibility, then re-run. ${cleanup}`,
      });
    }

    const data = { tmpRoot, agentSlug: AGENT_SLUG, runs, keepTemp: keep };
    const baseMsg =
      `${fired.length} background agent(s) are validating the harnessability-assessment skill ` +
      `(they keep running now that this verb returned). To check progress:\n${pollLines}\n${checklist}\n${cleanup}`;

    const allClean = fired.length === urls.length && captured.length === fired.length;
    if (allClean) {
      return ctx.ok(data, { next_action: baseMsg });
    }

    const issues = runs.filter((r) => r.error).map((r) => `${r.repo}: ${r.error}`);
    return ctx.degraded(
      data,
      `${baseMsg}\nDegraded: ${issues.join('; ')}. ` +
        `For any repo with runId=null, cross-check via its run.log and \`minih history ${AGENT_SLUG}\`.`,
    );
  },
};

export default validateHarnessability;

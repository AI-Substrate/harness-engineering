import type { HarnessVerb, VerbContext } from 'harness-engineering/contract';

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
 * Guardrails honoured: no `node:*` imports; all I/O via `ctx.exec`; never throws;
 * every non-ok result carries a `next_action`.
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

/** `https://github.com/chalk/chalk.git` -> `chalk`. */
function repoName(url: string): string {
  const tail = url.split('/').pop() ?? 'repo';
  return tail.replace(/\.git$/, '') || 'repo';
}

/** ISO -> filesystem-safe (`:`/`.` -> `-`). */
function fsSafe(iso: string): string {
  return iso.replace(/[:.]/g, '-');
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
    await ctx.exec('sleep', ['0.3']);
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
    // 0. minih must be on PATH (E_MINIH_MISSING -> hard error).
    const minihCheck = await ctx.exec('bash', ['-c', 'command -v minih']);
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

    // 2. Make the temp env.
    const tmpRoot = `/tmp/harnessability-selftest-${fsSafe(ctx.clock.nowIso())}`;
    const mk = await ctx.exec('mkdir', ['-p', tmpRoot]);
    if (!mk.ok) {
      return ctx.error('E_TMP', `could not create temp dir ${tmpRoot}`, {
        details: mk.stderr,
        next_action: 'Check that /tmp is writable, then re-run `harness validate-harnessability`.',
      });
    }

    // 3 + 4. Clone, fire (background), and capture each run's id — one repo at a time.
    const runs: RunRecord[] = [];
    for (const url of urls) {
      const repo = repoName(url);
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

      const clone = await ctx.exec('git', ['clone', '--depth=1', url, dest]);
      if (!clone.ok) {
        rec.error = `clone failed (exit ${clone.code})`;
        runs.push(rec);
        continue;
      }
      rec.cloned = true;

      const before = await lastRunId(ctx);

      const modelFlag = model ? `-m ${model} ` : '';
      const fireCmd =
        `nohup minih run ${AGENT_SLUG} -p targetRepo=${dest} ${modelFlag}` +
        `--skill-source path:skills --skill harnessability-assessment > ${logPath} 2>&1 & echo $!`;
      const fire = await ctx.exec('bash', ['-c', fireCmd]);
      if (!fire.ok) {
        rec.error = `background fire failed (exit ${fire.code})`;
        runs.push(rec);
        continue;
      }
      rec.fired = true;
      rec.pid = fire.stdout.trim() || null;

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
      : `Clean up when done: rm -rf ${tmpRoot}`;
    const pollLines =
      `  • All:    minih status ${AGENT_SLUG}\n` +
      `  • One:    minih tail ${AGENT_SLUG} --run <runId>\n` +
      `  • Newest: minih last-run ${AGENT_SLUG}`;
    const checklist =
      'When a run shows completed, read its report (output/report.json) and validate: ' +
      '(1) verdict === PASS; ' +
      '(2) the assessment wrote .harness/reports/harnessability/latest.json AND a <ordinal>-<slug>/ run dir in the clone; ' +
      '(3) report.json validates against skills/harnessability-assessment/templates/assessment-report.schema.json; ' +
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

import type { HarnessVerb, VerbContext } from 'harness-engineering/contract';

/**
 * Dogfood self-test verb (plan 013): run the FULL harness setup flow on freshly
 * cloned public repos, in parallel.
 *
 * Mirrors `validate-harnessability.ts`, but each detached, fire-and-forget
 * `minih` worker (`validate-harness-flow`) drives the *entire* setup flow against
 * its clone — install → harnessability assessment → hand-written governance →
 * author + validate a `boot` extension → record a retro — and writes a structured
 * report. The verb returns IMMEDIATELY with the run IDs + a runnable `next_action`;
 * the agents keep running after it exits. A `--collect` mode (added in T007) waits
 * for the children to reach terminal states and aggregates their records + reports
 * into the plan folder.
 *
 * Guardrails (Constitution P2/P4/P5/P8): no `node:*` imports; all I/O via
 * `ctx.exec`/`ctx.fs`; never throws; every non-ok result carries a `next_action`.
 * Pinned by docs/plans/013-dogfood-harness-flow/dogfood-harness-flow-plan.md.
 */

const AGENT_SLUG = 'validate-harness-flow';

const DEFAULT_REPOS = [
  'https://github.com/expressjs/express.git', // Node
  'https://github.com/pallets/click.git', // Python
  'https://github.com/spf13/cobra.git', // Go
];

/** The skill flags every worker fires with (Finding 05 — two sources, eng-harness-0-* names). */
const SKILL_FLAGS = [
  '--skill-source',
  'path:skills/eng-harness-setup',
  '--skill-source',
  'path:skills/eng-harness-loop',
  '--skill',
  'eng-harness-0-harnessability-assessment',
  '--skill',
  'eng-harness-0-add-extension',
  '--skill',
  'eng-harness-4-retro',
];

/** Default collection sink (plan-scoped). Overridable with --out. */
const RUNS_DIR_DEFAULT = 'docs/plans/013-dogfood-harness-flow/runs';
const MANIFEST_NAME = '.last-fire.json';

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
  harnessSource: 'local' | 'github';
  error?: string;
}

interface FireManifest {
  firedAt: string;
  agentSlug: string;
  tmpRoot: string;
  keepTemp: boolean;
  runs: RunRecord[];
}

/** `https://github.com/expressjs/express.git` -> `express`, sanitized to a safe basename. */
function repoName(url: string): string {
  const tail = (url.split('/').pop() ?? 'repo').replace(/\.git$/, '');
  const safe = tail.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return safe || 'repo';
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

/** Write `content` to `path` with NO shell re-parsing of the content (argv-only). */
async function writeFile(ctx: VerbContext, path: string, content: string): Promise<boolean> {
  const r = await ctx.exec('bash', ['-c', 'printf "%s" "$2" > "$1"', 'writeFile', path, content]);
  return r.ok;
}

const validateHarnessFlow: HarnessVerb = {
  name: 'validate-harness-flow',
  summary:
    'Dogfood self-test: clone cross-language repos and fire background minih agents that run the FULL harness setup flow (assess → governance → boot → retro) on each; --collect aggregates their records.',
  description:
    'Clones the default repos (express/Node, click/Python, cobra/Go) — or --repo overrides — to a temp dir, then fires one detached, fire-and-forget `minih validate-harness-flow` worker per clone that drives the entire harness setup flow against it (install → harnessability assessment → hand-written engineering-harness.md governance → author + validate a `boot` extension → record a retro) and writes a structured report. Returns immediately with run IDs + a runnable next_action; the agents keep running after this verb exits. Re-run with --collect to wait for the children to reach terminal states and aggregate their records + reports into the plan folder.',
  options: [
    {
      flags: '--repo <urls...>',
      description: 'override the default target repos (one or more clonable URLs)',
    },
    { flags: '--keep', description: 'keep the temp clones + run dirs for inspection' },
    { flags: '--model <model>', description: 'pass-through model for `minih run -m`' },
    {
      flags: '--github',
      description: 'install the harness into each clone from github instead of the local project',
    },
    {
      flags: '--collect',
      description: 'aggregate finished workers’ records + reports into the runs/ folder',
    },
    {
      flags: '--out <dir>',
      description: `collection sink dir (default ${RUNS_DIR_DEFAULT})`,
    },
  ],
  async run(ctx) {
    // 0. minih must be on PATH (E_MINIH_MISSING -> hard error).
    const minihCheck = await ctx.exec('bash', ['-c', 'command -v minih']);
    if (!minihCheck.ok) {
      return ctx.error('E_MINIH_MISSING', 'minih is not on PATH', {
        next_action:
          'Install minih (https://github.com/AI-Substrate/minih) or fix your PATH, then re-run `harness validate-harness-flow`.',
      });
    }

    const runsDir = typeof ctx.options.out === 'string' ? ctx.options.out : RUNS_DIR_DEFAULT;

    // --collect mode lands in T007.
    if (ctx.options.collect === true) {
      return ctx.unconfigured('`--collect` is implemented in T007; run the fire path first.', {
        data: { runsDir },
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
    const harnessSource: 'local' | 'github' = ctx.options.github === true ? 'github' : 'local';

    // 2. Make the temp env.
    const tmpRoot = `/tmp/harness-flow-selftest-${fsSafe(ctx.clock.nowIso())}`;
    const mk = await ctx.exec('mkdir', ['-p', tmpRoot]);
    if (!mk.ok) {
      return ctx.error('E_TMP', `could not create temp dir ${tmpRoot}`, {
        details: mk.stderr,
        next_action: 'Check that /tmp is writable, then re-run `harness validate-harness-flow`.',
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
        harnessSource,
      };

      const clone = await ctx.exec('git', ['clone', '--depth=1', url, dest]);
      if (!clone.ok) {
        rec.error = `clone failed (exit ${clone.code})`;
        runs.push(rec);
        continue;
      }
      rec.cloned = true;

      const before = await lastRunId(ctx);

      // Fire detached WITHOUT interpolating any user-controlled value into shell
      // syntax: the script reads only `"$@"` (literal argv), so `dest`/`model`/
      // `logPath` can never be re-parsed by the shell (no injection). Param
      // contract: always `-p targetRepo=<dest>`; `--github` ⇒ `-p harnessSource=github`.
      const fireArgv = [
        '-c',
        'log="$1"; shift; nohup "$@" > "$log" 2>&1 & echo $!',
        'validate-harness-flow', // $0 label
        logPath, // $1 -> log (then shifted away)
        'minih',
        'run',
        AGENT_SLUG,
        '-p',
        `targetRepo=${dest}`,
        ...(harnessSource === 'github' ? ['-p', 'harnessSource=github'] : []),
        ...(model ? ['-m', model] : []),
        ...SKILL_FLAGS,
      ];
      const fire = await ctx.exec('bash', fireArgv);
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

    // 5. Persist a manifest so `--collect` (a later invocation) can find these runs.
    const cloned = runs.filter((r) => r.cloned);
    const fired = runs.filter((r) => r.fired);
    const captured = runs.filter((r) => r.runId);

    const manifest: FireManifest = {
      firedAt: ctx.clock.nowIso(),
      agentSlug: AGENT_SLUG,
      tmpRoot,
      keepTemp: keep,
      runs,
    };
    let manifestPath: string | null = `${runsDir}/${MANIFEST_NAME}`;
    const mkRuns = await ctx.exec('mkdir', ['-p', runsDir]);
    if (mkRuns.ok) {
      const wrote = await writeFile(ctx, manifestPath, JSON.stringify(manifest, null, 2));
      if (!wrote) manifestPath = null;
    } else {
      manifestPath = null;
    }

    // 6. Return immediately with the durable handles + the runnable prompting.
    const cleanup = keep
      ? `Temp kept at ${tmpRoot} (--keep).`
      : `Clean up when done: rm -rf ${tmpRoot}`;
    const pollLines =
      `  • All:    minih status ${AGENT_SLUG}\n` +
      `  • One:    minih tail ${AGENT_SLUG} --run <runId>\n` +
      `  • Newest: minih last-run ${AGENT_SLUG}`;
    const collectHint =
      `When the runs show completed, aggregate them:\n` +
      `  harness validate-harness-flow --collect\n` +
      `That waits for each worker to reach a terminal state, then copies its records + report into ${runsDir}/<repo>/ and writes ${runsDir}/ROLLUP.md. ` +
      `Retros are SURFACED, never auto-implemented.`;

    if (cloned.length === 0) {
      return ctx.error('E_NO_CLONES', 'no target repos could be cloned', {
        details: runs.map((r) => `${r.repo}: ${r.error ?? 'unknown'}`),
        next_action: `Check the --repo URLs / network / repo visibility, then re-run. ${cleanup}`,
      });
    }

    const data = {
      tmpRoot,
      agentSlug: AGENT_SLUG,
      harnessSource,
      runs,
      keepTemp: keep,
      manifestPath,
      runsDir,
    };
    const baseMsg =
      `${fired.length} background worker(s) are running the full harness setup flow ` +
      `(they keep running now that this verb returned). To check progress:\n${pollLines}\n${collectHint}\n${cleanup}`;

    const allClean =
      fired.length === urls.length && captured.length === fired.length && manifestPath !== null;
    if (allClean) {
      return ctx.ok(data, { next_action: baseMsg });
    }

    const issues = runs.filter((r) => r.error).map((r) => `${r.repo}: ${r.error}`);
    if (manifestPath === null) issues.push('manifest write failed (--collect cannot auto-discover runs)');
    return ctx.degraded(
      data,
      `${baseMsg}\nDegraded: ${issues.join('; ')}. ` +
        `For any repo with runId=null, cross-check via its run.log and \`minih history ${AGENT_SLUG}\`.`,
    );
  },
};

export default validateHarnessFlow;

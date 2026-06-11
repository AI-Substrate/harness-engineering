import type { HarnessVerb, VerbContext, VerbResult } from '@ai-substrate/engineering-harness/contract';
// Package-internal helpers (plan 014 T012 split — proves AC-14 in production).
import { captureNewRun, copyInto, lastRunId, readJson, writeFile } from './lib/worker-io.ts';

/**
 * Dogfood self-test verb (plan 013, regeared by FX004): prove the harness's
 * ONBOARDING experience on freshly cloned public repos, in parallel.
 *
 * Mirrors `validate-harnessability.ts`, but each detached, fire-and-forget
 * `minih` worker (`validate-harness-flow`) gets a goal brief — not a runbook:
 * "this clone has no harness; using the product's own README, docs, and
 * installed skills, set up a working engineering harness, prove it works, and
 * record your experience" — and writes a structured report. The verb returns
 * IMMEDIATELY with the run IDs + a runnable `next_action`; the agents keep
 * running after it exits. A `--collect` mode waits for the children to reach
 * terminal states, aggregates their records + reports into the plan folder,
 * and grades each DONE clone with deterministic probes (FX004-5) — the worker
 * self-report stays as an advisory cross-check, discrepancies flagged.
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

/**
 * The skill flags every worker fires with — the FULL installed surface, parity
 * with `.minih.json` `include` (FX004-4). The interactive router is mounted for
 * realism; the worker-rules rail covers the don't-drive-it-headless hazard.
 */
const SKILL_FLAGS = [
  '--skill-source',
  'path:skills/eng-harness-setup',
  '--skill-source',
  'path:skills/eng-harness-loop',
  '--skill',
  'eng-harness-0-adopt',
  '--skill',
  'eng-harness-0-harnessability-assessment',
  '--skill',
  'eng-harness-0-add-extension',
  '--skill',
  'eng-harness-1-boot',
  '--skill',
  'eng-harness-2-backpressure',
  '--skill',
  'eng-harness-4-retro',
  '--skill',
  'eng-harness-flow',
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

type CollectState = 'DONE' | 'TIMED_OUT' | 'MISSING_REPORT' | 'NOT_FIRED';
const TERMINAL_VERDICTS = new Set(['PASS', 'FAIL', 'ABANDONED']);

interface WorkerReport {
  targetRepo?: string;
  harnessabilityGrade?: string | null;
  axisTuple?: {
    operateTodayPercent?: number;
    operateTodayGrade?: string;
    adaptabilityPercent?: number;
    adaptabilityGrade?: string;
  };
  abandoned?: boolean;
  abandonReason?: string | null;
  bootAuthored?: boolean;
  bootRuns?: boolean;
  retroRecorded?: boolean;
  retroRecordPaths?: string[];
  verdict?: string;
  summary?: string;
  retrospective?: {
    workedWell?: string;
    confusing?: string;
    magicWand?: string;
    magicWandTarget?: string;
    difficulties?: Array<{ id?: string; layer?: string; category?: string; description?: string }>;
  };
}

interface CollectResult {
  repo: string;
  runId: string | null;
  runDir: string | null;
  dest: string;
  state: CollectState;
  reportPath: string | null;
  report: WorkerReport | null;
  copied: string[];
  probes: CloneProbes | null;
}

/** One deterministic probe outcome. `na` = not applicable for this run's state. */
interface ProbeOutcome {
  v: 'pass' | 'fail' | 'na';
  note?: string;
}

/**
 * Deterministic probes run by `--collect` against each DONE clone (FX004-5).
 * Graded probes check the CLONE, not the worker's claims; the observe counts
 * are INFO only (we watch how workers discover the capture verb before grading
 * discovery). Probe-vs-self-report disagreements on `bootRuns` /
 * `retroRecorded` land in `discrepancies` — drift data for a future verdict
 * inversion, no verdict change in this fix.
 */
interface CloneProbes {
  assessment: ProbeOutcome;
  doctor: ProbeOutcome;
  boot: ProbeOutcome;
  retro: ProbeOutcome;
  drained: ProbeOutcome;
  tempIgnore: ProbeOutcome;
  tempClean: ProbeOutcome;
  skillsLocal: ProbeOutcome;
  /** INFO, not graded. */
  observePending: number | null;
  observeRecorded: number;
  discrepancies: string[];
}

const NA: ProbeOutcome = { v: 'na' };

/** Project-local skills dirs the installer targets (per `-a`/CLI target). */
const LOCAL_SKILL_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.cursor/skills',
  '.github/skills',
  '.opencode/skills',
  '.pi/skills',
];

/** Parse a CLI `--json` Envelope from stdout; null when it isn't one. */
function parseEnvelope(
  stdout: string,
): { command?: string; status?: string; next_action?: string; data?: unknown } | null {
  try {
    const j: unknown = JSON.parse(stdout);
    return j && typeof j === 'object'
      ? (j as { command?: string; status?: string; next_action?: string; data?: unknown })
      : null;
  } catch {
    return null;
  }
}

/** Every retro-record .md under `.harness/records/retro` (flat + one dated level). */
function retroRecordFiles(ctx: VerbContext, dest: string): string[] {
  const root = `${dest}/.harness/records/retro`;
  if (!ctx.fs.exists(root)) return [];
  const out: string[] = [];
  for (const name of ctx.fs.readdir(root)) {
    if (name.endsWith('.md')) {
      out.push(`${root}/${name}`);
      continue;
    }
    for (const inner of ctx.fs.readdir(`${root}/${name}`)) {
      if (inner.endsWith('.md')) out.push(`${root}/${name}/${inner}`);
    }
  }
  return out;
}

/** True when the file opens with a closed `---` frontmatter block. */
function hasFrontmatter(text: string | null): boolean {
  if (!text || !text.startsWith('---')) return false;
  return text.indexOf('\n---', 3) > 0;
}

/**
 * Run the deterministic probes against one DONE clone. Applicability per
 * terminal verdict: PASS/FAIL ⇒ full probes; ABANDONED ⇒ assessment-exists
 * only (the worker is *supposed* to stop there). Non-DONE states never reach
 * this function — their probes render `—` in the rollup.
 */
async function probeClone(
  ctx: VerbContext,
  dest: string,
  report: WorkerReport,
): Promise<CloneProbes> {
  const probes: CloneProbes = {
    assessment: NA,
    doctor: NA,
    boot: NA,
    retro: NA,
    drained: NA,
    tempIgnore: NA,
    tempClean: NA,
    skillsLocal: NA,
    observePending: null,
    observeRecorded: 0,
    discrepancies: [],
  };

  if (!ctx.fs.exists(dest)) {
    probes.assessment = { v: 'na', note: 'clone missing (temp cleaned?) — probes skipped' };
    return probes;
  }

  // Assessment left a report? (the only probe an ABANDONED run is graded on.)
  const assessDir = `${dest}/.harness/reports/harnessability`;
  const assessFiles = ctx.fs.exists(assessDir) ? ctx.fs.readdir(assessDir) : [];
  probes.assessment =
    assessFiles.length > 0
      ? { v: 'pass' }
      : { v: 'fail', note: 'no assessment report in the clone' };

  if (report.verdict === 'ABANDONED') return probes;

  const bin = `${dest}/node_modules/.bin/harness`;
  const cliInstalled = ctx.fs.exists(bin);
  const noCli: ProbeOutcome = { v: 'fail', note: 'harness CLI not installed in the clone' };

  // doctor --json parses + conventions clean (incl. the 015 temp-hygiene check).
  if (!cliInstalled) {
    probes.doctor = noCli;
  } else {
    const r = await ctx.exec(bin, ['doctor', '--json'], { cwd: dest });
    const env = parseEnvelope(r.stdout);
    const conventions = (env?.data as { conventions?: unknown[] } | undefined)?.conventions;
    if (!env) probes.doctor = { v: 'fail', note: 'doctor --json did not parse' };
    else if (!Array.isArray(conventions))
      probes.doctor = { v: 'fail', note: 'no conventions report in the doctor envelope' };
    else
      probes.doctor =
        conventions.length === 0
          ? { v: 'pass' }
          : { v: 'fail', note: `${conventions.length} convention complaint(s)` };
  }

  // A boot verb exists + its envelope is honest (status/exit legal, next_action on non-ok).
  if (!cliInstalled) {
    probes.boot = noCli;
  } else {
    const r = await ctx.exec(bin, ['boot', '--json'], { cwd: dest });
    const env = parseEnvelope(r.stdout);
    if (!env || typeof env.status !== 'string') {
      probes.boot = { v: 'fail', note: `boot --json returned no envelope (exit ${r.code})` };
    } else if (env.command !== 'boot') {
      // An unknown-verb error envelope is stamped `command: "harness"` — a real
      // boot run stamps its own name. No boot verb ⇒ fail, however honest E108 is.
      probes.boot = { v: 'fail', note: 'no boot verb in the clone' };
    } else {
      const hasNext = typeof env.next_action === 'string' && env.next_action.length > 0;
      const legal =
        (env.status === 'ok' && r.code === 0) ||
        (env.status === 'degraded' && r.code === 0 && hasNext) ||
        (env.status === 'unconfigured' && r.code === 2 && hasNext) ||
        (env.status === 'error' && r.code === 1 && hasNext);
      probes.boot = legal
        ? { v: 'pass', note: `${env.status}/exit ${r.code}` }
        : {
            v: 'fail',
            note: `illegal pair ${env.status}/exit ${r.code}${hasNext ? '' : ', no next_action'}`,
          };
    }
  }

  // A retro record exists with parseable frontmatter; count entries as INFO.
  const records = retroRecordFiles(ctx, dest);
  const withFm = records.filter((p) => hasFrontmatter(ctx.fs.readText(p)));
  probes.retro =
    withFm.length > 0
      ? { v: 'pass', note: `${withFm.length} record(s)` }
      : { v: 'fail', note: records.length > 0 ? 'records lack frontmatter' : 'no retro records' };
  for (const p of withFm) {
    probes.observeRecorded += ((ctx.fs.readText(p) ?? '').match(/^\s+- id:/gm) ?? []).length;
  }

  // Observe buffer drained (0 pending) — pending count rides along as INFO.
  if (!cliInstalled) {
    probes.drained = noCli;
  } else {
    const r = await ctx.exec(bin, ['observe', '--list', '--json'], { cwd: dest });
    const env = parseEnvelope(r.stdout);
    const obs = (env?.data as { observations?: unknown[] } | undefined)?.observations;
    if (Array.isArray(obs)) {
      probes.observePending = obs.length;
      probes.drained =
        obs.length === 0 ? { v: 'pass' } : { v: 'fail', note: `${obs.length} pending undrained` };
    } else if (env && typeof env.status === 'string') {
      probes.drained = { v: 'fail', note: `observe --list returned ${env.status} (no list)` };
    } else {
      probes.drained = { v: 'fail', note: 'observe --list --json did not parse' };
    }
  }

  // temp/.gitignore intact (when temp exists) + no temp residue in git status.
  const tempDir = `${dest}/.harness/temp`;
  if (!ctx.fs.exists(tempDir)) {
    probes.tempIgnore = { v: 'pass', note: 'no temp dir' };
  } else {
    const gi = ctx.fs.readText(`${tempDir}/.gitignore`);
    probes.tempIgnore = gi?.includes('*')
      ? { v: 'pass' }
      : { v: 'fail', note: 'temp/.gitignore missing or not ignoring' };
  }
  const st = await ctx.exec('git', ['status', '--porcelain'], { cwd: dest });
  probes.tempClean = !st.ok
    ? { v: 'fail', note: 'git status failed' }
    : st.stdout.includes('.harness/temp')
      ? { v: 'fail', note: '.harness/temp appears in git status' }
      : { v: 'pass' };

  // Skills installed PROJECT-LOCAL in the clone (the minih mount does not count).
  let skillsNote = 'no project-local eng-harness-* skills (the minih mount does not count)';
  let skillsPass = false;
  for (const dir of LOCAL_SKILL_DIRS) {
    const full = `${dest}/${dir}`;
    if (!ctx.fs.exists(full)) continue;
    const entries = ctx.fs.readdir(full);
    const setup = entries.filter((e) => e.startsWith('eng-harness-0-'));
    const loop = entries.filter(
      (e) => e.startsWith('eng-harness-') && !e.startsWith('eng-harness-0-'),
    );
    if (setup.length > 0 && loop.length > 0) {
      skillsPass = true;
      skillsNote = `${dir}: ${setup.length} setup + ${loop.length} loop`;
      break;
    }
    if (entries.some((e) => e.startsWith('eng-harness-'))) {
      skillsNote = `${dir}: one group only`;
    }
  }
  probes.skillsLocal = { v: skillsPass ? 'pass' : 'fail', note: skillsNote };

  // Probe-vs-self-report cross-check (advisory — flagged, never verdict-changing).
  const cross: Array<[string, boolean | undefined, ProbeOutcome]> = [
    ['bootRuns', report.bootRuns, probes.boot],
    ['retroRecorded', report.retroRecorded, probes.retro],
  ];
  for (const [field, claimed, probe] of cross) {
    if (probe.v === 'na' || typeof claimed !== 'boolean') continue;
    const proven = probe.v === 'pass';
    if (claimed !== proven) {
      probes.discrepancies.push(
        `worker reported \`${field}: ${claimed}\` but the probe says ${proven ? 'pass' : `fail (${probe.note ?? 'no detail'})`}`,
      );
    }
  }
  return probes;
}

/** True when the run reached a minih terminal state (a `completed.json` was written). */
function runTerminated(ctx: VerbContext, runDir: string | null): boolean {
  if (!runDir) return false;
  return ctx.fs.exists(`${runDir}/completed.json`) || ctx.fs.exists(`${runDir}/failed.json`);
}

/** Read a worker's report.json if present + terminal-verdict; else null. */
function readWorkerReport(
  ctx: VerbContext,
  runDir: string | null,
): { path: string; report: WorkerReport } | null {
  if (!runDir) return null;
  const path = `${runDir}/output/report.json`;
  const report = readJson<WorkerReport>(ctx, path);
  if (report && typeof report.verdict === 'string' && TERMINAL_VERDICTS.has(report.verdict)) {
    return { path, report };
  }
  return null;
}

/**
 * `--collect`: wait for each fired worker to reach a terminal state, classify it
 * (DONE / TIMED_OUT / MISSING_REPORT / NOT_FIRED), copy each DONE child's records +
 * reports into `<runsDir>/<repo>/`, and write `<runsDir>/ROLLUP.md`. Idempotent;
 * reads child records (never mutates them). Retros are SURFACED, never applied.
 */
async function runCollect(ctx: VerbContext, runsDir: string): Promise<VerbResult> {
  const manifestPath = `${runsDir}/${MANIFEST_NAME}`;
  const manifest = readJson<FireManifest>(ctx, manifestPath);
  if (!manifest || !Array.isArray(manifest.runs) || manifest.runs.length === 0) {
    return ctx.unconfigured(
      `No fire manifest at ${manifestPath}. Run \`harness validate-harness-flow\` first to fire the workers, then \`--collect\`.`,
    );
  }

  const waitSeconds =
    typeof ctx.options.wait === 'string' ? Math.max(0, parseInt(ctx.options.wait, 10) || 0) : 120;
  const pollEveryMs = 5;
  const maxPolls = Math.max(1, Math.ceil((waitSeconds * 1000) / (pollEveryMs * 1000)) || 1);

  // Poll all runs to terminal (early-exit when none are still pending), up to the cap.
  const pending = new Set(manifest.runs.filter((r) => r.runId && r.runDir).map((r) => r.repo));
  for (let poll = 0; poll < maxPolls && pending.size > 0; poll++) {
    for (const r of manifest.runs) {
      if (!pending.has(r.repo)) continue;
      if (readWorkerReport(ctx, r.runDir) || runTerminated(ctx, r.runDir)) {
        pending.delete(r.repo);
      }
    }
    if (pending.size > 0) await ctx.exec('sleep', [String(pollEveryMs)]);
  }

  // Classify + copy.
  const results: CollectResult[] = [];
  for (const r of manifest.runs) {
    const res: CollectResult = {
      repo: r.repo,
      runId: r.runId,
      runDir: r.runDir,
      dest: r.dest,
      state: 'NOT_FIRED',
      reportPath: null,
      report: null,
      copied: [],
      probes: null,
    };

    if (!r.runId || !r.runDir) {
      results.push(res);
      continue;
    }

    const found = readWorkerReport(ctx, r.runDir);
    if (found) {
      res.state = 'DONE';
      res.reportPath = found.path;
      res.report = found.report;
    } else if (runTerminated(ctx, r.runDir)) {
      res.state = 'MISSING_REPORT';
    } else {
      res.state = 'TIMED_OUT';
    }

    if (res.state === 'DONE') {
      const destDir = `${runsDir}/${r.repo}`;
      // (1) the worker report
      if (res.reportPath && (await copyInto(ctx, res.reportPath, destDir))) {
        res.copied.push('report.json');
      }
      // (2) the harnessability report (from the clone)
      for (const f of ['latest.md', 'latest.json']) {
        const src = `${r.dest}/.harness/reports/harnessability/${f}`;
        if (await copyInto(ctx, src, destDir)) res.copied.push(`harnessability/${f}`);
      }
      // (3) every retro the worker recorded (from the clone). `harness record
      // retro` writes dated subdirectories (.harness/records/retro/<YYYY-MM-DD>/
      // <ord>-<slug>.md), so walk one level of subdirs as well as any flat .md
      // (companion F003) — keeping the date segment so filenames never collide.
      const retroDir = `${r.dest}/.harness/records/retro`;
      if (ctx.fs.exists(retroDir)) {
        for (const name of ctx.fs.readdir(retroDir)) {
          if (name.endsWith('.md')) {
            if (await copyInto(ctx, `${retroDir}/${name}`, `${destDir}/retro`)) {
              res.copied.push(`retro/${name}`);
            }
            continue;
          }
          // A dated subdir (readdir on a file returns [] — harmless skip).
          for (const inner of ctx.fs.readdir(`${retroDir}/${name}`)) {
            if (!inner.endsWith('.md')) continue;
            if (await copyInto(ctx, `${retroDir}/${name}/${inner}`, `${destDir}/retro/${name}`)) {
              res.copied.push(`retro/${name}/${inner}`);
            }
          }
        }
      }
      // (4) deterministic probes against the clone (FX004-5) — DONE runs only;
      // ABANDONED reports get the assessment probe alone inside probeClone.
      if (res.report) res.probes = await probeClone(ctx, r.dest, res.report);
    }
    results.push(res);
  }

  // Roll up + write.
  const rollup = buildRollup(ctx, manifest, results);
  const rollupPath = `${runsDir}/ROLLUP.md`;
  await ctx.exec('mkdir', ['-p', runsDir]);
  const wroteRollup = await writeFile(ctx, rollupPath, rollup);

  const counts = tally(results);
  const data = { runsDir, rollupPath: wroteRollup ? rollupPath : null, counts, results };
  const stillPending = counts.TIMED_OUT;
  const next_action =
    `Aggregated ${results.length} run(s) into ${runsDir}/ (see ROLLUP.md). ` +
    (stillPending > 0
      ? `${stillPending} run(s) are still in flight — re-run \`harness validate-harness-flow --collect\` later to pick them up. `
      : '') +
    `The collected magic-wand / difficulty notes are SURFACED for your review — nothing is auto-implemented.`;

  if (counts.DONE === 0) {
    return ctx.degraded(data, next_action);
  }
  return ctx.ok(data, { next_action });
}

function tally(results: CollectResult[]): Record<CollectState, number> {
  const t: Record<CollectState, number> = { DONE: 0, TIMED_OUT: 0, MISSING_REPORT: 0, NOT_FIRED: 0 };
  for (const r of results) t[r.state]++;
  return t;
}

/** Build the human-readable ROLLUP.md (a table + merged magic-wand / difficulty clusters). */
function buildRollup(
  ctx: VerbContext,
  manifest: FireManifest,
  results: CollectResult[],
): string {
  const counts = tally(results);
  const lines: string[] = [];
  lines.push('# validate-harness-flow — Run Rollup');
  lines.push('');
  lines.push(`**Collected**: ${ctx.clock.nowIso()}  ·  **Fired**: ${manifest.firedAt}`);
  lines.push(`**Agent**: ${manifest.agentSlug}  ·  **Temp root**: ${manifest.tmpRoot}`);
  lines.push('');
  lines.push(
    `**Totals**: DONE ${counts.DONE} · TIMED_OUT ${counts.TIMED_OUT} · MISSING_REPORT ${counts.MISSING_REPORT} · NOT_FIRED ${counts.NOT_FIRED}`,
  );
  lines.push('');
  lines.push(
    '> Retros + magic-wands below are **surfaced for review, never auto-implemented**. The only corrective change a dogfood run is *permitted* to make is repairing a broken record-write path (none was needed here unless noted).',
  );
  lines.push('');
  lines.push('## Runs');
  lines.push('');
  lines.push('| Repo | State | Verdict | Grade | Operate/Adapt | Abandoned | Boot | Retro | Copied |');
  lines.push('|------|-------|---------|-------|---------------|-----------|------|-------|--------|');
  for (const r of results) {
    const rep = r.report;
    const grade = rep?.harnessabilityGrade ?? '—';
    const axis = rep?.axisTuple
      ? `${rep.axisTuple.operateTodayGrade ?? '?'}/${rep.axisTuple.adaptabilityGrade ?? '?'}`
      : '—';
    const verdict = rep?.verdict ?? '—';
    const abandoned = rep?.abandoned ? `yes${rep.abandonReason ? ` (${rep.abandonReason})` : ''}` : 'no';
    const boot = rep ? (rep.bootAuthored && rep.bootRuns ? '✓' : rep.bootAuthored ? '~' : '✗') : '—';
    const retro = rep ? (rep.retroRecorded ? '✓' : '✗') : '—';
    lines.push(
      `| ${r.repo} | ${r.state} | ${verdict} | ${grade} | ${axis} | ${abandoned} | ${boot} | ${retro} | ${r.copied.length} files |`,
    );
  }
  lines.push('');

  // The deterministic probes table (FX004-5). Boot/Retro above are the worker's
  // CLAIMS; the table below is what the clone PROVES.
  lines.push('## Probes (deterministic, per clone)');
  lines.push('');
  lines.push(
    "> Probes grade the **clone**, not the worker's claims. **Skills local** is graded because the clone must stand alone — the next agent that opens it gets the `eng-harness-*` skills project-local (the minih mount does not count). **Observe** is INFO, not graded — we watch how workers discover the capture verb before grading discovery. A Skills-local ✗ can be **mount-suppression** (the worker never *needed* a project-local install because minih mounted the skills) rather than a product failure — read the worker retrospective to tell them apart. Applicability: PASS/FAIL runs get full probes; ABANDONED runs are graded on Assessed only; TIMED_OUT / MISSING_REPORT / NOT_FIRED render `—`.",
  );
  lines.push('');
  lines.push(
    '| Repo | Assessed | Doctor | Boot env | Retro rec | Drained | Temp ignore | Temp clean | Skills local | Observe (INFO) |',
  );
  lines.push(
    '|------|----------|--------|----------|-----------|---------|-------------|------------|--------------|----------------|',
  );
  const mark = (p?: ProbeOutcome) => (!p || p.v === 'na' ? '—' : p.v === 'pass' ? '✓' : '✗');
  for (const r of results) {
    const p = r.probes;
    const info =
      p && p.observePending !== null
        ? `${p.observePending} pending / ${p.observeRecorded} recorded`
        : '—';
    lines.push(
      `| ${r.repo} | ${mark(p?.assessment)} | ${mark(p?.doctor)} | ${mark(p?.boot)} | ${mark(p?.retro)} | ${mark(p?.drained)} | ${mark(p?.tempIgnore)} | ${mark(p?.tempClean)} | ${mark(p?.skillsLocal)} | ${info} |`,
    );
  }
  lines.push('');
  const noteRows: string[] = [];
  for (const r of results) {
    const p = r.probes;
    if (!p) continue;
    const named: Array<[string, ProbeOutcome]> = [
      ['assessed', p.assessment],
      ['doctor', p.doctor],
      ['boot', p.boot],
      ['retro', p.retro],
      ['drained', p.drained],
      ['temp-ignore', p.tempIgnore],
      ['temp-clean', p.tempClean],
      ['skills-local', p.skillsLocal],
    ];
    for (const [name, o] of named) {
      if (o.v === 'fail') noteRows.push(`- **${r.repo}** ${name} ✗ — ${o.note ?? 'no detail'}`);
    }
  }
  if (noteRows.length > 0) {
    lines.push(noteRows.join('\n'));
    lines.push('');
  }

  lines.push('### ⚠️ Probe vs self-report discrepancies');
  lines.push('');
  const flags = results.flatMap((r) =>
    (r.probes?.discrepancies ?? []).map((d) => `- **${r.repo}**: ${d}`),
  );
  lines.push(flags.length > 0 ? flags.join('\n') : '_None — self-reports and probes agree._');
  lines.push('');

  // Merged magic-wand wishes.
  const wands = results
    .filter((r) => r.report?.retrospective?.magicWand)
    .map(
      (r) =>
        `- **${r.repo}** (${r.report?.retrospective?.magicWandTarget ?? 'project'}): ${r.report?.retrospective?.magicWand}`,
    );
  lines.push('## Magic-wand wishes (surfaced)');
  lines.push('');
  lines.push(wands.length ? wands.join('\n') : '_None recorded._');
  lines.push('');

  // Merged difficulties, grouped by layer.
  lines.push('## Difficulties (surfaced)');
  lines.push('');
  const byLayer: Record<string, string[]> = {};
  for (const r of results) {
    for (const d of r.report?.retrospective?.difficulties ?? []) {
      const layer = d.layer ?? 'project';
      (byLayer[layer] ??= []).push(
        `- **${r.repo}** \`${d.id ?? '?'}\`${d.category ? ` [${d.category}]` : ''}: ${d.description ?? ''}`,
      );
    }
  }
  const layers = Object.keys(byLayer);
  if (layers.length === 0) {
    lines.push('_None recorded._');
  } else {
    for (const layer of layers.sort()) {
      lines.push(`### ${layer}`);
      lines.push('');
      lines.push(byLayer[layer].join('\n'));
      lines.push('');
    }
  }
  lines.push('');
  lines.push('## Per-run artifacts');
  lines.push('');
  for (const r of results) {
    if (r.copied.length === 0) continue;
    lines.push(`- **${r.repo}/** — ${r.copied.join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

const validateHarnessFlow: HarnessVerb = {
  name: 'validate-harness-flow',
  summary:
    'Dogfood self-test: clone cross-language repos and fire goal-briefed minih workers that must onboard the harness via the product’s own README/docs/skills; --collect aggregates records and grades each clone with deterministic probes.',
  description:
    'Clones the default repos (express/Node, click/Python, cobra/Go) — or --repo overrides — to a temp dir, then fires one detached, fire-and-forget `minih validate-harness-flow` worker per clone. Each worker gets a goal brief, not a runbook: set up a working engineering harness in the clone using the product’s own documentation and installed skills, prove it works, and report. Returns immediately with run IDs + a runnable next_action; the agents keep running after this verb exits. Re-run with --collect to wait for the children to reach terminal states, aggregate their records + reports into the plan folder, and grade each DONE clone with deterministic probes (doctor conventions, boot envelope honesty, retro records, observe drain, temp hygiene, project-local skills install) — the worker self-report stays as an advisory cross-check with discrepancies flagged.',
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
      flags: '--wait <seconds>',
      description: 'with --collect: max seconds to poll workers to a terminal state (default 120)',
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

    // --collect mode: wait for terminal children, classify, copy records, write ROLLUP.
    if (ctx.options.collect === true) {
      return runCollect(ctx, runsDir);
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

      const before = await lastRunId(ctx, AGENT_SLUG);

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

      const captured = await captureNewRun(ctx, AGENT_SLUG, before);
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

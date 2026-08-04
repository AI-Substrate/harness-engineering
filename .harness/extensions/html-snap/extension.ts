import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';
import { checkStructure } from './html-structure.js';
import {
  chromeArgs,
  cropArgs,
  resolveChrome,
  slicePlan,
  validateParams,
  verifyOutput,
  type SnapParams,
} from './snap-core.js';

/**
 * `harness html-snap` — render any HTML file in a real headless browser and
 * save PNG snapshot(s): the full page, one cropped region at an offset, or N
 * even slices. Built for agent review loops: a subagent snaps a page it (or
 * another agent) authored, reads the images, and describes what a human would
 * see — no live browser session, no MCP, no new dependency.
 *
 * Determinism posture: `--force-prefers-reduced-motion` is always passed, so
 * pages that settle animations under reduced motion (e.g. the --p/window beat
 * engine) render their FINISHED frames; `--virtual-time-budget` gives scripts
 * a bounded, repeatable slice of virtual time.
 *
 * Guardrails: no node:* imports; all I/O via ctx.exec/ctx.fs/ctx.fsWrite;
 * never throws; every non-ok result names its next action. No hard-coded
 * browser path: env override → probe ladder → loud failure (see snap-core).
 */

const num = (v: unknown, dflt: number): number =>
  v === undefined ? dflt : Number.parseInt(String(v), 10);

const htmlSnap: HarnessVerb = {
  name: 'html-snap',
  summary:
    'Screenshot any HTML file via headless system Chrome: full page, a crop at an offset, or N slices (agent-reviewable PNGs, reduced-motion settled).',
  description:
    'Renders file://<abs> in system Chrome (env HTML_SNAP_CHROME overrides; otherwise a probed candidate list — never a ' +
    'hard-coded path) at --width x --page-height with forced reduced motion, then optionally crops (--offset + --crop-height) ' +
    'or slices (--slices N) via sips (macOS) or ImageMagick (linux). A missing browser, a missing file, an out-of-range crop, ' +
    'or an empty render each FAIL loudly — a skip that looks like a pass would poison the review the image exists to serve.',
  options: [
    { flags: '--file <path>', description: 'HTML file to render (required)' },
    { flags: '--out <path>', description: 'output PNG (default .harness/temp/html-snap/<name>-<stamp>.png; slices append -1..N)' },
    { flags: '--width <px>', description: 'viewport width', defaultValue: '1440' },
    { flags: '--page-height <px>', description: 'rendered page height (window height)', defaultValue: '14000' },
    { flags: '--offset <px>', description: 'crop start Y (needs --crop-height)', defaultValue: '0' },
    { flags: '--crop-height <px>', description: 'crop height (0 = no crop)', defaultValue: '0' },
    { flags: '--slices <n>', description: 'split the page into N even bands (exclusive with crop)', defaultValue: '0' },
    { flags: '--delay-ms <ms>', description: 'virtual-time budget before capture', defaultValue: '1200' },
    { flags: '--structure', description: 'parse the HTML instead of rendering it: verify tag nesting (browsers error-recover broken markup, so screenshots CANNOT catch this)' },
  ],
  async run(ctx) {
    try {
      const file = ctx.options.file === undefined ? undefined : String(ctx.options.file);
      if (!file) {
        return ctx.error('HTML_SNAP_USAGE', 'html-snap needs --file <path.html>.', {
          next_action: 'Re-run with --file <path to the HTML to snapshot>.',
        });
      }
      const abs = ctx.fs.realpath(file);
      if (abs === null) {
        return ctx.error('HTML_SNAP_FILE_MISSING', `--file not found: ${file}`, {
          next_action: `Check the path (resolved against ${ctx.cwd}); pass an existing .html file.`,
        });
      }

      if (ctx.options.structure) {
        const html = ctx.fs.readText(abs);
        if (html === null) {
          return ctx.error('HTML_SNAP_FILE_MISSING', `could not read ${abs}`, { next_action: 'Check the file is readable.' });
        }
        const found = checkStructure(html);
        if (found.length > 0) {
          return ctx.error('HTML_SNAP_STRUCTURE', `${found.length} structural problem(s) — the browser will silently repair these, so renders LOOK fine while the markup is broken`, {
            details: found.slice(0, 20),
            next_action: `Fix the first problem first (line ${found[0].line}: ${found[0].detail}) — later ones are often cascade.`,
          });
        }
        return ctx.ok({ file: abs, structure: 'clean', checked: 'tag nesting, eaten-gt, stray/mismatched closes' });
      }

      const p: SnapParams = {
        file: abs,
        width: num(ctx.options.width, 1440),
        pageHeight: num(ctx.options.pageHeight, 14000),
        offset: num(ctx.options.offset, 0),
        cropHeight: num(ctx.options.cropHeight, 0),
        slices: num(ctx.options.slices, 0),
        delayMs: num(ctx.options.delayMs, 1200),
      };
      const problems = validateParams(p);
      if (problems.length > 0) {
        return ctx.error('HTML_SNAP_BAD_ARGS', 'invalid arguments', {
          details: problems,
          next_action: problems.map((x) => `${x.flag} ${x.problem}`).join(' · '),
        });
      }

      const chrome = resolveChrome(ctx.env.get('HTML_SNAP_CHROME'), (path) => ctx.fs.exists(path));
      if (chrome.kind === 'env-missing') {
        return ctx.error(
          'HTML_SNAP_CHROME_MISSING',
          `HTML_SNAP_CHROME is set to "${chrome.envPath}" but no binary exists there — refusing to fall back (a forced path that silently falls back is a skip that looks like a pass).`,
          { next_action: 'Fix or unset HTML_SNAP_CHROME.' },
        );
      }
      if (chrome.kind === 'none') {
        return ctx.unconfigured(
          `No headless-capable browser found. Probed: ${chrome.probed.join(' · ')}. Install Google Chrome/Chromium/Edge, or set HTML_SNAP_CHROME to a browser binary.`,
        );
      }

      if (!ctx.fsWrite) {
        return ctx.error('HTML_SNAP_NO_FSWRITE', 'this core lacks fsWrite; html-snap needs it to place outputs.', {
          next_action: 'Run `harness update` to a core with the plan-031 fsWrite capability.',
        });
      }
      const outDir = `${ctx.cwd}/.harness/temp/html-snap`;
      ctx.fsWrite.mkdirp(outDir);
      const base = (abs.split('/').pop() ?? 'page').replace(/\.html?$/i, '');
      const stamp = ctx.clock.nowIso().replace(/[:.]/g, '-');
      const outOpt = ctx.options.out === undefined ? undefined : String(ctx.options.out);
      const fullPng = outOpt && p.slices === 0 && p.cropHeight === 0 ? outOpt : `${outDir}/${base}-${stamp}-full.png`;

      const render = await ctx.exec(chrome.path, chromeArgs(p, abs, fullPng), { timeoutMs: 90_000 });
      const wc = await ctx.exec('wc', ['-c', fullPng], { timeoutMs: 10_000 });
      const bytes = wc.ok ? Number.parseInt((wc.stdout ?? '').trim().split(/\s+/)[0] ?? '0', 10) : null;
      const verdict = verifyOutput({ exists: ctx.fs.exists(fullPng), bytes });
      if (!render.ok || !verdict.ok) {
        return ctx.error(
          'HTML_SNAP_RENDER_FAILED',
          `chrome render failed: ${!render.ok ? `exit ${render.exitCode ?? '?'}` : (verdict.ok ? '' : verdict.reason)}`,
          {
            details: { stderrTail: (render.stderr ?? '').slice(-600), chrome: chrome.path },
            next_action: 'Check the HTML loads standalone (self-contained assets); try a larger --delay-ms; run with --page-height nearer the real content height.',
          },
        );
      }

      // Crop tool: sips (macOS) → magick (linux) → degrade to full-page only.
      const haveSips = (await ctx.exec('sips', ['--help'], { timeoutMs: 10_000 })).ok;
      const haveMagick = haveSips ? false : (await ctx.exec('magick', ['-version'], { timeoutMs: 10_000 })).ok;
      const tool: 'sips' | 'magick' | 'none' = haveSips ? 'sips' : haveMagick ? 'magick' : 'none';

      const evidence: Array<{ label: string; path: string }> = [];
      const outputs: string[] = [];

      const cropOne = async (offset: number, height: number, out: string): Promise<string | null> => {
        const c = cropArgs(tool as 'sips' | 'magick', fullPng, out, p.width, offset, height);
        const r = await ctx.exec(c.command, c.args, { timeoutMs: 30_000 });
        return r.ok && ctx.fs.exists(out) ? null : `crop failed at offset ${offset} (${c.command} exit ${r.exitCode ?? '?'})`;
      };

      if (p.cropHeight > 0 || p.slices > 0) {
        if (tool === 'none') {
          evidence.push({ label: 'full page (crop unavailable)', path: fullPng });
          return ctx.degraded(
            { out: fullPng, width: p.width, pageHeight: p.pageHeight, chrome: chrome.path },
            'Rendered the full page, but no crop tool exists (probed sips, magick) — install ImageMagick for --offset/--slices, or read the full PNG.',
            { evidence },
          );
        }
        if (p.cropHeight > 0) {
          const out = outOpt ?? `${outDir}/${base}-${stamp}-y${p.offset}.png`;
          const err = await cropOne(p.offset, p.cropHeight, out);
          if (err) return ctx.error('HTML_SNAP_CROP_FAILED', err, { next_action: 'Check offset/crop-height against --page-height; keep the full PNG for manual reading.', details: { fullPng } });
          outputs.push(out);
          evidence.push({ label: `crop y=${p.offset} h=${p.cropHeight}`, path: out });
        } else {
          for (const [i, band] of slicePlan(p.pageHeight, p.slices).entries()) {
            const out = `${(outOpt ?? `${outDir}/${base}-${stamp}`).replace(/\.png$/i, '')}-${i + 1}.png`;
            const err = await cropOne(band.offset, band.height, out);
            if (err) return ctx.error('HTML_SNAP_CROP_FAILED', err, { next_action: 'Reduce --slices or verify the full PNG renders.', details: { fullPng } });
            outputs.push(out);
            evidence.push({ label: `slice ${i + 1}/${p.slices} (y=${band.offset})`, path: out });
          }
        }
      } else {
        outputs.push(fullPng);
        evidence.push({ label: 'full page', path: fullPng });
      }

      return ctx.ok(
        { outputs, fullPng, width: p.width, pageHeight: p.pageHeight, chrome: chrome.path, via: chrome.via, cropTool: tool },
        { evidence },
      );
    } catch (err) {
      return ctx.error('HTML_SNAP_UNEXPECTED', `html-snap failed unexpectedly: ${String(err)}`, {
        next_action: 'Re-run with --json and report the envelope; the failure above is a bug in the extension.',
      });
    }
  },
};

export default htmlSnap;

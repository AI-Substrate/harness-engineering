/**
 * html-snap pure core — every decision that can be unit-tested without a
 * browser lives here: the chrome resolution ladder, argument validation,
 * command construction, and output verification. The verb (extension.ts)
 * only wires these to ctx.exec/ctx.fs.
 *
 * Chrome resolution ladder (governance ruling, spine seq 542 thread):
 *   1. HTML_SNAP_CHROME env — if SET but missing → hard error, never fallback
 *      (a forced path that silently falls back is a skip that looks like a pass).
 *   2. Probed candidate list (macOS + Linux, Chrome/Chromium/Edge).
 *   3. Nothing found → unconfigured, naming every path probed.
 */

export const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

export type ChromeResolution =
  | { kind: 'ok'; path: string; via: 'env' | 'probe' }
  | { kind: 'env-missing'; envPath: string }
  | { kind: 'none'; probed: string[] };

export function resolveChrome(
  envValue: string | undefined,
  exists: (p: string) => boolean,
): ChromeResolution {
  if (envValue !== undefined && envValue !== '') {
    return exists(envValue)
      ? { kind: 'ok', path: envValue, via: 'env' }
      : { kind: 'env-missing', envPath: envValue };
  }
  for (const c of CHROME_CANDIDATES) {
    if (exists(c)) return { kind: 'ok', path: c, via: 'probe' };
  }
  return { kind: 'none', probed: [...CHROME_CANDIDATES] };
}

export interface SnapParams {
  file: string;
  width: number;
  pageHeight: number;
  offset: number;
  cropHeight: number;
  slices: number;
  delayMs: number;
}

export type ParamProblem = { flag: string; problem: string };

/** Validate numeric/flag coherence. Pure — file existence is the verb's job. */
export function validateParams(p: SnapParams): ParamProblem[] {
  const problems: ParamProblem[] = [];
  const intish = (n: number, flag: string, min: number, max: number) => {
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
      problems.push({ flag, problem: `must be an integer in [${min}, ${max}], got ${n}` });
    }
  };
  intish(p.width, '--width', 320, 4000);
  intish(p.pageHeight, '--page-height', 200, 40000);
  intish(p.offset, '--offset', 0, 40000);
  intish(p.cropHeight, '--crop-height', 0, 40000);
  intish(p.slices, '--slices', 0, 40);
  intish(p.delayMs, '--delay-ms', 0, 30000);
  if (p.offset > 0 && p.cropHeight === 0) {
    problems.push({ flag: '--offset', problem: 'needs --crop-height (an offset with no crop height is a no-op that would silently return the full page)' });
  }
  if (p.slices > 0 && (p.offset > 0 || p.cropHeight > 0)) {
    problems.push({ flag: '--slices', problem: 'is mutually exclusive with --offset/--crop-height' });
  }
  if (p.offset + p.cropHeight > p.pageHeight) {
    problems.push({ flag: '--offset', problem: `offset ${p.offset} + crop-height ${p.cropHeight} exceeds --page-height ${p.pageHeight} — the crop would fall off the rendered page` });
  }
  return problems;
}

/** Chrome argv for a settled, deterministic, full-window screenshot. */
export function chromeArgs(p: SnapParams, absHtml: string, outPng: string): string[] {
  return [
    '--headless=new',
    '--force-prefers-reduced-motion',
    '--hide-scrollbars',
    '--disable-gpu',
    '--force-device-scale-factor=1',
    '--disable-lcd-text',
    `--virtual-time-budget=${p.delayMs}`,
    `--window-size=${p.width},${p.pageHeight}`,
    `--screenshot=${outPng}`,
    `file://${absHtml}`,
  ];
}

export type CropTool = { tool: 'sips' | 'magick' } | { tool: 'none' };

/** Crop command for one region. sips (macOS) or ImageMagick (linux), both probed by the verb. */
export function cropArgs(
  tool: 'sips' | 'magick',
  fullPng: string,
  outPng: string,
  width: number,
  offset: number,
  cropHeight: number,
): { command: string; args: string[] } {
  if (tool === 'sips') {
    return {
      command: 'sips',
      args: ['-c', String(cropHeight), String(width), '--cropOffset', String(offset), '0', fullPng, '--out', outPng],
    };
  }
  return {
    command: 'magick',
    args: [fullPng, '-crop', `${width}x${cropHeight}+0+${offset}`, '+repage', outPng],
  };
}

/** Slice plan: n even bands top to bottom (last band absorbs the remainder). */
export function slicePlan(pageHeight: number, slices: number): Array<{ offset: number; height: number }> {
  const band = Math.floor(pageHeight / slices);
  return Array.from({ length: slices }, (_, i) => ({
    offset: i * band,
    height: i === slices - 1 ? pageHeight - band * (slices - 1) : band,
  }));
}

/**
 * Verdict on a produced screenshot. A crash or an unreadable/tiny file must be
 * an ERROR, never a screenshot-shaped empty result someone then trusts.
 */
export function verifyOutput(input: {
  exists: boolean;
  bytes: number | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.exists) return { ok: false, reason: 'chrome exited but produced no file' };
  if (input.bytes === null || input.bytes < 1024) {
    return { ok: false, reason: `output file is ${input.bytes ?? 0} bytes — a screenshot-shaped empty result, not a render` };
  }
  return { ok: true };
}

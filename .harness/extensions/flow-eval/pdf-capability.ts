import type { ResolveContext, VerdictWithNote } from './resolvers.js';
import { json, object } from './native-evidence.js';

export async function pdfCapability(rc: ResolveContext): Promise<VerdictWithNote> {
  if (rc.pdfResult) return rc.pdfResult;
  if (!rc.pdfProbe) return { verdict: 'unknown', note: 'independent PDF probe is not configured' };
  const result = await rc.exec('python3', [rc.pdfProbe.script, '--root', rc.worktree, '--out', rc.pdfProbe.output], { cwd: rc.worktree });
  const report = json(result.stdout);
  if (!object(report) || !['pass', 'fail', 'unknown'].includes(String(report.verdict))) {
    return { verdict: 'unknown', note: 'PDF inspector unavailable or returned invalid evidence' };
  }
  if (report.verdict === 'pass' && (!result.ok || !Array.isArray(report.outputs) || report.outputs.length !== 2)) {
    return { verdict: 'fail', note: 'PDF probe did not successfully exercise both fresh inputs' };
  }
  if (Array.isArray(report.executed_files) && report.executed_files.every((file) => typeof file === 'string')) rc.capabilityFiles = report.executed_files;
  rc.pdfResult = { verdict: report.verdict as VerdictWithNote['verdict'], note: `${String(report.reason)}; evidence ${rc.pdfProbe.output}` };
  return rc.pdfResult;
}

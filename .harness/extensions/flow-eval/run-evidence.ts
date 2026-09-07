import type { VerbContext } from '@ai-substrate/engineering-harness/contract';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { acquireNativeEvidence, json, object, type NativeEvidence } from './native-evidence.js';
import type { ResolveContext } from './resolvers.js';

function within(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel));
}
function value(text: string | null, name: string): Record<string, unknown> | null {
  const doc = text === null ? null : json(text);
  if (!object(doc) || !Array.isArray(doc.sections)) return null;
  const row = doc.sections.find((s) => object(s) && s.name === name);
  return object(row) && object(row.value) ? row.value : null;
}
export async function prepareNativeRun(ctx: VerbContext, rc: ResolveContext, peer: string, plan: string | undefined, base: string, runDir: string) {
  if (!ctx.fsWrite) throw new Error('native evidence needs fsWrite to preserve source receipts');
  if (within(rc.worktree, runDir)) throw new Error('score from an evaluator root outside the disposable subject root');
  const cli = ctx.fs.exists(resolve(ctx.cwd, 'harness/cli/bin/harness.js'))
    ? { command: 'node', args: [resolve(ctx.cwd, 'harness/cli/bin/harness.js')] }
    : { command: resolve(ctx.cwd, 'node_modules/.bin/harness'), args: [] };
  const save = (name: string, text: string) => {
    const path = resolve(runDir, name);
    if (!within(runDir, path)) throw new Error('invalid evidence filename');
    ctx.fsWrite!.mkdirp(dirname(path));
    ctx.fsWrite!.writeText(path, text);
  };
  const peers = new Map<string, string>([[peer, rc.worktree]]);
  if (plan) {
    const team = resolve(rc.worktree, dirname(plan), 'assets/team');
    const composition = value(ctx.fs.readText(resolve(team, 'composition.dd.json')), 'composition');
    if (Array.isArray(composition?.units)) {
      for (const row of composition.units) {
        if (object(row) && typeof row.peer_id === 'string' && typeof row.workspace === 'string') peers.set(row.peer_id, row.workspace);
      }
    }
    const review = value(ctx.fs.readText(resolve(team, 'review-composition.dd.json')), 'review');
    if (review && typeof review.reviewer_id === 'string' && object(review.observed) && typeof review.observed.root === 'string') peers.set(review.reviewer_id, review.observed.root);
    rc.subject = { plan, base, peer, harness: cli, ddocs: resolve(ctx.cwd, 'node_modules/.bin/ddocs'), save };
  }
  rc.nativePeers = new Map<string, NativeEvidence>();
  for (const [id, root] of peers) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('unsafe peer identity in evidence binding');
    if (within(root, runDir)) throw new Error(`evidence directory is inside disposable peer ${id}`);
    const native = await acquireNativeEvidence(id, root, {
      exec: (command, args, opts) => ctx.exec(command, args, opts),
      save: (name, text) => save(`${id}/${name}`, text), harness: cli,
    });
    rc.nativePeers.set(id, native);
    if (id === peer) rc.native = native;
  }
  rc.pdfProbe = { script: resolve(ctx.cwd, '.harness/extensions/flow-eval/pdf-probe.py'), output: resolve(runDir, 'pdf') };
  return {
    source: 'flowspace' as const,
    path: runDir,
    subject_plan: plan ?? null,
    base_sha: base,
    peers: [...rc.nativePeers.values()].map((native) => ({ peer: native.peer_id, native_session: native.native_session,
      root: native.root, model: native.model, ...(native.effort && { effort: native.effort }),
      complete: native.complete, cutoff: native.cutoff, guid: native.guid, gaps: native.gaps })),
    provider_attestation: 'unverified' as const,
  };
}

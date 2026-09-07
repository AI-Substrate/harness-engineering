import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, dirname } from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (root, path) => {
  const suffix = relative(resolve(root), resolve(path));
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
};

/** Teaching fixtures, NEVER a claim that a peer/reviewer ran. Source SHA is supplied, not invented. */
export function lifecycleFixtures({ sourceSha, root, contractBytes, guideBytes, planBytes }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Supply an actual source Git SHA');
  const recorded_at = new Date().toISOString();
  const nonce = randomUUID();
  const unit = JSON.parse(guideBytes).sections.find((section) => section.name === 'units').value.find((entry) => entry.id === 'tk-0002');
  const attempt = `${unit.id}-${sourceSha}`;
  const role = { role: 'coder', harness: 'omp', model: 'github-copilot/gpt-6-astra', source: { harness: 'guide', model: 'guide' } };
  const reviewer = { ...role, role: 'reviewer', model: 'github-copilot/claude-opus-5' };
  const plan = { path: 'plan.dd.json', sha256: digest(planBytes) };
  const guide = { path: 'assets/impl-guide.dd.json', sha256: digest(guideBytes) };
  const allocation = { record_type: 'allocation', id: 'al-example', recorded_at, owner: 'harness', kind: 'clone', purpose: 'unit', root, authority_root: dirname(root), git_dir: `${root}/.git`, branch: 'builder/example/parser', base_sha: sourceSha, ordinal: 1, slug: 'example', actor: 'example-pm', journal: ['reserved', 'workspace-created'], plan_path: plan.path, unit_id: 'tk-0002' };
  const report = { path: 'report.txt', sha256: digest('Teaching fixture: independent review is not executed here.\n') };
  const observed = { peer_id: 'example-coder', root, ready: false, evidence: ['Synthetic runtime shape only; no native runtime was inspected.'], gaps: ['No live peer was launched; readiness, harness/model and provider-served identity are unverified.'] };
  const review = { record_type: 'review', id: 'rv-example', recorded_at, scope: 'decomposition', subject_sha: sourceSha, plan, guide, reviewer_id: 'example-reviewer', requested: reviewer, observed: { ...observed, peer_id: 'example-reviewer' }, verdict: 'blocked', report, findings: [] };
  const baseline = { record_type: 'baseline', id: 'bl-example', recorded_at, source_sha: sourceSha, plan, guide, files: [{ path: 'contracts.mjs', sha256: digest(contractBytes) }], checks: [], review: { path: 'review-decomposition.dd.json', sha256: digest(JSON.stringify(review)) } };
  const packet = { record_type: 'packet', id: `packet-${attempt}`, recorded_at, nonce, unit, plan, guide, baseline: { path: 'assets/team/baseline.dd.json', sha256: digest(JSON.stringify(baseline)) }, allocation: { path: `${dirname(root)}/allocation.dd.json`, sha256: digest(JSON.stringify(allocation)) }, source_sha: sourceSha, workspace: root, parent: 'example-pm', requested: role, forbidden: ['canonical flow/plan/guide/tasks/receipts without PM approval', 'global/deployed changes, unrelated workspaces, changes on main, pushes, PRs, merges or destructive actions without user authorization'], instructions: [
    `You own ${unit.paths.join(', ')}.`,
    `You may read ${unit.reads.map((entry) => `${entry.paths.join(', ')} (owner ${entry.owner})`).join('; ')}.`,
    `Your job: ${unit.responsibility} Frozen interface: ${unit.interface} Dependencies: ${unit.depends_on.join(', ')}; wave ${unit.wave}.`,
    `Done means ${unit.acceptance.join(', ')}: parse CRLF input into an immutable Document and propagate injected reader failures. Run node skills/builder/examples/verify.mjs --case parser (cwd: repository root); retain actual output for ${unit.proof.join(', ')}.`,
    'Receiving this work packet starts the assigned unit without a separate release. Write/read maps guide coders and PM, not fence source access; out-of-map edits need no approval or justification. Commit actual task changes and return UnitDelivery (unit_id, peer_id, workspace, commit_sha, packet_sha256, baseline_sha) plus actual proof, visible file/owning_unit warnings and friction.',
    'Optional read-only inspection: harness builder on-track <plan> [--unit <id>] [--from <ref>] [--to <ref>] [--untracked]. No readiness, seal, review or receipt prerequisite; no writes; exit 0. Show compared, warnings, actionable issues and the selected basis. Defaults include tracked staged/unstaged work; --untracked explicitly adds new paths; explicit --to is committed-only.',
    'This packet is a synthetic teaching fixture, not a native dispatch or observed delivery.',
  ] };
  const packetBytes = `${JSON.stringify({ dd: { schema: 'builder/work-packet' }, sections: [{ name: 'packet', value: packet }], references: [] }, null, 2)}\n`;
  const packetRef = { path: 'assets/team/packet.dd.json', sha256: digest(packetBytes) };
  // These records demonstrate shapes, not a sent message or a successful native session.
  const dispatch = { record_type: 'dispatch', id: `dispatch-${attempt}`, recorded_at, unit_id: unit.id, packet: packetRef, baseline: packet.baseline, allocation: packet.allocation, requested: role, observed, seed_files: [], delivery: { message_id: `synthetic-work-${nonce}`, outcome: 'queued', recorded_at } };
  const selfCheck = { packet: packetRef.path, expected: { packet_sha256: packetRef.sha256, root, source_sha: sourceSha }, observed: { packet_sha256: digest(packetBytes) }, warnings: [{ code: 'EXAMPLE_UNOBSERVED', message: 'Synthetic self-check shape: only the supplied packet bytes were measured; no checkout was inspected.', next_action: 'For real orientation, run the optional self-check from the actual allocated checkout using the issued packet and digest.' }] };
  const workMessage = [...packet.instructions, `Packet: ${packetRef.path}; SHA-256: ${packetRef.sha256}.`, `Optional warning-only orientation: harness builder self-check ${packetRef.path} --sha256 ${packetRef.sha256}`].join('\n');
  const delivery = { unit_id: packet.unit.id, peer_id: observed.peer_id, workspace: root, commit_sha: sourceSha, packet_sha256: packetRef.sha256, baseline_sha: sourceSha };
  const composition = { record_type: 'composition', id: 'co-example', recorded_at, baseline: packet.baseline, units: [delivery], integration_sha: sourceSha, files: [], checks: [] };
  return { kind: 'teaching-fixtures-not-live-evidence', allocation, review, baseline, packet, packetBytes, dispatch, workMessage, selfCheck, delivery, composition };
}

/** A real file-preservation exercise, NOT authorization to retire a Builder allocation. */
export async function preserveExample(source, destination, retiringRoots) {
  if (retiringRoots.some((root) => inside(root, destination))) throw new Error('Survivor is inside a retiring root');
  const bytes = await readFile(source);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
  return { source, destination, bytes: bytes.length, sha256: digest(bytes), category: 'observation' };
}

export async function verifyPreservedExample(item, { owner, runtimeReleased }) {
  if (owner !== 'harness') throw new Error('Allocation is not harness-owned');
  if (runtimeReleased !== true) throw new Error('Runtime release is unproven; idle is not closed');
  const bytes = await readFile(item.destination);
  if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) throw new Error('Preserved bytes changed');
  return item.destination;
}

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
  const observed = { peer_id: 'example-coder', root, ready: true, harness: role.harness, model: role.model, evidence: ['Explicit synthetic observation used only to demonstrate the record shape.'], gaps: ['No live peer was launched; provider-served identity is unverified.'] };
  const review = { record_type: 'review', id: 'rv-example', recorded_at, scope: 'decomposition', subject_sha: sourceSha, plan, guide, reviewer_id: 'example-reviewer', requested: reviewer, observed: { ...observed, peer_id: 'example-reviewer', model: reviewer.model }, verdict: 'approved', report, findings: [] };
  const baseline = { record_type: 'baseline', id: 'bl-example', recorded_at, source_sha: sourceSha, plan, guide, files: [{ path: 'contracts.mjs', sha256: digest(contractBytes) }], checks: [], review: { path: 'review-decomposition.dd.json', sha256: digest(JSON.stringify(review)) } };
  const packet = { record_type: 'packet', id: `packet-${attempt}`, recorded_at, nonce, unit, plan, guide, baseline: { path: 'assets/team/baseline.dd.json', sha256: digest(JSON.stringify(baseline)) }, allocation: { path: `${dirname(root)}/allocation.dd.json`, sha256: digest(JSON.stringify(allocation)) }, workspace: root, parent: 'example-pm', requested: role, forbidden: ['.the-flow-state.json', 'the-flow.json', 'the-flow.md', 'canonical plan/guide/tasks/receipts', 'other units', 'global settings', 'pushes'], canary: { path: 'canary.txt' }, instructions: ['Read the native relative packet/canary; submit pristine pre-work ack-<unit_id>-<full-current-source-sha> with packet.nonce and wait for the exact release.', 'After observing the release, refresh native observations and emit a new ack-<unit_id>-<full-current-source-sha>-release with retained release.message_id as nonce and actual recorded_at. Send its new path/digest and follow the already-granted scope without a second grant. PM ingests both phases through harness builder ack <plan> --receipt <path> before queued import; omit unsupported runtime fields and follow the explicit 5000 ms clock-skew bounds in team-lifecycle.md.'] };
  const canary = `${randomUUID()}\n`;
  const packetBytes = `${JSON.stringify({ dd: { schema: 'builder/packet' }, sections: [{ name: 'packet', value: packet }], references: [] }, null, 2)}\n`;
  const ack = { record_type: 'ack', id: `ack-${attempt}`, recorded_at, unit_id: packet.unit.id, peer_id: observed.peer_id, nonce, packet_sha256: digest(packetBytes), baseline_sha: sourceSha, native_root: root, shell_cwd: root, canary_nonce: canary.trimEnd(), observed };
  // Synthetic retained transport and fresh observation, NOT a sent or accepted live release.
  const release = { message_id: `release-${nonce}`, outcome: 'queued', recorded_at: new Date().toISOString() };
  const releaseAck = { ...ack, id: `ack-${attempt}-release`, recorded_at: new Date().toISOString(), nonce: release.message_id, observed: { ...observed, evidence: ['Separate synthetic post-release native observation; no live acknowledgement or PM ingestion occurred.'], gaps: [...observed.gaps] } };
  const delivery = { unit_id: packet.unit.id, peer_id: observed.peer_id, workspace: root, commit_sha: sourceSha, packet_sha256: ack.packet_sha256, baseline_sha: sourceSha };
  const composition = { record_type: 'composition', id: 'co-example', recorded_at, baseline: packet.baseline, units: [delivery], integration_sha: sourceSha, files: [], checks: [] };
  return { kind: 'teaching-fixtures-not-live-evidence', allocation, review, baseline, packet, packetBytes, canary, canary_sha256: digest(canary), ack, release, releaseAck, delivery, composition };
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

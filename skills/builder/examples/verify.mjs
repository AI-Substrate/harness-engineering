import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentFromLines } from './contracts.mjs';
import { createParser } from './parser.mjs';
import { createRenderer } from './renderer.mjs';
import { createConvert } from './compose.mjs';
import { createLedger } from './solo.mjs';
import { coupledUnits } from './bad.mjs';
import { lifecycleFixtures, preserveExample, verifyPreservedExample } from './lifecycle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cases = {
  contracts() {
    const input = ['one'];
    const document = documentFromLines(input);
    input.push('two');
    assert.deepEqual(document.lines, ['one']);
    assert.throws(() => document.lines.push('mutation'), TypeError);
    assert.throws(() => documentFromLines([42]), TypeError);
  },
  async parser() {
    const reads = [];
    const parse = createParser({ read: async (path) => { reads.push(path); return 'one\r\ntwo\n'; } });
    assert.deepEqual((await parse('input')).lines, ['one', 'two', '']);
    assert.deepEqual(reads, ['input']);
    await assert.rejects(createParser({ read: async () => { throw new Error('missing source'); } })('missing'), /missing source/);
    await assert.rejects(createParser({ read: async () => 42 })('invalid'), /return text/);
  },
  async renderer() {
    const writes = [];
    const render = createRenderer({ write: async (path, text) => { writes.push({ path, text }); } });
    const expected = '<p>&lt;b&gt;&amp;é&lt;/b&gt;</p>';
    assert.deepEqual(await render(documentFromLines(['<b>&é</b>']), 'out'), { path: 'out', bytes: Buffer.byteLength(expected) });
    assert.deepEqual(writes, [{ path: 'out', text: expected }]);
    await assert.rejects(createRenderer({ write: async () => { throw new Error('read-only sink'); } })(documentFromLines(['x']), 'out'), /read-only sink/);
  },
  async composition() {
    const writes = [];
    const convert = createConvert({ parse: createParser({ read: async () => 'a\r\n<b>' }), render: createRenderer({ write: async (path, text) => { writes.push([path, text]); } }) });
    await convert('input', 'output');
    assert.deepEqual(writes, [['output', '<p>a</p>\n<p>&lt;b&gt;</p>']]);
    let rendered = false;
    await assert.rejects(createConvert({ parse: async () => { throw new Error('parse failed'); }, render: async () => { rendered = true; } })('input', 'output'), /parse failed/);
    assert.equal(rendered, false);
    const root = await mkdtemp(join(tmpdir(), 'builder-example-cli-'));
    try {
      await writeFile(join(root, 'in.txt'), 'é & <x>\nlast');
      const result = JSON.parse(execFileSync(process.execPath, [join(here, 'cli.mjs'), join(root, 'in.txt'), join(root, 'out.html')], { encoding: 'utf8' }));
      const text = await readFile(join(root, 'out.html'), 'utf8');
      assert.equal(text, '<p>é &amp; &lt;x&gt;</p>\n<p>last</p>');
      assert.equal(result.bytes, Buffer.byteLength(text));
    } finally { await rm(root, { recursive: true, force: true }); }
  },
  solo() {
    const ledger = createLedger(10);
    assert.equal(ledger.reserve(7), 3);
    assert.throws(() => ledger.reserve(4), /Invalid reservation/);
    assert.equal(ledger.balance(), 3);
    assert.throws(() => ledger.reserve(-1), /Invalid reservation/);
    assert.equal(ledger.reserve(3), 0);
  },
  bad() {
    const bad = coupledUnits();
    assert.throws(() => bad.renderer(documentFromLines(['independent input'])), TypeError, 'A renderer that needs the sibling parser to run is not independent');
    bad.parser('<unsafe>');
    assert.equal(bad.renderer(), '<p><unsafe></p>', 'The bad implementation exposes unescaped input');
    bad.parser('another caller');
    assert.equal(bad.renderer(), '<p>another caller</p>', 'Hidden shared state changes another unit output');
  },
  async lifecycle() {
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const guideBytes = await readFile(join(here, '../templates/impl-guide.template.json'), 'utf8');
    const guide = Object.fromEntries(JSON.parse(guideBytes).sections.map(({ name, value }) => [name, value]));
    const expectedCriteria = ['ac-0001', 'ac-0002', 'ac-0003'];
    const missingCoverage = (capabilities) => expectedCriteria.filter((id) => !capabilities.some((capability) => capability.criterion.endsWith(`/${id}`) && guide.units.some((unit) => unit.id === capability.owner) && capability.proof.length > 0 && capability.proof.every((proof) => guide.checks.some((check) => proof.endsWith(`/${check.id}`)))));
    assert.deepEqual(missingCoverage(guide.capabilities), []);
    assert.deepEqual(missingCoverage(guide.capabilities.filter((capability) => !capability.criterion.endsWith('/ac-0003'))), ['ac-0003'], 'Separate unit proofs cannot silently omit composition coverage');
    assert.equal(guide.units.find((unit) => unit.id === 'tk-0002').wave, guide.units.find((unit) => unit.id === 'tk-0003').wave);
    assert.deepEqual(guide.units.find((unit) => unit.id === 'tk-0002').depends_on, ['tk-0001']);
    assert.deepEqual(guide.units.find((unit) => unit.id === 'tk-0003').depends_on, ['tk-0001']);
    const fixtureInputs = { sourceSha, root: '/example/worker', contractBytes: await readFile(join(here, 'contracts.mjs')), guideBytes, planBytes: 'explicit teaching plan bytes' };
    const fixtures = lifecycleFixtures(fixtureInputs);
    assert.equal(fixtures.kind, 'teaching-fixtures-not-live-evidence');
    assert.deepEqual(Object.keys(fixtures.packet.canary), ['path']);
    assert.equal(fixtures.packetBytes.includes(fixtures.canary.trim()), false);
    assert.equal(fixtures.ack.packet_sha256, createHash('sha256').update(fixtures.packetBytes).digest('hex'));
    assert.notEqual(fixtures.ack.packet_sha256, createHash('sha256').update(`${fixtures.packetBytes}changed`).digest('hex'));
    assert.equal(fixtures.ack.baseline_sha, sourceSha);
    assert.equal(fixtures.packet.id, `packet-${fixtures.packet.unit.id}-${sourceSha}`);
    assert.equal(fixtures.ack.id, `ack-${fixtures.packet.unit.id}-${sourceSha}`);
    assert.equal(fixtures.ack.nonce, fixtures.packet.nonce);
    assert.equal(fixtures.releaseAck.record_type, 'ack');
    assert.equal(fixtures.releaseAck.id, `ack-${fixtures.packet.unit.id}-${sourceSha}-release`);
    assert.notEqual(fixtures.releaseAck.id, fixtures.ack.id, 'Confirmation has its own exact phase identity, not the original acknowledgement');
    assert.equal(fixtures.releaseAck.nonce, fixtures.release.message_id);
    assert.notEqual(fixtures.releaseAck.nonce, fixtures.packet.nonce, 'This fixture deliberately proves release message ID is independent of packet nonce');
    assert.equal(fixtures.release.outcome, 'queued', 'Constructing a teaching receipt does not send or confirm live delivery');
    assert.equal(Number.isFinite(Date.parse(fixtures.releaseAck.recorded_at)), true);
    for (const field of ['unit_id', 'peer_id', 'packet_sha256', 'baseline_sha', 'native_root', 'shell_cwd', 'canary_nonce']) {
      assert.equal(fixtures.releaseAck[field], fixtures.ack[field], `Confirmation preserves ${field}`);
    }
    assert.equal('effort' in fixtures.releaseAck.observed, false);
    assert.equal('pid' in fixtures.releaseAck.observed, false, 'The teaching fixture must not invent native process evidence');
    const fresh = lifecycleFixtures(fixtureInputs);
    assert.equal(fresh.packet.id, fixtures.packet.id, 'One unit and sealed source select one attempt key, not a nonce-derived filename');
    assert.notEqual(fresh.packet.nonce, fixtures.packet.nonce, 'A fresh packet must not reuse the anti-replay nonce');
    assert.notEqual(fresh.ack.packet_sha256, fixtures.ack.packet_sha256, 'Old acknowledgement bytes cannot bind a freshly issued packet');
    assert.equal('effort' in fixtures.packet.requested, false);
    assert.notEqual(fixtures.review.requested.model, fixtures.packet.requested.model);
    assert.equal('artifact_sha' in fixtures.composition, false, 'Import-only cannot claim verified composition');
    const root = await mkdtemp(join(tmpdir(), 'builder-preserve-example-'));
    try {
      const worker = join(root, 'worker');
      await mkdir(worker);
      const source = join(worker, 'observation.txt');
      await writeFile(source, 'Actual observed evidence\n');
      await assert.rejects(preserveExample(source, join(worker, 'copy.txt'), [worker]), /inside a retiring root/);
      const item = await preserveExample(source, join(root, 'survivor/observation.txt'), [worker]);
      const preservation = { record_type: 'preservation', id: 'preservation-example', recorded_at: new Date().toISOString(), allocation_ids: ['al-example'], source_root: worker, source_sha: sourceSha, composed_sha: sourceSha, archived_plan: 'docs/plans/archive/001-example/plan.dd.json', survivor_root: join(root, 'survivor'), retiring_roots: [worker], inventory: [item], refs: [] };
      await writeFile(join(root, 'survivor/preservation.json'), JSON.stringify(preservation));
      assert.equal(preservation.inventory[0].sha256, createHash('sha256').update(await readFile(source)).digest('hex'));
      await assert.rejects(verifyPreservedExample(item, { owner: 'external', runtimeReleased: true }), /not harness-owned/);
      await assert.rejects(verifyPreservedExample(item, { owner: 'harness', runtimeReleased: false }), /idle is not closed/);
      await rm(worker, { recursive: true });
      assert.equal(await verifyPreservedExample(item, { owner: 'harness', runtimeReleased: true }), item.destination);
      await writeFile(item.destination, 'tampered');
      await assert.rejects(verifyPreservedExample(item, { owner: 'harness', runtimeReleased: true }), /bytes changed/);
    } finally { await rm(root, { recursive: true, force: true }); }
  },
};

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--case' || !(args[1] in cases))) throw new Error(`Usage: verify.mjs [--case ${Object.keys(cases).join('|')}]`);
const selected = args.length ? [args[1]] : Object.keys(cases);
for (const name of selected) await cases[name]();
console.log(JSON.stringify({ status: 'passed', exercised: selected, boundary: 'Executable teaching examples; not live peer, review, or feature acceptance evidence.' }));

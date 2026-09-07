import { parseWorktreePorcelain } from '../../adapters/git/exec-git.js';
import { ErrorCodes } from '../../output/error-codes.js';
import {
  isWithin,
  posixDirname,
  posixRelative,
  resolveInRepo,
  toPosix,
} from '../shared/posix-path.js';
import { resolveBuilderDispatchKind } from './commands.js';
import {
  builderAttemptFailure,
  prepareBuilderPacket,
  readCurrentBuilderBaseline,
  seedBuilderInputs,
} from './packet-service.js';
import {
  builderContext,
  builderFailure,
  builderRecordPath,
  digestBuilderFile,
  readBuilderRecord,
  sha256,
  writeBuilderRecord,
} from './records.js';
import type {
  AckInput,
  AckReceipt,
  AllocationRecord,
  BuilderContext,
  BuilderDeps,
  BuilderResult,
  DispatchDeps,
  DispatchInput,
  DispatchReceipt,
  DispatchResult,
  FileDigest,
  Packet,
  RoleBinding,
  RuntimeObservation,
  Stored,
} from './types.js';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const key = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const runtimeFailure = (message: string, details?: unknown) =>
  builderFailure(
    ErrorCodes.BUILDER_RUNTIME,
    message,
    'Use a supported native pij-rs/OMP runtime in the declared checkout; inspect the named prerequisite without switching model, actor or root.',
    details,
  );
const ackFailure = (message: string) =>
  builderFailure(
    ErrorCodes.BUILDER_ACK,
    message,
    'Keep work paused. Re-read the exact native packet and root challenge, then submit a fresh matching acknowledgement.',
  );
const RELEASE_ACK_CLOCK_SKEW_MS = 5000;
const RELEASE_CONFIRMATION_EVIDENCE = 'builder release confirmation: ';

/** Only the observed public v2 envelope; never a legacy/private descriptor projection. */
async function native(
  deps: BuilderDeps,
  args: string[],
  command: string,
): Promise<BuilderResult<JsonObject>> {
  const result = await deps.exec.run(deps.pij.command, [...deps.pij.args, ...args, '--json'], {
    cwd: deps.repoRoot,
    timeoutMs: args[0] === 'spawn' ? 45000 : 10000,
  });
  if (!result.ok) return runtimeFailure(`Native ${args[0]} failed (${result.code}).`, result);
  let envelope: unknown;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    return runtimeFailure(`Native ${args[0]} returned invalid JSON.`, result);
  }
  if (
    !object(envelope) ||
    envelope.ok !== true ||
    envelope.v !== 2 ||
    envelope.command !== command ||
    !object(envelope.data)
  ) {
    return runtimeFailure(`Native ${args[0]} returned an unsupported response contract.`, envelope);
  }
  return { ok: true, value: envelope.data };
}

/** A native PM may control a registered sibling, but never an unrelated clone or path alias. */
export async function verifyBuilderParentWorktreeAuthority(
  deps: BuilderDeps,
  nativeFolder: string,
): Promise<BuilderResult<true>> {
  const roots = [nativeFolder, deps.repoRoot];
  const env = { GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined };
  let common: string | undefined;
  for (const root of roots) {
    const physical = deps.fs.realpath(root);
    if (physical === null || toPosix(physical) !== root)
      return runtimeFailure('The parent or controlled worktree root is missing or aliased.', {
        native_folder: nativeFolder,
        target_root: deps.repoRoot,
      });
    const git = await deps.exec.run(
      'git',
      ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
      { cwd: root, timeoutMs: 10000, env },
    );
    const lines = git.stdout.replace(/\r?\n$/, '').split(/\r?\n/);
    if (!git.ok || lines.length !== 2 || toPosix(lines[0] ?? '') !== root || !text(lines[1]))
      return runtimeFailure(
        'The parent and target must each be an exact native Git worktree root.',
        { native_folder: nativeFolder, target_root: deps.repoRoot, probe_root: root, result: git },
      );
    const directory = toPosix(lines[1]);
    const physicalCommon = deps.fs.realpath(directory);
    if (
      physicalCommon === null ||
      toPosix(physicalCommon) !== directory ||
      (common !== undefined && common !== directory)
    )
      return runtimeFailure(
        'The parent and target do not share one canonical Git common-directory authority.',
        { native_folder: nativeFolder, target_root: deps.repoRoot, common_dir: directory },
      );
    common = directory;
  }
  const listed = await deps.exec.run('git', ['worktree', 'list', '--porcelain', '-z'], {
    cwd: nativeFolder,
    timeoutMs: 10000,
    env,
  });
  if (!listed.ok)
    return runtimeFailure('Cannot observe the parent Git authority worktree registry.', listed);
  const membership = parseWorktreePorcelain(listed.stdout, 4096);
  if (
    membership.status !== 'ok' ||
    !roots.every((root) => membership.roots.some((registered) => toPosix(registered) === root))
  )
    return runtimeFailure(
      'The parent and controlled target are not exact registered worktrees of the same Git authority.',
      { native_folder: nativeFolder, target_root: deps.repoRoot, common_dir: common, membership },
    );
  return { ok: true, value: true };
}

async function actor(deps: BuilderDeps, parent: string): Promise<BuilderResult<JsonObject>> {
  const observed = await native(deps, ['whoami'], 'pij whoami');
  if (!observed.ok) return observed;
  if (
    observed.value.id !== parent ||
    !text(observed.value.folder) ||
    !text(observed.value.session)
  ) {
    return runtimeFailure(
      'The actual sending seat/session/root does not match the declared parent.',
      observed.value,
    );
  }
  if (observed.value.folder !== deps.repoRoot) {
    const pane = observed.value.pane;
    if (
      !text(pane) ||
      !/^%\d+$/.test(pane) ||
      (deps.env.get('TMUX_PANE') && deps.env.get('TMUX_PANE') !== pane)
    )
      return runtimeFailure(
        'The native parent pane does not match the sending environment.',
        observed.value,
      );
    const authority = await verifyBuilderParentWorktreeAuthority(deps, observed.value.folder);
    if (!authority.ok) return authority;
  }
  return observed;
}

async function observePeer(
  deps: BuilderDeps,
  peer: string,
  root: string,
  requested: RoleBinding,
  parent: string,
): Promise<BuilderResult<RuntimeObservation>> {
  const state = await native(deps, ['state', peer], 'pij state');
  if (!state.ok) return state;
  const row = state.value;
  if (
    row.id !== peer ||
    row.liveness !== 'active' ||
    row.tombstonedAt != null ||
    row.cwd !== root ||
    row.parent !== parent ||
    row.harness !== requested.harness ||
    row.boundModel !== requested.model ||
    !Number.isSafeInteger(row.pid) ||
    (row.pid as number) <= 0 ||
    (requested.effort !== undefined && row.effort !== requested.effort)
  ) {
    return runtimeFailure(
      'Peer registration, liveness, root or requested configuration does not match.',
      row,
    );
  }
  const roster = await native(deps, ['list'], 'pij seats');
  if (!roster.ok) return roster;
  if (!Array.isArray(roster.value.seats)) return runtimeFailure('Native roster has no seat list.');
  const matches = roster.value.seats.filter(
    (entry): entry is JsonObject => object(entry) && entry.id === peer,
  );
  const seat = matches[0];
  if (
    matches.length !== 1 ||
    !seat ||
    !text(seat.session) ||
    seat.folder !== root ||
    seat.parent !== parent ||
    seat.harness !== row.harness ||
    seat.model !== row.boundModel ||
    !object(seat.proc) ||
    seat.proc.pid !== row.pid ||
    seat.proc.proc_start !== row.procStart ||
    seat.tombstoned_at != null ||
    (seat.effort ?? undefined) !== (row.effort ?? undefined)
  ) {
    return runtimeFailure(
      'Native session/process binding is absent or changed during readiness observation.',
      seat,
    );
  }
  if (row.effort != null && !text(row.effort))
    return runtimeFailure('Native effort observation is malformed.', row);
  return {
    ok: true,
    value: {
      peer_id: peer,
      root,
      ready: true,
      harness: row.harness as string,
      model: row.boundModel as string,
      ...(text(row.effort) && { effort: row.effort }),
      native_session: seat.session,
      pid: row.pid as number,
      evidence: [
        `pij-rs state: ${JSON.stringify({ id: row.id, liveness: row.liveness, cwd: row.cwd, harness: row.harness, boundModel: row.boundModel, effort: row.effort, pid: row.pid, procStart: row.procStart, parent: row.parent })}`,
        `pij-rs list: ${JSON.stringify({ id: seat.id, session: seat.session, folder: seat.folder, proc: seat.proc, harness: seat.harness, model: seat.model, effort: seat.effort })}`,
      ],
      gaps: [
        'Provider-served inference identity is unverified; these observations bind launch/session configuration only.',
        'Native public state does not expose process argv or environment; the peer acknowledgement must name its observation limits.',
        ...(row.effort == null
          ? ['Effective effort is unverified; no effort override was observed.']
          : []),
      ],
    },
  };
}

async function verifyRoot(
  deps: BuilderDeps,
  root: string,
  sha: string,
  branch?: string,
): Promise<BuilderResult<true>> {
  if (deps.fs.realpath(root) !== root)
    return runtimeFailure('Workspace root is missing or aliased.');
  const result = await deps.exec.run(
    'git',
    [
      'rev-parse',
      '--show-toplevel',
      'HEAD',
      ...(branch === undefined ? [] : ['--abbrev-ref', 'HEAD']),
    ],
    { cwd: root, timeoutMs: 10000 },
  );
  const lines = result.stdout.trim().split(/\r?\n/);
  if (branch === undefined) {
    if (!result.ok || lines.length !== 2 || lines[0] !== root || lines[1] !== sha)
      return runtimeFailure(
        'Native Git root or HEAD does not match the frozen workspace baseline.',
        result,
      );
  } else {
    if (
      !result.ok ||
      lines.length !== 3 ||
      lines[0] !== root ||
      !/^[0-9a-f]{40}$/.test(lines[1] ?? '') ||
      !branch ||
      lines[2] !== branch
    )
      return runtimeFailure(
        'Native Git root or branch no longer matches the released allocation.',
        result,
      );
    const ancestry = await deps.exec.run('git', ['merge-base', '--is-ancestor', sha, lines[1]!], {
      cwd: root,
      timeoutMs: 10000,
    });
    if (!ancestry.ok)
      return runtimeFailure(
        'Released checkout is not descended from the current sealed source.',
        ancestry,
      );
  }
  return { ok: true, value: true };
}

function verifyRef(deps: BuilderDeps, ref: FileDigest): BuilderResult<true> {
  const current = digestBuilderFile(deps, ref.path);
  if (!current.ok) return current;
  if (current.value.sha256 !== ref.sha256) return ackFailure(`Bound artifact changed: ${ref.path}`);
  return { ok: true, value: true };
}

function lockUnit(deps: BuilderDeps, path: string): BuilderResult<{ release(): void }> {
  const token = deps.nonce();
  deps.fs.mkdirp(posixDirname(path));
  if (!deps.fs.createExclusive(path, token))
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Unit operation is already claimed: ${path}`,
      'Inspect the owning operation or interrupted lock before retrying; never steal it.',
    );
  return {
    ok: true,
    value: {
      release() {
        if (deps.fs.readText(path) === token) deps.fs.deleteFile(path);
      },
    },
  };
}

export async function checkBuilderPeerReleased(
  deps: BuilderDeps,
  peerId: string,
): Promise<BuilderResult<boolean>> {
  if (!key(peerId)) return runtimeFailure('Invalid peer identity.');
  const state = await native(deps, ['state', peerId], 'pij state');
  if (!state.ok) return state;
  const row = state.value;
  if (row.id !== peerId) return runtimeFailure('Release observation belongs to a different peer.');
  if (row.liveness === 'active') return { ok: true, value: false };
  if ((row.liveness !== 'dead' && row.liveness !== 'recycled') || !text(row.cwd)) {
    return runtimeFailure(
      'Recorded peer liveness or native root is unobservable; unbound and absent are not release.',
      row,
    );
  }
  // Native liveness already compares PID plus process start time. A tombstone is
  // neither necessary nor sufficient: supersession can leave the process alive.
  const roster = await native(deps, ['list'], 'pij seats');
  if (!roster.ok) return roster;
  if (
    !Array.isArray(roster.value.seats) ||
    !Array.isArray(roster.value.unavailable) ||
    roster.value.unavailable.length !== 0
  ) {
    return runtimeFailure(
      'The native seat roster is incomplete; root occupancy cannot be ruled out.',
      roster.value,
    );
  }
  const root = deps.fs.realpath(row.cwd) ?? row.cwd;
  const occupants: JsonObject[] = [];
  for (const seat of roster.value.seats) {
    if (!object(seat) || !text(seat.id) || !text(seat.folder))
      return runtimeFailure('A native seat lacks identity/root evidence.', seat);
    if ((deps.fs.realpath(seat.folder) ?? seat.folder) === root) occupants.push(seat);
  }
  if (occupants.filter((seat) => seat.id === peerId).length !== 1)
    return runtimeFailure('The recorded peer is absent or ambiguous in the native root roster.');
  for (const occupant of occupants) {
    const observed = await native(deps, ['state', occupant.id as string], 'pij state');
    if (!observed.ok) return observed;
    const current = observed.value;
    if (
      current.id !== occupant.id ||
      !text(current.cwd) ||
      (deps.fs.realpath(current.cwd) ?? current.cwd) !== root
    )
      return runtimeFailure('Native root occupancy changed while release was observed.', current);
    if (current.liveness === 'active') return { ok: true, value: false };
    if (current.liveness !== 'dead' && current.liveness !== 'recycled')
      return runtimeFailure(
        'A same-root seat is unbound or unobservable; the workspace is not released.',
        current,
      );
  }
  return { ok: true, value: true };
}

function parseAck(deps: BuilderDeps, input: string): BuilderResult<AckReceipt> {
  const path = resolveInRepo(input, deps.repoRoot);
  const loaded = deps.fs.readTextFileNoFollow(posixDirname(path), path, 1024 * 1024);
  if (loaded.status !== 'ok') return ackFailure(`Cannot read acknowledgement: ${loaded.reason}`);
  let value: unknown;
  try {
    value = JSON.parse(loaded.text);
  } catch {
    return ackFailure('Acknowledgement is not JSON.');
  }
  if (object(value) && object(value.dd)) {
    const canonical = readBuilderRecord<AckReceipt>(deps, path, 'ack');
    if (!canonical.ok) return canonical;
    value = canonical.value.value;
  }
  if (
    !object(value) ||
    value.record_type !== 'ack' ||
    ![
      'id',
      'recorded_at',
      'unit_id',
      'peer_id',
      'nonce',
      'packet_sha256',
      'baseline_sha',
      'native_root',
      'shell_cwd',
      'canary_nonce',
    ].every((field) => text(value[field])) ||
    !object(value.observed)
  )
    return ackFailure('Acknowledgement is missing required raw AckReceipt fields.');
  const observed = value.observed;
  if (
    !text(observed.peer_id) ||
    !text(observed.root) ||
    typeof observed.ready !== 'boolean' ||
    !Array.isArray(observed.evidence) ||
    !observed.evidence.every(text) ||
    !Array.isArray(observed.gaps) ||
    !observed.gaps.every(text)
  )
    return ackFailure('RuntimeObservation is malformed.');
  for (const field of ['harness', 'model', 'effort', 'native_session']) {
    if (observed[field] !== undefined && !text(observed[field]))
      return ackFailure(`Malformed observed ${field}.`);
  }
  if (
    (observed.pid !== undefined &&
      (!Number.isSafeInteger(observed.pid) || (observed.pid as number) <= 0)) ||
    (observed.argv !== undefined && (!Array.isArray(observed.argv) || !observed.argv.every(text)))
  )
    return ackFailure('Malformed runtime PID or argv.');
  if (!key(value.unit_id as string) || !key(value.nonce as string) || !key(value.peer_id as string))
    return ackFailure('Malformed acknowledgement identity.');
  return { ok: true, value: value as unknown as AckReceipt };
}

function verifyAckBindings(
  ack: AckReceipt,
  receipt: DispatchReceipt,
  contract: Packet,
  nonce: string,
): BuilderResult<true> {
  if (
    ack.unit_id !== receipt.unit_id ||
    ack.unit_id !== contract.unit.id ||
    ack.peer_id !== receipt.observed.peer_id ||
    ack.nonce !== nonce ||
    ack.packet_sha256 !== receipt.packet.sha256 ||
    ack.native_root !== contract.workspace ||
    ack.shell_cwd !== contract.workspace ||
    ack.observed.root !== contract.workspace ||
    ack.observed.peer_id !== ack.peer_id ||
    ack.observed.ready !== true ||
    JSON.stringify(receipt.requested) !== JSON.stringify(contract.requested)
  )
    return ackFailure(
      'Acknowledgement does not match the dispatched unit, peer, phase nonce, packet, root or settings.',
    );
  return { ok: true, value: true };
}

async function observeAcknowledgement(
  deps: BuilderDeps,
  ack: AckReceipt,
  receipt: DispatchReceipt,
  contract: Packet,
): Promise<BuilderResult<RuntimeObservation>> {
  const current = await observePeer(
    deps,
    ack.peer_id,
    contract.workspace,
    receipt.requested,
    contract.parent,
  );
  if (!current.ok) return current;
  for (const field of ['harness', 'model', 'effort', 'native_session', 'pid'] as const) {
    if (
      ack.observed[field] !== current.value[field] ||
      (receipt.observed.ready && receipt.observed[field] !== current.value[field])
    )
      return ackFailure(`Observed ${field} changed or was not acknowledged exactly.`);
  }
  const sender = await actor(deps, contract.parent);
  return sender.ok ? current : sender;
}

/** Receipt of an existing grant is observation, never a second grant or a pristine-source check. */
async function confirmRelease(
  deps: BuilderDeps,
  context: BuilderContext,
  ack: AckReceipt,
  dispatch: Stored<DispatchReceipt>,
  packet: Stored<Packet>,
  allocation: AllocationRecord,
): Promise<BuilderResult<DispatchResult>> {
  const receipt = dispatch.value;
  const release = receipt.release;
  if (!release || !receipt.acknowledgement)
    return ackFailure(
      'Post-release confirmation requires an accepted pre-work acknowledgement and an already-issued release.',
    );
  if (release.outcome !== 'queued' && release.outcome !== 'delivered')
    return ackFailure(
      'Post-release confirmation requires a recorded queued or delivered release, not a held or refused transport.',
    );
  const ingestedAt = deps.clock.nowIso();
  const observedTime = Date.parse(ack.recorded_at);
  const sentTime = Date.parse(release.recorded_at);
  const ingestedTime = Date.parse(ingestedAt);
  if (
    !text(release.recorded_at) ||
    ![observedTime, sentTime, ingestedTime].every(Number.isFinite) ||
    observedTime < sentTime - RELEASE_ACK_CLOCK_SKEW_MS ||
    observedTime > ingestedTime + RELEASE_ACK_CLOCK_SKEW_MS
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_ACK,
      'Post-release receipt has invalid timestamps or exceeds the explicit 5000 ms clock-skew tolerance.',
      'Check peer/PM clock skew and the original release time; submit a correctly timed receipt, not an incorrect or tampered timestamp.',
    );
  }
  const root = await verifyRoot(
    deps,
    packet.value.workspace,
    allocation.base_sha,
    allocation.branch,
  );
  if (!root.ok) return root;
  const current = await observeAcknowledgement(deps, ack, receipt, packet.value);
  if (!current.ok) return current;
  const authority = readCurrentBuilderBaseline(deps, context);
  if (
    !authority.ok ||
    authority.value.ref.sha256 !== receipt.baseline.sha256 ||
    authority.value.value.source_sha !== allocation.base_sha
  )
    return builderAttemptFailure();
  for (const ref of [
    dispatch.ref,
    receipt.packet,
    receipt.baseline,
    receipt.allocation,
    receipt.acknowledgement,
    packet.value.baseline,
    packet.value.allocation,
    packet.value.plan,
    packet.value.guide,
  ]) {
    const verified = verifyRef(deps, ref);
    if (!verified.ok) return verified;
  }
  const confirmationPath = builderRecordPath(
    context,
    'ack',
    `${receipt.unit_id}-${allocation.base_sha}-release`,
  );
  const confirmations = receipt.observed.evidence.filter((entry) =>
    entry.startsWith(RELEASE_CONFIRMATION_EVIDENCE),
  );
  if (confirmations.length) {
    const recorded = readBuilderRecord<AckReceipt>(deps, confirmationPath, 'ack');
    let proof: unknown;
    try {
      proof = JSON.parse(confirmations[0]!.slice(RELEASE_CONFIRMATION_EVIDENCE.length));
    } catch {
      return ackFailure('Recorded release confirmation evidence is malformed.');
    }
    if (
      confirmations.length !== 1 ||
      !recorded.ok ||
      JSON.stringify(recorded.value.value) !== JSON.stringify(ack) ||
      !object(proof) ||
      !object(proof.confirmation) ||
      !text(proof.confirmation.path) ||
      resolveInRepo(proof.confirmation.path, deps.repoRoot) !== confirmationPath ||
      proof.confirmation.sha256 !== recorded.value.ref.sha256 ||
      proof.observed_at !== ack.recorded_at ||
      !text(proof.ingested_at) ||
      !Number.isFinite(Date.parse(proof.ingested_at)) ||
      !object(proof.transport) ||
      proof.transport.message_id !== release.message_id ||
      proof.transport.recorded_at !== release.recorded_at ||
      !['queued', 'delivered'].includes(String(proof.transport.outcome)) ||
      release.outcome !== 'delivered'
    )
      return ackFailure(
        'Immutable post-release acknowledgement or its canonical evidence binding changed.',
      );
    return { ok: true, value: { dispatch, packet } };
  }
  // Create-only publication also admits byte-identical recovery after a dispatch-CAS failure.
  const stored = writeBuilderRecord(deps, confirmationPath, ack);
  if (!stored.ok) return stored;
  const evidence = `${RELEASE_CONFIRMATION_EVIDENCE}${JSON.stringify({ transport: release, confirmation: stored.value.ref, observed_at: ack.recorded_at, ingested_at: ingestedAt })}`;
  const confirmed = writeBuilderRecord(
    deps,
    dispatch.ref.path,
    {
      ...receipt,
      observed: {
        ...current.value,
        ...(ack.observed.argv && { argv: ack.observed.argv }),
        evidence: [
          ...receipt.observed.evidence,
          ...current.value.evidence,
          ...ack.observed.evidence,
          evidence,
        ],
        gaps: [...new Set([...receipt.observed.gaps, ...current.value.gaps, ...ack.observed.gaps])],
      },
      release: { ...release, outcome: 'delivered' },
    },
    { expectedSha256: dispatch.ref.sha256 },
  );
  return confirmed.ok ? { ok: true, value: { dispatch: confirmed.value, packet } } : confirmed;
}

/** Ack is durable before release. The per-unit claim spans the external send and both CAS writes. */
export async function acknowledgeBuilderUnit(
  deps: BuilderDeps,
  input: AckInput,
): Promise<BuilderResult<DispatchResult>> {
  const context = builderContext(deps, input.plan);
  if (!context.ok) return context;
  const parsed = parseAck(deps, input.receipt);
  if (!parsed.ok) return parsed;
  const ack = parsed.value;
  const claim = lockUnit(
    deps,
    `${builderRecordPath(context.value, 'dispatch', ack.unit_id)}.operation-lock`,
  );
  if (!claim.ok) return claim;
  try {
    const baseline = readCurrentBuilderBaseline(deps, context.value);
    if (!baseline.ok) return baseline;
    const sourceSha = baseline.value.value.source_sha;
    const attempt = `${ack.unit_id}-${sourceSha}`;
    const dispatchPath = builderRecordPath(context.value, 'dispatch', attempt);
    const packetPath = builderRecordPath(context.value, 'packet', attempt);
    const ackPath = builderRecordPath(context.value, 'ack', attempt);
    const confirmation = ack.id === `ack-${attempt}-release`;
    if (ack.baseline_sha !== sourceSha || (!confirmation && ack.id !== `ack-${attempt}`))
      return builderAttemptFailure();
    const dispatch = readBuilderRecord<DispatchReceipt>(deps, dispatchPath, 'dispatch');
    if (!dispatch.ok) return builderAttemptFailure();
    const receipt = dispatch.value.value;
    if (
      receipt.id !== `dispatch-${attempt}` ||
      receipt.unit_id !== ack.unit_id ||
      resolveInRepo(receipt.packet.path, deps.repoRoot) !== packetPath ||
      receipt.baseline.sha256 !== baseline.value.ref.sha256 ||
      resolveInRepo(receipt.baseline.path, deps.repoRoot) !==
        resolveInRepo(baseline.value.ref.path, deps.repoRoot)
    )
      return builderAttemptFailure();
    const packetCheck = verifyRef(deps, receipt.packet);
    if (!packetCheck.ok) return builderAttemptFailure();
    const packet = readBuilderRecord<Packet>(deps, packetPath, 'packet');
    if (!packet.ok) return builderAttemptFailure();
    const contract = packet.value.value;
    if (
      contract.id !== `packet-${attempt}` ||
      contract.unit.id !== ack.unit_id ||
      contract.baseline.sha256 !== baseline.value.ref.sha256 ||
      resolveInRepo(contract.baseline.path, deps.repoRoot) !==
        resolveInRepo(baseline.value.ref.path, deps.repoRoot) ||
      contract.plan.sha256 !== baseline.value.value.plan.sha256 ||
      contract.guide.sha256 !== baseline.value.value.guide.sha256
    )
      return builderAttemptFailure();
    if (confirmation && (!receipt.acknowledgement || !receipt.release))
      return ackFailure(
        'Post-release confirmation requires an accepted pre-work acknowledgement and an already-issued release.',
      );
    const binding = verifyAckBindings(
      ack,
      receipt,
      contract,
      confirmation ? receipt.release!.message_id : contract.nonce,
    );
    if (!binding.ok) return binding;
    for (const ref of [
      receipt.baseline,
      receipt.allocation,
      contract.baseline,
      contract.allocation,
      contract.plan,
      contract.guide,
    ]) {
      const verified = verifyRef(deps, ref);
      if (!verified.ok) return verified;
    }
    if (
      receipt.baseline.sha256 !== contract.baseline.sha256 ||
      receipt.allocation.sha256 !== contract.allocation.sha256
    )
      return ackFailure('Packet and dispatch bind different baseline or allocation bytes.');
    const allocation = readBuilderRecord<AllocationRecord>(
      deps,
      receipt.allocation.path,
      'allocation',
    );
    if (!allocation.ok) return allocation;
    if (allocation.value.value.base_sha !== sourceSha) return builderAttemptFailure();
    if (
      ack.baseline_sha !== baseline.value.value.source_sha ||
      allocation.value.value.base_sha !== ack.baseline_sha ||
      allocation.value.value.root !== contract.workspace ||
      allocation.value.value.peer_id !== ack.peer_id ||
      allocation.value.value.unit_id !== ack.unit_id ||
      allocation.value.value.retired_at !== undefined
    )
      return ackFailure('Acknowledgement baseline or allocation ownership no longer matches.');
    if (
      resolveInRepo(contract.plan.path, deps.repoRoot) !== context.value.planPath ||
      baseline.value.value.plan.sha256 !== contract.plan.sha256 ||
      baseline.value.value.guide.sha256 !== contract.guide.sha256
    )
      return ackFailure('Acknowledgement belongs to a different or changed plan.');
    if (receipt.acknowledgement) {
      if (resolveInRepo(receipt.acknowledgement.path, deps.repoRoot) !== ackPath)
        return builderAttemptFailure();
      const recorded = readBuilderRecord<AckReceipt>(deps, ackPath, 'ack');
      if (
        !recorded.ok ||
        recorded.value.value.id !== `ack-${attempt}` ||
        recorded.value.value.unit_id !== ack.unit_id ||
        recorded.value.value.baseline_sha !== sourceSha
      )
        return builderAttemptFailure();
      if (recorded.value.ref.sha256 !== receipt.acknowledgement.sha256)
        return ackFailure('The accepted pre-work acknowledgement bytes changed.');
      if (confirmation) {
        const prior = verifyAckBindings(recorded.value.value, receipt, contract, contract.nonce);
        if (!prior.ok) return prior;
        if (recorded.value.value.canary_nonce !== ack.canary_nonce)
          return ackFailure(
            'Post-release challenge differs from the accepted pre-work acknowledgement.',
          );
        for (const field of ['harness', 'model', 'effort', 'native_session', 'pid'] as const) {
          if (recorded.value.value.observed[field] !== receipt.observed[field])
            return ackFailure(`Accepted pre-work ${field} no longer matches the dispatch.`);
        }
      } else {
        if (JSON.stringify(recorded.value.value) !== JSON.stringify(ack))
          return ackFailure('A different acknowledgement is already bound to this dispatch.');
        if (receipt.release)
          return { ok: true, value: { dispatch: dispatch.value, packet: packet.value } };
      }
    }
    for (const seed of receipt.seed_files) {
      const path = resolveInRepo(seed.path, contract.workspace);
      if (
        !isWithin(contract.workspace, path) ||
        posixRelative(contract.workspace, path) !== seed.path ||
        deps.fs.normalizeBundleTargetIdentity(path) !== path
      )
        return ackFailure('Dispatch seed path is not confined to its native root.');
      const bytes = deps.fs.readBytesNoFollow(path);
      if (bytes === null || sha256(bytes) !== seed.sha256)
        return ackFailure(`Native immutable seed changed: ${seed.path}`);
    }
    const challenges = receipt.seed_files.filter((seed) => seed.path === contract.canary.path);
    if (challenges.length !== 1 || challenges[0]?.sha256 !== sha256(ack.canary_nonce))
      return ackFailure('Native relative-file challenge does not match.');
    if (confirmation)
      return await confirmRelease(
        deps,
        context.value,
        ack,
        dispatch.value,
        packet.value,
        allocation.value.value,
      );
    const root = await verifyRoot(deps, contract.workspace, ack.baseline_sha);
    if (!root.ok) return root;
    for (const file of baseline.value.value.files) {
      const source = resolveInRepo(file.path, deps.repoRoot);
      if (!isWithin(deps.repoRoot, source))
        return ackFailure('Frozen source path escapes its repository.');
      const bytes = deps.fs.readBytesNoFollow(
        resolveInRepo(posixRelative(deps.repoRoot, source), contract.workspace),
      );
      if (bytes === null || sha256(bytes) !== file.sha256)
        return ackFailure(`Frozen source changed before release: ${file.path}`);
    }
    const status = await deps.exec.run(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: contract.workspace, timeoutMs: 10000 },
    );
    if (!status.ok) return ackFailure('Cannot inspect the native checkout before release.');
    const allowed = new Set(receipt.seed_files.map((seed) => seed.path));
    for (const entry of status.stdout.split('\0').filter(Boolean)) {
      if (!entry.startsWith('?? ') || !allowed.has(entry.slice(3)))
        return ackFailure(
          'Checkout changed before work release; only exact immutable seed files may be untracked.',
        );
    }
    const current = await observeAcknowledgement(deps, ack, receipt, contract);
    if (!current.ok) return current;
    const authority = readCurrentBuilderBaseline(deps, context.value);
    if (
      !authority.ok ||
      authority.value.ref.sha256 !== baseline.value.ref.sha256 ||
      authority.value.value.source_sha !== sourceSha
    )
      return builderAttemptFailure();
    const storedAck = writeBuilderRecord(deps, ackPath, ack);
    if (!storedAck.ok) return storedAck;
    const acknowledged = writeBuilderRecord(
      deps,
      dispatchPath,
      {
        ...receipt,
        observed: {
          ...current.value,
          ...(ack.observed.argv && { argv: ack.observed.argv }),
          evidence: [...current.value.evidence, ...ack.observed.evidence],
          gaps: [...new Set([...current.value.gaps, ...ack.observed.gaps])],
        },
        acknowledgement: storedAck.value.ref,
      },
      { expectedSha256: dispatch.value.ref.sha256 },
    );
    if (!acknowledged.ok) return acknowledged;
    const sent = await sendMessage(
      deps,
      contract.parent,
      ack.peer_id,
      `IMPLEMENTATION RELEASE — ${ack.peer_id} / ${ack.unit_id}; nonce ${ack.nonce}; packet ${ack.packet_sha256}; baseline ${ack.baseline_sha}. Implement only the immutable scoped packet.`,
      contract.nonce,
    );
    if (!sent.ok) return sent;
    const released = writeBuilderRecord(
      deps,
      dispatchPath,
      { ...acknowledged.value.value, release: { ...sent.value, recorded_at: deps.clock.nowIso() } },
      { expectedSha256: acknowledged.value.ref.sha256 },
    );
    if (!released.ok) return released;
    return { ok: true, value: { dispatch: released.value, packet: packet.value } };
  } finally {
    claim.value.release();
  }
}

async function sendMessage(
  deps: BuilderDeps,
  from: string,
  to: string,
  body: string,
  messageId: string,
): Promise<BuilderResult<{ message_id: string; outcome: 'queued' | 'delivered' }>> {
  const sent = await native(
    deps,
    ['send', '--from', from, '--to', to, '--body', body, '--msg-id', messageId],
    'pij send',
  );
  if (!sent.ok) return sent;
  const receipt = sent.value;
  if (receipt.msg_id !== messageId || !object(receipt.outcome))
    return runtimeFailure('Native send returned no matching receipt.', receipt);
  if (receipt.outcome.outcome === 'refused')
    return builderFailure(
      ErrorCodes.BUILDER_RUNTIME,
      'The recipient refused delivery; no successful release is recorded.',
      'Do not retry this refused message. Resolve the recipient decision explicitly.',
      receipt,
    );
  if (receipt.outcome.outcome !== 'queued' && receipt.outcome.outcome !== 'delivered')
    return runtimeFailure(
      'Native delivery was held or unobservable; no successful release is recorded.',
      receipt,
    );
  if (receipt.outcome.outcome === 'delivered' && !text(receipt.outcome.origin))
    return runtimeFailure('Delivered receipt has no observed delivery origin.', receipt);
  return { ok: true, value: { message_id: messageId, outcome: receipt.outcome.outcome } };
}

/** Provision through the shared boundary, launch at that native root, then publish acknowledgement-only work. */
export async function dispatchBuilderUnit(
  deps: DispatchDeps,
  input: DispatchInput,
): Promise<BuilderResult<DispatchResult>> {
  if (!key(input.unit) || !key(input.parent))
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Invalid unit or parent identity.',
      'Use the exact guide unit and registered governing peer.',
    );
  if (
    input.role.role !== 'coder' ||
    input.role.harness !== 'omp' ||
    !text(input.role.model) ||
    /\s|\0/.test(input.role.model) ||
    (input.role.effort !== undefined &&
      (!text(input.role.effort) || /\s|\0/.test(input.role.effort)))
  )
    return runtimeFailure(
      'Requested runtime/model/effort is unsupported; Builder currently dispatches native OMP coders only.',
    );
  const ready = await deps.readiness({ plan: input.plan, unit: input.unit });
  if (!ready.ok) return ready;
  if (ready.value.status !== 'ready')
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      'The unit is not ready for dispatch.',
      'Resolve every named guide/baseline prerequisite before provisioning.',
      ready.value.issues,
    );
  const { context, guide, baseline } = ready.value;
  const kind = resolveBuilderDispatchKind(guide.isolation.mode, input.kind);
  if (!kind.ok) return kind;
  if (kind.value === 'worktree')
    return runtimeFailure(
      'Native OMP cannot currently boot a linked-worktree Git-directory shape.',
      'Request clone explicitly or install a runtime that supports the declared worktree capability; no automatic substitution is made.',
    );
  const unit = guide.units.find((candidate) => candidate.id === input.unit);
  if (!unit || unit.role !== 'coder')
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      'This unit is not an independently dispatchable coder.',
      'Keep PM-owned work with its declared owner.',
    );
  const root = resolveInRepo(input.workspace, deps.repoRoot);
  if (
    isWithin(deps.repoRoot, root) ||
    isWithin(root, deps.repoRoot) ||
    deps.fs.normalizeBundleTargetIdentity(root) !== root
  )
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Coder root must be a separate, unaliased checkout.',
      'Choose an isolated root outside the PM checkout.',
    );
  const sender = await actor(deps, input.parent);
  if (!sender.ok) return sender;
  const sessionArgs: string[] = [];
  if (!deps.env.get('TMUX_PANE')) {
    if (!text(sender.value.pane) || !/^%\d+$/.test(sender.value.pane))
      return runtimeFailure('Headless dispatch has no observed parent tmux pane.');
    const session = await deps.exec.run(
      'tmux',
      ['display-message', '-p', '-t', sender.value.pane, '#{session_name}'],
      { cwd: deps.repoRoot, timeoutMs: 10000 },
    );
    if (!session.ok || !session.stdout.trim() || /[\r\n\0]/.test(session.stdout.trim()))
      return runtimeFailure(
        'Cannot resolve the named parent pane to an explicit tmux session.',
        session,
      );
    sessionArgs.push('--session', session.stdout.trim());
  } else if (deps.env.get('TMUX_PANE') !== sender.value.pane) {
    return runtimeFailure('Ambient tmux pane does not belong to the declared parent.');
  }
  const claim = lockUnit(deps, `${builderRecordPath(context, 'dispatch', unit.id)}.operation-lock`);
  if (!claim.ok) return claim;
  try {
    const authority = readCurrentBuilderBaseline(deps, context);
    if (!authority.ok) return authority;
    if (
      authority.value.ref.sha256 !== baseline.ref.sha256 ||
      authority.value.value.source_sha !== baseline.value.source_sha ||
      resolveInRepo(authority.value.ref.path, deps.repoRoot) !==
        resolveInRepo(baseline.ref.path, deps.repoRoot)
    )
      return builderAttemptFailure();
    const attempt = `${unit.id}-${authority.value.value.source_sha}`;
    const dispatchPath = builderRecordPath(context, 'dispatch', attempt);
    if (deps.fs.exists(dispatchPath)) {
      const existing = readBuilderRecord<DispatchReceipt>(deps, dispatchPath, 'dispatch');
      if (
        !existing.ok ||
        existing.value.value.id !== `dispatch-${attempt}` ||
        existing.value.value.unit_id !== unit.id ||
        existing.value.value.baseline.sha256 !== authority.value.ref.sha256 ||
        resolveInRepo(existing.value.value.baseline.path, deps.repoRoot) !==
          resolveInRepo(authority.value.ref.path, deps.repoRoot)
      )
        return builderAttemptFailure();
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        'This unit already has a durable dispatch.',
        'Acknowledge or explicitly reconcile that dispatch; never spawn a duplicate peer.',
      );
    }
    for (const ref of [
      baseline.ref,
      baseline.value.plan,
      baseline.value.guide,
      baseline.value.review,
      ...baseline.value.files,
    ]) {
      const checked = verifyRef(deps, ref);
      if (!checked.ok) return checked;
    }
    const planRoot = await verifyRoot(deps, deps.repoRoot, baseline.value.source_sha);
    if (!planRoot.ok) return planRoot;
    const slug = context.planDir.split('/').at(-1)?.replace(/^\d+-/, '');
    if (!slug)
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'Cannot resolve the canonical plan slug.',
        'Pass the guide-owned plan path.',
      );
    const workspace = await deps.provision({
      purpose: 'unit',
      slug,
      target: root,
      kind: kind.value,
      actor: input.parent,
      base: baseline.value.source_sha,
      plan: posixRelative(deps.repoRoot, context.planPath),
      unit: unit.id,
    });
    if (!workspace.ok) return workspace;
    const allocated = workspace.value.allocation;
    const allocation = allocated.value;
    if (
      allocation.root !== root ||
      allocation.kind !== kind.value ||
      allocation.purpose !== 'unit' ||
      allocation.unit_id !== unit.id ||
      allocation.base_sha !== baseline.value.source_sha ||
      allocation.actor !== input.parent ||
      allocation.retired_at !== undefined ||
      allocation.peer_id !== undefined ||
      allocation.owner !== guide.isolation.allocation_owner ||
      allocation.git_dir !== resolveInRepo('.git', root) ||
      isWithin(root, allocation.authority_root) ||
      !isWithin(allocation.authority_root, resolveInRepo(allocated.ref.path, deps.repoRoot))
    )
      return builderFailure(
        ErrorCodes.BUILDER_OWNERSHIP,
        'Provisioning returned a different or already-bound allocation.',
        'Inspect the allocation authority; dispatch never repurposes or silently changes a checkout.',
        allocated,
      );
    const nativeRoot = await verifyRoot(deps, root, baseline.value.source_sha);
    if (!nativeRoot.ok) return nativeRoot;
    const seeded = seedBuilderInputs(deps, root, baseline);
    if (!seeded.ok) return seeded;
    const spawn = await native(
      deps,
      [
        'spawn',
        '--harness',
        input.role.harness,
        '--bin',
        'omp',
        '--model',
        input.role.model,
        ...(input.role.effort !== undefined ? ['--effort', input.role.effort] : []),
        '--cwd',
        root,
        '--parent',
        input.parent,
        ...sessionArgs,
      ],
      'pij spawn',
    );
    if (!spawn.ok) return spawn;
    const launched = spawn.value;
    if (!text(launched.id) || !key(launched.id) || launched.dispatched !== true)
      return runtimeFailure(
        'Spawn returned no observable peer identity; inspect the launch before retrying.',
        launched,
      );
    const bound = writeBuilderRecord(
      deps,
      resolveInRepo(allocated.ref.path, deps.repoRoot),
      {
        ...allocation,
        peer_id: launched.id,
        journal: [...allocation.journal, `peer-launched:${launched.id}`],
      },
      { root: allocation.authority_root, expectedSha256: allocated.ref.sha256 },
    );
    if (!bound.ok)
      return {
        ...bound,
        details: { failure: bound.details, launched_peer: launched.id, allocation: allocated.ref },
      };
    const prepared = prepareBuilderPacket(deps, {
      context,
      baseline,
      allocation: bound.value,
      unit,
      parent: input.parent,
      requested: input.role,
      nonce: deps.nonce(),
    });
    if (!prepared.ok)
      return {
        ...prepared,
        details: {
          failure: prepared.details,
          launched_peer: launched.id,
          allocation: bound.value.ref,
        },
      };
    const observed = await observePeer(deps, launched.id, root, input.role, input.parent);
    const launchMatches =
      launched.folder === root &&
      launched.parent === input.parent &&
      launched.harness === input.role.harness &&
      launched.model === input.role.model &&
      observed.ok &&
      (launched.session == null || launched.session === observed.value.native_session) &&
      (launched.pid == null || launched.pid === observed.value.pid);
    const observation: RuntimeObservation =
      observed.ok && launchMatches
        ? observed.value
        : {
            peer_id: launched.id,
            root: '',
            ready: false,
            evidence: [
              `pij-rs spawn: ${JSON.stringify(launched)}`,
              ...(observed.ok ? observed.value.evidence : [observed.message]),
            ],
            gaps: ['Launch accepted, but exact native readiness is not established.'],
          };
    const receipt: DispatchReceipt = {
      record_type: 'dispatch',
      id: `dispatch-${attempt}`,
      recorded_at: deps.clock.nowIso(),
      unit_id: unit.id,
      packet: prepared.value.packet.ref,
      baseline: baseline.ref,
      allocation: { ...bound.value.ref, path: resolveInRepo(bound.value.ref.path, deps.repoRoot) },
      requested: input.role,
      observed: observation,
      seed_files: [...seeded.value, ...prepared.value.seeds],
    };
    const stored = writeBuilderRecord(deps, dispatchPath, receipt);
    if (!stored.ok) return stored;
    const result = { dispatch: stored.value, packet: prepared.value.packet };
    if (!observation.ready)
      return runtimeFailure(
        'Launch is recorded but not ready; no packet or work release was sent.',
        result,
      );
    const sent = await sendMessage(
      deps,
      input.parent,
      launched.id,
      `ACKNOWLEDGEMENT ONLY — ${unit.id}. Read native repository-relative packet ${prepared.value.packet.ref.path}; SHA-256 ${prepared.value.packet.ref.sha256}; nonce ${prepared.value.packet.value.nonce}; baseline ${baseline.value.source_sha}. Read the packet canary through native relative file tools, send your raw AckReceipt pointer, then WAIT for explicit IMPLEMENTATION RELEASE.`,
      deps.nonce(),
    );
    if (!sent.ok)
      return {
        ...sent,
        details: { failure: sent.details, dispatch: stored.value.ref, peer: launched.id },
      };
    return { ok: true, value: result };
  } finally {
    claim.value.release();
  }
}

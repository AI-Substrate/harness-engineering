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
import { verifyBuilderBasis } from './composition-service.js';
import {
  builderAttemptFailure,
  prepareBuilderPacket,
  readCurrentBuilderBaseline,
  seedBuilderInputs,
} from './packet-service.js';
import {
  builderFailure,
  builderRecordPath,
  digestBuilderFile,
  readBuilderRecord,
  verifyBuilderFilesAtCommit,
  writeBuilderRecord,
} from './records.js';
import type {
  BuilderDeps,
  BuilderResult,
  DispatchDeps,
  DispatchInput,
  DispatchReceipt,
  DispatchResult,
  FileDigest,
  ReadinessReport,
  RoleBinding,
  RuntimeObservation,
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
        'Native public state does not expose process argv or environment.',
        ...(row.effort == null
          ? ['Effective effort is unverified; no effort override was observed.']
          : []),
      ],
    },
  };
}

/** Fresh clones stay pristine; PM and explicitly adopted workers may have progressed. */
async function verifyRoot(
  deps: BuilderDeps,
  root: string,
  sourceSha: string,
  allowDescendant = false,
): Promise<BuilderResult<string>> {
  if (deps.fs.realpath(root) !== root)
    return runtimeFailure('Workspace root is missing or aliased.');
  const result = await deps.exec.run('git', ['rev-parse', '--show-toplevel', 'HEAD'], {
    cwd: root,
    timeoutMs: 10000,
  });
  const lines = result.stdout.trim().split(/\r?\n/);
  const head = lines[1] ?? '';
  if (
    !result.ok ||
    lines.length !== 2 ||
    toPosix(lines[0] ?? '') !== root ||
    !/^[0-9a-f]{40}$/.test(head)
  )
    return runtimeFailure(
      'Native Git root or HEAD does not match the frozen workspace baseline.',
      result,
    );
  if (head === sourceSha) return { ok: true, value: head };
  if (!allowDescendant)
    return runtimeFailure(
      'Native Git root or HEAD does not match the frozen workspace baseline.',
      result,
    );
  const ancestor = await deps.exec.run('git', ['merge-base', '--is-ancestor', sourceSha, head], {
    cwd: root,
    timeoutMs: 10000,
  });
  if (!ancestor.ok)
    return runtimeFailure(
      'The sealed source is neither HEAD nor an ancestor of HEAD in this repository; the baseline was rewritten or the checkout moved off its history.',
      { head, source_sha: sourceSha, result: ancestor },
    );
  return { ok: true, value: head };
}

function verifyRef(deps: BuilderDeps, ref: FileDigest): BuilderResult<true> {
  const current = digestBuilderFile(deps, ref.path);
  if (!current.ok) return current;
  if (current.value.sha256 !== ref.sha256)
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      `Bound artifact changed: ${ref.path}`,
      'Restore the sealed artifact or assess and seal the changed baseline before dispatch.',
    );
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
      'The recipient refused the work packet; no successful delivery is recorded.',
      'Do not retry this refused message. Resolve the recipient decision explicitly.',
      receipt,
    );
  if (receipt.outcome.outcome !== 'queued' && receipt.outcome.outcome !== 'delivered')
    return runtimeFailure(
      'Work-packet delivery was held or unobservable; no successful delivery is recorded.',
      receipt,
    );
  if (receipt.outcome.outcome === 'delivered' && !text(receipt.outcome.origin))
    return runtimeFailure('Delivered receipt has no observed delivery origin.', receipt);
  return { ok: true, value: { message_id: messageId, outcome: receipt.outcome.outcome } };
}

/** Record a native launch or existing peer binding, then publish its work packet. */
export async function dispatchBuilderUnit(
  deps: DispatchDeps,
  input: DispatchInput,
): Promise<BuilderResult<DispatchResult>> {
  if (
    !key(input.unit) ||
    !key(input.parent) ||
    (input.adoptPeer !== undefined && (!text(input.adoptPeer) || !key(input.adoptPeer)))
  )
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Invalid unit, parent or existing-peer identity.',
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
  if (ready.value.status !== 'ready') {
    return {
      ...builderFailure(
        ErrorCodes.BUILDER_NOT_READY,
        'The unit is not ready for dispatch.',
        'Resolve the named structural or proof prerequisite; map warnings do not prevent dispatch.',
        ready.value.issues,
      ),
      warnings: ready.value.warnings ?? [],
    };
  }
  const peerClaim =
    input.adoptPeer === undefined
      ? undefined
      : lockUnit(
          deps,
          `${builderRecordPath(ready.value.context, 'dispatch', `peer-${input.adoptPeer}-${ready.value.baseline.value.source_sha}`)}.operation-lock`,
        );
  if (peerClaim && !peerClaim.ok) return { ...peerClaim, warnings: ready.value.warnings ?? [] };
  try {
    const result = await dispatchReadyUnit(deps, input, ready.value);
    return result.ok ? result : { ...result, warnings: ready.value.warnings ?? [] };
  } finally {
    if (peerClaim?.ok) peerClaim.value.release();
  }
}

async function dispatchReadyUnit(
  deps: DispatchDeps,
  input: DispatchInput,
  ready: Extract<ReadinessReport, { status: 'ready' }>,
): Promise<BuilderResult<DispatchResult>> {
  const { context, guide, baseline } = ready;
  const adopting = input.adoptPeer !== undefined;
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
  if (!adopting && !deps.env.get('TMUX_PANE')) {
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
  } else if (deps.env.get('TMUX_PANE') && deps.env.get('TMUX_PANE') !== sender.value.pane) {
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
        'Inspect the recorded peer and transport outcome; reconcile that dispatch without spawning a duplicate.',
      );
    }
    for (const ref of [baseline.ref, baseline.value.review]) {
      const checked = verifyRef(deps, ref);
      if (!checked.ok) return checked;
    }
    const documents = await verifyBuilderBasis(deps, context, baseline.value);
    if (!documents.ok) return documents;
    const sealedFiles = await verifyBuilderFilesAtCommit(
      deps,
      baseline.value.source_sha,
      baseline.value.files,
    );
    if (!sealedFiles.ok) return sealedFiles;
    const planRoot = await verifyRoot(deps, deps.repoRoot, baseline.value.source_sha, true);
    if (!planRoot.ok) return planRoot;
    const planHead = planRoot.value;
    const slug = context.planDir.split('/').at(-1)?.replace(/^\d+-/, '');
    if (!slug)
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'Cannot resolve the canonical plan slug.',
        'Pass the guide-owned plan path.',
      );
    if (input.adoptPeer !== undefined) {
      const existingPeer = await observePeer(deps, input.adoptPeer, root, input.role, input.parent);
      if (!existingPeer.ok) return existingPeer;
      const existingRoot = await verifyRoot(deps, root, baseline.value.source_sha, true);
      if (!existingRoot.ok) return existingRoot;
      for (const candidate of guide.units) {
        if (candidate.role !== 'coder' || candidate.id === unit.id) continue;
        const candidateKey = `${candidate.id}-${baseline.value.source_sha}`;
        const candidatePath = builderRecordPath(context, 'dispatch', candidateKey);
        if (!deps.fs.exists(candidatePath)) continue;
        const prior = readBuilderRecord<DispatchReceipt>(deps, candidatePath, 'dispatch');
        if (!prior.ok) return prior;
        if (
          prior.value.value.id !== `dispatch-${candidateKey}` ||
          prior.value.value.unit_id !== candidate.id ||
          prior.value.value.baseline.sha256 !== baseline.ref.sha256
        )
          return builderAttemptFailure();
        if (prior.value.value.observed.peer_id === input.adoptPeer)
          return builderFailure(
            ErrorCodes.BUILDER_ACK,
            `Existing peer ${input.adoptPeer} is already bound to ${prior.value.value.unit_id}.`,
            'Use the correct distinct existing peer for each independent unit; preserve the recorded dispatch.',
            prior.value.ref,
          );
      }
    }
    const bindWorkspace = adopting ? deps.adoptUnit : deps.provision;
    const workspace = await bindWorkspace({
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
      (!adopting && allocation.actor !== input.parent) ||
      allocation.retired_at !== undefined ||
      (allocation.peer_id !== undefined && allocation.peer_id !== input.adoptPeer) ||
      (!adopting && allocation.owner !== guide.isolation.allocation_owner) ||
      allocation.git_dir !== resolveInRepo('.git', root) ||
      isWithin(root, allocation.authority_root) ||
      !isWithin(allocation.authority_root, resolveInRepo(allocated.ref.path, deps.repoRoot))
    )
      return builderFailure(
        ErrorCodes.BUILDER_OWNERSHIP,
        'Workspace binding returned a different or incompatible allocation.',
        'Inspect the allocation authority; dispatch never repurposes or silently changes a checkout.',
        allocated,
      );
    const nativeRoot = await verifyRoot(deps, root, baseline.value.source_sha, adopting);
    if (!nativeRoot.ok) return nativeRoot;
    if (adopting) {
      const branch = await deps.exec.run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
        cwd: root,
        timeoutMs: 10000,
      });
      if (!branch.ok || branch.stdout.trim() !== allocation.branch)
        return runtimeFailure(
          'Existing peer checkout no longer matches its allocated branch.',
          branch,
        );
    }
    const seeded = seedBuilderInputs(deps, root, baseline);
    if (!seeded.ok) return seeded;
    let peerId: string;
    let launched: JsonObject | undefined;
    if (input.adoptPeer !== undefined) {
      peerId = input.adoptPeer;
    } else {
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
      launched = spawn.value;
      if (!text(launched.id) || !key(launched.id) || launched.dispatched !== true)
        return runtimeFailure(
          'Spawn returned no observable peer identity; inspect the launch before retrying.',
          launched,
        );
      peerId = launched.id;
    }
    const bound =
      allocation.peer_id === peerId
        ? { ok: true as const, value: allocated }
        : writeBuilderRecord(
            deps,
            resolveInRepo(allocated.ref.path, deps.repoRoot),
            {
              ...allocation,
              peer_id: peerId,
              journal: [
                ...allocation.journal,
                `${adopting ? 'peer-adopted' : 'peer-launched'}:${peerId}`,
              ],
            },
            { root: allocation.authority_root, expectedSha256: allocated.ref.sha256 },
          );
    if (!bound.ok)
      return {
        ...bound,
        details: {
          failure: bound.details,
          ...(adopting ? { adopted_peer: peerId } : { launched_peer: peerId }),
          allocation: allocated.ref,
        },
      };
    const prepared = prepareBuilderPacket(deps, {
      context,
      baseline,
      allocation: bound.value,
      unit,
      parent: input.parent,
      requested: input.role,
      nonce: deps.nonce(),
      ...(adopting && { adoptedHead: nativeRoot.value }),
    });
    if (!prepared.ok)
      return {
        ...prepared,
        details: {
          failure: prepared.details,
          ...(adopting ? { adopted_peer: peerId } : { launched_peer: peerId }),
          allocation: bound.value.ref,
        },
      };
    const observed = await observePeer(deps, peerId, root, input.role, input.parent);
    const launchMatches =
      observed.ok &&
      (launched === undefined ||
        (launched.folder === root &&
          launched.parent === input.parent &&
          launched.harness === input.role.harness &&
          launched.model === input.role.model &&
          (launched.session == null || launched.session === observed.value.native_session) &&
          (launched.pid == null || launched.pid === observed.value.pid)));
    const observation: RuntimeObservation =
      observed.ok && launchMatches
        ? observed.value
        : {
            peer_id: peerId,
            root: '',
            ready: false,
            evidence: [
              ...(launched
                ? [`pij-rs spawn: ${JSON.stringify(launched)}`]
                : [`Existing peer adoption: ${peerId}; no spawn performed.`]),
              ...(observed.ok ? observed.value.evidence : [observed.message]),
            ],
            gaps: ['Peer binding is recorded, but exact native readiness is not established.'],
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
      observed: {
        ...observation,
        evidence: [
          ...observation.evidence,
          ...(adopting
            ? [
                `Existing native peer adopted without spawning; worker HEAD observed before metadata seeding: ${nativeRoot.value}. Existing commits and work were retained.`,
              ]
            : []),
          `plan root HEAD at dispatch: ${planHead} (sealed source ${baseline.value.source_sha}${planHead === baseline.value.source_sha ? '' : ', a descendant: receipts/evidence committed after the seal'})`,
        ],
      },
      seed_files: [...seeded.value, ...prepared.value.seeds],
      warnings: [
        ...(ready.warnings ?? baseline.value.warnings ?? []),
        ...(adopting && allocation.owner !== guide.isolation.allocation_owner
          ? [
              {
                file: '<guide:isolation/allocation_owner>',
                owning_unit: unit.id,
                stage: 'guide' as const,
                code: 'adopted-allocation-owner',
                message: `Existing ${allocation.owner} ownership is retained instead of the guide's ${guide.isolation.allocation_owner} allocation expectation.`,
                next_action:
                  'Use the original ownership and preservation rules; binding an existing peer does not grant retirement authority.',
              },
            ]
          : []),
      ],
    };
    const stored = writeBuilderRecord(deps, dispatchPath, receipt);
    if (!stored.ok) return stored;
    const result = { dispatch: stored.value, packet: prepared.value.packet };
    if (!observation.ready)
      return runtimeFailure(
        'Peer binding is recorded but native readiness does not match; no work packet was sent.',
        result,
      );
    const current = readCurrentBuilderBaseline(deps, context);
    if (
      !current.ok ||
      current.value.ref.sha256 !== baseline.ref.sha256 ||
      current.value.value.source_sha !== baseline.value.source_sha
    )
      return builderAttemptFailure();
    for (const ref of [
      prepared.value.packet.ref,
      bound.value.ref,
      baseline.ref,
      baseline.value.review,
    ]) {
      const checked = verifyRef(deps, ref);
      if (!checked.ok) return checked;
    }
    const retainedDocuments = await verifyBuilderBasis(deps, context, baseline.value);
    if (!retainedDocuments.ok) return retainedDocuments;
    const retainedFiles = await verifyBuilderFilesAtCommit(
      deps,
      baseline.value.source_sha,
      baseline.value.files,
    );
    if (!retainedFiles.ok) return retainedFiles;
    const sent = await sendMessage(
      deps,
      input.parent,
      peerId,
      [
        ...prepared.value.packet.value.instructions.slice(0, 4),
        `Work packet ${prepared.value.packet.ref.path}; SHA-256 ${prepared.value.packet.ref.sha256}.`,
        `Optional advisory self-check: harness builder self-check ${JSON.stringify(prepared.value.packet.ref.path)} --sha256 ${prepared.value.packet.ref.sha256}`,
        adopting
          ? 'This packet binds your existing work. Retain completed commits and current work; do not replay implementation. Return the intended committed delivery and its proof using this packet digest, and continue only remaining unit work.'
          : 'Receiving this packet means do the unit within its declared map. Report scoped committed delivery and proof to the PM.',
      ].join('\n'),
      deps.nonce(),
    );
    if (!sent.ok)
      return {
        ...sent,
        details: { failure: sent.details, dispatch: stored.value.ref, peer: peerId },
      };
    const delivered = writeBuilderRecord(
      deps,
      dispatchPath,
      { ...stored.value.value, delivery: { ...sent.value, recorded_at: deps.clock.nowIso() } },
      { expectedSha256: stored.value.ref.sha256 },
    );
    if (!delivered.ok)
      return {
        ...delivered,
        details: {
          failure: delivered.details,
          dispatch: stored.value.ref,
          peer: peerId,
          delivery: sent.value,
        },
      };
    return { ok: true, value: { dispatch: delivered.value, packet: prepared.value.packet } };
  } finally {
    claim.value.release();
  }
}

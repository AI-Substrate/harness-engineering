import { parse } from '@ai-substrate/dd';
import { isWithin, resolveInRepo, toPosix } from '../shared/posix-path.js';
import { recordSchema, sha256 } from './records.js';
import type { BuilderDeps, BuilderResult, SelfCheckInput, SelfCheckReport } from './types.js';

const MAX_INSPECTION_BYTES = 4 * 1024 * 1024;
const sourceSha = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const absoluteRoot = (value: unknown): value is string =>
  typeof value === 'string' && /^([A-Za-z]:)?\//.test(toPosix(value));

/** Inspect the selected record only; schema/link discovery would expand the local read boundary. */
function inspectionRecord(bytes: Uint8Array, kind: 'packet' | 'baseline') {
  try {
    const doc = parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      Array.isArray(doc) ||
      (doc.dd.schema !== recordSchema(kind) &&
        !(kind === 'packet' && doc.dd.schema === 'builder/packet')) ||
      doc.sections.length !== 1
    )
      return undefined;
    const section = doc.sections[0];
    return section?.name === kind && object(section.value) && section.value.record_type === kind
      ? section.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** A local observation, never an acknowledgement, lifecycle write or authority decision. */
export async function selfCheckBuilderPacket(
  deps: BuilderDeps,
  input: SelfCheckInput,
): Promise<BuilderResult<SelfCheckReport>> {
  const path = resolveInRepo(input.packet, deps.repoRoot);
  const report: SelfCheckReport = {
    packet: input.packet,
    expected: { packet_sha256: input.sha256 },
    observed: {},
    warnings: [],
  };
  const warn = (code: string, message: string, next_action: string, path?: string) => {
    report.warnings.push({ code, message, next_action, ...(path !== undefined && { path }) });
  };
  const loaded = deps.fs.readBytesNoFollow(path, { maxBytes: MAX_INSPECTION_BYTES });
  let packet: Record<string, unknown> | undefined;
  if (loaded === null) {
    warn(
      'packet-unavailable',
      'The selected packet is missing, unreadable, oversized or not a regular unaliased file.',
      'Select the dispatched, bounded regular packet file without a symlink.',
      input.packet,
    );
  } else {
    report.observed.packet_sha256 = sha256(loaded);
    if (report.observed.packet_sha256 !== input.sha256)
      warn(
        'packet-digest-mismatch',
        'The selected packet bytes differ from the supplied SHA-256.',
        'Compare the packet pointer and measured digest with the dispatch message; select the intended packet.',
        input.packet,
      );
    packet = inspectionRecord(loaded, 'packet');
    if (!packet) {
      warn(
        'packet-invalid',
        'The selected file is not a single UTF-8 Builder packet DD record.',
        'Select the original packet DD JSON named in the dispatch message.',
        input.packet,
      );
    } else {
      if (absoluteRoot(packet.workspace)) report.expected.root = toPosix(packet.workspace);
      else
        warn(
          'packet-invalid',
          'The packet has no absolute workspace root to compare.',
          'Ask the PM for the original packet with its checkout binding.',
          input.packet,
        );
      if (sourceSha(packet.source_sha)) report.expected.source_sha = packet.source_sha;
      else if (packet.source_sha !== undefined)
        warn(
          'packet-invalid',
          'The packet source_sha is not a full Git commit SHA.',
          'Ask the PM for the original packet with its source commit; do not infer it from the current HEAD.',
          input.packet,
        );
    }
  }

  try {
    const git = await deps.exec.run('git', ['rev-parse', '--show-toplevel', 'HEAD'], {
      cwd: deps.repoRoot,
      timeoutMs: 10000,
      env: { GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined },
    });
    const lines = git.stdout.trim().split(/\r?\n/);
    if (git.ok && lines.length === 2 && absoluteRoot(lines[0]) && sourceSha(lines[1])) {
      report.observed.root = toPosix(lines[0]);
      report.observed.source_sha = lines[1];
    } else {
      warn(
        'git-unavailable',
        'Git could not report a repository root and full HEAD commit for this checkout.',
        'Run from the intended Git checkout and inspect git rev-parse --show-toplevel HEAD.',
        deps.repoRoot,
      );
    }
  } catch {
    warn(
      'git-unavailable',
      'The local Git inspection could not be executed.',
      'Make Git available in the intended checkout and repeat the optional self-check.',
      deps.repoRoot,
    );
  }

  if (packet && packet.source_sha === undefined) {
    const baseline = packet.baseline;
    const root = report.observed.root;
    if (
      !root ||
      !object(baseline) ||
      typeof baseline.path !== 'string' ||
      !baseline.path ||
      typeof baseline.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(baseline.sha256)
    ) {
      warn(
        'baseline-unavailable',
        'The historical packet lacks an inspectable checkout or digest-bound baseline pointer.',
        'Restore the packet’s original baseline inside the intended checkout, or obtain a current packet with source_sha.',
        input.packet,
      );
    } else {
      const baselinePath = resolveInRepo(baseline.path, root);
      if (!isWithin(root, baselinePath)) {
        warn(
          'baseline-outside-root',
          'The historical baseline pointer is outside this checkout and was not read.',
          'Use the original digest-bound baseline copied inside the intended checkout.',
          baseline.path,
        );
      } else {
        const historical = deps.fs.readBytesNoFollow(baselinePath, {
          maxBytes: MAX_INSPECTION_BYTES,
          root,
        });
        if (historical === null) {
          warn(
            'baseline-unavailable',
            'The historical baseline is missing, unreadable, oversized or not an in-root regular file.',
            'Restore the original bounded regular baseline inside this checkout without symlinks.',
            baseline.path,
          );
        } else if (sha256(historical) !== baseline.sha256) {
          warn(
            'baseline-digest-mismatch',
            'Historical baseline bytes differ from the packet’s bound SHA-256; no source commit was inferred.',
            'Compare against the original baseline digest and restore the matching file.',
            baseline.path,
          );
        } else {
          const record = inspectionRecord(historical, 'baseline');
          if (record && sourceSha(record.source_sha))
            report.expected.source_sha = record.source_sha;
          else
            warn(
              'baseline-invalid',
              'The bound historical file is not a single baseline record with a full source SHA.',
              'Obtain the original baseline record or a current packet with source_sha.',
              baseline.path,
            );
        }
      }
    }
  }
  if (report.expected.root && report.observed.root && report.expected.root !== report.observed.root)
    warn(
      'root-mismatch',
      `Observed checkout ${report.observed.root} differs from packet workspace ${report.expected.root}.`,
      'Switch to the packet’s intended checkout or clarify the workspace with the PM before editing.',
      input.packet,
    );
  if (
    report.expected.source_sha &&
    report.observed.source_sha &&
    report.expected.source_sha !== report.observed.source_sha
  )
    warn(
      'source-mismatch',
      `Observed HEAD ${report.observed.source_sha} differs from packet source ${report.expected.source_sha}.`,
      'Inspect the checkout history and packet baseline with the PM; preserve existing work rather than resetting it.',
      input.packet,
    );
  return { ok: true, value: report };
}

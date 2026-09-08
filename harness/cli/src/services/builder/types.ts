import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { ExecPort } from '../../adapters/exec/exec-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ErrorCode } from '../../output/error-codes.js';
import type { ResolvedSettings } from '../settings/settings.js';

export interface CommandSpec {
  command: string;
  args: string[];
}

/** All service I/O is explicit. Command arguments are argv, never shell text. */
export interface BuilderDeps {
  fs: FsPort;
  exec: ExecPort;
  clock: Clock;
  env: EnvPort;
  repoRoot: string;
  schemasDir: string;
  /** Packaged templates; scaffold operations refuse explicitly when unavailable. */
  templatesDir?: string;
  harness: CommandSpec;
  ddocs: CommandSpec;
  pij: CommandSpec;
  nonce(): string;
}

export interface BuilderFailure {
  ok: false;
  code: ErrorCode;
  message: string;
  next_action: string;
  details?: unknown;
  warnings?: OwnershipWarning[];
}

export type BuilderResult<T> = { ok: true; value: T } | BuilderFailure;
export interface FileDigest {
  path: string;
  sha256: string;
}
export interface Stored<T> {
  ref: FileDigest;
  value: T;
}
export interface BuilderIssue {
  code: string;
  message: string;
  next_action: string;
  path?: string;
}
export interface BuilderTarget {
  plan: string;
}

export interface BuilderContext {
  repoRoot: string;
  planDir: string;
  planPath: string;
  guidePath: string;
  flowPath: string;
  teamDir: string;
}

export interface Check {
  id: string;
  description: string;
  command: string;
  args: string[];
  cwd: string;
  timeout_ms: number;
}

export interface CheckReceipt {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  recorded_at: string;
}

export type Role = 'coder' | 'reviewer';
export interface RoleProfile {
  harness: string;
  model: string;
  effort?: string;
}
export interface RoleBinding extends RoleProfile {
  role: Role;
  source: {
    harness: 'repo' | 'guide' | 'override';
    model: 'repo' | 'guide' | 'override';
    effort?: 'repo' | 'guide' | 'override';
  };
}
export type RoleOverrides = Partial<Record<Role, Partial<RoleProfile>>>;
export type ResolveRoles = (
  settings: ResolvedSettings,
  guide: Guide,
  overrides?: RoleOverrides,
) => BuilderResult<RoleBinding[]>;

export interface Unit {
  id: string;
  name: string;
  role: 'pm' | 'coder';
  responsibility: string;
  paths: string[];
  reads: Array<{ owner: string; paths: string[] }>;
  interface: string;
  depends_on: string[];
  wave: number;
  acceptance: string[];
  proof: string[];
  notes?: string;
}

/** Mirrors the canonical builder/impl-guide sections; links remain DD addresses. */
export interface Guide {
  meta: { title: string; plan: string; version: number; updated?: string };
  architecture: { principles: string; composition_root: string; contracts: string[] };
  fan_out: { decision: 'solo-pm' | 'coders'; rationale: string };
  capabilities: Array<{
    id: string;
    criterion: string;
    owner: string;
    path: string;
    proof: string[];
  }>;
  units: Unit[];
  baseline: { files: string[]; proof: string[]; receipt: string };
  isolation: {
    mode: 'worktree-per-coder' | 'clone-per-coder' | 'solo';
    allocation_owner: AllocationOwner;
    note: string;
  };
  roles: Array<RoleProfile & { id: string; role: string; note?: string }>;
  checks: Check[];
  composition: { owner: string; order: string[]; steps: string[]; proof: string[] };
  review: { when: string; inputs: string[]; proof: string[] };
  risks?: Array<{ id: string; text: string; check: string }>;
}

export interface GuideCheckReport {
  valid: boolean;
  issues: BuilderIssue[];
  warnings?: OwnershipWarning[];
  architectural_judgement: 'not-performed';
}
export interface GuideInput extends BuilderTarget {
  init?: boolean;
}
export interface BaselineInput extends BuilderTarget {
  review: string;
}
export interface ReadinessInput extends BuilderTarget {
  unit?: string;
}
export type ReadinessReport =
  | {
      status: 'ready';
      issues: BuilderIssue[];
      warnings?: OwnershipWarning[];
      context: BuilderContext;
      guide: Guide;
      baseline: Stored<BaselineReceipt>;
    }
  | { status: 'not-ready' | 'cant-tell'; issues: BuilderIssue[]; warnings?: OwnershipWarning[] };
export type AssessReadiness = (input: ReadinessInput) => Promise<BuilderResult<ReadinessReport>>;

export type AllocationOwner = 'harness' | 'external' | 'pij';
export type WorkspaceKind = 'worktree' | 'clone';
export type WorkspaceKindSelector = WorkspaceKind | 'guide';
export interface AllocationRecord {
  record_type: 'allocation';
  id: string;
  owner: AllocationOwner;
  kind: WorkspaceKind;
  purpose: 'plan' | 'unit';
  root: string;
  authority_root: string;
  git_dir: string;
  branch: string;
  base_sha: string;
  ordinal: number;
  slug: string;
  actor: string;
  recorded_at: string;
  journal: string[];
  plan_path?: string;
  parent_id?: string;
  unit_id?: string;
  peer_id?: string;
  retired_at?: string;
}

export interface WorkspaceInput {
  purpose: 'plan' | 'unit';
  slug: string;
  target: string;
  kind: WorkspaceKind;
  actor: string;
  base?: string;
  title?: string;
  phases?: string[];
  parent?: AllocationRecord;
  plan?: string;
  unit?: string;
}
export interface WorkspaceResult {
  allocation: Stored<AllocationRecord>;
  plan: string;
  flow: string;
}
export interface AdoptInput extends BuilderTarget {
  owner: 'external' | 'pij';
  actor: string;
}
export type ProvisionWorkspace = (input: WorkspaceInput) => Promise<BuilderResult<WorkspaceResult>>;

export interface BaselineReceipt {
  record_type: 'baseline';
  id: string;
  recorded_at: string;
  source_sha: string;
  plan: FileDigest;
  guide: FileDigest;
  files: FileDigest[];
  checks: CheckReceipt[];
  review: FileDigest;
  warnings?: OwnershipWarning[];
}

export interface RuntimeObservation {
  peer_id: string;
  root: string;
  ready: boolean;
  harness?: string;
  model?: string;
  effort?: string;
  native_session?: string;
  pid?: number;
  argv?: string[];
  evidence: string[];
  gaps: string[];
}

export interface Packet {
  record_type: 'packet';
  id: string;
  recorded_at: string;
  nonce: string;
  unit: Unit;
  plan: FileDigest;
  guide: FileDigest;
  baseline: FileDigest;
  allocation: FileDigest;
  /** Present on current packets; historical packets recover it from their bound baseline. */
  source_sha?: string;
  workspace: string;
  parent: string;
  requested: RoleBinding;
  forbidden: string[];
  /** Historical packet metadata; no current producer creates a root challenge. */
  canary?: { path: string };
  instructions: string[];
}

/** Historical evidence, read only for provenance and independent-review exclusions. */
export interface AckReceipt {
  record_type: 'ack';
  id: string;
  recorded_at: string;
  unit_id: string;
  peer_id: string;
  nonce: string;
  packet_sha256: string;
  baseline_sha: string;
  native_root: string;
  shell_cwd: string;
  canary_nonce: string;
  observed: RuntimeObservation;
}

export interface DispatchReceipt {
  record_type: 'dispatch';
  id: string;
  recorded_at: string;
  unit_id: string;
  packet: FileDigest;
  baseline: FileDigest;
  allocation: FileDigest;
  requested: RoleBinding;
  observed: RuntimeObservation;
  /** Exact immutable seed files, not a broad untracked-file exemption. */
  seed_files: FileDigest[];
  warnings?: OwnershipWarning[];
  /** Observed transport outcome for the work packet, never an acknowledgement gate. */
  delivery?: { message_id: string; outcome: 'queued' | 'delivered'; recorded_at: string };
  /** Historical handshake metadata; current dispatch/import do not consume it. */
  acknowledgement?: FileDigest;
  release?: { message_id: string; outcome: 'queued' | 'delivered'; recorded_at: string };
}

export interface DispatchDeps extends BuilderDeps {
  readiness: AssessReadiness;
  provision: ProvisionWorkspace;
  adoptUnit: ProvisionWorkspace;
}
export interface DispatchInput extends BuilderTarget {
  unit: string;
  workspace: string;
  parent: string;
  role: RoleBinding;
  /** Omission/guide resolves from isolation.mode; an explicit kind overrides it. */
  kind?: WorkspaceKindSelector;
  /** Bind this existing native peer without provisioning or spawning another checkout. */
  adoptPeer?: string;
}
export interface SelfCheckInput {
  packet: string;
  sha256: string;
}
export interface SelfCheckReport {
  packet: string;
  expected: { packet_sha256: string; root?: string; source_sha?: string };
  observed: { packet_sha256?: string; root?: string; source_sha?: string };
  warnings: BuilderIssue[];
}
export interface DispatchResult {
  dispatch: Stored<DispatchReceipt>;
  packet: Stored<Packet>;
}

export interface UnitDelivery {
  unit_id: string;
  peer_id: string;
  workspace: string;
  commit_sha: string;
  packet_sha256: string;
  baseline_sha: string;
}

/** Advisory map comparison, retained with the stage that observed it. */
export interface OwnershipWarning {
  file: string;
  owning_unit: string;
  stage: 'guide' | 'delivery' | 'import' | 'verify';
  unit_id?: string;
  code?: string;
  message?: string;
  next_action?: string;
}

export interface OnTrackInput extends BuilderTarget {
  unit?: string;
  from?: string;
  to?: string;
  untracked?: boolean;
}
export interface OnTrackReport {
  compared: boolean;
  mode: 'unit' | 'pm';
  unit_id?: string;
  basis?: 'explicit' | 'import' | 'baseline' | 'head';
  from?: string;
  to?: string;
  includes_worktree: boolean;
  includes_untracked: boolean;
  warnings: OwnershipWarning[];
  issues: BuilderIssue[];
}

/** Equality of a canonical Git tree projection, not a new product-check receipt. */
export interface IntegratedUnitProof {
  unit_id: string;
  delivery_sha: string;
  scope: 'unit-map' | 'delivery-changes';
  compared_paths: number;
  tree_sha256: string;
}

/** Import is not proof. artifact_sha is set only after committed-tree verification. */
export interface CompositionReceipt {
  record_type: 'composition';
  id: string;
  recorded_at: string;
  baseline: FileDigest;
  units: UnitDelivery[];
  integration_sha: string;
  artifact_sha?: string;
  files: FileDigest[];
  checks: CheckReceipt[];
  /** Absent on historical receipts. Never an authorization or proof gate. */
  warnings?: OwnershipWarning[];
  /** Absent on historical receipts; importing still does not establish artifact proof. */
  integration_method?: 'replayed' | 'already-integrated';
  integration_proofs?: IntegratedUnitProof[];
}
export interface CompositionDeps extends BuilderDeps {
  readiness: AssessReadiness;
}
export type ComposeInput = BuilderTarget &
  (
    | {
        mode: 'import';
        deliveries: UnitDelivery[];
        alreadyIntegrated?: boolean;
        /** Optional committed integration point; requires alreadyIntegrated. */
        integrationSha?: string;
      }
    | { mode: 'verify'; sha: string }
  );

export interface ReviewFinding {
  id: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  disposition: 'open' | 'fixed' | 'accepted';
  evidence?: string;
}
export interface ReviewReceipt {
  record_type: 'review';
  id: string;
  recorded_at: string;
  scope: 'decomposition' | 'composition';
  subject_sha: string;
  plan: FileDigest;
  guide: FileDigest;
  reviewer_id: string;
  requested: RoleBinding;
  observed: RuntimeObservation;
  verdict: 'approved' | 'changes-requested' | 'blocked';
  report: FileDigest;
  findings: ReviewFinding[];
}
export interface ReviewInput extends BuilderTarget {
  receipt: ReviewReceipt;
}
export interface AdvanceInput extends BuilderTarget {
  now: string;
}
export interface AdvanceResult {
  flow: string;
  now: string;
  warnings?: OwnershipWarning[];
}

export interface PreservedItem {
  source: string;
  destination: string;
  sha256: string;
  bytes: number;
  category: 'artifact' | 'wip' | 'report' | 'observation' | 'telemetry';
}
export interface PreservedRef {
  source_repo: string;
  source_ref: string;
  oid: string;
  destination_repo: string;
  destination_ref: string;
}
export interface PreservationReceipt {
  record_type: 'preservation';
  id: string;
  recorded_at: string;
  allocation_ids: string[];
  source_root: string;
  source_sha: string;
  composed_sha: string;
  archived_plan: string;
  survivor_root: string;
  retiring_roots: string[];
  inventory: PreservedItem[];
  refs: PreservedRef[];
}
export interface CloseInput extends BuilderTarget {
  survivor: string;
  allocations: Stored<AllocationRecord>[];
  /** Additional required evidence, including observations and telemetry, with an explicit class. */
  evidence: Array<{ path: string; category: PreservedItem['category'] }>;
}
export interface CloseResult {
  archive: string;
  preservation: Stored<PreservationReceipt>;
}
export interface TidyInput {
  allocation: Stored<AllocationRecord>;
  preservation: PreservationReceipt;
}
export interface TidyDeps extends BuilderDeps {
  /** Required capability; unavailable runtimes return a named failure, never permission. */
  peerReleased: (peerId: string) => Promise<BuilderResult<boolean>>;
}
export interface TidyResult {
  allocation: Stored<AllocationRecord>;
  removed: boolean;
}

/** Durable facts, never an independently advanced team lifecycle. */
export type BuilderRecord =
  | AllocationRecord
  | BaselineReceipt
  | Packet
  | AckReceipt
  | DispatchReceipt
  | CompositionReceipt
  | ReviewReceipt
  | PreservationReceipt;
export type RecordKind = BuilderRecord['record_type'];

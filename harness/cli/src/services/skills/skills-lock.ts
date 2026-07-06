import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { HARNESS_DIR } from '../shared/temp.js';

export type SkillsLockScope = 'project' | 'global';

export interface SkillsLockEntry {
  scope: SkillsLockScope;
  source: string;
  targets: string[];
}

export interface SkillsLock {
  lockfile_version: 1;
  installs: SkillsLockEntry[];
}

export function emptySkillsLock(): SkillsLock {
  return { lockfile_version: 1, installs: [] };
}

function isScope(value: unknown): value is SkillsLockScope {
  return value === 'project' || value === 'global';
}

function cleanTargets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const target of value) {
    if (typeof target !== 'string' || target.trim() === '' || seen.has(target)) continue;
    seen.add(target);
    out.push(target);
  }
  return out;
}

export function readSkillsLock(raw: string | null): SkillsLock {
  if (raw === null) return emptySkillsLock();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptySkillsLock();
    const obj = parsed as Record<string, unknown>;
    if (obj.lockfile_version !== 1 || !Array.isArray(obj.installs)) return emptySkillsLock();
    const installs: SkillsLockEntry[] = [];
    for (const item of obj.installs) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      if (!isScope(entry.scope) || typeof entry.source !== 'string' || entry.source.trim() === '') {
        continue;
      }
      const targets = cleanTargets(entry.targets);
      if (targets.length === 0) continue;
      installs.push({ scope: entry.scope, source: entry.source, targets });
    }
    return { lockfile_version: 1, installs };
  } catch {
    return emptySkillsLock();
  }
}

export function mergeSkillsLock(lock: SkillsLock, entry: SkillsLockEntry): SkillsLock {
  const targets = cleanTargets(entry.targets);
  if (targets.length === 0) return lock;
  const installs = lock.installs.map((i) => ({ ...i, targets: [...i.targets] }));
  const existing = installs.find((i) => i.scope === entry.scope && i.source === entry.source);
  if (existing) {
    const seen = new Set(existing.targets);
    for (const target of targets) {
      if (!seen.has(target)) {
        seen.add(target);
        existing.targets.push(target);
      }
    }
  } else {
    installs.push({ scope: entry.scope, source: entry.source, targets });
  }
  return { lockfile_version: 1, installs };
}

export function serializeSkillsLock(lock: SkillsLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function skillsLockPath(input: {
  cwd: string;
  env: EnvPort;
  scope: SkillsLockScope;
}): string | null {
  if (input.scope === 'project') {
    return posixJoin(toPosix(input.cwd), HARNESS_DIR, 'skills.lock.json');
  }
  const home = input.env.home();
  return home ? posixJoin(toPosix(home), HARNESS_DIR, 'skills.lock.json') : null;
}

export function readSkillsLockFile(fs: FsPort, path: string | null): SkillsLock {
  return path ? readSkillsLock(fs.readText(path)) : emptySkillsLock();
}

export function writeMergedSkillsLock(input: {
  fs: FsPort;
  path: string | null;
  entry: SkillsLockEntry;
}): boolean {
  if (!input.path) return false;
  const next = mergeSkillsLock(readSkillsLockFile(input.fs, input.path), input.entry);
  const slash = input.path.lastIndexOf('/');
  if (slash >= 0) input.fs.mkdirp(input.path.slice(0, slash));
  input.fs.writeText(input.path, serializeSkillsLock(next));
  return true;
}

import { describe, expect, it } from 'vitest';
import { PACKAGED_SKILLS_SOURCE } from '../../../src/services/skills/contract.js';
import {
  emptySkillsLock,
  mergeSkillsLock,
  readSkillsLock,
  serializeSkillsLock,
} from '../../../src/services/skills/skills-lock.js';

describe('skills lock (pure)', () => {
  it('treats missing, unreadable, or malformed lock content as empty', () => {
    expect(readSkillsLock(null)).toEqual(emptySkillsLock());
    expect(readSkillsLock('{not json')).toEqual(emptySkillsLock());
    expect(readSkillsLock('{"lockfile_version":99,"installs":"bad"}')).toEqual(emptySkillsLock());
  });

  it('merges targets into one entry per scope, deduping while preserving first-seen order', () => {
    const lock = mergeSkillsLock(emptySkillsLock(), {
      scope: 'project',
      source: PACKAGED_SKILLS_SOURCE,
      targets: ['codex', 'github-copilot'],
    });
    const merged = mergeSkillsLock(lock, {
      scope: 'project',
      source: PACKAGED_SKILLS_SOURCE,
      targets: ['codex', 'claude-code'],
    });

    expect(merged.installs).toEqual([
      {
        scope: 'project',
        source: PACKAGED_SKILLS_SOURCE,
        targets: ['codex', 'github-copilot', 'claude-code'],
      },
    ]);
  });

  it('keeps project and global entries separate', () => {
    const lock = mergeSkillsLock(
      mergeSkillsLock(emptySkillsLock(), {
        scope: 'project',
        source: PACKAGED_SKILLS_SOURCE,
        targets: ['codex'],
      }),
      { scope: 'global', source: PACKAGED_SKILLS_SOURCE, targets: ['claude-code'] },
    );

    expect(lock.installs).toEqual([
      { scope: 'project', source: PACKAGED_SKILLS_SOURCE, targets: ['codex'] },
      { scope: 'global', source: PACKAGED_SKILLS_SOURCE, targets: ['claude-code'] },
    ]);
  });

  it('serializes to stable pretty JSON with a trailing newline', () => {
    expect(
      serializeSkillsLock({
        lockfile_version: 1,
        installs: [{ scope: 'project', source: PACKAGED_SKILLS_SOURCE, targets: ['codex'] }],
      }),
    ).toBe(
      `{
  "lockfile_version": 1,
  "installs": [
    {
      "scope": "project",
      "source": "packaged",
      "targets": [
        "codex"
      ]
    }
  ]
}
`,
    );
  });
});

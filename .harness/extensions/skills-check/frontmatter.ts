/**
 * Pure SKILL.md frontmatter validation — no I/O, fully unit-tested.
 *
 * Encodes the Agent Skills spec (https://agentskills.io/specification) limits
 * that decide whether a host CLI will LOAD a skill at all:
 *   - `name`: required, ≤64 chars, lowercase letters/digits/hyphens, no
 *     leading/trailing hyphen, and must equal the containing directory name
 *     (that's how Claude Code / Copilot CLI resolve a skill).
 *   - `description`: required, 1–1024 chars. Over the limit a conforming
 *     loader treats the skill as INVALID and silently skips it — measured in
 *     the field 2026-06-11: Copilot CLI dropped `eng-harness-flow` (1379 chars)
 *     without a word.
 *
 * Lengths are counted in UTF-16 code units (`String.length`) — what a JS
 * loader measures. That is ≥ the code-point count, so it is the conservative
 * bound for emoji-bearing descriptions.
 *
 * The parser speaks just enough YAML for real frontmatter: plain scalars
 * (with ` #` comment truncation, as a real YAML parser sees them), quoted
 * scalars, and literal/folded block scalars (`|`, `>`) with chomping
 * indicators — the `description: |` form every skill in this repo uses.
 */

export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
/** Headroom band: warn before the next edit walks a description off the cliff. */
export const DESCRIPTION_WARN = 900;
/** Spec charset: lowercase/digits/hyphens, no leading or trailing hyphen. */
export const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type Severity = 'error' | 'warn';

export interface Finding {
  rule: string;
  severity: Severity;
  /** Repo-relative SKILL.md path the finding is about. */
  path: string;
  message: string;
}

export interface SkillFile {
  /** Repo-relative path to the SKILL.md. */
  path: string;
  /** Basename of the directory containing the SKILL.md. */
  dirName: string;
  /** Raw file contents. */
  text: string;
}

export interface ParsedFrontmatter {
  ok: boolean;
  fields: Record<string, string>;
  /** Why parsing failed (when !ok). */
  detail?: string;
}

/** Strip one pair of matching quotes; otherwise truncate plain scalars at a ` #` comment. */
function plainOrQuoted(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  // YAML: in a plain scalar, `#` preceded by whitespace starts a comment.
  const hash = v.search(/\s#/);
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}

/** Apply a block scalar's folding + chomping to its captured lines. */
function blockScalar(style: '|' | '>', chomp: '' | '-' | '+', lines: string[]): string {
  // Drop trailing all-blank lines but remember them for chomping.
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  const content = lines.slice(0, end);
  const trailingBlanks = lines.length - end;

  if (content.length === 0) return '';

  // Indentation = leading spaces of the first non-empty line.
  const indent = content.find((l) => l.trim() !== '')?.match(/^ */)?.[0].length ?? 0;
  const stripped = content.map((l) => (l.trim() === '' ? '' : l.slice(indent)));

  let body: string;
  if (style === '|') {
    body = stripped.join('\n');
  } else {
    // Folded: k consecutive line breaks fold to k-1 newlines — a single break
    // becomes a space, each blank line one newline (more-indented-line
    // subtleties skipped — uniform indents here).
    body = stripped[0];
    let blanks = 0;
    for (const line of stripped.slice(1)) {
      if (line === '') {
        blanks++;
      } else {
        body += blanks > 0 ? '\n'.repeat(blanks) + line : ` ${line}`;
        blanks = 0;
      }
    }
  }

  if (chomp === '-') return body;
  if (chomp === '+') return body + '\n'.repeat(trailingBlanks + 1);
  return `${body}\n`; // default "clip": exactly one trailing newline
}

/**
 * Parse the leading `--- … ---` frontmatter block. Returns top-level string
 * fields only — exactly the surface the Agent Skills spec constrains.
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  if (text.charCodeAt(0) === 0xfeff) {
    return { ok: false, fields: {}, detail: 'file starts with a UTF-8 BOM — strict loaders will not see the frontmatter' };
  }
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { ok: false, fields: {}, detail: 'no `---` frontmatter block at the very start of the file' };
  }
  const close = normalized.indexOf('\n---', 4);
  const closeOk = close !== -1 && (normalized[close + 4] === '\n' || close + 4 === normalized.length);
  if (!closeOk) {
    return { ok: false, fields: {}, detail: 'frontmatter opened with `---` but never closed' };
  }

  const lines = normalized.slice(4, close).split('\n');
  const fields: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!m) continue; // indented continuation handled by the block-scalar branch below
    const key = m[1];
    const rest = m[2].trim();

    const block = rest.match(/^([|>])([+-]?)\s*$/);
    if (block) {
      const captured: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^\s/.test(lines[i + 1]))) {
        captured.push(lines[i + 1]);
        i++;
      }
      fields[key] = blockScalar(block[1] as '|' | '>', (block[2] || '') as '' | '-' | '+', captured);
    } else {
      fields[key] = plainOrQuoted(rest);
    }
  }
  return { ok: true, fields };
}

/** Validate one SKILL.md against the spec rules. Pure — feed it text, get findings. */
export function checkSkill(skill: SkillFile): Finding[] {
  const findings: Finding[] = [];
  const at = (rule: string, severity: Severity, message: string) =>
    findings.push({ rule, severity, path: skill.path, message });

  const parsed = parseFrontmatter(skill.text);
  if (!parsed.ok) {
    at('frontmatter', 'error', parsed.detail ?? 'unparseable frontmatter');
    return findings;
  }

  const name = parsed.fields.name;
  const description = parsed.fields.description?.trim();

  if (name === undefined || name === '') {
    at('name-missing', 'error', 'required field `name` is missing or empty');
  } else {
    if (name.length > NAME_MAX) {
      at('name-too-long', 'error', `name is ${name.length} chars — the spec maximum is ${NAME_MAX}`);
    }
    if (!NAME_PATTERN.test(name)) {
      at('name-charset', 'error', `name '${name}' must be lowercase letters/digits/hyphens with no leading or trailing hyphen`);
    }
    if (name !== skill.dirName) {
      at('name-dir-mismatch', 'error', `name '${name}' must equal its directory name '${skill.dirName}' — that is how host CLIs resolve the skill`);
    }
  }

  if (description === undefined || description === '') {
    at('description-missing', 'error', 'required field `description` is missing or empty');
  } else if (description.length > DESCRIPTION_MAX) {
    at(
      'description-too-long',
      'error',
      `description is ${description.length} chars — over the spec maximum of ${DESCRIPTION_MAX}; host CLIs silently skip the skill. Cut ${description.length - DESCRIPTION_MAX}+ chars (aim ≤${DESCRIPTION_WARN}).`,
    );
  } else if (description.length > DESCRIPTION_WARN) {
    at(
      'description-near-limit',
      'warn',
      `description is ${description.length} chars — within the ${DESCRIPTION_MAX} limit but past the ${DESCRIPTION_WARN}-char headroom band; trim before the next edit walks it off the cliff`,
    );
  }

  return findings;
}

/** Validate a whole tree of skills: per-file rules + cross-file name uniqueness. */
export function checkAll(skills: SkillFile[]): Finding[] {
  const findings = skills.flatMap(checkSkill);

  const byName = new Map<string, string[]>();
  for (const s of skills) {
    const name = parseFrontmatter(s.text).fields.name;
    if (name) byName.set(name, [...(byName.get(name) ?? []), s.path]);
  }
  for (const [name, paths] of byName) {
    if (paths.length > 1) {
      for (const path of paths) {
        findings.push({
          rule: 'name-duplicate',
          severity: 'error',
          path,
          message: `name '${name}' is declared by ${paths.length} skills (${paths.join(', ')}) — installs would collide`,
        });
      }
    }
  }

  // Stable order: path, then rule — so report diffs are stable.
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));
}

export interface Decision {
  status: 'ok' | 'degraded' | 'error';
  data: {
    skills: number;
    errors: number;
    warnings: number;
    findings: Finding[];
  };
  next_action?: string;
  error?: { code: string; message: string };
}

/** Map findings onto the envelope contract: errors → error/1, warn-only → degraded/0, clean → ok/0. */
export function toDecision(skillCount: number, findings: Finding[]): Decision {
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  const data = { skills: skillCount, errors: errors.length, warnings: warnings.length, findings };

  if (errors.length > 0) {
    const first = errors[0];
    return {
      status: 'error',
      data,
      error: {
        code: 'E_SKILL_INVALID',
        message: `${errors.length} spec violation(s) across ${skillCount} skill(s); host CLIs will silently skip the offenders`,
      },
      next_action: `Fix ${first.path} first — ${first.message} Then re-run \`harness skills-check\`.`,
    };
  }
  if (warnings.length > 0) {
    return {
      status: 'degraded',
      data,
      next_action: `${warnings.length} skill(s) are inside the headroom band — trim their descriptions below ${DESCRIPTION_WARN} chars before they drift over ${DESCRIPTION_MAX}.`,
    };
  }
  return { status: 'ok', data };
}

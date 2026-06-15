/**
 * Minimal, pure SemVer "is-newer" comparison for the update check.
 *
 * Intentionally tiny — no dependency, no validation surface beyond what the
 * update decision needs: is `latest` strictly newer than `installed`? It is
 * pre-release aware (so a `-canary.N` build sorts below its release, per the
 * SemVer spec) and **safe by default**: if either side is malformed it returns
 * false — an unparseable version never produces a phantom "update available".
 */

interface Parsed {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers; empty array ⇒ a stable release. */
  prerelease: string[];
}

const NUMERIC = /^\d+$/;
/** A numeric identifier with no leading zero (SemVer §9 — `0` ok, `01` not). */
const NUMERIC_NOLEAD = /^(0|[1-9]\d*)$/;
/** A pre-release identifier's legal alphabet (SemVer §9). */
const PRERELEASE_ID = /^[0-9A-Za-z-]+$/;

/**
 * Parse `vX.Y.Z[-pre][+build]` → Parsed, or null if it isn't a clean triple.
 * Strict per SemVer §9 (companion F002): core/numeric-prerelease identifiers
 * reject leading zeroes; pre-release identifiers reject illegal characters — so
 * malformed input can never slip through and compare as "newer".
 */
function parse(raw: string): Parsed | null {
  if (typeof raw !== 'string') return null;
  let v = raw.trim();
  if (v === '') return null;
  if (v[0] === 'v' || v[0] === 'V') v = v.slice(1);

  // Build metadata (+…) is ignored for precedence (SemVer §10).
  const plus = v.indexOf('+');
  if (plus !== -1) v = v.slice(0, plus);

  const dash = v.indexOf('-');
  const core = dash === -1 ? v : v.slice(0, dash);
  const pre = dash === -1 ? '' : v.slice(dash + 1);

  const parts = core.split('.');
  if (parts.length !== 3) return null;
  if (!parts.every((p) => NUMERIC_NOLEAD.test(p))) return null; // reject leading zeroes / non-numeric

  const prerelease = pre === '' ? [] : pre.split('.');
  for (const id of prerelease) {
    if (!PRERELEASE_ID.test(id)) return null; // empty or illegal character
    if (NUMERIC.test(id) && !NUMERIC_NOLEAD.test(id)) return null; // numeric with a leading zero
  }

  return { major: Number(parts[0]), minor: Number(parts[1]), patch: Number(parts[2]), prerelease };
}

/** True iff `v` is a valid, concrete SemVer version (used to reject dist-tag pins — companion F005). */
export function isValidVersion(v: string): boolean {
  return parse(v) !== null;
}

function compareCore(a: Parsed, b: Parsed): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/** SemVer §11.4 pre-release precedence. A release (no pre-release) outranks any. */
function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a is a release, b is a pre-release ⇒ a newer
  if (b.length === 0) return -1;

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    const an = NUMERIC.test(ai);
    const bn = NUMERIC.test(bi);
    if (an && bn) {
      const x = Number(ai);
      const y = Number(bi);
      if (x !== y) return x < y ? -1 : 1;
    } else if (an !== bn) {
      return an ? -1 : 1; // numeric identifiers rank lower than alphanumeric
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1; // lexical ASCII order
    }
  }
  if (a.length !== b.length) return a.length < b.length ? -1 : 1; // more fields win
  return 0;
}

/**
 * True iff `latest` is strictly newer than `installed`. Malformed input on
 * either side ⇒ false (no update). Tolerates a leading `v`.
 */
export function isNewer(latest: string, installed: string): boolean {
  const l = parse(latest);
  const i = parse(installed);
  if (!l || !i) return false;
  const core = compareCore(l, i);
  if (core !== 0) return core > 0;
  return comparePrerelease(l.prerelease, i.prerelease) > 0;
}

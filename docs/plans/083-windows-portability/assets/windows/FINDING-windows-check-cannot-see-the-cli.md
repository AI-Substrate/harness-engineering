# FINDING — `windows-check` could never have caught defect 1, and a green reads as if it could

**Found** 2026-08-11 by `pij-balanced-mellanie` while fixing the null device. **Reported, not
fixed** — the gate is not that packet's scope.

## The claim

Our own cross-platform gate has **no reach into the product or the suite**. It could not have
caught the null-device defect, and it cannot catch anything in its class.

Two independent reasons, either sufficient on its own:

**1. Scope.** `.harness/extensions/windows-check/` scans only extension *source* files under
`.harness/extensions/`. Its own docstring: *"In scope = an extension SOURCE file under
`.harness/extensions/`, EXCLUDING the windows-check extension's own files, `fixtures/` and
`*.test.*`."* It never looks at `harness/cli/src` or `harness/cli/test` — **where all 112 Windows
failures live**. Corroborating: all 7 findings it reports today are inside `.harness/extensions/`,
consistent with it having no CLI reach.

**2. Pattern.** WIN007 matches `['"`]/(usr|bin|sbin|etc|home|root|opt)/` plus `process.env.HOME`.
`/dev/...` is not in that set, and **no rule matches `NUL` or `\\.\nul`**. So even with the scope
widened, the current rule set would not have flagged `platform === 'win32' ? 'NUL' : devNull`.

Usefully, the inverse also holds: widening the scope would **not** produce false positives against
the fix, because `/dev/null` matches nothing.

## Why this is worth writing down rather than just noting

**A green `windows-check` reads as "the Windows hazards are covered."** It isn't wrong — it is
answering a narrower question than the name suggests, and nothing at the call site says so. The
entire plan-083 defect class sits outside its boundary. That is the same shape as the defect it
failed to catch: a check that passes by not looking, which is indistinguishable from a check that
passes by finding nothing.

## Two candidate follow-ups — for whoever owns the gate

1. **A rule for config-path null devices** — `os.devNull` / `'NUL'` / `\\.\nul` used as a
   **config path value**. These are legitimate as a spawn stdio target, so the rule must key off
   `GIT_CONFIG_*` / config-path context rather than the bare identifier.
2. **A decision on scope.** Extensions-only may well be the right answer — but it should be a
   **stated boundary**, not an assumption inherited from where the extension happens to live.

**Do not promote `windows-check` to error in the same change that widens it.** A gate that has
never been observed refusing is not a verified gate; promoting and widening together makes its
first red also its first real run.

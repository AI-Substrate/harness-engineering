# Fix FX002: Proxy cold-replay lock remediation — per-package downgrade loop (INC-009 resolution)

> Started Vite-only (8.1.4→8.1.2); generalized 2026-07-15 (Jordan Source 2 + prime) into an iterative per-package loop after the Vite fix exposed the next in-lock proxy gap (rolldown). Vite is the first completed entry in the remediation ledger below.

**Created**: 2026-07-15
**Status**: Complete — GREEN (2026-07-15). Absolute cold `npm ci` PASS (exit 0, 0×404, 0 npmjs/unknown/denied); final lock `d12653fb…`; 5 packages remediated (ledger rows 1–5 + consequence 2a); 591 nodes/add0/remove0 vs post-ink baseline; 0 internal/signed URLs; 2527 tests + `harness checks` green. **Independent orchestrator re-verification of the final lock**: hash `d12653fb…` matches, all 6 target versions correct, 591 packages, 0 internal-host/signed-token/non-npmjs URLs, index clean (0 staged), no commits (HEAD cccc605d), worktree contains the expected Phase 3 diff; +46 vs cccc605d = the Phase-3 ink topology (expected). INC-009 unblocked.
**Plan**: `../typed-extensions-sensors-plan.md`
**Source**: HUMAN RULING via o-prime 2026-07-15: proxy/router truth is authoritative — a version absent from the proxy is not eligible/security-approved. Proxy latest vite = 8.1.2; 8.1.4 absent (verified twice + packument read). Bounded scope expansion explicitly authorized.
**Source 2 — GENERAL RULING (Jordan, direct, 2026-07-15, verbatim: "i think just do it, fix them all im not married to particualr versions")**: iterative remediation authorized for ALL cold-replay proxy gaps — for each cold-`npm ci` 404, downgrade THAT package (lock-only) to the proxy's latest version satisfying the committed manifest ranges, with the full per-package protocol below (pre-verify → canonicalizer transplant → evidence), repeating until cold ci passes. Hard STOPs remaining: a package with NO eligible proxy version in-range, or any fix requiring a `package.json` edit — those escalate. No package-count cap; report the full remediation list.
**Domain(s)**: repo root (lock only)

---

## Problem

The committed lock pins one or more packages at versions the mandated SFI proxy cannot serve (absent from the feed) — every policy-compliant cold `npm ci` fails repo-wide (INC-009), blocking p059's final landing. The gaps surface **one at a time** during cold replay: each fix advances the install to the next missing package. First observed: `vite@8.1.4` (absent → 8.1.2). Second: `rolldown@1.1.5` (absent → 1.1.4). The full set is unknown until a cold `npm ci` completes green — so remediation is an **iterative loop**, not a fixed edit.

## Proposed Fix

Iterative lock-only per-package downgrade: for each package the cold install reports missing, pin it to the proxy's latest **age-eligible** version that satisfies **every committed incoming semver constraint** (manifest untouched), via the same deterministic canonicalizer discipline as T009 — repeating until the cold install passes end-to-end. No `package.json` edits; no version chosen silently or unrecorded.

## Binding protocol — the per-package loop (any failure = STOP, never select another version silently)

For **each** package `P@bad` that cold `npm ci` reports absent from the proxy:

1. **Enumerate constraints**: record `P`'s currently-locked version AND every incoming committed semver range (from each dependent already in the lock/manifest). The chosen version must satisfy **all** of them simultaneously.
2. **Choose**: the proxy's **latest age-eligible** version that satisfies every constraint in step 1. If none exists → **HARD STOP, escalate** (do not touch the manifest to widen a range).
3. **Pre-verify via proxy under the full SFI config** (npm 11.10, age7, prefer-online, replace-registry-host=npmjs, host audit): metadata + tarball + integrity + age eligibility for the chosen version.
4. **Record the expected node/edge delta** for this package BEFORE mutating (which nodes change, which edges, what must stay byte-identical) — so the transplant is verified against a pre-stated expectation, not rationalized after.
5. **Scratch-resolve** the candidate atop the EXACT current p059 lock (already carrying all prior accepted remediations); **transplant only the required node/topology deltas** for `P` via the deterministic canonicalizer — preserving byte-exact: all validated ink topology, the four approved devOptional flips, zero libc changes, **every prior accepted remediation in this loop**, zero other old-entry drift, npmjs-format resolved URLs, zero internal hosts. Second canonicalizer run must reproduce the identical hash (idempotence).
6. **Re-run cold audited `npm ci` through the proxy.** If it advances to a NEW 404 → append that package to the ledger and repeat from step 1. If it PASSES end-to-end → the loop is done; proceed to the closeout gates.
7. Evidence per package: constraints, chosen version + why, command/env/timestamps/host-audit/URL/status/integrity, expected-vs-actual node delta, before/after lock hunks — appended to `FX002-vite-lock-remediation.log.md` and the ledger below.

**Closeout gates (once cold ci is green):** full root tests + `harness checks` + vite/vitest compatibility green on the installed result; final lock normalization byte-idempotent.

## Remediation ledger (single source of truth for the full list — feeds the Pony review)

| # | Package | Locked (bad) | Chosen | Incoming constraints satisfied | Proxy age-elig. | Status |
|---|---------|--------------|--------|-------------------------------|-----------------|--------|
| 1 | vite | 8.1.4 | 8.1.2 | vitest `^8.0.0`-class (manifest) | 14.53d @ 547233B, sha512-6YYP…I5AGQ== | ✅ transplanted; absolute cold-ci PASS |
| 2 | rolldown | 1.1.5 | 1.1.4 | vite `~1.1.3` = ≥1.1.3 <1.2.0 (sole dependent) | ✅ 13.65d @ 175956B, sha512-IjZY…HpXbA==; hosts proxy2/feed1/cdn1, npmjs/unknown/deny=0 | ✅ transplanted with 15 bindings + row 2a; absolute cold-ci PASS |
| 2a | @oxc-project/types | 0.139.0 | 0.138.0 | rolldown@1.1.4 `=0.138.0` (SOLE dependent; dev-only leaf, no sub-deps) | ✅ 15.44d @ 7707B, sha512-1a7Z…ZmfA==; hosts proxy2/feed1/cdn1, npmjs/unknown/deny=0 | ✅ transplanted with row 2; absolute cold-ci PASS |
| 3 | postcss | 8.5.18 | 8.5.16 | vite `^8.5.16` (= ≥8.5.16 <9; sole dependent) | ✅ proxy range selects 8.5.16; 16.62d @ 48702B, sha512-vuwi…yPwg==; hosts proxy2/feed1/cdn1, npmjs/unknown/deny=0 | ✅ transplanted; absolute cold-ci PASS |
| 4 | nanoid | 3.3.16 | 3.3.15 | postcss `^3.3.12` (= ≥3.3.12 **<4** — NOT the proxy's global-latest 5.1.16; stay on 3.x) | ✅ proxy-latest-in-range 3.3.15; 23.36d @ 5627B, sha512-y7Wy…HdjA==; hosts proxy2/feed1/cdn1, npmjs/unknown/deny=0 | ✅ transplanted; absolute cold-ci PASS |
| 5 | @biomejs/biome | 2.5.3 | 2.5.2 | root devDep `^2.5.0` (= ≥2.5.0 <3; sole dependent) | ✅ proxy-latest 2.5.2; 13.82d @ 89120B, sha512-VQ3R…hkKA==; hosts proxy2/feed1/cdn1, npmjs/unknown/deny=0 | ✅ transplanted with 8 CLI optionals; absolute cold-ci PASS (final `d12653fb…`) |

**Root cause (recorded for the review + retro):** the **pre-policy committed lock contained versions unavailable in the authoritative proxy**; **router truth defines eligibility** (a version absent from the proxy is not eligible/security-approved, per the Source-1 ruling). **Iterative in-range normalization restored cold replay** — each gap resolved identically by pinning to the proxy's latest age-eligible version satisfying **every committed incoming range**. No live npmjs comparison and no lag/ingestion claim is made or relied upon; eligibility is determined solely by the proxy. All gaps encountered (vite, rolldown+@oxc-project/types, postcss, nanoid, biome) had an eligible in-range version → **no hard-stop hit**; none needed a `package.json` edit. The nanoid case is the one trap: its dependent (postcss) pins the **3.x** line, so the proxy's latest *in-range* version (3.3.15) is not the proxy's latest *overall* (5.1.16).

### Expected node/edge delta — rolldown (pre-stated per prime, before transplant)

From the current candidate lock (`d931d773…`, post-vite):
- **`node_modules/rolldown`** (dev): version 1.1.5→1.1.4 + `resolved` + `integrity`. Its declared dep on `@rolldown/pluginutils` and the `@rolldown/binding-*` optional set to be read from the 1.1.4 packument.
- **15× `node_modules/@rolldown/binding-*`** (optional, dev) — currently all at 1.1.5, version in lockstep with rolldown: each expected 1.1.5→1.1.4 (version/resolved/integrity) **IF** rolldown@1.1.4's optionalDependencies pin that version. **`libc` arrays on the musl/gnu bindings MUST be preserved byte-identical** (this is exactly the forbidden-churn class from T009 — the raw resolver will try to strip them; canonicalizer discards that).
- **`node_modules/@rolldown/pluginutils`** (1.0.1, dev): changes **only if** rolldown@1.1.4 declares a different pluginutils range; if 1.1.4 still uses `1.0.1`, this node stays **byte-identical**. Coder confirms against the scratch resolution.
- **Edge**: `node_modules/vite → rolldown ~1.1.3` is satisfied by 1.1.4 — **NO edge/range change**, manifest untouched, vite node's dependency spec unchanged.
- **Byte-identical everywhere else**: the vite remediation (row 1), all ink topology, the 4 devOptional flips, all pre-existing libc arrays, npmjs-format URLs, zero internal hosts. Actual vs this expectation reported in the FX log; any node changing that is not listed here = STOP + report.

**EXPANSION 2a (coder STOP 2026-07-15, ruled in): rolldown@1.1.4 exact-pins `@oxc-project/types` at `=0.138.0`** (the 1.1.5 line pinned `=0.139.0`). The transplant of rolldown therefore **requires a 17th node** — `node_modules/@oxc-project/types` 0.139.0→0.138.0 (version/resolved/integrity). Adjudication (orchestrator, verified against the live lock + proxy):
- rolldown is the **SOLE dependent** on `@oxc-project/types` (grep of every dep-kind) → once rolldown→1.1.4, the only surviving constraint is `=0.138.0`; **no conflicting pin**, no other dependent to break.
- `@oxc-project/types` is a **dev-only leaf** (zero sub-dependencies) → the expansion is bounded to exactly this one node; node count stays 591/add0/remove0 (a version swap, not an add).
- 0.138.0 is on the proxy, published **2026-06-29** (~16d, age-eligible); coder runs the full binding pre-verify (metadata/tarball/integrity/hosts) before writing.
This node is now a **listed, expected** part of remediation row 2. Anything beyond {rolldown, 15 bindings, @oxc-project/types} still = STOP + report.

### Expected node/edge delta — postcss row 3 (pre-stated before transplant)

From candidate `401658da…` after row 2, the sole incoming constraint is `vite@8.1.2 → postcss ^8.5.16`. Under the seven-day cutoff, proxy range resolution selects 8.5.16. Its metadata declares the same dependency ranges as locked 8.5.18: `nanoid ^3.3.12`, `picocolors ^1.1.1`, and `source-map-js ^1.2.1`; all current nodes satisfy them.

- **Expected changing set: exactly `node_modules/postcss`** — 8.5.18→8.5.16, public-form `resolved`, and audited `integrity` only.
- **No edge/topology change**: Vite's `^8.5.16` and all three PostCSS dependency ranges stay byte-identical; package count remains 591/add0/remove0.
- **Everything else byte-identical**: rows 1/2/2a, all T009 topology/flips/libc arrays, and public URL form with zero internal/signed URLs.

Any candidate node beyond `node_modules/postcss`, or any PostCSS field beyond version/resolved/integrity, is a STOP + report.

### Expected node/edge delta — nanoid row 4 (pre-stated before transplant)

From candidate `17e013d0…`, Nanoid's sole incoming constraint is `postcss@8.5.16 → nanoid ^3.3.12`, which means ≥3.3.12 and <4. Proxy range enumeration returns 3.3.15 as the latest eligible 3.x version; global-latest 5.1.16 is explicitly rejected as out of range. Nanoid has no dependency edges.

- **Expected changing set: exactly `node_modules/nanoid`** — 3.3.16→3.3.15, public-form `resolved`, and audited `integrity` only.
- **No edge/topology change**: PostCSS's `^3.3.12` stays byte-identical; package count remains 591/add0/remove0.
- **Everything else byte-identical**: rows 1–3, T009 topology/flips/libc arrays, and zero internal/signed URLs.

Any candidate node beyond `node_modules/nanoid`, any Nanoid field beyond version/resolved/integrity, or any move to major 4/5 is a STOP + report.

### Expected node/edge delta — Biome row 5 (pre-stated before transplant)

From candidate `372cbd13…`, Biome's sole incoming constraint is root devDependency `^2.5.0`; proxy range resolution selects 2.5.2. Biome 2.5.2 has no normal dependencies and exact-pins the same eight `@biomejs/cli-*` platform optionals at 2.5.2.

- **Expected changing set: exactly nine nodes** — `node_modules/@biomejs/biome` plus its eight existing `node_modules/@biomejs/cli-*` optionals, all 2.5.3→2.5.2.
- Main Biome changes version/resolved/integrity plus its eight optional pin values; each CLI node changes version/resolved/integrity only.
- **Preserve libc byte-identically** on the four Linux GNU/musl CLI nodes; root `^2.5.0` stays unchanged; package count remains 591/add0/remove0.
- **Everything else byte-identical**: rows 1–4, T009 topology/flips/all other libc arrays, and zero internal/signed URLs.

Any changing node outside Biome plus those exact eight CLI optionals, or any additional field delta, is a STOP + report.

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX002-1 | The per-package loop (protocol steps 1–5 per package): SFI pre-verification + expected-delta record + scratch resolution + canonicalizer transplant, for EACH cold-replay gap until none remain | repo root | package-lock.json (+ scratch evidence) | every remediated package transplanted; all T009 invariants + every prior remediation re-proven byte-identical each round; idempotent second run each round | STOP on: no eligible in-range version, manifest edit needed, compatibility failure, unknown host, or any collateral drift beyond the current package's nodes |
| [x] | FX002-2 | Closeout (protocol step 6 terminal + gates): cold `npm ci` PASS through proxy (full host audit, zero npmjs/unknown), suite + checks + vitest compat green | repo root | (evidence → FX log) | INC-009 cold-replay RED→GREEN demonstrated end-to-end; all hard gates green | the landing unblock |

## Acceptance

- [x] Policy-compliant cold install of this repo succeeds **absolutely** end-to-end for the first time (not "only vite lines differ" — the full remediated set installs clean).
- [x] The remediation ledger above lists **every** package changed, each with recorded constraints + chosen version + evidence; no silent/unrecorded selection.
- [x] Vs the post-FX001 lock, only the ledgered packages' own nodes/edges differ; everything T009 validated is byte-identical; every prior remediation preserved.
- [x] Full remediation list carried into the Pony cold review.

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-07-15 | FX002-2 | Blocker | Vite remediation GREEN (8.1.2 fetched 200) but cold ci exposed the next proxy gap: rolldown@1.1.5 absent from feed (E404); coder STOPPED per protocol, lock left unstaged | General ruling (Source 2): iterate per-package downgrades until cold ci passes. Proxy latest rolldown = 1.1.4, satisfies vite's `~1.1.3` — orchestrator packument pre-probe 2026-07-15 |
| 2026-07-15 | FX002-2 | Outcome | Public-latest lock contained a chain of proxy-freshness gaps: Vite, Rolldown/OXC, PostCSS, Nanoid, and Biome/platform CLIs | Five bounded lock-only rows produced final `d12653fb…`; absolute cold `npm ci` passed with 553/553 HTTP 200, followed by 212/2527 tests and all hard harness gates green |

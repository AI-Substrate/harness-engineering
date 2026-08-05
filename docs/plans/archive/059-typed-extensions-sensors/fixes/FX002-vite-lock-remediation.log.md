# FX002 Vite lock remediation — execution log

**Protocol result**: **COMPLETE — initial Source 1 STOP superseded by Source 2 iterative ruling**  
**Final lock state**: `d12653fb…`, applied locally, unstaged, uncommitted  
**Authorized policy**: ledgered lock-only proxy-latest-in-range remediations

FX002 initially replaced unavailable `vite@8.1.4` with pre-verified `8.1.2`.
The first cold replay advanced past Vite but stopped on unchanged
`rolldown@1.1.5`, exactly as Source 1 required. Source 2 then authorized the
iterative per-package loop recorded below. That resumed loop reached an absolute
cold-install PASS and all closeout gates; the initial STOP evidence is retained
chronologically rather than rewritten.

## Environment and SFI configuration

- npm: `11.10.0`
- registry: `https://<sfi-proxy-host>/npm/`
- seven-day cutoff: `before=2026-07-08T05:26:34.363Z`
- `prefer-online=true`
- `replace-registry-host=npmjs` (rewrite mode only)
- fresh per-step caches
- `HTTP_PROXY`/`HTTPS_PROXY` and npm proxy settings pointed at the local
  fail-closed CONNECT auditor
- allowed host classes: the configured proxy, `<internal-feed-host>`,
  and `<internal-blob-host>`
- actual `registry.npmjs.org`, unknown hosts, and denied connections: forbidden

All persisted HTTP evidence has signed query strings redacted. No Microsoft
feed/CDN/SAS URL was written to `package-lock.json`.

## FX002-1 — pre-verification

**Run**: `2026-07-15T05:26:34Z`–`2026-07-15T05:26:47Z`

The bounded proxy-only probe ran the equivalent of:

```text
npm view vite@8.1.2 version dist.integrity dist.shasum dist.tarball time --json
npm pack vite@8.1.2 --json --ignore-scripts
```

Both commands used the complete SFI configuration above and a new cache.
Results:

| Evidence | Observed |
|---|---|
| Exact version | `8.1.2` |
| Published | `2026-06-30T16:46:39Z` |
| Age at probe | 14.53 days; eligible before the seven-day cutoff |
| Tarball bytes | `547233` |
| Unpacked bytes | `2240577` |
| Proxy metadata SHA-1 | `3ac29b5868ccf28c59321391be1ebe906f135ebd` |
| Independently computed SHA-1 | exact match |
| npm-pack SHA-512 | `sha512-6YYPbRXTxx6bRXmOn7XdnQAy5DQNHhDgtjhDHI13oe4pY93kkcdGJWxpGwOm++/Wh0QpQhDrpIoVMrmrsI5AGQ==` |
| Independently computed SHA-512 | exact match |
| HTTP results | four `200` responses across metadata/tarball retrieval |
| CONNECT audit | 4 total: proxy 2, feed 1, CDN 1 |
| denied / actual npmjs / unknown | `0 / 0 / 0` |

The Microsoft packument omits `dist.integrity`; it does provide `dist.shasum`.
The initial verifier incorrectly treated the absent field as a mismatch and
stopped before any lock mutation. Inspection established that there was no byte
mismatch: proxy SHA-1, npm-pack SHA-1/SHA-512, and independent SHA-1/SHA-512 all
agree. The initial verifier output is preserved as
`preverify-summary.initial-verifier.json`; the corrected proof is
`preverify-summary.json`.

## FX002-1 — exact scratch resolution and canonical transplant

The first scratch command used `--save=false`; npm correctly left the lock
unchanged. That no-op and its evidence are preserved under `resolve-nosave*`.
No root file changed. A fresh scratch copy of the exact current manifest/lock
then used an exact, scratch-only resolver edge:

```text
npm install vite@8.1.2 --package-lock-only --save-dev --save-exact \
  --ignore-scripts --no-audit --no-fund
```

This resolution started at `2026-07-15T05:29:24Z`. Fourteen metadata requests
returned `200` through the configured proxy. The CONNECT audit recorded one
allowed proxy connection and zero denied/npmjs/unknown connections. The raw
resolution had 591 package nodes, with no node additions or removals.

Raw npm normalization proposed only these classes:

1. the discarded scratch root `vite: 8.1.2` edge;
2. the exact Vite entry;
3. the known 14 npm-generated `libc` removals;
4. key-order-only rewrites of the four protected `devOptional` entries.

The deterministic canonicalizer rejected every other class, discarded the
scratch root edge and all normalization churn, restored public-form lock URLs,
and transplanted only `node_modules/vite`. It explicitly re-proved:

- 46 T009 Ink/React nodes byte-preserved;
- exactly four approved `devOptional:true` entries intact:
  `ansi-regex@6.2.2`, `es-toolkit@1.47.1`,
  `get-east-asian-width@1.6.0`, and `strip-ansi@7.2.0`;
- all 14 protected `libc` arrays intact;
- root optional edge byte-preserved;
- zero added or removed nodes;
- zero internal, proxy, feed, CDN, query, or signed lock URLs;
- real `package.json` byte-unchanged at SHA-256
  `7879868dc46f4385c9de84b186d6721930388dc3f9587429d8d5792410b51b1c`.

Lock hashes:

- post-FX001/T009 baseline:
  `2c900ce36a8c1d00852edc1a0fe612d459118f941c6b6076689daeef9408b0f4`
- FX002 candidate:
  `d931d77320558e8bc56ab6634e106fd4165e6e5ac73bd56e70d6e9a3f4491925`

Two dry runs produced the same candidate hash. The first real invocation
reported `transplantState=original`; the immediate second reported
`transplantState=candidate`; both real-lock hashes were identical.

The complete before/after hunk is retained at
`.harness/temp/fx002-vite-lock/vite-only.diff`. Its substantive delta is:

```diff
     "node_modules/vite": {
-      "version": "8.1.4",
-      "resolved": "https://registry.npmjs.org/vite/-/vite-8.1.4.tgz",
-      "integrity": "sha512-bTT9PsdWO+MQMNG9ZXIP/qM9wGh37DFxTV/sPq9cFpHr3w4jkgef032PkAL9jAqhk3Nz8NQw3O8n6/xFkqO4QQ==",
+      "version": "8.1.2",
+      "resolved": "https://registry.npmjs.org/vite/-/vite-8.1.2.tgz",
+      "integrity": "sha512-6YYPbRXTxx6bRXmOn7XdnQAy5DQNHhDgtjhDHI13oe4pY93kkcdGJWxpGwOm++/Wh0QpQhDrpIoVMrmrsI5AGQ==",
       "dependencies": {
         "lightningcss": "^1.32.0",
-        "picomatch": "^4.0.5",
+        "picomatch": "^4.0.4",
         "postcss": "^8.5.16",
-        "rolldown": "~1.1.4",
+        "rolldown": "~1.1.3",
         "tinyglobby": "^0.2.17"
```

The already-locked `picomatch@4.0.5` and `rolldown@1.1.5` satisfy those Vite
8.1.2 ranges, so no topology change was required.

## FX002-2 — required cold replay: RED, protocol STOP

**Run**: `2026-07-15T05:33:37Z`–`2026-07-15T05:33:51Z`  
**Command**: absolute root `npm ci --no-audit --no-fund` with the full SFI
environment, lifecycle scripts enabled, and a fresh cache  
**Exit**: `1`

The install removed the existing `node_modules`, fetched through the authorized
proxy/CDN classes, and advanced past the remediated Vite tarball:

- the exact Vite 8.1.2 content blob returned HTTP `200`;
- no `vite-8.1.2.tgz` request returned `404`;
- no `vite-8.1.4.tgz` request occurred;
- the candidate lock remained byte-idempotent at `d931d773…`.

Cold replay network evidence:

| Metric | Observed |
|---|---:|
| CONNECTs | 268 |
| configured proxy | 15 |
| Microsoft CDN | 253 |
| unique hosts | 227 |
| denied / actual npmjs / unknown | `0 / 0 / 0` |
| captured HTTP statuses | 553 |
| HTTP 200 | 547 |
| HTTP 404 | 6 |

The terminal and authoritative failure was the unchanged Vite transitive:

```text
npm error code E404
npm error 404 Not Found - GET https://<sfi-proxy-host>/npm/rolldown/-/rolldown-1.1.5.tgz - Cannot find the file rolldown-1.1.5.tgz in package 'rolldown 1.1.5' in feed 'npm-public'
```

Other concurrent proxy 404 observations are enumerated in
`cold-ci-failure-summary.json`; no alternative source or version was tried.
The fresh cold cache was deleted after the sanitized evidence was captured.
Because `npm ci` cleans first and then failed, root `node_modules` is an empty
0-byte directory; Vite, Vitest, Rolldown, and `.bin/vitest` are absent.

## Initial Source 1 stop decision and remaining gate (superseded by Source 2)

The binding acceptance requires a complete cold proxy `npm ci` pass. It did not
pass. Therefore:

- FX002 is **not accepted as complete**;
- the new blocker is `rolldown@1.1.5` availability at the mandated proxy;
- no non-Vite lock entry was changed;
- no other Vite or Rolldown version was considered or selected;
- no registry fallback, cache fallback, or public npm contact was attempted;
- full root tests, Vite/Vitest runtime compatibility, and `harness checks` were
  **not run**, because protocol step 3 failed before step 4;
- staged files remain `0`; no commit was created;
- the candidate lock remains locally applied and unstaged for coordinator
  inspection, with the exact post-FX001 baseline retained in ignored scratch;
- queued OP-9 remains acknowledged but **not started** while FX002 is stopped.

### Initial acceptance matrix at Source 1 STOP (superseded)

- [x] Exact authorized Vite 8.1.2 pre-verified through the proxy.
- [x] Vite-only canonical lock candidate; all T009 invariants preserved.
- [x] Vite 8.1.2 tarball fetched successfully in cold replay.
- [ ] Policy-compliant cold install succeeds end-to-end — **blocked by unchanged `rolldown@1.1.5` proxy 404**.
- [ ] Full suite and `harness checks` on the cold install — **not reached**.

## Source 2 resume — iterative remediation

The human Source 2 ruling generalized FX002 into a one-package-at-a-time loop.
The Vite candidate `d931d773…` became the exact baseline for row 2.

### Row 2 — Rolldown 1.1.5 → 1.1.4

Constraint enumeration found one incoming edge: `vite@8.1.2` declares
`rolldown: ~1.1.3` (≥1.1.3 and <1.2.0). The proxy's ruled latest eligible
version, 1.1.4, satisfies it.

Rolldown pre-verification ran `2026-07-15T05:44:21Z`–`05:44:31Z` with cutoff
`2026-07-08T05:44:21.215Z`:

- published `2026-07-01T14:01:48Z` (13.65 days old);
- tarball `175956` bytes, unpacked `771682` bytes;
- proxy/npm-pack/independent hashes agreed at SHA-1
  `7e15fb26997353808330109ef6bffda274aaa027` and SHA-512
  `sha512-IjZYiLxZwpnhwhdBH2ugdTGVSdhCQUmLxLoqyjiL0JxYjyRst+5a0P3xfrTxJ5F638j4Mvvw5FAX5XE6eHpXbA==`;
- four HTTP `200` responses; CONNECT proxy/feed/CDN `2/1/1`, with
  denied/npmjs/unknown `0/0/0`.

The first exact scratch resolution correctly triggered a STOP before mutation:
Rolldown 1.1.4 exact-pins `@oxc-project/types =0.138.0`, requiring an unlisted
17th node. Evidence was captured in `actual-vs-expected.json`; the real lock
remained `d931d773…`. Expansion 2a then explicitly ruled this dev-only leaf into
the expected delta after verifying Rolldown is its sole dependent.

### Row 2a — @oxc-project/types 0.139.0 → 0.138.0

The full proxy pre-verification ran `2026-07-15T05:49:56Z`–`05:50:00Z` with
cutoff `2026-07-08T05:49:56.329Z`:

- published `2026-06-29T19:17:51Z` (15.44 days old);
- leaf tarball `7707` bytes, unpacked `44501` bytes;
- proxy/npm-pack/independent hashes agreed at SHA-1
  `ce9690ec80144b4c38dfed44e76a67b911df9aca` and SHA-512
  `sha512-1a7ZKmrRTCoN1XMZ4L0PyyqrMnrNlLyPuOkdSX2MZg7IiIGRUyurNhAm73ptDOraoBcIordsIGKNPKUzy3ZmfA==`;
- four HTTP `200` responses; CONNECT proxy/feed/CDN `2/1/1`, with
  denied/npmjs/unknown `0/0/0`.

### Row 2 canonical transplant

The re-released scratch resolution produced 591 nodes with zero additions or
removals. The canonicalizer accepted exactly the pre-stated 17-node set:

- `node_modules/rolldown` 1.1.5 → 1.1.4, including its OXC exact edge and 15
  optional binding pins;
- all 15 `node_modules/@rolldown/binding-*` nodes 1.1.5 → 1.1.4;
- `node_modules/@oxc-project/types` 0.139.0 → 0.138.0.

The candidate diff is exactly 67 insertions/67 deletions: three source fields
per binding, three source fields for OXC, and 19 Rolldown-owned lines. It has no
`libc` line change. `@rolldown/pluginutils@1.0.1`, the Vite row-1 entry and
`vite → rolldown ~1.1.3` edge are byte-identical. All 14 protected libc arrays,
46 T009-added nodes, four `devOptional` flips, root optional edge, and public URL
normalization passed. Internal/signed URL count is zero.

- baseline: `d931d77320558e8bc56ab6634e106fd4165e6e5ac73bd56e70d6e9a3f4491925`
- row-2 candidate: `401658daa5531c0223f4fe0d7f1f225e13e38db203331bbb37389baa78c22037`
- canonicalizer SHA-256:
  `f015f1b9e0171946b185017a0185a9b97df3ecf7850af2a221dbafd0b46b642c`
- first real state: `original`; immediate second: `candidate`; hashes identical.

Full row-2 evidence is retained under
`.harness/temp/fx002-vite-lock/remediations/02-rolldown-1.1.4/`; OXC probe
evidence is under sibling `02a-oxc-project-types-0.138.0/`.

### Cold run 02 — advanced to PostCSS

Candidate `401658da…` ran cold from `2026-07-15T05:54:03Z` to `05:54:16Z`.
The lock stayed byte-identical. The 293 allowed CONNECTs were proxy/CDN
`15/278`, with denied/npmjs/unknown `0/0/0`. Vite, Rolldown, and OXC fetched
past their former gaps; the terminal error advanced to `postcss@8.5.18`.

### Row 3 — PostCSS 8.5.18 → 8.5.16

Constraint enumeration found PostCSS's sole incoming edge at
`vite@8.1.2 → postcss ^8.5.16`. SFI range resolution selected 8.5.16 as the
proxy latest in range. Pre-verification (`2026-07-15T05:56:04Z`–`05:56:06Z`)
proved:

- published `2026-06-28T14:57:42Z` (16.62 days old);
- tarball `48702` bytes, unpacked `206377` bytes;
- proxy/npm-pack/independent SHA-1
  `1230ce0b5df354c24c0ea45f99ce5f6a88279d28` and SHA-512
  `sha512-vuwillviilfKZsg0VGj5R/YwwcHx4SLsIOI/7K6mQkWx+l5cUHTjj5g0AasTBcyXsbfTgrwsUNmVUb5xVwyPwg==`
  agree;
- four HTTP `200`; CONNECT proxy/feed/CDN `2/1/1`; denied/npmjs/unknown
  `0/0/0`.

The expected delta was recorded before scratch resolution: PostCSS alone,
version/resolved/integrity only. The scratch result matched exactly: 591 nodes,
add/remove zero, unchanged PostCSS dependencies (`nanoid ^3.3.12`, `picocolors
^1.1.1`, `source-map-js ^1.2.1`), and unchanged Vite edge. The canonicalizer
changed only `node_modules/postcss`, preserved all prior rows/T009/libc/flips,
and produced byte-identical dry and two real runs:

- baseline `401658daa5531c0223f4fe0d7f1f225e13e38db203331bbb37389baa78c22037`;
- row-3 candidate `17e013d089d3dc7acf6b1558abb4c2dcf714c8fffd726b3da683bc436679cba3`;
- first real state `original`; second `candidate`.

Evidence: `.harness/temp/fx002-vite-lock/remediations/03-postcss/`.

### Cold run 03 — advanced to Nanoid

Candidate `17e013d0…` ran cold `2026-07-15T05:59:40Z`–`05:59:51Z` and stayed
byte-identical. All 282 CONNECTs were proxy/CDN (`15/267`), with
`deny/npmjs/unknown=0`. PostCSS cleared; the terminal error advanced to
`nanoid@3.3.16`.

### Row 4 — Nanoid 3.3.16 → 3.3.15

The sole incoming range is `postcss@8.5.16 → nanoid ^3.3.12`, constraining the
choice to ≥3.3.12 and <4. Proxy range enumeration returned 3.3.15 as the latest
eligible 3.x; global-latest 5.1.16 was explicitly rejected as out of range.
Full pre-verification (`2026-07-15T06:01:02Z`–`06:01:06Z`) proved:

- published `2026-06-21T21:23:58Z` (23.36 days old);
- tarball `5627` bytes, unpacked `24698` bytes;
- matching SHA-1 `36c490fad8c6e86c824c940dfdde999b69ed4316` and SHA-512
  `sha512-y7Wygv/7mEOvxTuEQDB8StXdMRBWf1kR/tlhAzBRUFkB2jfcLOAxO/SHmOO2zgz1pVgK29/kyupn059/bCHdjA==`;
- four HTTP `200`; proxy/feed/CDN `2/1/1`; denied/npmjs/unknown `0/0/0`.

The pre-stated and actual deltas matched: Nanoid alone,
version/resolved/integrity only; no dependencies, edge, topology, prior-row, or
T009 change. Two dry and two real canonicalizer runs were byte-identical:

- baseline `17e013d089d3dc7acf6b1558abb4c2dcf714c8fffd726b3da683bc436679cba3`;
- row-4 candidate `372cbd13df381d8691d48119cd73acf3663a717bbb4bb981e2359fa7048498ad`.

Evidence: `.harness/temp/fx002-vite-lock/remediations/04-nanoid/`.

### Cold run 04 — advanced to Biome

Candidate `372cbd13…` ran cold `2026-07-15T06:02:58Z`–`06:03:11Z`, with
276 allowed CONNECTs (proxy/CDN `15/261`) and denied/npmjs/unknown `0/0/0`.
Nanoid cleared; the terminal error advanced to `@biomejs/biome@2.5.3`.

### Row 5 — Biome 2.5.3 → 2.5.2 plus platform optionals

The sole incoming constraint is root devDependency `^2.5.0`. Proxy range
resolution returned 2.5.2. Full pre-verification
(`2026-07-15T06:04:39Z`–`06:04:42Z`) proved:

- published `2026-07-01T10:30:58Z` (13.82 days old);
- tarball `89120` bytes, unpacked `730429` bytes;
- matching SHA-1 `02e284f63fbbef1feca5297688e4f0459949c5c0` and SHA-512
  `sha512-VQ3RCqr7JmDIX+w6stWYl+g/3bYofN3q2wDBHUKKc/c7i5QWrFKFBZYCYPWTE6agsUPMIZZe6/CMmVUfUAhkKA==`;
- four HTTP `200`; proxy/feed/CDN `2/1/1`; denied/npmjs/unknown `0/0/0`.

Metadata and scratch resolution confirmed the pre-stated exact nine-node set:
Biome main plus eight platform CLI optionals, all 2.5.3→2.5.2. Biome has no
normal dependencies. The main node changed version/resolved/integrity plus its
eight pin values; each CLI changed version/resolved/integrity only. The four
Linux CLI libc arrays stayed byte-identical. Node count remained 591 with zero
add/remove, and every prior row/T009 invariant stayed byte-identical.

The diff is exactly 35 insertions/35 deletions and has no libc line change.
Two dry and two real canonicalizer runs were byte-identical:

- baseline `372cbd13df381d8691d48119cd73acf3663a717bbb4bb981e2359fa7048498ad`;
- row-5 candidate `d12653fb6d235edf15770bf19a7ff4d715dc603b83edc4622e75c134638bc36c`.

Evidence: `.harness/temp/fx002-vite-lock/remediations/05-biome/`.

## FX002-2 final absolute cold replay — PASS

Final candidate `d12653fb…` ran from `2026-07-15T06:08:01Z` to `06:08:17Z`
with lifecycle scripts enabled and a fresh cache. It exited `0`; the root
`prepare → build` chain ran successfully. The lock and manifest remained
byte-identical.

| Final cold metric | Observed |
|---|---:|
| CONNECTs | 280 |
| configured proxy | 15 |
| Microsoft CDN | 265 |
| denied / actual npmjs / unknown | `0 / 0 / 0` |
| HTTP statuses | 553 |
| HTTP 200 | 553 |
| HTTP 404 | 0 |
| terminal errors | 0 |

This is the first policy-compliant absolute cold install PASS for the branch.
Evidence: `.harness/temp/fx002-vite-lock/cold-runs/05-after-biome/summary.json`.

## Closeout gates

The installed compatibility matrix proves:

- Vitest `4.1.10` accepts and executed with Vite `8.1.2`;
- Vite ranges accept Rolldown `1.1.4` and PostCSS `8.5.16`;
- Rolldown exact-pins OXC types `0.138.0`;
- PostCSS accepts Nanoid `3.3.15` without crossing major 3;
- root `^2.5.0` accepts Biome `2.5.2`;
- dynamic Vite import reports `8.1.2`.

Validation on the cold-installed tree:

- root `npm test`: **212 files / 2,527 tests passed**;
- `vitest --version`: `vitest/4.1.10 darwin-arm64 node-v24.7.0`;
- final authoritative `harness checks --json` at `2026-07-15T06:13:54.265Z`:
  exit `0`, 14,131 ms, every hard gate green;
- overall checks status remains `degraded` only for the same accepted
  warn-launch findings: architecture 2 and markdown 199.

Final canonicalizer replay after install/checks reported candidate state again
and preserved SHA-256
`d12653fb6d235edf15770bf19a7ff4d715dc603b83edc4622e75c134638bc36c`.

## Final lock audit and remediation list

Against post-FX001/T009 baseline `2c900ce3…`:

- package count `591`; add/remove `0/0`; root lock entry byte-identical;
- exactly 29 package entries changed, all ledgered:
  - Vite (1);
  - Rolldown + 15 bindings + OXC types (17);
  - PostCSS (1);
  - Nanoid (1);
  - Biome + 8 platform CLIs (9);
- 46 T009 Ink/React nodes byte-identical;
- four approved `devOptional` flips byte-identical;
- all 14 protected libc arrays byte-identical;
- internal/proxy/feed/CDN/SAS/query lock URLs: `0`;
- `package.json` SHA-256 remains
  `7879868dc46f4385c9de84b186d6721930388dc3f9587429d8d5792410b51b1c`.

Machine-readable final audit:
`.harness/temp/fx002-vite-lock/final-lock-audit.json`. Compatibility evidence:
`.harness/temp/fx002-vite-lock/compatibility.json`. Composite-gate evidence:
`.harness/temp/fx002-vite-lock/closeout/harness-checks-final.json`.

Final safety: `git diff --check` clean, staged files `0`, no commit, no fallback
registry/cache, no manifest edit, and OP-9 remained queued until this FX002
completion report.

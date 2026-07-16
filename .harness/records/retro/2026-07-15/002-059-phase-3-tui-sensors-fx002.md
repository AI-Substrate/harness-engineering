---
record_kind: "retro"
harness_version: "0.12.0"
branch: "feat/059-typed-extensions-sensors"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-15T09:38:45.174Z"
agent: "flow-pair-orchestrator"
plan_id: "059-typed-extensions-sensors"
schema_version: "1.2"
retro_id: "2026-07-15T09:38Z-orchestrator-p059p3"
started_at: "2026-07-15T00:29:00Z"
ended_at: "2026-07-15T09:38:45Z"
summary: "Plan 059 Phase 3 (sensors TUI + packaging + docs) plus two fix streams: FX001 (12 real repo sensors + AGENTS/README two-view) and FX002 (proxy cold-replay lock remediation). The dominant friction was the mandated SFI npm proxy: a misdiagnosed 404 pattern (real cause was an unmandated npm config), then a repo-wide gap where the committed lock pinned versions the proxy could not serve — resolved by an iterative per-package in-range downgrade loop that made the first-ever policy-compliant cold install pass. Live operator testing and a cross-model review surfaced defects no test caught: a boot black-screen (alt-screen entered after the first frame) and a shared-build-directory race that made the default parallel sensor check flaky."
entries:
  - id: DL-001
    kind: difficulty
    description: "The mandated SFI npm proxy returned HTTP 404 for tarball URLs on a first fresh-cache request but served them minutes later (303 -> internal blob 200), which initially read as lazy upstream ingestion and cost a full spike NO-GO stop cycle. Superseded by INS-001 as the true root cause."
    target: infra
    severity: degrading
    workaround: "Retry the same config; verified the redirect trace by direct GET."
    suggested_encoding: "A pre-warm step for npm-dependent tasks: GET each new dependency tarball through the proxy before install; but see INS-001 — the deeper fix is config, not pre-warming."
    fp: "e402e288aa39"
    disposition: kept
    system:
      compound:
        status: superseded
        source: agent-self
        first_seen_at: "2026-07-15T02:06:45Z"
  - id: INS-001
    kind: insight
    description: "Root cause of the proxy tarball 404s: an unmandated `replace-registry-host=always` npm setting rewrote the proxy's metadata-advertised upstream-feed tarball paths onto proxy-host+upstream-path, which the proxy 404s. The npm-default `replace-registry-host=npmjs` keeps npmjs-rewrite protection while letting the proxy's designed upstream flow work. The earlier lazy-ingestion diagnosis (DL-001) was wrong — different URL shapes were being tested."
    target: infra
    workaround: "Drop `replace-registry-host=always`; keep registry / min-release-age=7 / prefer-online unchanged."
    suggested_encoding: "Pin the exact npm config block (including `replace-registry-host` semantics) in the SFI-proxy policy brief so belt-and-braces additions cannot brick resolution."
    fp: "3861544fc95e"
    disposition: kept
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-07-15T02:10:00Z"
  - id: DL-002
    kind: difficulty
    description: "Repo-wide: the mandated proxy's feed lacked the committed lock's pinned versions (first `vite@8.1.4`, then rolldown/@oxc-project/types/postcss/nanoid/@biomejs/biome) — so every policy-compliant cold `npm ci` failed on every branch, independent of new work. A missing-version-in-proxy class of blocker."
    target: infra
    severity: blocking
    workaround: "Differential replay (original vs candidate lock) isolated new-work regressions; the feed gap itself was resolved by an iterative per-package in-range downgrade (FX002) to the proxy's latest age-eligible version satisfying every committed range, repeated until cold install passed."
    suggested_encoding: "A lock-vs-proxy-feed coverage sensor (assert every resolved version is present in the proxy packument) run before any SFI cold install is relied upon — this would have caught the gap before it blocked a landing."
    fp: "422dbb834713"
    disposition: kept
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-07-15T02:57:16Z"
  - id: INS-002
    kind: insight
    description: "The Ink TUI booted to a black screen: the alt-screen enter ran in a useEffect that fired AFTER React committed the first frame, so the frame painted to the primary buffer and the alt buffer stayed blank; with no watcher running, the mtime poll never repainted, leaving a permanent black screen. The existing tests asserted the alt-screen-enter byte appeared but never that a rendered frame lands AFTER it on the alt buffer."
    target: tooling
    workaround: "Enter the alt-screen synchronously before render(); add a no-input PTY boot test asserting a frame token appears after the alt-screen-enter escape."
    suggested_encoding: "For any alt-screen TUI: a boot test that captures the byte stream with no input and asserts real frame content lands on the alternate buffer (not merely that the switch happened)."
    fp: "b00752c7ee01"
    disposition: kept
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-15T08:30:00Z"
  - id: INS-003
    kind: insight
    description: "Making the sensor run-all parallel surfaced two latent 'a test/sensor mutates a shared artifact' bugs: two full-suite sensors wrote the same coverage-reports directory, and a PTY test compiled the CLI into the shared build directory as a beforeAll side effect while another sensor executed that same build — both producing false failures under concurrency. Both pre-existed in parallel watch mode; parallel-by-default just made them deterministic."
    target: project-sensor
    workaround: "Per-sensor absolute coverage directories; PTY test compiles to a unique temp output directory and launches from it; deterministic regressions assert the shared build directory is never rewritten during the suite."
    suggested_encoding: "A test/sensor isolation guard: any sensor or test that spawns a build or writes coverage must target a unique per-run directory; a fingerprint check that the shared build dir is unchanged across the suite catches side-effect writes."
    fp: "c91a4d5e77b2"
    disposition: kept
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-15T08:30:02Z"
---

# Retro — Plan 059 Phase 3 (TUI + packaging + docs) + FX001 + FX002

The two highest-leverage, still-open suggestions are **INS-001** (pin the exact SFI npm config in the policy brief) and **DL-002** (a lock-vs-proxy-feed coverage sensor). Together they would have prevented the two costliest stalls this phase — a misdiagnosed 404 cycle and a repo-wide cold-install blocker — before either bit. **INS-002** (boot-frame-after-alt-enter) and **INS-003** (shared-artifact isolation under parallel sensors) were both encoded as fixes with proving tests this phase.

<!-- Internal SFI proxy/feed/blob hostnames have been redacted to placeholders (<sfi-proxy-host>/<internal-feed-host>/<internal-blob-host>) for public-repo publication; the raw evidence is retained locally under the gitignored .harness/temp/ trail referenced by the FX002 dossier. -->

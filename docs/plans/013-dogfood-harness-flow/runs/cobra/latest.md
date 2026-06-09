# Harnessability Assessment — cobra

Run metadata
- Timestamp: 20260609T125423Z
- Repo root: /private/tmp/harness-flow-selftest-2026-06-09T12-48-22-100Z/cobra
- Branch / commit: main / ad460ea8f249db69c943a365fb84f3a59042d54e
- Mode: safe-probe
- Commands executed: git status --short; git branch --show-current; git rev-parse HEAD; npm install --prefix . /Users/jordanknight/substrate/harness-engineering --no-audit --no-fund; ./node_modules/.bin/harness doctor --json; go env GOVERSION GOPATH GOMODCACHE; static file inspection and ripgrep searches
- Commands skipped: service boot: not applicable for Go library; go test ./... during assessment: reserved for the boot extension verification step; make test: skipped because Makefile install_deps runs go get; external service calls: none needed
- Safety notes: No secret values read.; No product-code changes applied.; No services booted during assessment.; Assessment writes limited to .harness/reports/harnessability/.

## Verdict
- Operate-Today: B (74%)
- Adaptability: B (70%)
- Harnessability Index: 72% (B)
- Readiness: H2
- Highest proof level detected: L2 Static/build/test
- Target next proof level: L3 Runtime interaction
- Confidence: high
- Final grade: B

## Plain-English assessment
Cobra is a stateless Go library/CLI framework with strong local proof surfaces: documented Go test commands, a Makefile, a broad hermetic test suite, golangci-lint configuration, and CI coverage across operating systems and Go versions. The main gaps are harness-product gaps rather than product-runtime blockers: there was no canonical .harness governance contract, no Envelope-producing boot verb, no structured evidence artifact, and no compounding retro loop before this run.

## Top blockers
1. No canonical harness governance/front door before setup — add .harness/engineering-harness.md and a boot verb.
2. Makefile test target runs go get through install_deps — use go test ./... for non-mutating boot proof.
3. CI/local parity is split across Makefile and workflow YAML — add a preflight/doctor surface for missing tools.
4. Test evidence is terminal-only — capture command, exit code, duration, and output path.

## Highest-leverage improvements
- Encode boot as go test ./... with an honest Envelope.
- Add a non-mutating local/CI preflight naming go, golangci-lint, Docker/addlicense availability.
- Persist boot evidence under .harness/runs/.
- Keep retro records so harness friction compounds.

## First safe agent session plan
- Read .harness/engineering-harness.md once created, then verify npx harness doctor --json.
- Run npx harness boot to execute go test ./... and inspect the Envelope status/next_action.
- For a scoped code change, add or update colocated Go tests using Command.SetArgs/SetOut/SetErr/ExecuteC as the interaction surface.
- Use gofmt/golangci-lint as stronger follow-up checks when local tools are installed.
- Record retro friction rather than silently encoding new behavior during the same run.

## Axis A — Operate-Today scorecard
- A1 Cold-start orientation and repo map: Partial (2/3) — Good product orientation and contribution notes, but no canonical first-session engineering harness map yet.
- A2 Setup and environment contract: Partial (2/3) — Tool and dependency discovery is mostly through Go conventions and CI; no devcontainer/tool-version/doctor preflight.
- A3 Locality of infrastructure and external-dependency exposure: Strong (3/3) — Runtime proof is not blocked by product infrastructure; only Go module/tool downloads may be needed on a cold machine.
- A4 Harness front door and command discoverability: Partial (2/3) — There is a conventional Makefile but no canonical .harness governance file or harness verb before this setup flow.
- A5 Boot and health/readiness path: Strong (3/3) — Library health can be proven without a server boot. make test is less safe as a boot command because install_deps runs go get; prefer go test ./....
- A6 Seed, fixture, reset, and cleanup state: Not applicable (n/a/3) — No persistent datastore or service state requires seed/reset. File outputs in tests are local/generated and isolated by test code.
- A7 Supported interaction surfaces: Strong (3/3) — Agents can exercise real library behavior through Go tests and small fixture commands.
- A8 Existing deterministic back-pressure sensors: Strong (3/3) — Strong L2 sensors exist; local/CI differ because CI uses richgo and matrix/lint/license checks that are not a single local command.
- A9 Observability and evidence artifacts: Partial (2/3) — Evidence is deterministic but mostly terminal output, not portable structured artifacts.
- A10 Compounding harness loop: Absent (0/3) — This setup flow will add the first harness reports and retro record.

## Axis B — Adaptability scorecard
- B1 Structural coupling and blast radius: Partial (2/3) — Structure is understandable but centralized.
- B2 Temporal/change coupling: Unknown (0/3) — Git co-change history was not mined in this static/safe-probe assessment.
- B3 Cohesion and locality of change: Partial (2/3) — Most behavior has nearby tests; central command abstractions still create broad edit impact.
- B4 Seams, substitution, and dependency inversion: Strong (3/3) — The public API itself provides strong test seams for interaction and observation.
- B5 Hermetic, offline, and isolated testability: Strong (3/3) — Cold machines may need Go modules, but product behavior tests are hermetic once dependencies are available.
- B6 Side-effect isolation and external-effect sinks: Not applicable (n/a/3) — No external-effect sink is required for this repo topology.
- B7 State evolution and consequence verification: Partial (2/3) — Good L2 consequence assertions; no reusable harness evidence artifact yet.
- B8 Architecture boundary enforceability: Partial (2/3) — Generic static rules are encoded; architectural constraints are mostly by convention and review.
- B9 Complexity, size, and navigability thresholds: Partial (2/3) — Lint quality is strong, but complexity and file-size back pressure is intentionally light.
- B10 Inner-loop speed and repeatability: Strong (3/3) — The fastest reliable loop should avoid Makefile install_deps/go get and call go test ./... directly.

## Evidence and inference log
- README.md: Cobra is a Go library for creating CLI applications and documents command/flag/help/completion concepts. (evidence, high)
- CONTRIBUTING.md: Contributors are told to run go test ./..., make test, and make all. (evidence, high)
- Makefile: make all runs fmt and test; test depends on install_deps, which runs go get -v ./.... (evidence, high)
- .github/workflows/test.yml: CI runs license headers, golangci-lint, and richgo tests across Unix/Windows Go versions. (evidence, high)
- .golangci.yml: Static quality checks include gofmt/goimports formatters and linters such as errcheck, gocritic, gosec, govet, staticcheck, and unused. (evidence, high)
- command_test.go and completions_test.go: Tests exercise command behavior through public interaction seams and in-memory buffers. (evidence, high)
- static external dependency scan: No product runtime databases, queues, object stores, auth, email, payment, SMS, webhook, analytics, or model-provider dependencies were detected. (evidence, high)

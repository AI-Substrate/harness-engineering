# Engineering Harness — Cobra

This is the canonical Boot / Interact / Observe contract for this throwaway Cobra clone.

## Boot command

```bash
go test ./...
```

For this stateless Go library, the boot target is the full package test suite. It builds the packages and exercises the command, completion, and documentation-generation behavior without starting a long-lived service. Prefer this command over `make test` because the Makefile's `test` target depends on `install_deps`, which runs `go get -v ./...`.

## Health check

```bash
go test ./...
```

Exit code `0` proves the library is healthy enough for local work. Failing output is the health diagnostic. There is no HTTP readiness endpoint or background process for this repo topology.

## Interact method

Agents interact with Cobra behavior through Go tests that construct real `*cobra.Command` trees, inject arguments with `SetArgs`, capture output with `SetOut`/`SetErr`, and execute via `ExecuteC`, `ExecuteContext`, or related public APIs. Completion and documentation behavior is exercised by calling the generator functions in tests.

## Observe method

Observation is through command exit codes, `go test -v ./...` output, test assertions over `bytes.Buffer` stdout/stderr sinks, returned command/error values, generated completion text, and generated documentation strings. Harness-level reports live under `.harness/reports/`, and retrospectives live under `.harness/records/`.

## Deterministic signal inventory

- `go test ./...` — primary local health and proof lane for all Go packages.
- `make fmt` — wraps `gofmt -l` and prints diffs on formatting failure.
- `golangci-lint run -v` — configured by `.golangci.yml`; CI installs/runs it through `golangci-lint-action`.
- GitHub Actions `.github/workflows/test.yml` — runs license headers, golangci-lint, and richgo-backed tests across OS/Go-version matrix.
- Tests in `command_test.go`, `completions_test.go`, shell completion tests, and `doc/*_test.go` — deterministic in-memory command interaction and generated-output assertions.

## Evidence paths

- Terminal output and exit code from `go test ./...` / `go test -v ./...`.
- GitHub Actions run logs for `lic-headers`, `golangci-lint`, `test-unix`, and `test-win`.
- Harnessability reports: `.harness/reports/harnessability/latest.{json,md}` and `.harness/reports/harnessability/001-cobra/`.
- Retro records: `.harness/records/retro/` once recorded.
- No native structured Go test artifact path was detected before this setup run.

## Back-pressure gaps

- No shipped `harness init` writer creates this governance file; it had to be hand-written from the BIO template.
- The primary proof lane is terminal-only unless a harness verb captures command, exit code, duration, and output path.
- CI/local parity is split across `go test`, `make`, `.golangci.yml`, and GitHub Actions; there is no non-mutating preflight that names missing tools.
- `make test` is not ideal for agent boot because it runs `go get -v ./...` through `install_deps`.
- No compounding harness retro/history loop existed before this setup run.

## Current maturity snapshot

L2 — Static/build/test proof is available through `go test ./...` and related lint/format/CI checks, but the harness is not yet a full runtime interaction loop with durable structured evidence.

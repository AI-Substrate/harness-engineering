<!-- foundations: first-principles#11, #15, #21, #22, #23, directives#D2-D6 -->

# Harnessability Assessment — {{REPO_NAME}}

Run metadata
- Timestamp: {{TIMESTAMP_UTC}}
- Repo root: {{REPO_ROOT}}
- Branch / commit: {{BRANCH}} / {{COMMIT_OR_UNKNOWN}}
- Mode: {{MODE}}
- Commands executed: {{COMMANDS_EXECUTED}}
- Commands skipped: {{COMMANDS_SKIPPED}}
- Safety notes: {{SAFETY_NOTES}}

## Verdict

- Operate-Today: {{OPERATE_TODAY_GRADE}} ({{OPERATE_TODAY_PERCENT}}%)
- Adaptability: {{ADAPTABILITY_GRADE}} ({{ADAPTABILITY_PERCENT}}%)
- Harnessability Index: {{HARNESSABILITY_INDEX}}
- Readiness: {{READINESS_LEVEL}}
- Highest proof level detected: {{HIGHEST_PROOF_LEVEL}}
- Target next proof level: {{TARGET_PROOF_LEVEL}}
- Confidence: {{CONFIDENCE}}

## Plain-English assessment

{{PLAIN_ENGLISH_ASSESSMENT}}

## Top blockers

{{TOP_BLOCKERS}}

## Highest-leverage improvements

{{HIGHEST_LEVERAGE_IMPROVEMENTS}}

## First safe agent session plan

{{FIRST_SAFE_SESSION_PLAN}}

## Harness surfaces

| Surface | Path | Kind | Status | Notes |
|---------|------|------|--------|-------|
{{HARNESS_SURFACES_TABLE}}

## Repository topology

{{REPOSITORY_TOPOLOGY}}

## Axis A — Operate-Today scorecard

| Dimension | Band | Points | Evidence | Notes |
|-----------|------|-------:|----------|-------|
{{AXIS_A_SCORECARD}}

## Axis B — Adaptability scorecard

| Dimension | Band | Points | Evidence | Notes |
|-----------|------|-------:|----------|-------|
{{AXIS_B_SCORECARD}}

## Back-pressure surface inventory

{{BACKPRESSURE_SURFACE_INVENTORY}}

## Scenario probes

{{SCENARIO_PROBES}}

## Command tiers

| Tier | Command or check | Status | Proof | Notes |
|------|------------------|--------|-------|-------|
{{COMMAND_TIERS_TABLE}}

## Services, environment, and remote dependency exposure

{{SERVICES_ENVIRONMENT_DEPENDENCIES}}

## State, fixtures, reset, and cleanup

{{STATE_FIXTURES_RESET}}

## Observability and evidence

{{OBSERVABILITY_AND_EVIDENCE}}

## Codebase affordance recommendations

{{CODEBASE_AFFORDANCE_RECOMMENDATIONS}}

## Harness-only recommendations

{{HARNESS_ONLY_RECOMMENDATIONS}}

## Onboarding consolidation notes

{{ONBOARDING_CONSOLIDATION_NOTES}}

## Human questions

{{HUMAN_QUESTIONS}}

## Evidence and inference log

| Source | Provenance | Claim |
|--------|------------|-------|
{{EVIDENCE_AND_INFERENCE_LOG}}

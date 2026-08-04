# FX001 execution log

(started 2026-08-05 — entries appended by the fix coder)

## Orchestrator ruling note (2026-08-05, pij-related-koala)

D2 consequence, stated plainly for every future reader: A10 (gate-refused)
was not answered badly by the eval runs — it was STRUCTURALLY UNANSWERABLE
for any flushed session, ever, because the OTLP roll dropped
command_exit.code (0 coded exits across all 112 telemetry refs). An
unanswerable assertion reporting `unknown` looks identical to a subject
that simply never hit a gate; runs 20260804-160553Z-rictor and
20260804-210515Z-dkoala are the former, and their telemetry lanes are
evidence of NOTHING about subject behaviour. D2's fix is prospective;
historic refusal bytes were never encoded and cannot be recovered.

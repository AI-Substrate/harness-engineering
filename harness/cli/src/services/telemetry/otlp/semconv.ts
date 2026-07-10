/**
 * OTLP attribute vocabulary (plan 038 · T009 — the single semconv mapping module).
 *
 * The two-layer field-naming rule (WS-A FN):
 *  - ADOPT stable OTEL GenAI semconv as-is (`gen_ai.usage.*`, `gen_ai.request.model`)
 *    for free upstream interop.
 *  - OWN everything reconstruction-critical under `harness.*` + our pinned schema,
 *    so experimental semconv churn (gen_ai.agent.*, cache-token granularity) can
 *    never reach the data the timeline is rebuilt from.
 *
 * Quarantine: the ONLY OTEL-owned names live in the GENAI block below. Everything
 * else is `harness.*` — chosen by our needs, versioned by OUR schema_url. To swap
 * a semconv name when it stabilises, edit this file and nothing else.
 */

// ── Stable OTEL GenAI semconv (adopted as-is) ────────────────────────────────
export const GENAI_MODEL = 'gen_ai.request.model';
export const GENAI_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const GENAI_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
/** OTEL token-usage metric + its type discriminator (stable). */
export const GENAI_TOKEN_USAGE_METRIC = 'gen_ai.client.token.usage';
export const GENAI_TOKEN_TYPE = 'gen_ai.token.type';

// ── Resource attributes (once per session) ───────────────────────────────────
export const RES_SERVICE = 'service.name';
/** Stable OTEL resource attribute — the producing harness CLI version. */
export const RES_SERVICE_VERSION = 'service.version';
export const RES_SESSION = 'harness.session_id';
export const RES_HARNESS = 'harness.harness';
export const RES_COMMAND = 'harness.command';
export const RES_BRANCH = 'harness.branch';
export const RES_SCHEMA_VERSION = 'harness.schema_version';
/**
 * The allowlisted env snapshot (segment `captured_env`) → ONE kvlist-valued
 * resource attribute (name → value), not N dynamic keys — so the frozen
 * attribute contract stays a closed, fixed set (mirrors `harness.checks.gates`).
 */
export const RES_ENV = 'harness.env';

// ── harness.* — reconstruction-critical, owned by us ─────────────────────────
export const A = {
  KIND: 'harness.event.kind',
  T: 'harness.event.t',
  T_PRECISION: 'harness.event.t_precision',
  PROMPT_WORDS: 'harness.prompt.words',
  TURN_DUR_S: 'harness.turn.dur_s',
  CACHE_READ: 'harness.usage.cache_read',
  CACHE_CREATE: 'harness.usage.cache_create',
  TOOL_NAME: 'harness.tool.name',
  TOOL_COUNT: 'harness.tool.count',
  TOOL_SPAN_S: 'harness.tool.span_s',
  TOOL_SIG: 'harness.tool.signature',
  TOOL_RESULT_TOKENS: 'harness.tool.result_tokens',
  SKILL_NAME: 'harness.skill.name',
  SKILL_STATUS: 'harness.skill.status',
  SKILL_DUR_S: 'harness.skill.dur_s',
  SKILL_ARG: 'harness.skill.arg',
  FLOW_NAME: 'harness.flow.name',
  FLOW_STAGE: 'harness.flow.stage',
  FLOW_STATUS: 'harness.flow.status',
  FLOW_FROM: 'harness.flow.from',
  FLOWLOG_OP: 'harness.flow_log.op',
  FLOWLOG_NODE: 'harness.flow_log.node',
  FLOWLOG_FROM: 'harness.flow_log.from',
  FLOWLOG_TO: 'harness.flow_log.to',
  FLOWLOG_TYPE: 'harness.flow_log.type',
  FLOWLOG_EDGE_OP: 'harness.flow_log.edge_op',
  BRANCH_TO: 'harness.branch.to',
  BRANCH_FROM: 'harness.branch.from',
  VERB: 'harness.verb',
  OBSERVE_KIND: 'harness.observe.kind',
  CHECKS_STATUS: 'harness.checks.status',
  CHECKS_GATES: 'harness.checks.gates',
  CMD_VERB: 'harness.command.verb',
  CMD_EXIT: 'harness.command.exit',
  CMD_STATUS: 'harness.command.status',
  SUBAGENT_NAME: 'harness.subagent.name',
  SUBAGENT_STATUS: 'harness.subagent.status',
  SUBAGENT_DUR_S: 'harness.subagent.dur_s',
  EFFORT: 'harness.effort',
  API_ERROR_SIG: 'harness.api_error.signature',
  ARTIFACT_TYPE: 'harness.artifact.type',
  ARTIFACT_PATH: 'harness.artifact.path',
  ARTIFACT_PLAN_ID: 'harness.artifact.plan_id',
  ARTIFACT_CHANGE: 'harness.artifact.change',
  ARTIFACT_COUNTS: 'harness.artifact.counts',
  ARTIFACT_ENUMS: 'harness.artifact.enums',
  ARTIFACT_SIZE_LINES: 'harness.artifact.size_lines',
  ARTIFACT_SIZE_BYTES: 'harness.artifact.size_bytes',
  // metric-only attrs
  TOOL: 'harness.tool.name',
  SKILL: 'harness.skill.name',
  SKILL_STATUS_M: 'harness.skill.status',
  FLOW_STAGE_M: 'harness.flow.stage',
  CMD_VERB_M: 'harness.command.verb',
  CMD_STATUS_M: 'harness.command.status',
  TOKEN_TYPE: 'harness.token.type',
} as const;

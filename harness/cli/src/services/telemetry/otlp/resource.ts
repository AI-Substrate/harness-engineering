/**
 * OTLP Resource attributes for a session (plan 038) — shared by the logs +
 * metrics serializers so the session identity is written once, identically.
 * Counts-only / opaque-session / repo-relative (P12): the segment is already
 * serialized when it reaches here.
 */
import type { Segment } from '../segment.js';
import {
  RES_BRANCH,
  RES_CAPTURE_MODE,
  RES_COMMAND,
  RES_ENV,
  RES_HARNESS,
  RES_PRODUCT_COMMIT,
  RES_SCHEMA_VERSION,
  RES_SERVICE,
  RES_SERVICE_VERSION,
  RES_SESSION,
} from './semconv.js';
import { type KeyValue, kv, sv } from './types.js';

export function resourceAttrs(seg: Segment): KeyValue[] {
  const attrs: KeyValue[] = [
    kv(RES_SERVICE, sv('harness')),
    kv(RES_SERVICE_VERSION, sv(seg.harness_version)),
    kv(RES_SESSION, sv(seg.harness_session_id)),
    kv(RES_HARNESS, sv(seg.harness)),
    kv(RES_COMMAND, sv(seg.command)),
    kv(RES_SCHEMA_VERSION, sv(seg.schema_version)),
  ];
  if (seg.branch !== null) attrs.push(kv(RES_BRANCH, sv(seg.branch)));
  if (seg.schema_version !== '2.4' && seg.product_commit !== undefined) {
    attrs.push(kv(RES_PRODUCT_COMMIT, sv(seg.product_commit)));
  }
  // v2.7 — carried on the RESOURCE (once per segment) rather than per event, so a
  // reader learns that this whole window is late BEFORE it reads a single instant.
  if (seg.capture_mode !== undefined) attrs.push(kv(RES_CAPTURE_MODE, sv(seg.capture_mode)));
  // The allowlisted env snapshot → ONE kvlist attribute (omitted when absent/empty),
  // so the resource attribute key set stays closed even as var names vary.
  const env = seg.captured_env;
  if (env !== undefined && Object.keys(env).length > 0) {
    const values: KeyValue[] = Object.keys(env)
      .sort()
      .map((k) => kv(k, sv(env[k])));
    attrs.push(kv(RES_ENV, { kvlistValue: { values } }));
  }
  return attrs;
}

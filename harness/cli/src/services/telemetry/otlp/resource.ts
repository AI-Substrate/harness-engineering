/**
 * OTLP Resource attributes for a session (plan 038) — shared by the logs +
 * metrics serializers so the session identity is written once, identically.
 * Counts-only / opaque-session / repo-relative (P12): the segment is already
 * serialized when it reaches here.
 */
import type { Segment } from '../segment.js';
import {
  RES_BRANCH,
  RES_COMMAND,
  RES_HARNESS,
  RES_SCHEMA_VERSION,
  RES_SERVICE,
  RES_SESSION,
} from './semconv.js';
import { type KeyValue, kv, sv } from './types.js';

export function resourceAttrs(seg: Segment): KeyValue[] {
  const attrs: KeyValue[] = [
    kv(RES_SERVICE, sv('harness')),
    kv(RES_SESSION, sv(seg.harness_session_id)),
    kv(RES_HARNESS, sv(seg.harness)),
    kv(RES_COMMAND, sv(seg.command)),
    kv(RES_SCHEMA_VERSION, sv(seg.schema_version)),
  ];
  if (seg.branch !== null) attrs.push(kv(RES_BRANCH, sv(seg.branch)));
  return attrs;
}

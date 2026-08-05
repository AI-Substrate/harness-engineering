# Deterministic Documents — Frozen P1 Surface

**Plan**: 065 · **Freeze owner**: Phase 1 · **Status**: one-way extensible

Phases 2-4 fill command bodies. They may not rename a command, change a frozen
positional, remove an option, change the placeholder exit contract, or edit the
E400-E449 allocation. A RESERVED row may gain options only through a one-line PM
renegotiation.

`--json` is the existing global harness output option and applies to every command.

## Commands

| Frozen signature | Owner | P1 placeholder |
|---|---|---|
| `dd validate <path> [--depth <n>] [--json]` | Phase 2: Schema layer & baked docs | `unconfigured`, exit 2; default depth `3` |
| `dd schema list [--json]` | Phase 2: Schema layer & baked docs | `unconfigured`, exit 2 |
| `dd schema show <name> [--json]` | Phase 2: Schema layer & baked docs | `unconfigured`, exit 2 |
| `dd docs list [--json]` | Phase 2: Schema layer & baked docs | `unconfigured`, exit 2 |
| `dd docs get <id> [--json]` | Phase 2: Schema layer & baked docs | `unconfigured`, exit 2 |
| `dd build <path> [--check] [--json]` | Phase 3: Render, adapters & freshness | `unconfigured`, exit 2 |
| `dd address generate <interior> [--path <path>] [--json]` | Phase 4: Links, ledger & doctor | `unconfigured`, exit 2 |
| `dd address validate <address> [--resolve] [--json]` | Phase 4: Links, ledger & doctor | `unconfigured`, exit 2 |
| `dd link resolve <address> [--json]` | Phase 4: Links, ledger & doctor | `unconfigured`, exit 2 |
| `dd link verify-basis <address> --sha <sha> [--json]` | Phase 4: Links, ledger & doctor | `unconfigured`, exit 2 |
| `dd links <target> [--json]` | Phase 4: Links, ledger & doctor | `unconfigured`, exit 2 |
| `dd graph [--json]` | Phase 4: Links, ledger & doctor | `unconfigured`, exit 2 |
| `dd doctor [--json]` | Phase 4: Links, ledger & doctor | `unconfigured`, exit 2 |
| `dd get <address> [--json]` | plan 070 Phase 1: dd writer verbs | shipped |
| `dd set <address> <value> [--value-json] [--json]` | plan 070 Phase 1: dd writer verbs | shipped |
| `dd add <address> <json> [--mint <prefix>] [--json]` | plan 070 Phase 1: dd writer verbs | shipped |
| `dd rm <address> [--json]` | plan 070 Phase 1: dd writer verbs | shipped |

Every placeholder `next_action` names its owning phase exactly. `dd validate`
remains a placeholder until Phase 2 supplies the real convention-based schema
resolver (OD-2).

### Phase 1 leaf ruling — address generation inputs

`generate` accepts one canonical alternating `name/id/...` interior and an
optional `--path`. Omitting `--path` produces the bare-`#` same-document form.
This is the smallest input that maps directly to the closed workshop-001 grammar;
it avoids a second set of section/id flags that would merely reconstruct the same
string.

## RESERVED extension rows

| Surface | Reservation |
|---|---|
| `dd doctor` scope/options | RESERVED — Phase 4 leaf decision. Options may be added; command name and zero frozen positionals may not change. **GRANTED 2026-08-03 (PM renegotiation, P4 T007b)**: `--path <dir>` — scopes the sweep ROOT SET to a subtree; radius stays infinite. |
| `dd graph` emit/scope options | RESERVED — Phase 4 leaf decision. Options may be added; command name and zero frozen positionals may not change. **GRANTED 2026-08-03 (PM renegotiation, P4 T007c)**: `--path <dir>` — same root-set semantics as doctor, deliberately the same word. No emit option (global `--json` + human mermaid already cover both modes). |
| `dd graph` subcommand namespace | RESERVED — extended for Phase 7. **GRANTED 2026-08-04 (PM renegotiation, P7 T001; requested by Jordan)**: `dd graph map <address>` — a NAMED SUBCOMMAND, not a positional on bare `dd graph`. Bare `dd graph` keeps zero positionals and byte-identical output, so the P4 freeze is intact rather than amended: `map` is a sibling verb under the same noun. Options granted with it: `--depth <n>` (default 3), `--max-nodes <n>` (default 20), `--direction in\|out\|both` (default both). **GRANTED 2026-08-04 (plan 070 Phase 1, tk-7014)**: `--rel <rel>` — repeatable; follows only edges carrying one of the named relations. No default: an absent flag means EVERY relation, because a filter that defaulted to a set would answer a narrower question than the one asked while looking like a complete map. **No new E-codes** — E430-E439 is full, and a bad seed address is already `E430 DD_LINK_UNRESOLVED` while a traversal failure is already `E436 DD_LINK_SCAN_FAILED`. Opening E450+ for this would be a block extension bought for nothing. |
| `dd link verify-basis` explicit re-verification mutation semantics | RESERVED — Phase 4 leaf decision. Read-only `<address> --sha <sha>` remains frozen; any mutation option is additive only. **GRANTED 2026-08-03 (PM renegotiation, P4 T007a)**: `--update <doc>` — no separate re-verify verb; re-verification IS verify-basis plus this explicit write flag, updating the recorded sha in the REFERENCING doc's ledger entry (both `live` and `pinned` modes; an entry's mode never changes as a side effect). Read-only form byte-identical when absent. |
| `dd address validate --resolve` segment classification | RESERVED — Phase 4 resolves optional instance ids versus shape-part names against the schema. P1 parser `kind` values are positional hints only; the frozen command and option do not change. **RULED 2026-08-03 (PM renegotiation, P4 T007d)**: no new option — with `--resolve`, each segment is classified against the resolved schema shape + data as section \| part \| instance (shape-directed, never positional guessing). |

## Frozen link relations

**GRANTED 2026-08-04 (one-line renegotiation, plan 070 Phase 1)**: a schema may
declare `rel` on any `link` shape (including an array's `items`). The built-in
set is FROZEN at five; the namespace is OPEN — an unknown rel is accepted and
behaves as `ref`. Extending the built-in set is a one-line renegotiation of this
table, and `dd-surface.test.ts` counts the rows.

| Relation | Meaning |
|---|---|
| `pressure` | this assertion names the instrument that checks it |
| `proven_by` | this claim points at the record that evidences it |
| `satisfies` | this work accounts for that acceptance criterion |
| `derives` | this item's state is computed FROM the target |
| `ref` | a plain reference, carrying no further semantics |

## Frozen flow gate kinds

**GRANTED 2026-08-04 (one-line renegotiation, plan 071 ph-7102, tk-7131/tk-7132)**:
a flow node's `dd_link` may carry an optional `check`, naming WHICH question the
departure gate asks. Absent `check` is the completion kind and is byte-identical
to what shipped in 065 — the opt-in guarantee is unchanged, and a flow with no
`check` anywhere behaves exactly as before. The vocabulary is FROZEN; an unknown
value is REFUSED (authoring → `E108`; a file already on disk → `E444` at the
gate), never defaulted, because both plausible defaults lie: running a check
nobody asked for, or silently downgrading a gate the author believed they had.
Extending the set is a one-line renegotiation of this table, and
`dd-surface.test.ts` counts the rows.

| Gate kind | `dd_link` shape | Question it asks |
|---|---|---|
| completion | `{address}` (no `check`) | are every item at the address gate-terminal? |
| `plan-validate` | `{address, check: "plan-validate"}` | does `harness plan validate --complete` come back green for the plan at the address? |

**No new E-codes.** A non-green check is `E440 DD_GATE_UNSATISFIED` — a gate that
is not satisfied, which is what it is; an unresolvable address is `E441`; an
unimplemented `check` is `E444 DD_GATE_EVALUATION_FAILED`, because "this CLI
cannot answer that question" is precisely a gate that could not be evaluated. An
agent that already handles a gate refusal handles the second kind without
learning anything, and E440–E449 stays a complete allocation.

The check gate's `address` accepts BOTH a bare document path and a full
`path#interior` address; an interior scopes the check to that address's closure
(the `--address` read), and its absence checks the whole plan.

## Error allocation

### E400-E409 — core/validate

| Code | Name | Failure class |
|---|---|---|
| E400 | `DD_DOCUMENT_INVALID` | invalid JSON or dd envelope |
| E401 | `DD_SCHEMA_UNRESOLVABLE` | document schema cannot resolve |
| E402 | `DD_SCHEMA_SHAPE_INVALID` | data violates resolved shape |
| E403 | `DD_ID_INVALID` | minted/explicit id rule violation |
| E404 | `DD_ID_DUPLICATE` | duplicate per-file id |
| E405 | `DD_ADDRESS_INVALID` | malformed locked grammar |
| E406 | `DD_LINK_TYPE_MISMATCH` | cell target differs from declared type path |
| E407 | `DD_ENUM_INVALID` | value outside declared enum |
| E408 | `DD_STATE_NOTE_REQUIRED` | `blocked`/`na` note absent |
| E409 | `DD_HUMAN_SKIP_RECEIPT_REQUIRED` | human-skip verbatim receipt absent |

### E410-E419 — schema/docs

| Code | Name | Failure class |
|---|---|---|
| E410 | `DD_SCHEMA_NOT_FOUND` | qualified schema absent |
| E411 | `DD_SCHEMA_PACKAGE_INVALID` | malformed schema package |
| E412 | `DD_SCHEMA_NAME_CONFLICT` | duplicate name in one root |
| E413 | `DD_SCHEMA_SHADOWED` | lower-precedence duplicate |
| E414 | `DD_SCHEMA_VERSION_UNSUPPORTED` | unsupported schema version |
| E415 | `DD_SCHEMA_ENUM_INVALID` | invalid enum/gate-terminal declaration |
| E416 | `DD_SCHEMA_SCAN_FAILED` | schema-root discovery failed |
| E417 | `DD_SCHEMA_PATH_ESCAPE` | schema path escapes discovery root |
| E418 | `DD_SCHEMA_WRITE_FAILED` | schema-owned artifact write failed |
| E419 | `DD_DOCS_ENTRY_NOT_FOUND` | baked dd doc id absent |

### E420-E429 — render/adapters

| Code | Name | Failure class |
|---|---|---|
| E420 | `DD_RENDER_FAILED` | deterministic render failed |
| E421 | `DD_RENDER_WRITE_FAILED` | sibling markdown write failed |
| E422 | `DD_RENDER_DRIFT` | `build --check` byte drift |
| E423 | `DD_ADAPTER_NOT_FOUND` | custom type adapter absent |
| E424 | `DD_ADAPTER_LOAD_FAILED` | adapter load failed |
| E425 | `DD_ADAPTER_RUNTIME_FAILED` | adapter threw |
| E426 | `DD_ADAPTER_OUTPUT_INVALID` | adapter returned invalid output |
| E427 | `DD_LIVE_BASIS_REFRESH_FAILED` | live ledger refresh failed |
| E428 | `DD_WATCH_FAILED` | watcher/regeneration failed |
| E429 | `DD_BUILD_INPUT_INVALID` | build input unreadable/unsupported |

### E430-E439 — links/doctor

| Code | Name | Failure class |
|---|---|---|
| E430 | `DD_LINK_UNRESOLVED` | address target cannot resolve |
| E431 | `DD_LINK_TARGET_MISSING` | target file missing |
| E432 | `DD_LINK_TARGET_UNTRACKED` | target file untracked |
| E433 | `DD_LINK_PATH_ESCAPE` | target resolves outside repo |
| E434 | `DD_BASIS_STALE` | recorded sha differs |
| E435 | `DD_BASIS_VERIFY_FAILED` | basis verification/re-verification failed |
| E436 | `DD_LINK_SCAN_FAILED` | inbound/outbound scan failed |
| E437 | `DD_GRAPH_FAILED` | mermaid graph construction failed |
| E438 | `DD_DOCTOR_FINDINGS` | doctor found ERROR-class issues |
| E439 | `DD_DOCTOR_SCAN_FAILED` | doctor sweep machinery failed |

### E440-E449 — flow gate

| Code | Name | Failure class |
|---|---|---|
| E440 | `DD_GATE_UNSATISFIED` | linked gate incomplete |
| E441 | `DD_GATE_TARGET_INVALID` | target not completable |
| E442 | `DD_GATE_SCHEMA_UNRESOLVABLE` | gate schema cannot resolve |
| E443 | `DD_GATE_BASIS_STALE` | gate basis stale |
| E444 | `DD_GATE_EVALUATION_FAILED` | unclassified evaluation failure |
| E445 | `DD_GATE_OVERRIDE_INVALID` | override malformed/not permitted |
| E446 | `DD_GATE_STATE_INVALID` | item state outside schema vocabulary |
| E447 | `DD_GATE_EVENT_WRITE_FAILED` | force event receipt write failed |
| E448 | `DD_GATE_SURFACE_FAILED` | orient/rail/render gate output failed |
| E449 | `DD_GATE_LINK_MISSING` | gate-enabled node lacks link data |

### E450-E459 — dd writer verbs & the plan semantic layer
**GRANTED 2026-08-04 (one-line renegotiation, plan 070 Phase 1)**: E430-E439 and
E440-E449 are both complete allocations, so the writer family (`dd get/set/add/rm`)
and `harness plan validate`'s semantic layer open the next block. Complete
allocation; the surface test counts sixty E4xx codes.

| Code | Name | Failure class |
|---|---|---|
| E450 | `DD_MUTATION_TARGET_INVALID` | address names no target the verb can act on |
| E451 | `DD_MUTATION_SCHEMA_REFUSED` | mutation would break the schema; nothing written |
| E452 | `DD_MUTATION_WRITE_FAILED` | writing the mutated document failed |
| E453 | `DD_MUTATION_VALUE_INVALID` | value unreadable as the declared type |
| E454 | `DD_ID_MINT_FAILED` | no collision-free id under the requested prefix |
| E455 | `DD_REL_INVALID` | schema declares a malformed link relation |
| E456 | `DD_PLAN_CONTRADICTION` | gate-terminal item links to a non-terminal target |
| E457 | `DD_PLAN_INCOMPLETE` | `--complete` found open completables or orphan ACs |
| E458 | `DD_PLAN_SCOPE_UNRESOLVED` | `--address` scope did not resolve |
| E459 | `DD_PLAN_VALIDATE_FAILED` | the semantic validation pass itself failed |

### E460-E469 — builder fence, review documents, and the readiness gate
**GRANTED 2026-08-04 (one-line renegotiation, plan 071 ph-7103)**: E450-E459 is a
complete allocation, so the fence check (`harness plan fence`, ac-7120) and the
review corpus (ac-7121) open the next block.
**EXTENDED 2026-08-05 (one-line renegotiation, plan 072)**: `harness plan ready
--strict` needs a code of its own. Reusing `DD_PLAN_INCOMPLETE` (E457) was the
alternative and was rejected: readiness can fail because a backpressure receipt is
stale or missing, which is not a statement about the plan being incomplete, and an
agent switching on E457 would be told the wrong thing. Partial allocation —
E463-E469 are free. The surface test counts sixty-three E4xx codes.

| Code | Name | Failure class |
|---|---|---|
| E460 | `DD_FENCE_VIOLATION` | a touched path is refused by an active fence row |
| E461 | `DD_FENCE_INVALID` | the fence document cannot be read as a fence |
| E462 | `DD_PLAN_NOT_READY` | `plan ready --strict` reached a not-ready verdict |

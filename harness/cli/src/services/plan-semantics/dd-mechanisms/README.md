# Temporary mechanism copies (plan 080 · tk-0008 · dw-000f)

Everything in this directory is a **deliberate, enumerated, temporary copy** of a dd
mechanism that has **no public `@ai-substrate/dd` home** at pin
`a37a20ecf12342275a9d81b4cf8835302de8e9e0`.

The rule this directory exists under: **a symbol with a public home is IMPORTED, never
copied.** These four modules are here only because Node's own resolver refuses them —
`@ai-substrate/dd/core/{constants,derive,rel,value}` all answer
`ERR_PACKAGE_PATH_NOT_EXPORTED`, and the exports map carries no wildcard.

| copy | dd origin | why it is not imported |
|---|---|---|
| `constants.ts` | `core/constants` | not exported; and by Jordan's ontology ruling (2026-08-09) the VOCABULARY values are builder-owned, so copying them is sanctioned rather than a D-3 block |
| `derive.ts` | `core/derive` | not exported. `deriveSchemaItems`/`deriveSchemaState` on `./schema` are the public cousins but are NOT drop-ins — they require a full `SchemaRecord` (name/description/version/path/root) that `buildPlanIndex` never has, and they decide `terminal` from the SCHEMA's declaration rather than from the entry's own set, which is the opposite of what the plan layer needs |
| `rel.ts` | `core/rel` | not exported; `DdLinkCell.rel` carries the DECLARED rel, so the public surface cannot answer the `effectiveRel` question |
| `value.ts` | `core/value` | not exported; three lines of type-narrowing, algorithm-class |

**Planned replacement**: dd's mechanism-vocabulary seam scoping (dd `6aaef35`) — scoped
but UNSCHEDULED upstream. When that seam lands, the mechanism halves here are deleted in
favour of imports; the vocabulary halves stay builder-owned by the ruling.

`shared/posix-path` is deliberately NOT copied here: it is already harness-owned
(`services/shared/posix-path.ts`), outside the `services/dd/**` fence, so the promoted
module imports it directly.

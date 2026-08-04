# dd-core fixture corpus

The corpus is intentionally real `.dd.json` data. Tests enumerate these files and
inject fixture-backed schema/document resolvers; production dd-core never reads the
filesystem.

## ERROR fixtures and good twins

| Invalid fixture | Expected issue class | Good twin |
|---|---|---|
| `invalid/duplicate-id.dd.json` | `duplicate-id` | `valid/base.dd.json` |
| `invalid/malformed-minted-id.dd.json` | `id-invalid` | `valid/minted-id.dd.json` |
| `invalid/malformed-address.dd.json` | `address-malformed` | `valid/base.dd.json` |
| `invalid/unresolvable-schema.dd.json` | `schema-unresolvable` | `valid/base.dd.json` |
| `invalid/blocked-note-missing.dd.json` | `state-note-required` | `valid/state-notes.dd.json` |
| `invalid/na-note-missing.dd.json` | `state-note-required` | `valid/state-notes.dd.json` |
| `invalid/human-skipped-receipt-missing.dd.json` | `human-skipped-receipt-required` | `valid/state-notes.dd.json` |
| `invalid/bad-enum.dd.json` | `enum-invalid` | `valid/custom-enum.dd.json` |
| `invalid/link-type-mismatch.dd.json` | `link-type-mismatch` | `valid/base.dd.json` |
| `graph/chain-d-invalid.dd.json` | `enum-invalid` | `graph/chain-d-valid.dd.json` |

## WARN-only path fixtures

| Fixture | Expected WARN class |
|---|---|
| `warn/absolute-path.dd.json` | `address-path-absolute` |
| `warn/non-posix-path.dd.json` | `address-path-non-posix` |
| `warn/path-escape.dd.json` | `address-path-escape` |
| `warn/untracked-target.dd.json` | `address-target-untracked` |
| `warn/missing-target.dd.json` | `address-target-missing` |

## Walk fixtures

- `graph/chain-a.dd.json` -> `chain-b.dd.json` -> `chain-c.dd.json` ->
  `chain-d-invalid.dd.json` proves remaining-depth semantics and finding ownership.
- `graph/chain-b.dd.json` deliberately records a stale basis for `chain-c.dd.json`.
- `graph/cycle-a.dd.json` <-> `cycle-b.dd.json` proves visited-set termination.
- `excluded/sweep-excluded.dd.json` carries `dd.sweep_exclude: true`; direct
  validation still checks it.

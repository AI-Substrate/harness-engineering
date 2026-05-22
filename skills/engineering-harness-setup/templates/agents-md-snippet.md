<!-- foundations: directives#D1, first-principles#27, patterns-that-work#P11 -->

## The engineering harness is non-negotiable.

This repository has a project-side engineering harness. Read `HARNESS.md` before starting non-trivial work.

The agent harness drives. The engineering harness proves.

**Dogfood rule.** When you do work in this repository, you do it *through* the engineering harness — not around it. If you find yourself reaching for a raw build/test/run/lint command, ask whether the harness already wraps it; if not, ask whether the missing command is itself the next harness improvement candidate. The harness exists so that the supported path is easier than the shortcut. Going around the harness erases that property and erodes the front door for the next agent.

Prefer the harness CLI over raw commands where a harness command exists:

```txt
{{HARNESS_CLI_INVOCATION}}
```

Start new sessions with:

```txt
{{HARNESS_CLI_INVOCATION}} --help
{{HARNESS_CLI_INVOCATION}} doctor
```

## Forbidden ↔ required (equivalence table)

The skill detected the host tooling in this repository and populated this table. Each row maps a direct-tool invocation (forbidden because it bypasses the harness) to the equivalent harness CLI subcommand (required because it routes through the proof loop).

<!-- USER CONTENT START -->
| Detected signal | ❌ Forbidden | ✅ Required |
|---|---|---|
{{EQUIVALENCE_TABLE_ROWS}}
<!-- USER CONTENT END -->

The skill populates `{{EQUIVALENCE_TABLE_ROWS}}` at install time from inspection of `package.json`, `pyproject.toml`, `Justfile`, `Makefile`, and `harness/proofs/`. The install pass adds at least three rows. Subsequent runs add rows additively — your own rows between the sentinels are never deleted.

**Add a row when you find friction.** If you used `pnpm test` directly (or any other forbidden invocation) because no harness equivalent existed yet, file the missing equivalence as a friction-log entry and add the row to this table once the equivalent ships.

## Self-check before you act

Ask: *"Could `{{HARNESS_CLI_INVOCATION}} <subcommand>` answer this?"*

- If yes, use that. The harness is the front door for a reason.
- If no, the gap is the answer — file it as a magic-wand entry in `harness/state/friction-log.md` and propose the missing subcommand.

## Reporting when work is complete

When work is complete, report which harness commands were run, what passed, what failed, what remains unproven, and what gate (if any) is now achievable that wasn't before.

If you discover repeated friction, do not only add prose instructions. Consider whether the fix belongs in the harness as a command, check, fixture, diagnostic, default, template, or validation step.

At the end of meaningful work, ask the magic-wand question from `HARNESS.md` and record useful, concrete improvement candidates in `harness/state/friction-log.md` after human review.

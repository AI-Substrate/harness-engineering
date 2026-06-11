# Verification walkthrough — 008 harness-setup-flow (T006)

Manual acceptance check of the reworked `engineering-harness-setup` skill against the spec's 9 acceptance criteria. Each row names the concrete check used and its result. AC9 is proven separately by the `install-and-validate-test-extension` e2e agent (T007).

| AC | Criterion | Check | Result |
|----|-----------|-------|--------|
| AC1 | SKILL is a 3-step mermaid DAG; no CREATE/VALIDATE/STATUS | `grep '```mermaid' SKILL.md` = 1; `grep -E 'CREATE Mode|VALIDATE Mode|STATUS Mode' SKILL.md` = 0 | ✅ PASS |
| AC2 | Install uses npx + `harness init` + `harness doctor` success check + troubleshooting | `npx github:AI-Substrate…` + `npx harness init` + `npx harness doctor` present (5 hits); Troubleshooting table present | ✅ PASS |
| AC3 | Graceful degradation when `harness init` absent | "Graceful fallback" note in Step 1.3 + troubleshooting row "`harness init` → unknown command → expected, skip" | ✅ PASS |
| AC4 | Assess only when no report at `.harness/reports/harnessability/latest.json` (dir fallback) | Step 2 check `test -f …/latest.json || ls …/*`; prose names the fallback (post-fix F001) | ✅ PASS |
| AC5 | Boot via `add-extension` (not hand-written), basic, verified via doctor/boot/help | `npx harness new boot --wrap …` shown as add-extension's under-the-hood call; boot-shape table; Verify block | ✅ PASS |
| AC5a | Boot returns ready/degraded/error verdict + orientation | "return a clear verdict — ready / degraded / error (envelope + exit code)" + "print short orientation" | ✅ PASS |
| AC6 | All 19 templates deleted; skill generates nothing | `ls templates/` → GONE; "What this skill does not do" enumerates no-generation | ✅ PASS |
| AC7 | README mermaid DAG; AUTHORING + skills/README updated + report location | README has 2 mermaid blocks; AUTHORING orchestration-only; skills/README rows + `.harness/reports/harnessability/` updated; README "What it does" realigned to the post-fix contract (`npx harness …` + directory fallback) per companion F003/F004 | ✅ PASS |
| AC8 | Depend only on CLI command/envelope surface (no prose scraping) | "Read only the envelope … use `--json` … never scrape human prose" (Step 1) + guardrail; no bespoke parsing of `doctor`/`help`/assessment prose anywhere in the skill | ✅ PASS |
| AC9 | e2e agent demonstrates install → add-extension → verify | Ran `install-and-validate-test-extension` (verbName=boot, variant=wrap, local) → **PASS**: scaffolded `.harness/extensions/boot.ts` via `add-extension`/`harness new`; `doctor` loaded it, `help` listed it, `npx harness boot --json` = status ok / exit 0 | ✅ PASS |

## Lockstep with the e2e agent (`install-and-validate-test-extension`)

The skill's install + verify recipe matches the e2e agent's recipe:

| Step | Skill (SKILL.md) | e2e agent (prompt.md) |
|------|------------------|------------------------|
| Install core | `npm install github:AI-Substrate/harness-engineering` | `npm install github:AI-Substrate/harness-engineering` (github mode) |
| Sanity | `npx harness doctor --json` | `npx harness doctor --json` (2 occurrences) |
| Author extension | via `add-extension` → `npx harness new …` | drives the `add-extension` skill (never hand-writes) |
| Verify | `npx harness doctor` / `help` / verb | `npx harness doctor --json` / `help` / invoke verb |

Recipes are in lockstep — the human-guided flow and the automated proof exercise the same commands.

## AC8 envelope-only confirmation

Reviewed the full SKILL.md for non-envelope coupling: the only programmatic-output guidance is "use `--json` (status/data/error/next_action) and exit codes — never scrape human prose," reinforced in the guardrails. No step parses human-readable `doctor`/`help`/assessment text. The flow is therefore forward-compatible with a future MCP server over the same command/envelope surface.

**Verdict**: AC1–AC9 PASS. AC9 proven by the e2e run (run `2026-06-09T08-54-42-126Z-7d46`, verdict PASS).

## e2e learnings (folded back)

1. **doctor is `degraded` in a consumer repo** — the e2e showed `npx harness doctor --json` returns top-level `status: degraded` in a throwaway repo (a `cli-build` layer that only applies inside the CLI's own repo) even though the `boot` extension loaded and ran. Folded into SKILL Step 1.4: gate on "the CLI runs and returns an envelope (exit 0)" and read `data.layers`/`data.extensions`, not a top-level `ok`.
2. **local source install packaged no `dist`** — the e2e's `local` file-install path lacked a built `harness/cli/dist`, so the agent built a copy first. This is specific to the *local-source* path; the SKILL's documented **github** path (`npm install github:AI-Substrate/harness-engineering`) builds `dist` via the package `prepare` step, so the documented recipe is unaffected. (Captured as harness-CLI friction for a future fix.)

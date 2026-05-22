<!-- foundations: first-principles#28, #36, patterns-that-work#P21 -->

# Harness Proof Note

- Date:
- Task / change:
- Agent / operator:
- Harness CLI invocation:
- Proof tier: fast | quick | proof

## Commands run

| Command | Ran | Outcome | Evidence |
|---|---|---|---|
|  | yes / no / dry-run / unconfigured | pass / fail / degraded / n/a |  |

Use these enums verbatim. `Ran` records whether the command actually executed (`unconfigured` means the command slot was empty; `dry-run` means the command was simulated). `Outcome` records the verdict (`degraded` covers passed-with-warnings or partially-skipped). `Evidence` is a one-line pointer (log file, screenshot path, output snippet) — not the evidence itself.

## What is proven

-

## What remains unproven

-

## Human judgement required

-

## Harness friction observed

-

## Magic-wand improvement candidate

At the end of this proof, ask:

> If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, or higher quality? Be concrete — name a command, flag, output field, fixture, diagnostic, template, or workflow change.

Record the answer here and file it in `harness/state/friction-log.md` with `magicWandTarget: project | harness | agent`. Good candidates: a missing diagnostic that would have caught the failure, a flag that would have shortened the proof, a fixture that would have made the test deterministic, an output field that would have made the verdict machine-readable.

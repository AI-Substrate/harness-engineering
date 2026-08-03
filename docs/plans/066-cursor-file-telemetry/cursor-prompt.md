# Prompt for the Cursor agent (copy everything below the line)

---

You are working in /Users/jordanknight/substrate/harness-engineering-worktrees/cursor-test
on branch cursor-test. Treat this as normal feature work in this repo — follow its
engineering discipline.

First, orient: run `harness doctor` (if `harness` is not on PATH, use
`node harness/cli/bin/harness.js`). This repo's rule is that work is not done until
`harness checks` (the same gate CI runs) passes.

Task: build a small self-contained text-statistics toolkit under demo/textstat/:

1. lib.mjs — pure functions, no dependencies: wordCount, sentenceCount,
   charFrequency, readingTimeMinutes(text, wpm = 200), topWords(text, n = 10).
2. lib.test.mjs — a node:test suite covering every function, including edge cases
   (empty input, unicode, punctuation-only text). Run with: node --test demo/textstat/
3. cli.mjs — a CLI that takes a file path (or stdin) and prints a stats summary;
   support --json and --top <n> flags.
4. fixtures/ — two sample text files the tests and README examples use.
5. README.md — usage documentation with real, runnable examples.

Work in small increments with AT LEAST four commits, each a coherent step (e.g. lib,
then tests, then CLI, then fixtures+docs). Before EVERY commit: run your tests, then
run `harness checks` and make sure your change introduces no new failures (pre-existing
issues unrelated to demo/textstat are not yours to fix). Commit only files under
demo/textstat/. Do not push the branch, do not merge anything, and do not touch files
outside demo/textstat/.

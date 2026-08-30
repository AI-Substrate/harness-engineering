# Ruling 2026-08-30 — prime-governance orphan branch

**Jordan (via lynx relay)**: prime-governance ruled IN. Orphan branch, standing
worktree, prime pushes directly, never merges to main; main keeps a pointer stub.
Layout: government/ + records/retro/ + docs/prd/ + scratch/ at branch root,
README.md front door; plan folders stay in main with their code.

**Effect here**: this branch. Resolves the /government/-is-gitignored
contradiction (main .gitignore:166 stays byte-stable). fs3 reference:
fs3-governance/government/rulings/2026-08-30-prime-governance-branch.md.

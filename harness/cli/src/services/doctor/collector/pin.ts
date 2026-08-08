/**
 * THE PIN — the git-ai collector version and its per-platform digests, as DATA.
 *
 * Plan 073 · ac-0003, ac-000d, ac-000f. This file is the ENTIRE bump surface: a
 * new git-ai version is a one-file diff to the literal below, produced by
 * `regenerateGitAiPin` (see `regenerate.ts`), never by the install path. That is
 * why it holds no imports, no logic and no derived values — anything a reader
 * has to compute is somewhere a version could drift.
 *
 * `expect_schema_version` rides in the same literal on purpose: binary drift and
 * authorship-note FORMAT drift then arrive in the same diff, and a reviewer
 * approves both or neither. git-ai's own constant is `AUTHORSHIP_LOG_VERSION`
 * (`src/authorship/authorship_log_serialization.rs`).
 *
 * `sha256` values are the digests GitHub publishes for the release assets and
 * that git-ai's own `SHA256SUMS` repeats. Never `latest`, never a range: the
 * install path resolves exactly this tag and refuses anything whose bytes hash
 * differently.
 */
export const GITAI_PIN = {
  /** Release download base; the artifact URL is the base, tag and file joined. */
  release_base_url: 'https://github.com/git-ai-project/git-ai/releases/download',
  /** The exact release tag. NEVER 'latest'. */
  version: 'v1.6.21',
  /** The authorship-note schema this pin was reviewed against. */
  expect_schema_version: 'authorship/3.0.0',
  /** One entry per published platform artifact — all six, no fallback. */
  artifacts: {
    'macos-x64': {
      file: 'git-ai-macos-x64',
      sha256: 'ad816a7ec31d284f6feae83f107e8fa3099623ba3535a333d5031c54744ee307',
    },
    'macos-arm64': {
      file: 'git-ai-macos-arm64',
      sha256: '78990a0929d1eb97243c3f1ce8db415442dfc72c3960fe328aa1c144d6c3f0d2',
    },
    'linux-x64': {
      file: 'git-ai-linux-x64',
      sha256: '8465f82008707bd7f0d867908f0ccf6c591f0cef118f5991e1f245f14b17d3d7',
    },
    'linux-arm64': {
      file: 'git-ai-linux-arm64',
      sha256: '29b87cda34e53a91c5d6687fa446dca09fd658ff3fe45b104f7c2e06d88b3fa6',
    },
    'windows-x64': {
      file: 'git-ai-windows-x64.exe',
      sha256: 'a8d311f0ed027998e1b95dc1fb49ee092ac76e092a8739b9617031e6d7c1f314',
    },
    'windows-arm64': {
      file: 'git-ai-windows-arm64.exe',
      sha256: 'ccb667c274b082ba2e524b7923b29be19764194b8d12d2c3f63a8cb285be8d20',
    },
  },
} as const;

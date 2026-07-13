import { defineConfig, mergeConfig } from 'vitest/config';
import cliConfig from './harness/cli/vitest.config.js';

export default mergeConfig(
  cliConfig,
  defineConfig({
    root: 'harness/cli',
  }),
);

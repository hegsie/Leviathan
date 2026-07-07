import { playwrightLauncher } from '@web/test-runner-playwright';
import { esbuildPlugin } from '@web/dev-server-esbuild';

export default {
  files: 'src/**/*.test.ts',
  nodeResolve: true,
  plugins: [
    esbuildPlugin({ ts: true, target: 'auto', tsconfig: 'tsconfig.json', loaders: { '.png': 'dataurl' } }),
  ],
  browsers: [
    playwrightLauncher({
      product: 'chromium',
      // Allow pointing at a preinstalled Chromium (e.g. in CI/sandbox images
      // where the bundled download is skipped). Falls back to Playwright's
      // default resolution when the env var is unset.
      ...(process.env.PW_CHROMIUM_PATH
        ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
        : {}),
    }),
  ],
  testFramework: {
    config: {
      timeout: 10000,
    },
  },
  coverageConfig: {
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.test.ts', 'node_modules/**/*'],
  },
};

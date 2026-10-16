import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  fullyParallel: false,
  testDir: './e2e',
  timeout: 60_000,
  use: { browserName:'chromium',ignoreHTTPSErrors:true,launchOptions:existsSync(chrome) ? { executablePath:chrome } : {} },
  workers:1
});

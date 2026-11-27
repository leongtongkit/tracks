import { execSync } from 'node:child_process'
import { defineConfig, devices } from '@playwright/test'

// Base URLs come from the environment (CI runs against a staging copy). When
// they are unset, the config builds the site once and starts both sites
// locally with wrangler dev.
const localTracks = !process.env.TRACKS_URL
const localSynth = !process.env.SYNTH_URL
const tracksUrl = process.env.TRACKS_URL ?? 'http://localhost:8787'
const synthUrl = process.env.SYNTH_URL ?? 'http://localhost:8788'

process.env.TRACKS_URL = tracksUrl
process.env.SYNTH_URL = synthUrl
process.env.WRANGLER_SEND_METRICS = 'false'

// Build once, in the main process only (workers inherit the flag).
if ((localTracks || localSynth) && !process.env.E2E_BUILT && !process.env.E2E_SKIP_BUILD) {
  execSync('npm run build', { stdio: 'inherit' })
  process.env.E2E_BUILT = '1'
}

const webServer = [
  ...(localTracks
    ? [{
        command: 'npx --yes wrangler@4 dev --port 8787 --inspector-port 9329',
        url: tracksUrl,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { WRANGLER_SEND_METRICS: 'false' },
      }]
    : []),
  ...(localSynth
    ? [{
        // two wrangler dev servers starting at the same instant can fail to spawn,
        // so the synth one waits for the tracks one when both are local
        command: `${localTracks ? `until curl -sf ${tracksUrl} >/dev/null; do sleep 1; done; ` : ''}exec npx --yes wrangler@4 dev -c wrangler-synth.toml --port 8788 --inspector-port 9330`,
        url: synthUrl,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { WRANGLER_SEND_METRICS: 'false' },
      }]
    : []),
]

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: tracksUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    serviceWorkers: 'block',
  },
  webServer,
  projects: [
    { name: 'chromium-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'chromium-1024', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
  ],
})
